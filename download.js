/* Bounded prefetch: concurrent reads, ordered consumption, prompt cancellation. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WebstaticDownloads = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    function createQueue(entries, load, options = {}) {
        const concurrency = options.concurrency ?? 8;
        const windowSize = options.windowSize ?? concurrency * 2;
        if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 ||
            !Number.isInteger(windowSize) || windowSize < concurrency) throw new Error('Invalid download concurrency/window');
        const controller = new AbortController(), slots = new Map();
        let next = 0, consumed = 0, active = 0, completed = 0, bytes = 0, failure;
        function cancel(reason = new DOMException('Download cancelled', 'AbortError')) {
            if (!failure) failure = reason;
            controller.abort(failure);
            slots.clear();
        }
        function fill() {
            while (!failure && active < concurrency && next < entries.length && next < consumed + windowSize) {
                const index = next++;
                active++;
                // Attach both handlers immediately, including for not-yet-consumed entries.
                const task = Promise.resolve().then(() => {
                    if (failure) throw failure;
                    return load(entries[index], controller.signal);
                }).then(data => {
                    if (failure) return { error: failure };
                    completed++; bytes += data.byteLength;
                    options.onProgress?.({ completed, bytes, total: entries.length });
                    return { data };
                }).catch(error => {
                    cancel(error);
                    return { error };
                }).finally(() => { active--; fill(); });
                slots.set(index, task);
            }
        }
        async function take(index) {
            if (failure) throw failure;
            if (index !== consumed || index >= entries.length) throw new Error('Downloads must be consumed in order');
            const result = await slots.get(index);
            if (failure) throw failure;
            if (result.error) throw result.error;
            slots.delete(index); consumed++;
            fill();
            return result.data;
        }
        fill();
        return { take, cancel };
    }
    return { createQueue };
});
