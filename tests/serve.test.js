// Локальный сервер: не падает на кривых адресах и не отдаёт служебные файлы.
const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../scripts/serve.js');

test('сервер переживает некорректные запросы и не отдаёт .git и node_modules', async (t) => {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const status = async p => (await fetch(`http://127.0.0.1:${server.address().port}${p}`)).status;
  assert.equal(await status('/%E0%A4%A'), 400, 'битая percent-последовательность');
  assert.equal(await status('/%00'), 400, 'нулевой байт');
  assert.equal(await status('/.git/config'), 403);
  assert.equal(await status('/node_modules/react/package.json'), 403);
  assert.equal(await status('/..%2fpackage.json'), 403, 'выход за корень');
  assert.equal(await status('/'), 200, 'сервер жив после всех запросов');
});
