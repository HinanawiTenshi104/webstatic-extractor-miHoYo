/* Browser UI shares its analyzer and output planner with cli.js. */
let currentPlan = null;
const btn = document.getElementById('btn');
const downloadButton = document.getElementById('download');
const desc = document.getElementById('desc');
const input = document.getElementById('url');
const concurrencyInput = document.getElementById('concurrency');
const cancelButton = document.getElementById('cancel');
let activeDownloads = null;
const localProxy = document.querySelector('meta[name="webstatic-proxy"]')?.content;
function requestURL(url) {
    return localProxy && ['localhost', '127.0.0.1'].includes(location.hostname) && !url.startsWith('data:')
        ? localProxy + '?url=' + encodeURIComponent(url) : url;
}
async function readBytes(url, signal) {
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw signal.reason;
        const request = new AbortController();
        const abort = () => request.abort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => request.abort(new Error('Request timed out')), 60000);
        try {
            const response = await fetch(requestURL(url), { signal: request.signal, credentials: 'omit' });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!bytes.length) throw new Error(`Empty response: ${url}`);
            return bytes;
        } catch (e) {
            if (signal?.aborted) throw signal.reason;
            error = e;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        }
    }
    throw error;
}
const readText = async url => new TextDecoder().decode(await readBytes(url));
async function clk() {
    btn.disabled = true; downloadButton.disabled = true; currentPlan = null;
    try {
        const pageURL = new URL(input.value.trim()).href;
        desc.textContent = '正在读取页面…';
        const html = await readText(pageURL);
        const queue = WebstaticExtractor.discoverHTML(html, pageURL), sources = [], seen = new Set();
        if (!queue.length) throw new Error('没有找到活动资源包，此页面结构暂不支持。');
        for (const source of queue) {
            if (seen.has(source.url)) continue;
            seen.add(source.url); desc.textContent = `正在读取资源包 ${sources.length + 1}…`;
            source.text = await readText(source.url); sources.push(source);
            if (source.kind !== 'css') for (const url of WebstaticExtractor.discoverImports(source.text, source.url)) {
                if (url.startsWith(new URL('.', pageURL).href) && !seen.has(url)) queue.push({ url, kind: 'js' });
            }
        }
        desc.textContent = '正在解析素材…';
        await new Promise(resolve => setTimeout(resolve, 0));
        const result = WebstaticExtractor.analyze(sources);
        for (const match of html.matchAll(/\b(?:src|content)\s*=\s*(['"])(.*?)\1/gi)) {
            const src = WebstaticExtractor.resourceURL(match[2], pageURL);
            if (src) result.assets.push({ src, id: WebstaticExtractor.stem(src), source: pageURL, kind: 'html' });
        }
        currentPlan = await WebstaticPlan.prepare(result, pageURL, readText);
        currentPlan.pageURL = pageURL;
        desc.textContent = `找到 ${currentPlan.spines.length} 套 Spine，共 ${currentPlan.entries.length} 个文件。` +
            (currentPlan.warnings.length ? '\n请检查提取报告：' + currentPlan.warnings.join('\n') : '\n图集、骨骼与贴图已配对，可以下载。');
        downloadButton.disabled = currentPlan.entries.length === 0;
    } catch (error) { desc.textContent = '解析失败：' + error.message; console.error(error); }
    finally { btn.disabled = false; }
}
async function downloadZip() {
    if (!currentPlan) return;
    btn.disabled = true; downloadButton.disabled = true;
    concurrencyInput.disabled = true;
    let writable;
    try {
        const name = new URL('.', currentPlan.pageURL).pathname.split('/').filter(Boolean).pop() + '.zip';
        // Invoke during the button's user gesture, before any network awaits.
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
            writable = await handle.createWritable();
        }
        const plan = currentPlan, encoder = new TextEncoder(), started = performance.now();
        let written = 0;
        let progress = { completed: 0, bytes: 0, total: plan.entries.length };
        function showProgress() {
            const seconds = Math.max((performance.now() - started) / 1000, 0.001);
            const mib = progress.bytes / 1048576;
            desc.textContent = `已获取 ${progress.completed}/${progress.total}，已打包 ${written}/${progress.total}\n` +
                `${mib.toFixed(1)} MiB · 平均 ${(mib / seconds).toFixed(1)} MiB/s`;
        }
        activeDownloads = WebstaticDownloads.createQueue(plan.entries, async (entry, signal) => {
            const data = entry.content !== undefined ? encoder.encode(entry.content) : await readBytes(entry.url, signal);
            if (entry.category === 'spine-json') {
                const json = JSON.parse(new TextDecoder().decode(data));
                if (!json.skeleton || !Array.isArray(json.bones)) throw new Error('无效的 Spine JSON：' + entry.path);
            }
            if (entry.category === 'spine-texture' && entry.path.endsWith('.png') && [137,80,78,71,13,10,26,10].some((v,i) => data[i] !== v)) throw new Error('贴图不是 PNG：' + entry.path);
            if (entry.url && /^\s*(?:<!doctype html|<html)/i.test(new TextDecoder().decode(data.subarray(0, 100)))) throw new Error('素材返回了 HTML：' + entry.path);
            return data;
        }, {
            concurrency: Number(concurrencyInput.value),
            onProgress(value) { progress = value; showProgress(); }
        });
        const downloads = activeDownloads;
        cancelButton.hidden = false;
        const archive = new ZIP({ start(writer) {
            for (const [index, entry] of plan.entries.entries()) writer.enqueue({ name: entry.path, async bytes() {
                const data = await downloads.take(index);
                return data;
            } });
            writer.enqueue({ name: 'manifest.json', bytes: () => encoder.encode(JSON.stringify({ pageURL: plan.pageURL, statistics: plan.statistics, spines: plan.spines, warnings: plan.warnings }, null, 2)) });
            writer.close();
        }, onEntry() { written = Math.min(written + 1, plan.entries.length); showProgress(); } });
        if (writable) await archive.pipeTo(writable);
        else {
            const blob = await new Response(archive).blob();
            const url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url; a.download = name; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        desc.textContent = `下载完成：${plan.spines.length} 套 Spine，${plan.entries.length} 个素材文件。`;
    } catch (error) {
        activeDownloads?.cancel(error);
        if (writable) { try { await writable.abort(error); } catch (_) {} }
        desc.textContent = error.name === 'AbortError' ? '已取消下载。' : '下载失败：' + error.message;
        console.error(error);
    } finally {
        activeDownloads?.cancel(); activeDownloads = null;
        cancelButton.hidden = true;
        concurrencyInput.disabled = false;
        btn.disabled = false; downloadButton.disabled = !currentPlan;
    }
}
function cancelDownload() { activeDownloads?.cancel(); }
