#!/usr/bin/env node
// Сборка самодостаточной страницы: стили и скрипты из src/shell.html встраиваются
// прямо в файл. На выходе один index.html — его открывают двойным щелчком, он
// работает без интернета и без остальных файлов репозитория.
//
// Запуск: npm run build   (после правок src/shell.html, src/app.js, src/core.js,
//                          src/styles.css или vendor/ — тесты следят за свежестью)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHELL = 'src/shell.html';
const OUT = 'index.html';

const BANNER = [
  '<!-- Файл собран из src/shell.html командой `npm run build`.',
  '     Правьте исходники (src/shell.html, src/app.js, src/core.js, src/styles.css),',
  '     а не этот файл: при следующей сборке правки потеряются. -->',
  '',
].join('\n');

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// Внутри <script> последовательность </script> недопустима даже внутри строки.
const inlineCode = (code) => code.replace(/<\/script>/gi, '<\\/script>');

// dev: в сборку попадают development-сборки React и ReactDOM — их использует
// tests/app.test.js, чтобы поймать предупреждения React о неверной разметке.
function build({ dev = false } = {}) {
  const devFile = (file) => dev
    ? file
      .replace('vendor/react.production.min.js', 'node_modules/react/umd/react.development.js')
      .replace('vendor/react-dom.production.min.js', 'node_modules/react-dom/umd/react-dom.development.js')
    : file;

  let html = read(SHELL);
  html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">[ \t]*\n?/g,
    (m, href) => `  <style>\n${read(href).trim()}\n  </style>\n`);
  html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>[ \t]*\n?/g,
    (m, src) => `  <script>\n${inlineCode(read(devFile(src)).trim())}\n  </script>\n`);

  const externals = html.match(/(?:src|href)="(?:https?:)?\/\//g);
  if (externals) throw new Error('В сборку попали внешние ресурсы: ' + externals.join(', '));
  return BANNER + html;
}

if (require.main === module) {
  const dev = process.argv.includes('--dev');
  const html = build({ dev });
  fs.writeFileSync(path.join(ROOT, OUT), html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`${OUT}: ${kb} КБ, зависимостей нет${dev ? ' (development-сборка React)' : ''}`);
}

module.exports = { build, OUT, SHELL, BANNER };
