#!/usr/bin/env node
// Копирует браузерные сборки библиотек из node_modules в vendor/.
// Версии задаются в package.json; после `npm install` запустите `npm run vendor`.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const FILES = {
  'react.production.min.js': 'react/umd/react.production.min.js',
  'react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
  'htm.umd.js': 'htm/dist/htm.umd.js',
};

if (require.main === module) {
  for (const [dest, src] of Object.entries(FILES)) {
    fs.copyFileSync(path.join(root, 'node_modules', src), path.join(root, 'vendor', dest));
    console.log(`vendor/${dest} <- node_modules/${src}`);
  }
}

module.exports = { FILES };
