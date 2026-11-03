const assert = require('node:assert/strict');
const test = require('node:test');
const { core } = require('./helpers');

test('signalLabel показывает явно заданный ноль и скрывает пустое количество', () => {
  assert.equal(core.signalLabel({ k: 'AO', n: 0 }, true), 'AO (0)');
  assert.equal(core.signalLabel({ k: 'AI', n: '' }, true), 'AI');
  assert.equal(core.signalLabel({ k: 'DI', n: 16 }, true), 'DI (16)');
  assert.equal(core.signalLabel({ k: 'RS-485' }, true), 'RS-485');
  assert.equal(core.signalLabel({ k: 'AO', n: 0 }, false), 'AO');
});

test('signalsOf перечисляет включённые сигналы в постоянном порядке', () => {
  const cab = { di: true, dO: false, ai: true, ao: true, rs485: true, diN: 8, aiN: 4, aoN: 0 };
  assert.deepEqual(core.signalsOf(cab), [
    { k: 'DI', n: 8 }, { k: 'AI', n: 4 }, { k: 'AO', n: 0 }, { k: 'RS-485' },
  ]);
});

test('fit обрезает длинные строки многоточием', () => {
  assert.equal(core.fit('короткая', 10), 'короткая');
  assert.equal(core.fit('1234567890', 5), '1234…');
  assert.equal(core.fit(null, 5), '');
});

test('fileNameOf заменяет недопустимые символы, оставляя кириллицу', () => {
  assert.equal(core.fileNameOf({ fileName: 'Схема цеха №1 / v2' }), 'Схема_цеха_1_v2');
  assert.equal(core.fileNameOf({ fileName: '' }), 'scheme');
});

test('routeBand раскладывает пересекающиеся пролёты по разным каналам', () => {
  const hs = [
    { x1: 0, x2: 100, top: [0], bot: [100] },
    { x1: 50, x2: 150, top: [50], bot: [150] },
    { x1: 200, x2: 300, top: [200], bot: [300] },
  ];
  const tracks = core.routeBand(hs);
  assert.equal(tracks, 2);
  assert.notEqual(hs[0].track, hs[1].track);
  assert.equal(hs[2].track, 0, 'независимый пролёт занимает первый канал');
  assert.equal(core.routeBand([]), 0);
});

test('makeResolvers подменяет ссылки на удалённые элементы', () => {
  const state = {
    project: { kvmPanel: false },
    racks: [{ id: 'r1' }], netCabs: [{ id: 'n1' }, { id: 'n2' }], autoCabs: [{ id: 'a1' }, { id: 'a2' }],
  };
  const r = core.makeResolvers(state);
  assert.equal(r.effTarget('n2'), 'n2');
  assert.equal(r.effTarget('r1'), 'r1');
  assert.equal(r.effTarget('gone'), 'n1');
  assert.equal(r.effTarget(core.KVM_PANEL_ID, true), 'n1', 'щит выключен — связь идёт в сетевой шкаф');
  assert.equal(core.makeResolvers({ ...state, project: { kvmPanel: true } }).effTarget(core.KVM_PANEL_ID, true), core.KVM_PANEL_ID);
  assert.equal(r.effNet('r1'), 'n1', 'стойка не может быть сетевой целью');
  assert.equal(r.effAutoTarget('a1', 'a1'), 'a2', 'шкаф не связывается сам с собой');
  assert.equal(r.effAutoTarget(null, 'a2'), 'a1');
  assert.equal(core.makeResolvers({ ...state, autoCabs: [{ id: 'a1' }] }).effAutoTarget('a1', 'a1'), null);
});

test('фабрики новых элементов ссылаются на первый сетевой шкаф', () => {
  const state = core.createDefaultState();
  const net = state.netCabs[0].id;
  assert.equal(core.newOpItem(state).target, net);
  assert.equal(core.newRack(state).netTarget, net);
  assert.equal(core.newAutoCab(state).netTarget, net);
  assert.equal(core.newAutoCab(state).name, 'Шкаф ША-04');
  assert.equal(core.newNetCab(state).name, 'Шкаф сетевой ШС-02');
  assert.notEqual(core.newRack(state).id, core.newRack(state).id);
});

test('clampPerRow держит число блоков в ряду в разумных пределах', () => {
  assert.equal(core.clampPerRow(3), 3);
  assert.equal(core.clampPerRow('12'), 12);
  assert.equal(core.clampPerRow(2.7), 2, 'дробное значение округляется вниз');
  assert.equal(core.clampPerRow(0), 1);
  assert.equal(core.clampPerRow(-5), 1);
  assert.equal(core.clampPerRow(''), 1);
  assert.equal(core.clampPerRow('abc'), 1);
  assert.equal(core.clampPerRow(1e6), core.PER_ROW_MAX, 'иначе лист растягивается на десятки тысяч пикселей');
});

test('rasterScale укладывает картинку в предел canvas и не мельчит её', () => {
  assert.equal(core.rasterScale(1000, 800), core.RASTER_SCALE, 'обычный лист печатается в двойном размере');
  const big = core.rasterScale(6000, 3000);
  assert.ok(big > 0 && big < core.RASTER_SCALE, 'для большого листа масштаб уменьшается');
  assert.ok(6000 * big * 3000 * big <= core.RASTER_MAX_PIXELS + 1, 'площадь картинки не больше предела');
  assert.ok(core.rasterScale(1e6, 1e6) > 0, 'огромный лист всё равно даёт положительный масштаб');
});

test('toCount ограничивает количества и возвращает запасное значение для мусора', () => {
  assert.equal(core.toCount('-3'), 0);
  assert.equal(core.toCount('2.7'), 2);
  assert.equal(core.toCount(1e9), core.COUNT_MAX);
  assert.equal(core.toCount('abc', 8), 8);
  assert.equal(core.toCount(Infinity, 8), 8);
  assert.equal(core.toCount(''), 0);
});

test('строгий порядок встречных вертикалей учитывает концы пролётов', () => {
  const hs = [
    { x1: 0, x2: 100, top: [], bot: [100] },
    { x1: 100, x2: 200, top: [100], bot: [] },
  ];
  core.routeBand(hs, { hard: true });
  assert.ok(hs[1].track < hs[0].track, 'уходящая вверх линия выше приходящей снизу');
});

test('wrapText переносит слова и разбивает слово длиннее строки', () => {
  assert.deepEqual(core.wrapText('Первое предложение\nВторое', 10), ['Первое', 'предложени', 'е', 'Второе']);
  assert.deepEqual(core.wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(core.wrapText('  ', 10), []);
  assert.deepEqual(core.wrapText('', 10), []);
});


test('пары RS-485 с разделителем в id не смешиваются', () => {
  const state = core.normalizeState({ autoCabs: [
    { id: 'a|b', rs485Cab: true, rs485Target: 'c' },
    { id: 'c' },
    { id: 'a', rs485Cab: true, rs485Target: 'b|c' },
    { id: 'b|c' },
  ] });
  const links = core.buildScheme(state).conns.filter(c => c.cabLink);
  assert.deepEqual(links.map(c => [c.src.id, c.tgt.id]), [['a|b', 'c'], ['a', 'b|c']]);
});
