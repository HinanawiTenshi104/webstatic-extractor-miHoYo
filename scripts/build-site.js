#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const files = ['extractor.js', 'plan.js', 'vendor.js', 'download.js', 'app.js', 'LICENSE'];
async function build(output = path.join(__dirname, '../dist')) {
    const root = path.resolve(__dirname, '..');
    await fs.mkdir(output, { recursive: true });
    await fs.mkdir(path.join(output, 'lib'), { recursive: true });
    const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
        .replace('node_modules/acorn/dist/acorn.js', 'lib/acorn.js')
        .replace(/^.*<meta name="webstatic-proxy"[^>]*>\r?\n/m, '');
    await fs.writeFile(path.join(output, 'index.html'), html);
    for (const file of files) await fs.copyFile(path.join(root, file), path.join(output, file));
    await fs.copyFile(require.resolve('acorn'), path.join(output, 'lib/acorn.js'));
    await fs.copyFile(path.join(root, 'node_modules/acorn/LICENSE'), path.join(output, 'lib/acorn-LICENSE'));
    await fs.writeFile(path.join(output, '.nojekyll'), '');
    // Never publish the upstream owner's custom domain or a local proxy setting.
    await fs.rm(path.join(output, 'CNAME'), { force: true });
    return output;
}
if (require.main === module) build().then(output => console.log(`Static site ready: ${output}`)).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { build };
