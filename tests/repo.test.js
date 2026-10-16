// Проверки целостности репозитория: страница работает офлайн, vendor/ и styles.css актуальны.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { ROOT, read } = require('./helpers');
const { FILES } = require('../scripts/vendor.js');

test('index.html не обращается к внешним ресурсам и ссылается на существующие файлы', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//, 'страница должна работать без интернета');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 5);
  refs.forEach(ref => assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} существует`));
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
