// Локальный сервер: не падает на кривых адресах и не отдаёт служебные файлы.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../scripts/serve.js');

test('сервер переживает некорректные запросы и не отдаёт .git и node_modules', async (t) => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const request = p => fetch(`http://127.0.0.1:${server.address().port}${p}`);
  const status = async p => (await request(p)).status;
  assert.equal(await status('/%E0%A4%A'), 400, 'битая percent-последовательность');
  assert.equal(await status('/%00'), 400, 'нулевой байт');
  assert.equal(await status('/%ZZ'), 400, 'некорректное percent-кодирование');
  assert.equal(await status('/.git/config'), 403);
  assert.equal(await status('/.github/workflows/ci.yml'), 403);
  assert.equal(await status('/src/%2e%2e/.git/config'), 403, 'скрытый каталог после нормализации');
  assert.equal(await status('/node_modules/react/package.json'), 403);
  assert.equal(await status('/src/%2e%2e/node_modules/react/package.json'), 403);
  assert.equal(await status('/..%2fpackage.json'), 403, 'выход за корень');
  assert.equal(await status('/missing-file'), 404);
  const page = await request('/');
  assert.equal(page.status, 200, 'сервер жив после всех запросов');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /Генератор структурных схем/);
});


test('символические ссылки не открывают файлы вне корня и служебные каталоги', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scheme-server-'));
  const root = path.join(tmp, 'root');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(tmp, 'secret'), 'outside');
  fs.writeFileSync(path.join(root, '.hidden', 'secret'), 'hidden');
  fs.writeFileSync(path.join(root, 'node_modules', 'secret'), 'modules');
  fs.writeFileSync(path.join(root, 'public.txt'), 'public');
  fs.symlinkSync(path.join(tmp, 'secret'), path.join(root, 'outside.txt'));
  fs.symlinkSync('.hidden', path.join(root, 'hidden-link'));
  fs.symlinkSync('node_modules', path.join(root, 'modules-link'));
  fs.symlinkSync('public.txt', path.join(root, 'public-link'));
  const server = createServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(() => { fs.rmSync(tmp, { recursive: true, force: true }); resolve(); })));
  const request = p => fetch(`http://127.0.0.1:${server.address().port}${p}`);
  for (const p of ['/outside.txt', '/hidden-link/secret', '/modules-link/secret']) {
    assert.equal((await request(p)).status, 403, p);
  }
  assert.equal(await (await request('/public-link')).text(), 'public');
});
