/* Streaming ZIP32 writer. Consume one entry at a time and propagate read failures. */
(function (root) {
    'use strict';
    const encoder = new TextEncoder();
    const table = Uint32Array.from({ length: 256 }, (_, n) => {
        for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
        return n >>> 0;
    });
    function crc32(bytes) {
        let crc = 0xffffffff;
        for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
        return (crc ^ 0xffffffff) >>> 0;
    }
    function header(length, signature) {
        const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
        view.setUint32(0, signature, true); return { bytes, view };
    }
    function ZIP(source) {
        const queue = [], names = new Set();
        let closed = false, cancelled = false, pending, failure;
        function wake() { if (pending) { pending(); pending = null; } }
        const writer = {
            enqueue(file) {
                if (closed || cancelled) throw new Error('ZIP is closed');
                if (!file.name || /(^|\/)\.\.(\/|$)|^[/\\]|^[A-Za-z]:/.test(file.name)) throw new Error('Unsafe ZIP filename');
                if (names.has(file.name)) throw new Error(`Duplicate ZIP filename: ${file.name}`);
                names.add(file.name); queue.push(file); wake();
            },
            close() { closed = true; wake(); }
        };
        Promise.resolve().then(() => source.start(writer)).catch(error => { failure = error; closed = true; wake(); });
        async function* chunks() {
            const central = [];
            let offset = 0;
            while (!cancelled) {
                if (failure) throw failure;
                if (!queue.length) {
                    if (closed) break;
                    await new Promise(resolve => { pending = resolve; }); continue;
                }
                const file = queue.shift();
                const data = file.bytes ? await file.bytes() : new Uint8Array(await new Response(file.stream()).arrayBuffer());
                const name = encoder.encode(file.name);
                if (name.length > 65535 || data.length >= 0xffffffff || offset + data.length + name.length + 30 >= 0xffffffff || central.length >= 65535) throw new Error('ZIP32 limit exceeded; use the CLI to save files directly');
                const crc = crc32(data), local = header(30 + name.length, 0x04034b50);
                local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true);
                // Fixed valid DOS timestamp avoids locale-dependent metadata.
                local.view.setUint16(12, 0x21, true);
                local.view.setUint32(14, crc, true);
                local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true);
                local.view.setUint16(26, name.length, true); local.bytes.set(name, 30);
                central.push({ name, crc, size: data.length, offset });
                yield local.bytes; yield data;
                offset += local.bytes.length + data.length;
                source.onEntry?.(file.name);
            }
            if (cancelled) return;
            const centralOffset = offset;
            for (const entry of central) {
                const item = header(46 + entry.name.length, 0x02014b50);
                item.view.setUint16(4, 20, true); item.view.setUint16(6, 20, true);
                item.view.setUint16(8, 0x800, true); item.view.setUint16(14, 0x21, true);
                item.view.setUint32(16, entry.crc, true); item.view.setUint32(20, entry.size, true); item.view.setUint32(24, entry.size, true);
                item.view.setUint16(28, entry.name.length, true); item.view.setUint32(42, entry.offset, true);
                item.bytes.set(entry.name, 46); yield item.bytes; offset += item.bytes.length;
            }
            if (offset >= 0xffffffff) throw new Error('ZIP32 central directory limit exceeded');
            const end = header(22, 0x06054b50);
            end.view.setUint16(8, central.length, true); end.view.setUint16(10, central.length, true);
            end.view.setUint32(12, offset - centralOffset, true); end.view.setUint32(16, centralOffset, true);
            yield end.bytes;
        }
        const iterator = chunks();
        return new ReadableStream({
            async pull(controller) {
                try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
                catch (error) { cancelled = true; controller.error(error); }
            },
            async cancel() { cancelled = true; wake(); await iterator.return(); }
        });
    }
    if (typeof module === 'object' && module.exports) module.exports = ZIP;
    else root.ZIP = ZIP;
})(typeof globalThis === 'object' ? globalThis : this);
