const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../download');
const ZIP = require('../vendor');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('prefetch overlaps downloads while ZIP retains correct file order and bytes', async () => {
    let active = 0, peak = 0;
    const entries = Array.from({ length: 24 }, (_, id) => ({ id, name: `文件-${id}.bin` }));
    const completed = [];
    const queue = createQueue(entries, async entry => {
        active++; peak = Math.max(peak, active);
        await wait(entry.id % 3 === 0 ? 8 : 1);
        active--; completed.push(entry.id);
        return new Uint8Array([entry.id, 80, 75, 3, 4]);
    }, { concurrency: 4 });
    const zip = new ZIP({ start(writer) {
        entries.forEach((entry, index) => writer.enqueue({ name: entry.name, bytes: () => queue.take(index) }));
        writer.close();
    } });
    const bytes = Buffer.from(await new Response(zip).arrayBuffer());
    assert.equal(peak, 4);
    assert.notDeepEqual(completed, entries.map(e => e.id));
    let offset = 0;
    for (const entry of entries) {
        assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
        const length = bytes.readUInt16LE(offset + 26), size = bytes.readUInt32LE(offset + 22);
        assert.equal(bytes.subarray(offset + 30, offset + 30 + length).toString(), entry.name);
        assert.deepEqual([...bytes.subarray(offset + 30 + length, offset + 30 + length + size)], [entry.id, 80, 75, 3, 4]);
        offset += 30 + length + size;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
});

test('slow ZIP consumer cannot cause unbounded read-ahead', async () => {
    let started = 0;
    const queue = createQueue(Array.from({ length: 100 }), async () => {
        started++; return new Uint8Array(1024);
    }, { concurrency: 4, windowSize: 8 });
    await wait(5);
    assert.equal(started, 8);
    await queue.take(0); await wait(5);
    assert.equal(started, 9);
    queue.cancel();
});

test('prefetch failure aborts in-flight reads and rejects even before its ZIP entry', async () => {
    let aborted = 0;
    const queue = createQueue([0, 1, 2, 3, 4], (id, signal) => {
        if (id === 1) return Promise.reject(new Error('HTTP 503'));
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true }));
    }, { concurrency: 4 });
    await assert.rejects(queue.take(0), /HTTP 503/);
    assert.equal(aborted, 3);
});

test('user cancellation aborts active requests and starts no queued requests', async () => {
    let started = 0, aborted = 0;
    const queue = createQueue(Array.from({ length: 20 }), (entry, signal) => {
        started++;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true }));
    }, { concurrency: 4 });
    await wait(1);
    const first = queue.take(0);
    queue.cancel();
    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(started, 4); assert.equal(aborted, 4);
});
