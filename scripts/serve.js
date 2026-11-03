#!/usr/bin/env node
// Простой статический сервер для предпросмотра: npm start → http://localhost:8000/
// (страница работает и без сервера — достаточно открыть index.html в браузере).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

// Кривые адреса — 400, а не падение процесса. Выход за корень, скрытые каталоги
// (.git, .github) и node_modules запрещены, в том числе после декодирования пути.
function resolveFile(reqUrl, root = ROOT) {
  root = path.resolve(root);
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(reqUrl, 'http://x').pathname); }
  catch (_) { return { status: 400 }; }
  if (urlPath.includes('\0')) return { status: 400 };
  const file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(root + path.sep)) return { status: 403 };
  if (path.relative(root, file).split(path.sep).some(p => p.startsWith('.') || p === 'node_modules')) {
    return { status: 403 };
  }
  return { status: 200, file };
}

function createServer(root = ROOT) {
  return http.createServer((req, res) => {
    const { status, file } = resolveFile(req.url, root);
    if (status !== 200) {
      res.writeHead(status).end(status === 400 ? 'Bad request' : 'Forbidden');
      return;
    }
    // Символическая ссылка внутри корня не должна вести наружу или в скрытый
    // каталог: проверяем и настоящий путь, а не только текст адреса.
    fs.realpath(root, (rootError, realRoot) => {
      if (rootError) { res.writeHead(404).end('Not found'); return; }
      fs.realpath(file, (pathError, realFile) => {
        if (pathError) { res.writeHead(404).end('Not found'); return; }
        const relative = path.relative(realRoot, realFile);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
            relative.split(path.sep).some(p => p.startsWith('.') || p === 'node_modules')) {
          res.writeHead(403).end('Forbidden'); return;
        }
        fs.readFile(realFile, (err, data) => {
          if (err) { res.writeHead(404).end('Not found'); return; }
          res.writeHead(200, {
            'Content-Type': TYPES[path.extname(realFile)] || 'application/octet-stream',
            'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
          });
          res.end(data);
        });
      });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => console.log(`Structural Scheme: http://localhost:${port}/`));
}

module.exports = { createServer, resolveFile };
