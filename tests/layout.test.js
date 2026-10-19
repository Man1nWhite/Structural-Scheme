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

test('«Без связи» убирает верхнюю линию шкафа, но не связь с другим шкафом', () => {
  const state = sampleState();
  state.autoCabs = state.autoCabs.map(c => ({ ...c, uplink: core.UPLINK_NONE }));
  const m = core.buildScheme(state);
  const auto = m.conns.filter(c => c.src.level === 'auto');
  assert.deepEqual(auto.map(connName), ['a1→a2'], 'осталась только линия RS-485 между шкафами');

  // Значение переживает сохранение и загрузку.
  const loaded = core.parseState(core.serializeState(state));
  assert.equal(loaded.autoCabs[0].uplink, core.UPLINK_NONE);
  assert.ok(!core.buildScheme(loaded).conns.some(c => c.src.level === 'auto' && c.tgt.level !== 'auto'));
});

test('RS-485 между шкафами выходит справа после стрелок, а входит слева до них', () => {
  const m = core.buildScheme(sampleState());
  const conn = m.conns.find(c => c.src.id === 'a1' && c.tgt.id === 'a2');
  assert.ok(conn, 'связь a1 → a2 есть');
  const sigX = id => m.signals.filter(s => s.block.id === id).map(s => s.x).sort((a, b) => a - b);
  const a1 = m.blocks.find(b => b.id === 'a1'), a2 = m.blocks.find(b => b.id === 'a2');
  const [sx, sy] = conn.pts[0];
  const [tx, ty] = conn.pts[conn.pts.length - 1];

  assert.equal(sy, a1.y + a1.h, 'выход из нижней грани');
  assert.equal(ty, a2.y + a2.h, 'вход в нижнюю грань');
  assert.ok(sx > Math.max(...sigX('a1')) + 5, 'выход правее всех стрелок DI/DO/AI/AO/RS-485');
  assert.ok(sx > a1.x + a1.w * 0.8, 'выход у правого края, а не по центру');
  assert.ok(tx < Math.min(...sigX('a2')) - 5, 'вход левее всех стрелок');
  assert.ok(tx < a2.x + a2.w * 0.3, 'вход у левого края');
  sigX('a1').concat(sigX('a2')).forEach(x => {
    assert.ok(Math.abs(sx - x) > 5 && Math.abs(tx - x) > 5, 'вертикаль не совпадает со стрелкой сигнала');
  });
});

test('без щита КВМ линии в щит не строятся', () => {
  const state = sampleState();
  state.project.kvmPanel = false;
  const m = core.buildScheme(state);
  assert.ok(!m.blocks.some(b => b.id === core.KVM_PANEL_ID));
  assert.ok(!m.conns.some(c => c.tgt.id === core.KVM_PANEL_ID));
  assert.equal(m.conns.find(c => c.src.id === 'op3').tgt.id, 'net1');
});

test('высота блока — по числу строк описания, без пустого низа', () => {
  const m = core.buildScheme(sampleState());
  const of = id => m.blocks.find(b => b.id === id);
  assert.equal(of('net1').lines.length, 5, 'сетевой шкаф: 5 строк');
  assert.equal(of('rack1').lines.length, 4);
  assert.equal(of('a1').lines.length, 1);
  assert.equal(of('net1').h - of('rack1').h, 16, 'на строку меньше — на шаг строки ниже');
  assert.equal(of('net1').h - of('a1').h, 4 * 16, 'одна строка — самый низкий блок');

  const short = core.buildScheme(core.createDefaultState());
  const auto = short.blocks.filter(b => b.level === 'auto');
  assert.ok(auto.every(b => b.h === auto[0].h), 'одинаковые описания — одинаковая высота');
  assert.ok(auto[0].h < of('net1').h, 'шкаф с одной строкой ниже шкафа с пятью');

  const sample = sampleState();
  sample.racks[0].ntp = false;
  const less = core.buildScheme(sample).blocks.find(b => b.id === 'rack1');
  assert.equal(less.h, of('rack1').h - 16, 'выключили строку — блок стал ниже');
});

test('блоки АРМ на четверть уже остальных, но по центру своей колонки', () => {
  const m = core.buildScheme(sampleState());
  const op = m.blocks.filter(b => b.level === 'op' && b.kind === 'item');
  const others = m.blocks.filter(b => b.kind === 'net' || b.kind === 'auto');
  op.forEach(b => assert.equal(b.w, others[0].w * 0.75, 'ширина АРМ — 3/4 ширины шкафа'));

  // Центры узких блоков лежат на общей сетке колонок: шаг берём по соседним АРМ,
  // а широкий щит КВМ должен попасть на ту же сетку.
  const colStep = op[1].x - op[0].x;
  const colCenter = b => op[0].x + op[0].w / 2 + (b.col - op[0].col) * colStep;
  op.forEach(b => {
    assert.ok(Math.abs(b.x + b.w / 2 - colCenter(b)) < 0.01, `АРМ по центру колонки ${b.col}`);
    assert.ok(b.nameText.length <= core.fit(b.name, 100).length, 'заголовок влезает по ширине');
  });
  const panel = m.blocks.find(b => b.kind === 'panel');
  assert.equal(panel.w, others[0].w, 'щит КВМ обычной ширины');
  assert.ok(Math.abs(panel.x + panel.w / 2 - colCenter(panel)) < 0.01, 'широкий блок на той же сетке');

  const svg = core.toSvg(m);
  op.forEach(b => assert.ok(svg.includes(`>${b.nameText}<`), `подпись ${b.nameText} есть в SVG`));
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
