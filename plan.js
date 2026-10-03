(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./extractor'));
    else root.WebstaticPlan = factory(root.WebstaticExtractor);
})(typeof globalThis === 'object' ? globalThis : this, function (core) {
    'use strict';
    function safePart(value) {
        let part = String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
        if (!part || part === '.' || part === '..') part = '_';
        if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) part = '_' + part;
        return part;
    }
    function hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return (h >>> 0).toString(16).padStart(8, '0');
    }
    async function prepare(result, pageURL, readText) {
        const entries = [], warnings = [...result.warnings], usedURLs = new Set(), names = new Set();
        function add(entry) {
            const key = entry.path.toLowerCase();
            if (names.has(key)) throw new Error(`Duplicate output path: ${entry.path}`);
            names.add(key); entries.push(entry); if (entry.url) usedURLs.add(entry.url);
        }
        const spines = [];
        for (const spine of result.spines) {
            let dir = `spines/${safePart(spine.id)}`;
            if (names.has(`${dir}/${safePart(spine.id)}.atlas`.toLowerCase())) dir += '_' + hash(spine.atlas + JSON.stringify(spine.json));
            const name = safePart(spine.id);
            const atlasURL = core.isAtlas(spine.atlas) ? null : new URL(spine.atlas, spine.source).href;
            const atlas = atlasURL ? await readText(atlasURL) : spine.atlas;
            if (!core.isAtlas(atlas)) throw new Error(`Invalid atlas: ${spine.id}`);
            add({ path: `${dir}/${name}.atlas`, content: atlas, category: 'atlas', source: spine.source });
            if (atlasURL) usedURLs.add(atlasURL);
            let json = spine.json;
            if (typeof json === 'string' && json.trim().startsWith('{')) json = JSON.parse(json);
            if (typeof json === 'string') add({ path: `${dir}/${name}.json`, url: new URL(json, spine.source).href, category: 'spine-json' });
            else add({ path: `${dir}/${name}.json`, content: JSON.stringify(json, null, 2), category: 'spine-json', source: spine.source });
            const pages = [];
            for (const page of core.pageNames(atlas)) {
                const id = core.stem(page);
                const matching = result.assets.filter(a => (a.id === id || core.stem(a.src) === id) && (a.src.startsWith('data:image/') || /\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i.test(a.src)));
                const preferred = matching.filter(a => a.kind === 'manifest' && a.source === spine.source);
                const candidates = [...new Set((preferred.length ? preferred : matching).map(a => a.src))];
                const url = candidates.length === 1 ? candidates[0] : atlasURL && candidates.length === 0 ? new URL(page, atlasURL).href : null;
                if (!url) { warnings.push(`${spine.id}: ${candidates.length ? 'ambiguous' : 'missing'} atlas page ${page}`); continue; }
                // Retain the relative filename inside the atlas, including any subdirectory.
                const parts = page.replace(/\\/g, '/').split('/');
                if (parts.some(p => safePart(p) !== p)) throw new Error(`Unsafe atlas page path: ${page}`);
                const path = `${dir}/${parts.join('/')}`;
                add({ path, url, category: 'spine-texture' }); pages.push({ page, path, url });
            }
            spines.push({ id: spine.id, directory: dir, atlas: `${dir}/${name}.atlas`, json: `${dir}/${name}.json`, pages });
        }
        for (const asset of result.assets) {
            if (usedURLs.has(asset.src)) continue;
            let path;
            if (asset.src.startsWith('data:')) {
                const mime = asset.src.match(/^data:([^;,]+)/)[1];
                path = `assets/inline/${hash(asset.src)}.${({ 'image/svg+xml': 'svg', 'image/jpeg': 'jpg' })[mime] || safePart(mime.split('/')[1])}`;
            } else {
                const url = new URL(asset.src), base = new URL('.', pageURL);
                const relative = asset.src.startsWith(base.href) ? url.pathname.slice(base.pathname.length) : url.hostname + url.pathname;
                path = 'assets/' + relative.split('/').filter(Boolean).map(p => safePart(decodeURIComponent(p))).join('/');
                if (url.search) path = path.replace(/(\.[^./]+)$/, '_' + hash(url.search) + '$1');
            }
            if (names.has(path.toLowerCase())) path = path.replace(/(\.[^./]+)$/, '_' + hash(asset.src) + '$1');
            add({ path, url: asset.src, category: 'asset' });
        }
        return { entries, spines, warnings, statistics: result.statistics };
    }
    return { prepare, safePart, hash };
});
