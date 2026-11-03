const assert = require('node:assert/strict');
const test = require('node:test');
const { core, parseXml, sampleState, layoutProblems } = require('./helpers');

const tricky = () => {
  const state = sampleState();
  state.project.title = 'Схема <A&B> "цех"';
  state.opItems[0].name = 'АРМ <1> & "2"';
  state.project.notesText = 'x < y & z';
  return state;
};

test('SVG — корректный XML с одним объявлением xmlns', () => {
  const svg = core.toSvg(core.buildScheme(tricky()));
  assert.equal((svg.match(/xmlns=/g) || []).length, 1);
  const doc = parseXml(svg);
  assert.equal(doc.documentElement.tagName, 'svg');
  assert.equal(doc.documentElement.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
});

test('SVG экранирует пользовательский текст', () => {
  const doc = parseXml(core.toSvg(core.buildScheme(tricky())));
  const texts = [...doc.getElementsByTagName('text')].map(t => t.textContent);
  assert.ok(texts.includes('Схема <A&B> "цех"'));
  assert.ok(texts.includes('x < y & z'));
  assert.ok(texts.some(t => t.startsWith('АРМ <1> & "2"')));
});

test('SVG содержит блоки, линии, сигналы и легенду', () => {
  const m = core.buildScheme(sampleState());
  const doc = parseXml(core.toSvg(m));
  assert.equal(doc.getElementsByTagName('path').length, m.conns.length);
  const texts = [...doc.getElementsByTagName('text')].map(t => t.textContent);
  // Подпись обрезается по ширине блока: у узкого АРМ символов помещается меньше.
  m.blocks.forEach(b => assert.ok(texts.includes(b.nameText), `есть подпись блока ${b.id}`));
  m.blocks.forEach(b => assert.ok(b.nameText.length * 6.4 <= b.w - 8, `подпись ${b.nameText} влезает в блок ${b.id}`));
  m.signals.forEach(s => assert.ok(texts.includes(s.label), `есть подпись сигнала ${s.label}`));
  assert.ok(texts.includes('Условные обозначения:'));
  const extLines = [...doc.getElementsByTagName('line')].filter(l => l.getAttribute('stroke-dasharray') === '7 4');
  assert.equal(extLines.length, m.ext.length, 'пунктир внешней связи');
  assert.ok(texts.includes('Примечания:'));
});

test('Draw.io — корректный XML, все связи ссылаются на существующие ячейки', () => {
  const m = core.buildScheme(tricky());
  const doc = parseXml(core.toDrawio(m));
  const cells = [...doc.getElementsByTagName('mxCell')];
  const ids = new Set(cells.map(c => c.getAttribute('id')));
  assert.equal(ids.size, cells.length, 'идентификаторы ячеек уникальны');
  const edges = cells.filter(c => c.getAttribute('edge') === '1');
  assert.equal(edges.length, m.conns.length + m.ext.length + m.signals.length);
  edges.forEach(e => {
    assert.ok(ids.has(e.getAttribute('source')), 'источник существует');
    if (e.hasAttribute('target')) assert.ok(ids.has(e.getAttribute('target')), 'цель существует');
  });
  const model = doc.getElementsByTagName('mxGraphModel')[0];
  assert.equal(Number(model.getAttribute('pageWidth')), Math.round(m.width));
  assert.equal(Number(model.getAttribute('pageHeight')), Math.round(m.height));
});

test('Draw.io и SVG показывают одинаковые подписи', () => {
  const m = core.buildScheme(tricky());
  const doc = parseXml(core.toDrawio(m));
  const values = [...doc.getElementsByTagName('mxCell')].map(c => c.getAttribute('value') || '');
  const all = values.join('\n');
  // В Draw.io подписи блоков — HTML, поэтому пользовательский текст экранирован дважды.
  const html = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  m.blocks.forEach(b => {
    assert.ok(all.includes(`<b>${html(b.name)}</b>`), `блок ${b.id}`);
    b.lines.forEach(l => assert.ok(all.includes(html(l)), `строка «${l}» блока ${b.id}`));
  });
  m.signals.forEach(s => assert.ok(values.includes(s.label), `сигнал ${s.label}`));
  m.legend.items.forEach(i => assert.ok(all.includes(i.name), `легенда: ${i.name}`));
  assert.ok(all.includes(html('x < y & z')), 'примечания');
  assert.ok(all.includes(`<b>${html(m.title)}</b>`), 'заголовок');
});

test('связи Draw.io идут по тем же точкам, что и в SVG', () => {
  const m = core.buildScheme(sampleState());
  const doc = parseXml(core.toDrawio(m));
  const edges = [...doc.getElementsByTagName('mxCell')].filter(c => /^b_/.test(c.getAttribute('target') || ''));
  assert.equal(edges.length, m.conns.length);
  edges.forEach((e, i) => {
    const pts = [...e.getElementsByTagName('mxPoint')].map(p => [Number(p.getAttribute('x')), Number(p.getAttribute('y'))]);
    const expected = m.conns[i].pts.slice(1, -1).map(([x, y]) => [Math.round(x), Math.round(y)]);
    assert.deepEqual(pts, expected);
  });
});

test('Draw.io остаётся корректным XML при необычных id из чужого файла', () => {
  const odd = 'n"1 <&>';
  const state = core.parseState(JSON.stringify({
    netCabs: [{ id: odd, name: 'ШС', external: true }],
    autoCabs: [{ id: 'a1', name: 'ША', netTarget: odd, di: true, rs485: true }],
  }));
  const model = core.buildScheme(state);
  const cells = [...parseXml(core.toDrawio(model)).getElementsByTagName('mxCell')];
  assert.ok(cells.some(c => c.getAttribute('id') === 'b_' + odd));
  assert.ok(cells.some(c => c.getAttribute('target') === 'b_' + odd));
  assert.ok(cells.some(c => c.getAttribute('source') === 'b_a1' && !c.hasAttribute('target')), 'id шкафа экранирован в источнике сигнала');
  assert.ok(cells.some(c => c.getAttribute('source') === 'b_' + odd && !c.hasAttribute('target')), 'id экранирован в источнике внешней связи');
  const ids = new Set(cells.map(c => c.getAttribute('id')));
  cells.filter(c => c.getAttribute('edge') === '1').forEach(c => {
    assert.ok(ids.has(c.getAttribute('source')));
    if (c.hasAttribute('target')) assert.ok(ids.has(c.getAttribute('target')));
  });
});

test('Draw.io экранирует id внешней связи и идентификаторы, похожие на свойства объекта', () => {
  const state = core.normalizeState({ netCabs: [{ id: '__proto__', external: true }] });
  const model = core.buildScheme(state);
  assert.equal(model.conns.length, 0);
  const cells = [...parseXml(core.toDrawio(model)).getElementsByTagName('mxCell')];
  assert.ok(cells.some(c => c.getAttribute('id') === 'b___proto__'));
  assert.ok(cells.some(c => c.getAttribute('source') === 'b___proto__' && !c.hasAttribute('target')));
});

test('белая обводка сохраняет подпись сигнала поверх линии в обоих форматах', () => {
  const model = core.buildScheme(sampleState());
  const svg = parseXml(core.toSvg(model));
  const labels = [...svg.getElementsByTagName('g')].filter(g => g.querySelector('line') && g.querySelector('polygon') && g.querySelector('text')).map(g => g.querySelector('text'));
  assert.deepEqual(labels.map(t => t.textContent), model.signals.map(s => s.label));
  assert.equal(labels.length, model.signals.length);
  labels.forEach(t => {
    assert.equal(t.getAttribute('stroke'), '#ffffff');
    assert.equal(t.getAttribute('stroke-width'), '3');
    assert.equal(t.getAttribute('paint-order'), 'stroke');
  });
  const cells = [...parseXml(core.toDrawio(model)).getElementsByTagName('mxCell')];
  model.signals.forEach(s => {
    const cell = cells.find(c => c.getAttribute('edge') === '1' && c.getAttribute('value') === s.label);
    assert.ok(cell.getAttribute('style').includes('labelBackgroundColor=#ffffff;'));
  });
});

test('длинные заголовок, подзаголовок и примечания переносятся в общей модели', () => {
  const state = sampleState();
  state.project.title = 'Очень длинный заголовок структурной схемы промышленного комплекса '.repeat(5);
  state.project.subtitle = 'Подзаголовок с подробным описанием объекта и назначением схемы '.repeat(4);
  state.project.notesText = 'Длинное примечание с описанием требований к монтажу оборудования. '.repeat(8) + '\n' + 'я'.repeat(500);
  const model = core.buildScheme(state);
  assert.ok(model.titleLines.length > 1);
  assert.ok(model.subtitleLines.length > 1);
  assert.ok(model.notes.lines.length > 3);
  assert.deepEqual(layoutProblems(model), []);
  model.titleLines.forEach(line => assert.ok(line.length * 10.8 <= model.width - 36));
  model.subtitleLines.forEach(line => assert.ok(line.length * 7.2 <= model.width - 36));
  model.notes.lines.forEach(line => assert.ok(line.length * 6 <= model.notes.w));
  const svg = parseXml(core.toSvg(model));
  const texts = [...svg.getElementsByTagName('text')].map(t => t.textContent);
  const drawio = [...parseXml(core.toDrawio(model)).getElementsByTagName('mxCell')].map(c => c.getAttribute('value'));
  for (const line of [...model.titleLines, ...model.subtitleLines, ...model.notes.lines]) {
    assert.ok(texts.includes(line), 'строка есть в SVG');
    assert.ok(drawio.some(value => value && value.includes(line.replace(/&/g, '&amp;').replace(/</g, '&lt;'))), 'строка есть в Draw.io');
  }
  assert.ok(model.rooms[0].y > 150, 'помещения начинаются под увеличенным заголовком');
});


test('ширина примечаний Draw.io совпадает с моделью и не зависит от узкой легенды', () => {
  const state = sampleState();
  state.project.blocksPerRow = 12;
  state.opItems = Array.from({ length: 12 }, (_, i) => ({ ...state.opItems[0], id: 'op-' + i }));
  state.project.showNotes = true;
  state.project.notesText = ('Подробное примечание к монтажу оборудования и связи. ').repeat(100);
  const model = core.buildScheme(state);
  // Модель допускает отдельную ширину легенды; проверяем экспорт при узкой легенде,
  // даже если текущая раскладка по умолчанию растягивает её на всю ширину.
  model.legend = { ...model.legend, w: 240 };
  assert.ok(model.notes.w > model.legend.w, 'лист и примечания шире легенды');
  assert.ok(model.notes.lines.length > 1);
  assert.ok(model.notes.lines.some(line => line.length * 6 > model.legend.w), 'строка не помещается в легенду');
  const svg = parseXml(core.toSvg(model));
  const svgLines = [...svg.getElementsByTagName('text')].map(t => t.textContent);
  const drawio = parseXml(core.toDrawio(model));
  const cell = [...drawio.getElementsByTagName('mxCell')].find(c => c.getAttribute('id') === 'notes');
  assert.ok(cell);
  assert.equal(Number(cell.getElementsByTagName('mxGeometry')[0].getAttribute('width')), Math.round(model.notes.w));
  const content = cell.getAttribute('value');
  model.notes.lines.forEach(line => {
    assert.ok(svgLines.includes(line), 'строка есть в SVG');
    assert.ok(content.includes(`<div>${line}</div>`), 'та же строка есть в Draw.io');
  });
});
