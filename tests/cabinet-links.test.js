const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', 'Structural Scheme 2026.09.04.html');
const source = fs.readFileSync(htmlPath, 'utf8');

test('optional RS-485 cabinet links are routed as regular connections', () => {
  assert.match(source, /if \(b\.item\.rs485Cab\)/);
  assert.match(source, /effAutoTarget\(b\.item\.rs485Target, b\.id\)/);
  assert.match(source, /conns\.push\(\{ src: b, tgt: target, color: COLORS\['RS-485'\] \}\)/);
  assert.match(source, /rs485CabLinks\.has\(linkKey\)/);
});

test('operator blocks do not display their connection type', () => {
  assert.match(source, /const opLines = \(it\) => \[it\.type\]/);
  assert.doesNotMatch(source, /return \[it\.type, `Связь:/);
});
