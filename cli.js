#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./extractor');
const { prepare, safePart, hash } = require('./plan');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function fetchBytes(url) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'WebstaticExtractor/0.2' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length) throw new Error(`Empty response: ${url}`);
            return bytes;
        } catch (error) { last = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); }
    }
    throw last;
}
async function collect(pageURL, output, sourceDir) {
    const html = sourceDir ? await fs.readFile(path.join(sourceDir, '../event-index.html'), 'utf8') : (await fetchBytes(pageURL)).toString('utf8');
    const queue = core.discoverHTML(html, pageURL), seen = new Set(), sources = [];
    if (!queue.length) throw new Error('No event bundles found in HTML. This page layout is not supported yet.');
    await fs.mkdir(path.join(output, '_sources'), { recursive: true });
    await fs.writeFile(path.join(output, '_sources/index.html'), html);
    for (const source of queue) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        const filename = new URL(source.url).pathname.split('/').pop();
        source.text = sourceDir ? await fs.readFile(path.join(sourceDir, filename), 'utf8') : (await fetchBytes(source.url)).toString('utf8');
        await fs.writeFile(path.join(output, '_sources', hash(source.url) + '_' + safePart(filename)), source.text);
        sources.push(source);
        if (source.kind !== 'css') for (const url of core.discoverImports(source.text, source.url)) {
            if (url.startsWith(new URL('.', pageURL).href) && !seen.has(url)) queue.push({ url, kind: 'js' });
        }
    }
    const result = core.analyze(sources);
    for (const match of html.matchAll(/\b(?:src|content)\s*=\s*(['"])(.*?)\1/gi)) {
        const src = core.resourceURL(match[2], pageURL);
        if (src) result.assets.push({ src, id: core.stem(src), source: pageURL, kind: 'html' });
    }
    return { result, sources: sources.map(({ url, kind }) => ({ url, kind })) };
}
function validateBytes(entry, data) {
    if (entry.category === 'spine-json') {
        const value = JSON.parse(data.toString('utf8'));
        if (!value.skeleton || !Array.isArray(value.bones)) throw new Error('JSON is not a Spine skeleton');
    }
    if (entry.category === 'spine-texture' && entry.path.endsWith('.png') && !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Atlas page expects PNG, response has a different format');
    if (entry.url && /^\s*(?:<!doctype html|<html)/i.test(data.subarray(0, 100).toString('utf8'))) throw new Error('Received an HTML error page instead of an asset');
}
async function run(args = process.argv.slice(2)) {
    const pageURL = args[0];
    if (!pageURL || args.includes('--help')) {
        console.log('Usage: node cli.js <event-url> [--output <directory>] [--concurrency 8] [--plan-only] [--source-dir <cached-bundles-directory>]');
        return;
    }
    if (!/^https?:$/.test(new URL(pageURL).protocol)) throw new Error('Expected an HTTP(S) event URL');
    const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
    const output = path.resolve(option('--output', path.join('output', safePart(new URL('.', pageURL).pathname.split('/').filter(Boolean).pop()))));
    const concurrency = Number(option('--concurrency', '8'));
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Concurrency must be between 1 and 32');
    await fs.mkdir(output, { recursive: true });
    console.log('Reading event bundles...');
    const { result, sources } = await collect(pageURL, output, option('--source-dir', null));
    const plan = await prepare(result, pageURL, async url => (await fetchBytes(url)).toString('utf8'));
    console.log(`Found ${plan.spines.length} Spines, ${plan.entries.length} output files, ${plan.warnings.length} warnings.`);
    const report = { pageURL, generatedAt: new Date().toISOString(), sources, statistics: plan.statistics, spines: plan.spines, warnings: plan.warnings, files: [], failures: [] };
    await fs.writeFile(path.join(output, 'extraction-plan.json'), JSON.stringify(plan, null, 2));
    if (args.includes('--plan-only')) return report;
    let previous = { files: [] };
    try { previous = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8')); } catch (_) {}
    const prior = new Map((previous.pageURL === pageURL ? previous.files : []).map(f => [f.path, f]));
    let next = 0, completed = 0;
    const checkpoint = async () => fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(report, null, 2));
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < plan.entries.length) {
            const entry = plan.entries[next++];
            const destination = path.resolve(output, ...entry.path.split('/'));
            if (!destination.startsWith(output + path.sep)) throw new Error(`Output escapes directory: ${entry.path}`);
            try {
                let data, cached = prior.get(entry.path);
                if (cached && cached.url === entry.url) {
                    try { const old = await fs.readFile(destination); if (sha256(old) === cached.sha256) data = old; } catch (_) {}
                }
                if (!data) data = entry.content !== undefined ? Buffer.from(entry.content, 'utf8') : await fetchBytes(entry.url);
                validateBytes(entry, data);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.writeFile(destination + '.partial', data);
                await fs.rename(destination + '.partial', destination);
                report.files.push({ path: entry.path, url: entry.url, source: entry.source, category: entry.category, size: data.length, sha256: sha256(data) });
            } catch (error) {
                report.failures.push({ path: entry.path, url: entry.url, error: error.message });
                console.error(`FAILED ${entry.path}: ${error.message}`);
            }
            completed++;
            if (completed % 100 === 0) console.log(`Saved ${report.files.length}/${plan.entries.length}; failures ${report.failures.length}`);
        }
    }));
    report.files.sort((a,b) => a.path.localeCompare(b.path));
    await checkpoint();
    console.log(`Done: ${report.files.length} saved, ${report.failures.length} failed. ${output}`);
    if (report.failures.length || report.warnings.length) process.exitCode = 1;
    return report;
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, fetchBytes, validateBytes, collect };
