const test = require('node:test');
const assert = require('node:assert/strict');
const ZIP = require('../vendor');
const encode = value => new TextEncoder().encode(value);
test('ZIP preserves file boundaries and UTF-8 names under delayed enqueue', async () => {
    const fixtures = [['人物/图集.atlas', encode('hello')], ['image.png', new Uint8Array([80,75,3,4,0,255,1])], ['empty', new Uint8Array()]];
    const zip = new ZIP({ async start(writer) {
        for (const [name, data] of fixtures) {
            writer.enqueue({ name, bytes: async () => data });
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        writer.close();
    } });
    const bytes = Buffer.from(await new Response(zip).arrayBuffer());
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    assert.equal(bytes.readUInt16LE(end + 10), fixtures.length);
    let offset = bytes.readUInt32LE(end + 16);
    for (const [name, data] of fixtures) {
        assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
        const nameLength = bytes.readUInt16LE(offset + 28), local = bytes.readUInt32LE(offset + 42);
        assert.equal(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), name);
        assert.equal(bytes.readUInt32LE(local), 0x04034b50);
        assert.equal(bytes.readUInt32LE(local + 22), data.length);
        assert.deepEqual(bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + data.length), Buffer.from(data));
        if (name.endsWith('.atlas')) assert.equal(bytes.readUInt32LE(offset + 16), 0x3610a686);
        offset += 46 + nameLength;
    }
    assert.equal(offset, end);
});
test('ZIP rejects duplicate filenames rather than overwriting central directory records', async () => {
    const zip = new ZIP({ start(writer) {
        writer.enqueue({ name: 'same', bytes: () => encode('a') });
        writer.enqueue({ name: 'same', bytes: () => encode('b') });
    } });
    await assert.rejects(new Response(zip).arrayBuffer(), /Duplicate/);
});
test('ZIP producer and network failures reject the consumer', async () => {
    await assert.rejects(new Response(new ZIP({ async start() { throw new Error('producer failed'); } })).arrayBuffer(), /producer failed/);
    await assert.rejects(new Response(new ZIP({ start(writer) {
        writer.enqueue({ name: 'broken', bytes: async () => { throw new Error('network failed'); } }); writer.close();
    } })).arrayBuffer(), /network failed/);
});
