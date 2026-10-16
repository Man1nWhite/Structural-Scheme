// Проверки целостности репозитория: страница работает офлайн, сборка и сгенерированные
// файлы не разошлись с исходниками.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ROOT, read } = require('./helpers');
const { FILES } = require('../scripts/vendor.js');
const { build, OUT, SHELL } = require('../scripts/build.js');

test('каркас страницы ссылается на существующие файлы и не ходит в интернет', () => {
  const html = read(SHELL);
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'страница должна работать без интернета');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 5, 'стили и скрипты подключаются из файлов репозитория');
  refs.forEach(ref => assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} существует`));
});

test('index.html собран из исходников и ничего не требует извне', () => {
  const html = read(OUT);
  assert.equal(html, build(), 'index.html устарел — выполните npm run build');
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'в сборке нет внешних ресурсов');
  assert.doesNotMatch(html, /(src|href)="(?!data:)[^"]+"/, 'в сборке нет ссылок на файлы репозитория');
  assert.match(html, /<style>/, 'стили встроены в файл');
  assert.match(html, /ReactDOM/, 'скрипты встроены в файл');
  assert.ok(html.length > 100000, 'в сборку попали библиотеки');
});

test('сборка разбирается как HTML: каркас, стили и пять встроенных скриптов', () => {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(read(OUT)).window.document;
  assert.equal(doc.querySelectorAll('link').length, 0, 'внешних <link> нет');
  assert.equal(doc.querySelectorAll('script[src]').length, 0, 'внешних <script src> нет');
  assert.equal(doc.querySelectorAll('style').length, 1, 'стили в одном блоке');
  assert.equal(doc.querySelectorAll('script').length, 5, 'react, react-dom, htm, core, app');
  assert.ok(doc.querySelector('#root'), 'есть точка монтирования приложения');
});

test('vendor/ совпадает с версиями из package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [dest, src] of Object.entries(FILES)) {
    const name = src.split('/')[0];
    const installed = JSON.parse(read(`node_modules/${name}/package.json`)).version;
    assert.equal(installed, pkg.devDependencies[name], `установлена версия ${name} из package.json (npm ci)`);
    assert.ok(
      fs.readFileSync(path.join(ROOT, 'vendor', dest)).equals(fs.readFileSync(path.join(ROOT, 'node_modules', src))),
      `vendor/${dest} устарел — выполните npm run vendor`,
    );
  }
});

test('src/styles.css собран из актуальных классов (npm run build:css)', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scheme-css-')), 'styles.css');
  execFileSync(process.execPath, [
    path.join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
    '-c', 'tailwind.config.js', '-i', 'src/tailwind.css', '-o', out, '--minify',
  ], { cwd: ROOT, stdio: 'pipe' });
  assert.equal(read('src/styles.css'), fs.readFileSync(out, 'utf8'), 'src/styles.css устарел — выполните npm run build:css');
});
