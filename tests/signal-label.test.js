const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', 'Structural Scheme 2026.09.04.html');
const source = fs.readFileSync(htmlPath, 'utf8');

function loadSignalLabel() {
  const match = source.match(
    /const signalLabel = ([\s\S]*?);\s*const NET1_ID/
  );
  assert.ok(match, 'signalLabel must be defined in the application');
  return Function(`"use strict"; return (${match[1]});`)();
}

test('signal labels preserve an explicitly configured zero count', () => {
  const signalLabel = loadSignalLabel();

  assert.equal(signalLabel({ k: 'AO', n: 0 }, true), 'AO (0)');
  assert.equal(signalLabel({ k: 'DI', n: 16 }, true), 'DI (16)');
  assert.equal(signalLabel({ k: 'RS-485' }, true), 'RS-485');
  assert.equal(signalLabel({ k: 'AO', n: 0 }, false), 'AO');
});

test('SVG preview and Draw.io export use the shared label formatter', () => {
  const calls = source.match(/signalLabel\(s, project\.showSignalCounts\)/g) || [];

  assert.equal(calls.length, 2);
  assert.doesNotMatch(source, /project\.showSignalCounts\s*&&\s*s\.n\s*\?/);
});
