const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extractor');
const { prepare } = require('../plan');
const { validateBytes } = require('../cli');
const base = 'https://act.mihoyo.com/ys/event/demo/';
const atlas = 'hero.png\nsize: 10, 20\nfilter: Linear,Linear\nhead\nbounds: 0,0,10,20\n';
const skeleton = { skeleton: { spine: '4.2.0' }, bones: [{ name: 'root' }] };
const js = (text, filename = 'index.js') => ({ url: base + filename, text, kind: 'js' });

test('minified manifest without _MANIFEST, raw atlas and external JSON across chunks', async () => {
    const result = core.analyze([
        js(`self.chunks.push([[1],{1:function(e,n,t){t.d(n,{WC:function(){return o}});var images=[{id:"hero",src:t(4),type:"image"}],o={hero:{atlas:t(2),json:t(3)}}},2:function(e){e.exports=${JSON.stringify(atlas)}}}]);`),
        js('self.chunks.push([[2],{3:function(e,n,t){e.exports=t.p+"spine/hero.12345678.json"},4:function(e,n,t){e.exports=t.p+"images/hero.abcdef12..png"}}]);', 'extra.js')
    ]);
    assert.equal(result.spines.length, 1);
    assert.equal(result.spines[0].atlas, atlas);
    assert.equal(result.spines[0].json, base + 'spine/hero.12345678.json');
    assert.deepEqual(result.warnings, []);
    const plan = await prepare(result, base + 'index.html', () => assert.fail('inline atlas must not be fetched'));
    assert.deepEqual(plan.entries.map(e => e.path), ['spines/hero/hero.atlas', 'spines/hero/hero.json', 'spines/hero/hero.png']);
    assert.equal(plan.entries[2].url, base + 'images/hero.abcdef12..png');
});

test('legacy array module factories and JSON.parse retain Unicode', () => {
    const result = core.analyze([js(`webpackJsonp([[0],[function(e,n,t){n.SPINE_MANIFEST={人物:{atlas:t(1),json:t(2)}}},function(e){e.exports=${JSON.stringify(atlas)}},function(e){e.exports=JSON.parse(${JSON.stringify(JSON.stringify(skeleton))})}]]);`)]);
    assert.equal(result.spines[0].id, '人物');
    assert.deepEqual(result.spines[0].json, skeleton);
});

test('Vite imports, unexported names and Object.values/Object.assign', () => {
    const result = core.analyze([
        js(`import a from './atlas.js';import {s as j} from './data.js';const Mr={hero:{atlas:Object.values(Object.assign({"hero.atlas":{default:a}}))[0].default,json:j}};`),
        js(`export default ${JSON.stringify(atlas)};`, 'atlas.js'),
        js(`const data=${JSON.stringify(skeleton)};export {data as s};`, 'data.js')
    ]);
    assert.equal(result.spines.length, 1);
    assert.equal(result.spines[0].atlas, atlas);
    assert.deepEqual(JSON.parse(JSON.stringify(result.spines[0].json)), skeleton);
});

test('untrusted calls are not executed and unresolved data is reported', () => {
    const result = core.analyze([js(`throw Error('must not execute');const x={bad:{atlas:stealCredentials(),json:fetch('/account')}};`)]);
    assert.equal(result.spines.length, 0);
    assert.equal(result.warnings.length, 1);
});

test('multi-page atlas and duplicate URLs retain every required output alias', async () => {
    const multi = atlas + '\nhero_2.png\nsize: 10,20\nfilter: Linear,Linear\nbody\nbounds: 0,0,10,20\n';
    const result = { spines: [{ id: 'hero', atlas: multi, json: skeleton, source: base }], assets: [
        { id: 'hero', src: base + 'shared.png', source: base, kind: 'manifest' },
        { id: 'hero_2', src: base + 'shared.png', source: base, kind: 'manifest' }
    ], warnings: [] };
    const plan = await prepare(result, base, () => {});
    assert.equal(plan.spines[0].pages.length, 2);
    assert.equal(plan.entries.filter(e => e.url === base + 'shared.png').length, 2);
});

test('ambiguous or missing textures are never silently reported complete', async () => {
    const result = { spines: [{ id: 'hero', atlas, json: skeleton, source: base }], assets: [], warnings: [] };
    assert.match((await prepare(result, base)).warnings[0], /missing/);
    result.assets = ['a', 'b'].map(v => ({ id: 'hero', src: base + v + '.png' }));
    assert.match((await prepare(result, base)).warnings[0], /ambiguous/);
});

test('unsafe atlas paths are rejected; similar asset filenames do not overwrite', async () => {
    await assert.rejects(prepare({ spines: [{ id: 'hero', atlas: atlas.replace('hero.png', '../hero.png'), json: skeleton, source: base }], assets: [{ id: 'hero', src: base + 'hero.png' }], warnings: [] }, base), /Unsafe/);
    const plan = await prepare({ spines: [], assets: [{ src: base + 'img.png?a=1' }, { src: base + 'img.png?a=2' }], warnings: [] }, base);
    assert.notEqual(plan.entries[0].path, plan.entries[1].path);
});

test('HTML source discovery ignores SDK/analytics; CSS URLs retain query strings', () => {
    assert.deepEqual(core.discoverHTML(`<script src='index.js'></script><script src='/sdk.js'></script><link href="style.css" rel="stylesheet">`, base), [
        { url: base + 'index.js', kind: 'js' }, { url: base + 'style.css', kind: 'css' }
    ]);
    const result = core.analyze([{ url: base + 'style.css', kind: 'css', text: `.a{background:url('./图.png?v=1')}` }]);
    assert.equal(result.assets[0].src, base + '%E5%9B%BE.png?v=1');
    assert.deepEqual(core.discoverImports(`import './chunk.js'; import('./lazy.js')`, base + 'index.js'), [base + 'chunk.js', base + 'lazy.js']);
});

test('JSON and texture validation rejects successful HTTP error payloads', () => {
    assert.throws(() => validateBytes({ category: 'spine-json' }, Buffer.from('{"error":"denied"}')), /not a Spine/);
    assert.throws(() => validateBytes({ category: 'spine-texture', path: 'hero.png' }, Buffer.from('not png')), /different format/);
    validateBytes({ category: 'spine-json' }, Buffer.from(JSON.stringify(skeleton)));
});
