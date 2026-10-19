const assert = require('node:assert/strict');
const test = require('node:test');
const { core, parseXml, sampleState } = require('./helpers');

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
