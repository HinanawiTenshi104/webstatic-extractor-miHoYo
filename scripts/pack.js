#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Writable } = require('node:stream');
const ZIP = require('../vendor');
async function main() {
    const directory = path.resolve(process.argv[2]);
    const destination = path.resolve(process.argv[3] || directory + '.zip');
    const manifest = JSON.parse(await fsp.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.failures.length || manifest.warnings.length) throw new Error('Resolve extraction failures/warnings before packaging');
    const files = [...manifest.files.map(f => f.path), 'manifest.json'];
    for (const name of ['README.txt', 'verification.json']) {
        try { await fsp.access(path.join(directory, name)); files.push(name); } catch (_) {}
    }
    const zip = new ZIP({ start(writer) {
        for (const name of files) writer.enqueue({ name, bytes: () => fsp.readFile(path.join(directory, name)) });
        writer.close();
    } });
    await zip.pipeTo(Writable.toWeb(fs.createWriteStream(destination + '.partial')));
    await fsp.rename(destination + '.partial', destination);
    console.log(`Packed ${files.length} entries: ${destination}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
