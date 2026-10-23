// Local development server. Vercel serves api/*.js as Web-standard Functions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as auth from './api/auth.js';
import * as me from './api/me.js';
import * as tasks from './api/tasks.js';

const routes = { '/api/auth': auth, '/api/me': me, '/api/tasks': tasks };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (routes[pathname]) {
      const method = req.method.toUpperCase();
      const handler = routes[pathname][method];
      if (!handler) { res.writeHead(405); return res.end('Method not allowed'); }
      const body = method === 'GET' || method === 'HEAD' ? undefined : req;
      const request = new Request(url, { method, headers: req.headers, body, ...(body ? { duplex: 'half' } : {}) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const safeFiles = new Set(['/','/index.html','/styles.css','/app.js','/assets/favicon.svg','/manifest.webmanifest']);
    if (!safeFiles.has(pathname)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(process.cwd(), pathname === '/' ? 'index.html' : pathname);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end('Not found'); }).pipe(res);
  } catch(e) { console.error(e); res.statusCode=500; res.end('Internal server error'); }
});
server.listen(port, () => console.log(`\n  ⚡ NEON TASKS running at http://localhost:${port}\n  Local demo database: .data/dev.json\n`));
