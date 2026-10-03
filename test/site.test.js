const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build-site');
test('Pages build uses portable relative URLs and ships no upstream CNAME or backend', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webstatic-site-'));
    try {
        // A stale domain from an earlier build must also be removed.
        await fs.writeFile(path.join(directory, 'CNAME'), 'upstream.example');
        await build(directory);
        const html = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
        assert.ok(!html.includes('webstatic-proxy'));
        for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
            assert.ok(!match[1].startsWith('/'));
            assert.ok(!match[1].startsWith('node_modules'));
            await fs.access(path.join(directory, match[1]));
        }
        await assert.rejects(fs.access(path.join(directory, 'CNAME')));
        await assert.rejects(fs.access(path.join(directory, 'server.js')));
        await fs.access(path.join(directory, '.nojekyll'));
        await fs.access(path.join(directory, 'lib/acorn-LICENSE'));
    } finally {
        // The exact directory is created above by mkdtemp under the OS temp directory.
        assert.equal(path.dirname(directory), os.tmpdir());
        assert.ok(path.basename(directory).startsWith('webstatic-site-'));
        await fs.rm(directory, { recursive: true, force: true });
    }
});
