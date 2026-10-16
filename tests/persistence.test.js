const assert = require('node:assert/strict');
const test = require('node:test');
const { core, sampleState } = require('./helpers');

test('проект сохраняется и загружается без потерь', () => {
  const state = sampleState();
  const text = core.serializeState(state);
  const data = JSON.parse(text);
  assert.equal(data.format, core.FORMAT);
  assert.equal(data.version, core.FORMAT_VERSION);
  assert.deepEqual(core.parseState(text), state);
});

test('демо-проект проходит сохранение и загрузку', () => {
  const state = core.createDefaultState();
  assert.deepEqual(core.parseState(core.serializeState(state)), state);
});

test('недостающие поля заполняются значениями по умолчанию, лишние отбрасываются', () => {
  const state = core.normalizeState({
    project: { title: 'Моя схема', unknown: 1, showNotes: 'yes' },
    racks: [{ id: 'r1', name: 'Стойка', hacked: true }],
    autoCabs: [{ name: 'ША' }],
  });
  assert.equal(state.project.title, 'Моя схема');
  assert.equal(state.project.showNotes, core.PROJECT_DEFAULTS.showNotes, 'значение неверного типа заменено');
  assert.ok(!('unknown' in state.project));
  assert.deepEqual(state.racks[0], { ...core.ITEM_DEFAULTS.racks, id: 'r1', name: 'Стойка' });
  assert.deepEqual(state.opItems, []);
  assert.deepEqual(state.netCabs, []);
  assert.ok(state.autoCabs[0].id, 'элемент без id получает новый id');
  assert.equal(state.autoCabs[0].diN, core.ITEM_DEFAULTS.autoCabs.diN);
});

test('повторяющиеся и зарезервированные id заменяются', () => {
  const state = core.normalizeState({
    racks: [{ id: 'x' }, { id: 'x' }],
    netCabs: [{ id: core.KVM_PANEL_ID }],
  });
  assert.equal(state.racks[0].id, 'x');
  assert.notEqual(state.racks[1].id, 'x');
  assert.notEqual(state.netCabs[0].id, core.KVM_PANEL_ID);
});

test('числа можно хранить строкой (значение поля ввода)', () => {
  const state = core.normalizeState({ project: { blocksPerRow: '3' }, racks: [{ servers: Infinity }] });
  assert.equal(state.project.blocksPerRow, '3', 'строка из поля ввода остаётся строкой');
  assert.equal(state.racks[0].servers, core.ITEM_DEFAULTS.racks.servers);
});

test('число блоков в ряду приводится к допустимому диапазону при загрузке', () => {
  assert.equal(core.normalizeState({ project: { blocksPerRow: 99 } }).project.blocksPerRow, core.PER_ROW_MAX);
  assert.equal(core.normalizeState({ project: { blocksPerRow: 0 } }).project.blocksPerRow, 1);
  assert.equal(core.normalizeState({ project: { blocksPerRow: 'много' } }).project.blocksPerRow, 1);
});

test('чужие и повреждённые файлы отклоняются понятной ошибкой', () => {
  assert.throws(() => core.parseState('{не json'), /повреждён/);
  assert.throws(() => core.parseState('[]'), /не содержит проект/);
  assert.throws(() => core.parseState('{"format":"other"}'), /не является проектом/);
  assert.throws(() => core.parseState(JSON.stringify({ format: core.FORMAT, version: core.FORMAT_VERSION + 1 })), /более новом формате/);
});

test('загруженный проект сразу строится', () => {
  const state = core.parseState(JSON.stringify({ format: core.FORMAT, version: 1, opItems: [{ name: 'АРМ', target: 'нет' }] }));
  const m = core.buildScheme(state);
  assert.equal(m.blocks.length, 1);
  assert.equal(m.conns.length, 0, 'без серверной связь некуда вести');
});
