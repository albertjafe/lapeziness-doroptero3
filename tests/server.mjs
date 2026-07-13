import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  try {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const filePath = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, '127.0.0.1');
