'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fetchBytes } = require('./cli');
const root = __dirname;
const allowed = hostname => /^(?:[a-z0-9-]+\.)*(?:mihoyo\.com|hoyoverse\.com|hoyolab\.com)$/.test(hostname);
const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        if (url.pathname === '/fetch') {
            const target = new URL(url.searchParams.get('url'));
            if (target.protocol !== 'https:' || target.username || target.password || target.port || !allowed(target.hostname)) throw new Error('Unsupported asset host');
            const data = await fetchBytes(target.href);
            response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(data); return;
        }
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
        const ext = path.extname(file);
        const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
        const content = await fs.readFile(file);
        response.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' }); response.end(content);
    } catch (error) { if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(error.message); }
});
server.listen(Number(process.env.PORT || 8765), '127.0.0.1', () => console.log(`Webstatic Extractor: http://127.0.0.1:${server.address().port}`));
