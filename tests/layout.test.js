const assert = require('node:assert/strict');
const test = require('node:test');
const { core, sampleState } = require('./helpers');

const connName = c => `${c.src.id}→${c.tgt.id}`;
const colorName = c => core.NAME_BY_COLOR[c.color];

test('схема по умолчанию строится и содержит все блоки демо-проекта', () => {
  const state = core.createDefaultState();
  const m = core.buildScheme(state);
  assert.equal(m.blocks.length, 4 + 1 + 1 + 3);
  assert.ok(m.width >= 880);
  assert.ok(m.height > 0);
  assert.deepEqual(m.rooms.map(r => r.name), ['Операторная', 'Серверная', 'Помещение шкафов автоматики']);
});

test('пустой проект не ломает раскладку', () => {
  const m = core.buildScheme({ project: { ...core.PROJECT_DEFAULTS }, opItems: [], racks: [], netCabs: [], autoCabs: [] });
  assert.equal(m.blocks.length, 0);
  assert.equal(m.conns.length, 0);
  assert.ok(core.toSvg(m).startsWith('<svg'));
});

test('блоки лежат внутри своих помещений и не перекрываются', () => {
  const state = sampleState();
  state.project.blocksPerRow = 2;
  const m = core.buildScheme(state);
  const room = { op: m.rooms[0], srv: m.rooms[1], auto: m.rooms[2] };
  m.blocks.forEach(b => {
    const r = room[b.level];
    assert.ok(b.x >= r.x && b.x + b.w <= r.x + r.w, `${b.id} по горизонтали внутри помещения`);
    assert.ok(b.y >= r.y && b.y + b.h <= r.y + r.h, `${b.id} по вертикали внутри помещения`);
  });
  for (const a of m.blocks) {
    for (const b of m.blocks) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${a.id} и ${b.id} не перекрываются`);
    }
  }
});

test('линии связи ортогональны и начинаются/заканчиваются на гранях блоков', () => {
  const m = core.buildScheme(sampleState());
  assert.ok(m.conns.length > 0);
  m.conns.forEach(c => {
    for (let i = 1; i < c.pts.length; i++) {
      const [x0, y0] = c.pts[i - 1], [x1, y1] = c.pts[i];
      assert.ok(x0 === x1 || y0 === y1, `${connName(c)}: отрезок ${i} горизонтален или вертикален`);
    }
    const [sx, sy] = c.pts[0], [tx, ty] = c.pts[c.pts.length - 1];
    assert.ok(sy === c.src.y || sy === c.src.y + c.src.h, `${connName(c)} выходит из грани источника`);
    assert.ok(sx > c.src.x && sx < c.src.x + c.src.w);
    assert.ok(ty === c.tgt.y || ty === c.tgt.y + c.tgt.h, `${connName(c)} входит в грань цели`);
    assert.ok(tx > c.tgt.x && tx < c.tgt.x + c.tgt.w);
  });
});

test('связи строятся по настройкам проекта', () => {
  const m = core.buildScheme(sampleState());
  const list = m.conns.map(c => `${connName(c)}:${colorName(c)}`).sort();
  assert.deepEqual(list, [
    'a1→a2:RS-485',              // RS-485 между шкафами: одна линия на пару, хотя включена у обоих
    'a1→net1:Витая пара',
    'a2→net2:Витая пара',
    'a3→net1:Оптика',            // ссылка на удалённый шкаф → первый сетевой шкаф
    'op1→kvmpanel:KVM',          // дополнительная KVM-линия в щит
    'op1→net1:Витая пара',
    'op2→rack1:Оптика',
    'op3→kvmpanel:KVM',          // основная связь прямо в щит
    'rack1→kvmpanel:KVM',
    'rack1→net1:Витая пара',
  ].sort());
});

test('RS-485 между шкафами появляется только при включённой опции', () => {
  const state = sampleState();
  state.autoCabs = state.autoCabs.map(c => ({ ...c, rs485Cab: false }));
  const m = core.buildScheme(state);
  assert.ok(!m.conns.some(c => c.src.level === 'auto' && c.tgt.level === 'auto'));
});

test('без щита КВМ линии в щит не строятся', () => {
  const state = sampleState();
  state.project.kvmPanel = false;
  const m = core.buildScheme(state);
  assert.ok(!m.blocks.some(b => b.id === core.KVM_PANEL_ID));
  assert.ok(!m.conns.some(c => c.tgt.id === core.KVM_PANEL_ID));
  assert.equal(m.conns.find(c => c.src.id === 'op3').tgt.id, 'net1');
});

test('описания блоков', () => {
  const m = core.buildScheme(sampleState());
  const lines = id => m.blocks.find(b => b.id === id).lines;
  assert.deepEqual(lines('op1'), ['АРМ'], 'блок операторной показывает только тип');
  assert.deepEqual(lines('rack1'), ['Серверов: 3', 'Сервер NTP', 'KVM', 'ИБП RACK']);
  assert.deepEqual(lines('net1'), ['Коммутаторов: 2', 'Межсетевых экранов: 1', 'Опт. кроссов: 2', 'Внешняя связь', 'ИБП RACK']);
  assert.deepEqual(lines('net2'), ['Коммутаторов: 1']);
  assert.deepEqual(lines(core.KVM_PANEL_ID), ['KVM-удлинители', 'Стоек подключено: 1']);
  assert.deepEqual(lines('a1'), ['Контроллеров: 1']);
});

test('сигналы, внешняя связь, легенда и примечания', () => {
  const m = core.buildScheme(sampleState());
  const a1 = m.signals.filter(s => s.block.id === 'a1').map(s => s.label);
  assert.deepEqual(a1, ['DI (16)', 'DO (8)', 'AI (8)', 'AO (0)', 'RS-485']);
  assert.equal(m.ext.length, 1);
  assert.equal(m.ext[0].b.id, 'net1');
  assert.deepEqual(m.legend.items.map(i => i.name), ['Витая пара', 'Оптика', 'KVM', 'RS-485', 'DI', 'DO', 'AI', 'AO']);
  assert.deepEqual(m.notes.lines, ['Первое', 'Второе']);

  const state = sampleState();
  state.project.showNotes = false;
  state.netCabs = state.netCabs.map(c => ({ ...c, external: false }));
  state.opItems = state.opItems.map(o => ({ ...o, link: 'Витая пара' }));
  state.autoCabs = state.autoCabs.map(c => ({ ...c, uplink: 'Витая пара', ao: false }));
  const m2 = core.buildScheme(state);
  assert.equal(m2.notes, null);
  assert.ok(!m2.legend.items.some(i => i.name === 'Оптика' || i.name === 'AO'), 'в легенде только используемые обозначения');
});

test('число блоков в ряду управляет количеством рядов', () => {
  const state = core.createDefaultState();
  state.autoCabs = Array.from({ length: 6 }, () => core.newAutoCab(state));
  const rowsOf = perRow => {
    state.project.blocksPerRow = perRow;
    const ys = new Set(core.buildScheme(state).blocks.filter(b => b.level === 'auto').map(b => b.y));
    return ys.size;
  };
  assert.equal(rowsOf(6), 1);
  assert.equal(rowsOf(3), 2);
  assert.equal(rowsOf('2'), 3, 'значение из поля ввода может быть строкой');
  assert.equal(rowsOf(''), 6, 'пустое значение = 1 блок в ряду');
  assert.equal(rowsOf(0), 6, 'ноль приводится к одному блоку в ряду');
  assert.equal(rowsOf(1000), 1, 'слишком большое значение ограничивается, лист не растягивается');
});
