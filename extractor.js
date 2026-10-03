/* Static analysis only: downloaded JavaScript is never evaluated. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('acorn'));
    else root.WebstaticExtractor = factory(root.acorn);
})(typeof globalThis === 'object' ? globalThis : this, function (acorn) {
    'use strict';
    const UNKNOWN = Symbol('unknown');
    const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
    const keyOf = node => node && (node.type === 'Identifier' ? node.name : node.value);
    const media = /\.(?:png|jpe?g|webp|gif|avif|svg|ico|mp3|ogg|wav|m4a|mp4|webm|json|atlas|skel|bin|ktx2?|woff2?|ttf|otf)(?:[?#].*)?$/i;
    function resourceURL(value, base) {
        if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
        if (/^data:(?:image|audio|video|font|application\/octet-stream)\//.test(value) || /^data:image\//.test(value)) return value;
        if (!media.test(value) || /[<>"{}]/.test(value)) return null;
        try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) ? u.href : null; }
        catch (_) { return null; }
    }
    function pageNames(text) {
        if (typeof text !== 'string') return [];
        const lines = text.replace(/\r/g, '').split('\n');
        return lines.filter((line, i) => line.trim() && !/^\s/.test(line) && !line.includes(':') &&
            /^\s*(?:size|format|filter|pma)\s*:/.test(lines[i + 1] || '')).map(s => s.trim());
    }
    function isAtlas(text) { return pageNames(text).length > 0 && /\b(?:bounds|xy)\s*:/.test(text); }
    function stem(url) {
        const name = decodeURIComponent(new URL(url, 'https://placeholder.invalid/').pathname.split('/').pop());
        return name.replace(/\.[^.]+$/, '').replace(/[._-][a-f\d]{8,64}\.?$/i, '');
    }
    function analyze(sources) {
        const records = [], scopes = new WeakMap(), parents = new WeakMap(), values = new WeakMap();
        const tableFor = new WeakMap(), tables = [], roots = new Map(), warnings = [];
        function visit(node, scope, parent, record) {
            if (!node || typeof node.type !== 'string') return;
            parents.set(node, parent);
            if (node.type === 'Program' || /Function/.test(node.type)) {
                scope = { parent: scope, bindings: new Map(), record, fn: node, nodes: [] };
                if (node.type === 'Program') record.scope = scope;
                for (const param of node.params || []) if (param.type === 'Identifier') scope.bindings.set(param.name, null);
            }
            scopes.set(node, scope);
            scope.nodes.push(node);
            record.nodes.push(node);
            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) scope.bindings.set(node.id.name, node.init);
            if (node.type === 'ImportDeclaration') for (const spec of node.specifiers) scope.bindings.set(spec.local.name, { imported: true, source: node.source.value, name: spec.type === 'ImportDefaultSpecifier' ? 'default' : keyOf(spec.imported) });
            if (node.type === 'ObjectExpression') {
                const functions = node.properties.filter(p => p.type === 'Property' && /FunctionExpression/.test(p.value.type));
                if (functions.length && functions.length === node.properties.length) {
                    const table = new Map(functions.map(p => [String(keyOf(p.key)), p.value]));
                    tables.push(table);
                    for (const p of functions) tableFor.set(p.value, table);
                }
            }
            // webpack 4 also uses arrays of module factories.
            if (node.type === 'ArrayExpression') {
                const funcs = node.elements.filter(p => p && /FunctionExpression/.test(p.type));
                if (funcs.length && funcs.length === node.elements.filter(Boolean).length) {
                    const table = new Map(node.elements.map((p, i) => [String(i), p]).filter(([, p]) => p));
                    tables.push(table); for (const fn of funcs) tableFor.set(fn, table);
                }
            }
            for (const [key, child] of Object.entries(node)) {
                if (key === 'start' || key === 'end') continue;
                if (Array.isArray(child)) child.forEach(n => visit(n, scope, node, record));
                else if (child && typeof child.type === 'string') visit(child, scope, node, record);
            }
        }
        for (const source of sources.filter(s => s.kind !== 'css')) {
            try {
                const ast = acorn.parse(source.text, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
                const record = { ...source, nodes: [], ast };
                records.push(record); roots.set(source.url, record); visit(ast, null, null, record);
            } catch (error) { warnings.push(`Cannot parse ${source.url}: ${error.message}`); }
        }
        // Top-level chunks share their module ID space; prefer a factory's own table.
        const globalModules = new Map();
        tables.forEach(table => table.forEach((fn, id) => { if (!globalModules.has(id)) globalModules.set(id, fn); }));
        const moduleCache = new WeakMap(), resolving = new WeakSet();
        function getter(node) {
            if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') return evaluate(node.body);
            const ret = node.body && node.body.body && node.body.body.find(n => n.type === 'ReturnStatement');
            return ret ? evaluate(ret.argument) : UNKNOWN;
        }
        function moduleValue(fn) {
            if (!fn || resolving.has(fn)) return UNKNOWN;
            if (moduleCache.has(fn)) return moduleCache.get(fn);
            resolving.add(fn);
            const moduleName = keyOf(fn.params[0]), exportsName = keyOf(fn.params[1]), requireName = keyOf(fn.params[2]);
            let value = Object.create(null);
            const scope = scopes.get(fn);
            for (const n of scope.nodes) {
                if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression') {
                    const obj = keyOf(n.left.object), key = keyOf(n.left.property);
                    if (obj === moduleName && key === 'exports') value = evaluate(n.right);
                    else if (obj === exportsName && typeof value === 'object' && value !== null) value[key] = evaluate(n.right);
                }
                if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && keyOf(n.callee.object) === requireName && keyOf(n.callee.property) === 'd') {
                    const definition = n.arguments[1];
                    if (definition && definition.type === 'ObjectExpression') for (const p of definition.properties) value[keyOf(p.key)] = getter(p.value);
                    // Recent Rspack/webpack emits a compact [name, getter] definition.
                    if (definition && definition.type === 'ArrayExpression') {
                        const entries = definition.elements;
                        for (let i = 0; i < entries.length;) {
                            const key = evaluate(entries[i++]), entry = entries[i++];
                            value[key] = entry && entry.value === 0 ? evaluate(entries[i++]) : entry ? getter(entry) : UNKNOWN;
                        }
                    }
                    if (n.arguments[2]) value[evaluate(definition)] = getter(n.arguments[2]);
                }
            }
            resolving.delete(fn); moduleCache.set(fn, value); return value;
        }
        function evaluate(node, seen = new Set()) {
            if (!node || seen.has(node)) return UNKNOWN;
            if (values.has(node)) return values.get(node);
            seen = new Set(seen); seen.add(node);
            const ev = n => evaluate(n, seen), scope = scopes.get(node);
            let result = UNKNOWN;
            switch (node.type) {
                case 'Literal': result = node.value; break;
                case 'Identifier': {
                    for (let s = scope; s; s = s.parent) if (s.bindings.has(node.name)) {
                        const binding = s.bindings.get(node.name);
                        if (binding && binding.imported) {
                            const rec = roots.get(new URL(binding.source, s.record.url).href);
                            if (rec) {
                                const exp = rec.ast.body.find(n => binding.name === 'default' && n.type === 'ExportDefaultDeclaration');
                                if (exp) result = ev(exp.declaration);
                                else {
                                    const named = rec.ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.specifiers.some(p => keyOf(p.exported) === binding.name));
                                    const spec = named && named.specifiers.find(p => keyOf(p.exported) === binding.name);
                                    if (spec) result = ev(spec.local);
                                    else if (rec.scope.bindings.has(binding.name)) result = ev(rec.scope.bindings.get(binding.name));
                                }
                            }
                        } else if (binding) result = ev(binding);
                        break;
                    }
                    break;
                }
                case 'ObjectExpression': {
                    result = Object.create(null);
                    for (const p of node.properties) {
                        if (p.type === 'SpreadElement') { const v = ev(p.argument); if (v && typeof v === 'object') Object.assign(result, v); }
                        else if (p.type === 'Property' && p.kind === 'init') result[p.computed ? ev(p.key) : keyOf(p.key)] = ev(p.value);
                    }
                    break;
                }
                case 'ArrayExpression': result = node.elements.map(ev); break;
                case 'AssignmentExpression': result = ev(node.right); break;
                case 'SequenceExpression': result = ev(node.expressions[node.expressions.length - 1]); break;
                case 'UnaryExpression': {
                    const v = ev(node.argument);
                    if (v !== UNKNOWN) result = node.operator === '-' ? -v : node.operator === '+' ? +v : node.operator === '!' ? !v : UNKNOWN;
                    break;
                }
                case 'BinaryExpression': {
                    const a = ev(node.left), b = ev(node.right);
                    if (node.operator === '+' && a !== UNKNOWN && b !== UNKNOWN) result = a + b;
                    break;
                }
                case 'TemplateLiteral': {
                    const parts = node.expressions.map(ev);
                    if (!parts.includes(UNKNOWN)) result = node.quasis.map((q, i) => q.value.cooked + (parts[i] ?? '')).join('');
                    break;
                }
                case 'MemberExpression': {
                    const key = node.computed ? ev(node.property) : keyOf(node.property);
                    if (key === 'p' && node.object.type === 'Identifier') {
                        for (let s = scope; s; s = s.parent) if (tableFor.has(s.fn) && keyOf(s.fn.params[2]) === node.object.name) { result = new URL('.', s.record.url).href; break; }
                    }
                    if (result === UNKNOWN) { const obj = ev(node.object); if (obj !== UNKNOWN && own(obj, key)) result = obj[key]; }
                    break;
                }
                case 'CallExpression': {
                    const callee = node.callee;
                    if (callee.type === 'Identifier' && node.arguments.length === 1) {
                        const id = ev(node.arguments[0]);
                        for (let s = scope; s; s = s.parent) if (tableFor.has(s.fn) && keyOf(s.fn.params[2]) === callee.name) {
                            result = moduleValue(tableFor.get(s.fn).get(String(id)) || globalModules.get(String(id))); break;
                        }
                    } else if (callee.type === 'MemberExpression') {
                        const object = keyOf(callee.object), method = keyOf(callee.property);
                        const args = node.arguments.map(ev);
                        if (object === 'JSON' && method === 'parse' && typeof args[0] === 'string') { try { result = JSON.parse(args[0]); } catch (_) {} }
                        if (object === 'Object' && !args.includes(UNKNOWN)) {
                            if (method === 'assign' && args.every(v => v && typeof v === 'object')) result = Object.assign(Object.create(null), ...args);
                            if (method === 'values' && args[0] && typeof args[0] === 'object') result = Object.values(args[0]);
                            if (method === 'freeze') result = args[0];
                        }
                    }
                    break;
                }
            }
            // Unknown values may be cyclic, so do not permanently cache them.
            if (result !== UNKNOWN) values.set(node, result);
            return result;
        }
        const spines = [], assets = [], atlasTexts = new Set(), assetKeys = new Set(), spineKeys = new Set();
        let candidates = 0;
        function addAsset(src, id, source, kind) {
            src = resourceURL(src, source);
            if (!src) return;
            id = typeof id === 'string' ? id : src.startsWith('data:') ? `inline_${assets.length}` : stem(src);
            const key = `${id}\n${src}`;
            if (!assetKeys.has(key)) { assets.push({ id, src, source, kind }); assetKeys.add(key); }
        }
        for (const record of records) for (const node of record.nodes) {
            if (node.type === 'Literal' && typeof node.value === 'string') {
                if (isAtlas(node.value)) atlasTexts.add(node.value);
                // Literal relative paths in bundled vendor libraries are often examples.
                if (record.kind !== 'vendor') addAsset(node.value, null, record.url, 'static');
            }
            if (node.type === 'ObjectExpression') {
                const props = new Map(node.properties.filter(p => p.type === 'Property').map(p => [keyOf(p.key), p.value]));
                if (props.has('atlas') && props.has('json')) {
                    candidates++;
                    const atlas = evaluate(props.get('atlas')), json = evaluate(props.get('json'));
                    const parent = parents.get(node), id = parent && parent.type === 'Property' ? String(keyOf(parent.key)) : `spine_${spines.length}`;
                    if (!(isAtlas(atlas) || resourceURL(atlas, record.url)) || !(typeof json === 'string' || json && typeof json === 'object')) {
                        warnings.push(`Unresolved Spine entry ${id} in ${record.url}`); continue;
                    }
                    const key = `${id}\n${atlas}\n${JSON.stringify(json)}`;
                    if (!spineKeys.has(key)) {
                        spineKeys.add(key); spines.push({ id, atlas, json, source: record.url });
                    }
                }
                if (props.has('src') && props.has('id')) addAsset(evaluate(props.get('src')), evaluate(props.get('id')), record.url, 'manifest');
            }
            if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && keyOf(node.left.property) === 'exports') addAsset(evaluate(node.right), null, record.url, 'module');
        }
        // Recover standalone atlas exports even when a manifest is not statically resolvable.
        for (const atlas of atlasTexts) if (!spines.some(s => s.atlas === atlas)) {
            const id = stem(pageNames(atlas)[0]);
            const json = assets.find(a => a.id === id && /\.json(?:[?#]|$)/i.test(a.src));
            if (json) spines.push({ id, atlas, json: json.src, source: json.source });
            else warnings.push(`Unpaired atlas: ${id}`);
        }
        for (const source of sources.filter(s => s.kind === 'css')) {
            for (const match of source.text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) addAsset(match[2], null, source.url, 'css');
        }
        return { spines, assets, warnings, statistics: { spineCandidates: candidates, uniqueAtlasTexts: atlasTexts.size, parsedScripts: records.length } };
    }
    function discoverHTML(html, pageURL) {
        const sources = [];
        const base = new URL('.', pageURL).href;
        for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
            const attr = tag[0].match(/\b(?:src|href)\s*=\s*(['"])(.*?)\1/i);
            if (!attr) continue;
            const url = new URL(attr[2].replace(/&amp;/g, '&'), pageURL).href;
            // Restrict the crawl to the event's static bundle; don't fetch SDKs or analytics.
            if (!url.startsWith(base) || !/\.(?:m?js|css)(?:[?#]|$)/i.test(url)) continue;
            sources.push({ url, kind: /\.css(?:[?#]|$)/i.test(url) ? 'css' : /\/vendors?[^/]*\.js/.test(url) ? 'vendor' : 'js' });
        }
        return [...new Map(sources.map(s => [s.url, s])).values()];
    }
    function discoverImports(text, sourceURL) {
        const urls = new Set();
        let ast;
        try { ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' }); } catch (_) { return []; }
        function walk(node) {
            if (!node || typeof node.type !== 'string') return;
            if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source && typeof node.source.value === 'string') {
                const value = node.source.value;
                if (/^(?:\.|\/|https?:)/.test(value)) urls.add(new URL(value, sourceURL).href);
            }
            for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value.type === 'string') walk(value);
        }
        walk(ast); return [...urls];
    }
    return { analyze, discoverHTML, discoverImports, pageNames, isAtlas, resourceURL, stem };
});
