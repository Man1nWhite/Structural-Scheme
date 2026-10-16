// Общие помощники для тестов.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'src', 'core.js'));

// Разбор XML через jsdom: бросает ошибку, если документ не является корректным XML.
function parseXml(text) {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM(text, { contentType: 'application/xml' }).window.document;
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('Некорректный XML: ' + err.textContent);
  return doc;
}

// Небольшой проект со всеми типами блоков и связей.
function sampleState(overrides = {}) {
  const state = {
    project: { ...core.PROJECT_DEFAULTS, kvmPanel: true, showSignalCounts: true, notesText: 'Первое\nВторое' },
    opItems: [
      { id: 'op1', name: 'АРМ 1', type: 'АРМ', link: 'Витая пара', target: 'net1', kvmToPanel: true },
      { id: 'op2', name: 'Принтер', type: 'Принтер', link: 'Оптика', target: 'rack1', kvmToPanel: false },
      { id: 'op3', name: 'АРМ 3', type: 'АРМ', link: 'KVM', target: core.KVM_PANEL_ID, kvmToPanel: false },
    ],
    racks: [{ id: 'rack1', name: 'Стойка 1', servers: 3, kvm: true, ntp: true, ups: true, netTarget: 'net1' }],
    netCabs: [
      { id: 'net1', name: 'ШС-01', switches: 2, fw: 1, cross: 2, external: true, ups: true },
      { id: 'net2', name: 'ШС-02', switches: 1, fw: 0, cross: 0, external: false, ups: false },
    ],
    autoCabs: [
      { ...core.ITEM_DEFAULTS.autoCabs, id: 'a1', name: 'ША-01', netTarget: 'net1', rs485: true, rs485Cab: true, rs485Target: 'a2', aoN: 0, ao: true },
      { ...core.ITEM_DEFAULTS.autoCabs, id: 'a2', name: 'ША-02', netTarget: 'net2', rs485Cab: true, rs485Target: 'a1' },
      { ...core.ITEM_DEFAULTS.autoCabs, id: 'a3', name: 'ША-03', netTarget: 'missing', uplink: 'Оптика' },
    ],
  };
  return { ...state, ...overrides };
}

module.exports = { ROOT, core, parseXml, sampleState, read: (p) => fs.readFileSync(path.join(ROOT, p), 'utf8') };
