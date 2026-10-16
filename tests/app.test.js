// Сквозные тесты интерфейса: настоящий index.html в jsdom со всеми скриптами.
// React подменяется development-сборкой той же версии, чтобы ловить предупреждения.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { ROOT, core } = require('./helpers');

const ORIGIN = 'http://scheme.test/';
const DEV_BUILDS = {
  'vendor/react.production.min.js': 'node_modules/react/umd/react.development.js',
  'vendor/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.development.js',
};

class LocalLoader extends ResourceLoader {
  fetch(url) {
    const rel = decodeURIComponent(new URL(url).pathname.slice(1));
    const file = path.join(ROOT, DEV_BUILDS[rel] || rel);
    return Promise.resolve(fs.readFileSync(file));
  }
}

async function openApp({ storage } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (...a) => errors.push(a.join(' ')));
  virtualConsole.on('warn', (...a) => errors.push(a.join(' ')));
  virtualConsole.on('jsdomError', e => errors.push(String(e.stack || e)));

  const downloads = [];
  const dialogs = { confirm: true, alerts: [] };
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    url: ORIGIN, runScripts: 'dangerously', resources: new LocalLoader(), virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      if (storage) Object.entries(storage).forEach(([k, v]) => w.localStorage.setItem(k, v));
      w.URL.createObjectURL = blob => { downloads.push({ blob }); return 'blob:' + downloads.length; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { downloads[downloads.length - 1].name = this.download; };
      w.confirm = () => dialogs.confirm;
      w.alert = msg => dialogs.alerts.push(msg);
    },
  });
  const w = dom.window;
  const app = {
    w, dom, errors, downloads, dialogs,
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    svg: () => w.document.querySelector('[data-testid="preview"] svg'),
    svgTexts: () => [...w.document.querySelectorAll('[data-testid="preview"] svg text')].map(t => t.textContent),
    button: text => {
      const b = [...w.document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
      assert.ok(b, `кнопка «${text}» существует`);
      return b;
    },
    field: label => {
      const l = [...w.document.querySelectorAll('label')].find(x => x.textContent.trim() === label);
      assert.ok(l, `поле «${label}» существует`);
      return l.parentElement.querySelector('input, textarea');
    },
    async click(el) { el.click(); await settle(); },
    async type(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      await settle();
    },
    async select(el, value) {
      el.value = value;
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle();
    },
    async tab(name) { await app.click(app.button(name)); },
    readBlob: blob => new Promise(res => { const r = new w.FileReader(); r.onload = () => res(r.result); r.readAsText(blob); }),
    stored: () => JSON.parse(w.localStorage.getItem(core.STORAGE_KEY)),
  };
  const settle = () => new Promise(r => setTimeout(r, 20));
  for (let i = 0; i < 200 && !app.svg(); i++) await settle();
  assert.ok(app.svg(), 'приложение отрисовало схему');
  return app;
}

test('страница загружается и рисует демо-схему без ошибок', async () => {
  const app = await openApp();
  const texts = app.svgTexts();
  assert.ok(texts.includes('Структурная схема комплекса'));
  assert.ok(texts.includes('Шкаф ША-03'));
  assert.equal(app.$$('[data-testid="preview"] svg path').length, core.buildScheme(core.createDefaultState()).conns.length);
  assert.deepEqual(app.errors, []);
  app.w.close();
});

test('изменения в форме сразу видны на схеме и сохраняются в браузере', async () => {
  const app = await openApp();
  await app.type(app.field('Название схемы'), 'Схема котельной');
  assert.ok(app.svgTexts().includes('Схема котельной'));
  assert.equal(app.stored().project.title, 'Схема котельной');

  await app.tab('Шкафы автоматики');
  await app.click(app.button('＋ Добавить шкаф'));
  assert.ok(app.svgTexts().includes('Шкаф ША-04'));
  assert.equal(app.stored().autoCabs.length, 4);
  assert.deepEqual(app.errors, []);
  app.w.close();
});

test('после перезагрузки восстанавливается сохранённый проект', async () => {
  const state = core.createDefaultState();
  state.project.title = 'Сохранённая схема';
  state.racks = [];
  const app = await openApp({ storage: { [core.STORAGE_KEY]: core.serializeState(state) } });
  assert.ok(app.svgTexts().includes('Сохранённая схема'));
  assert.ok(!app.svgTexts().includes('Серверная стойка №1'));
  app.w.close();
});

test('повреждённое сохранение не мешает запуску', async () => {
  const app = await openApp({ storage: { [core.STORAGE_KEY]: '{oops' } });
  assert.ok(app.svgTexts().includes('Структурная схема комплекса'));
  app.w.close();
});

test('RS-485 между шкафами включается из интерфейса', async () => {
  const app = await openApp();
  await app.tab('Шкафы автоматики');
  const rows = () => app.$$('.overflow-x-auto > .flex.items-start');
  const countRs = () => app.$$('[data-testid="preview"] svg path').filter(p => p.getAttribute('stroke') === core.COLORS['RS-485']).length;
  assert.equal(countRs(), 0);
  const rs485Cab = row => row.querySelectorAll('input[type="checkbox"]')[5];
  await app.click(rs485Cab(rows()[0]));
  assert.equal(countRs(), 1);
  const select = rows()[0].querySelectorAll('select')[2];
  assert.ok(select, 'появился выбор второго шкафа');
  const third = app.stored().autoCabs[2].id;
  await app.select(select, third);
  assert.equal(app.stored().autoCabs[0].rs485Target, third);
  assert.equal(countRs(), 1);
  assert.deepEqual(app.errors, []);
  app.w.close();
});

test('экспорт SVG и Draw.io выдаёт корректные файлы', async () => {
  const app = await openApp();
  await app.click(app.button('⬇ SVG'));
  await app.click(app.button('⬇ Draw.io'));
  assert.deepEqual(app.downloads.map(d => d.name), ['structural_scheme.svg', 'structural_scheme.drawio']);
  const svg = await app.readBlob(app.downloads[0].blob);
  assert.equal((svg.match(/xmlns=/g) || []).length, 1, 'одно объявление xmlns');
  assert.equal(svg, core.toSvg(core.buildScheme(core.parseState(JSON.stringify(app.stored())))));
  const drawio = await app.readBlob(app.downloads[1].blob);
  assert.match(drawio, /^<mxfile /);
  app.w.close();
});

test('проект сохраняется в файл и открывается из файла', async () => {
  const app = await openApp();
  await app.click(app.button('Сохранить проект'));
  const saved = app.downloads[0];
  assert.equal(saved.name, 'structural_scheme.json');
  const parsed = core.parseState(await app.readBlob(saved.blob));
  assert.equal(parsed.autoCabs.length, 3);

  parsed.project.title = 'Из файла';
  parsed.autoCabs = parsed.autoCabs.slice(0, 1);
  const input = app.$('[data-testid="project-file"]');
  const file = new app.w.File([core.serializeState(parsed)], 'p.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  for (let i = 0; i < 50 && !app.svgTexts().includes('Из файла'); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(app.svgTexts().includes('Из файла'));
  assert.ok(!app.svgTexts().includes('Шкаф ША-02'));
  assert.equal(app.stored().project.title, 'Из файла');

  const bad = new app.w.File(['{"format":"other"}'], 'bad.json');
  Object.defineProperty(input, 'files', { value: [bad], configurable: true });
  input.dispatchEvent(new app.w.Event('change', { bubbles: true }));
  for (let i = 0; i < 50 && !app.dialogs.alerts.length; i++) await new Promise(r => setTimeout(r, 20));
  assert.match(app.dialogs.alerts[0], /не является проектом/);
  assert.ok(app.svgTexts().includes('Из файла'), 'текущий проект не потерян');
  app.w.close();
});

test('«Начать заново» возвращает демо-проект только после подтверждения', async () => {
  const app = await openApp();
  await app.type(app.field('Название схемы'), 'Черновик');
  app.dialogs.confirm = false;
  await app.click(app.button('Начать заново'));
  assert.ok(app.svgTexts().includes('Черновик'));
  app.dialogs.confirm = true;
  await app.click(app.button('Начать заново'));
  assert.ok(app.svgTexts().includes('Структурная схема комплекса'));
  app.w.close();
});

test('все вкладки открываются без ошибок', async () => {
  const app = await openApp();
  for (const name of ['Операторная', 'Серверная', 'Шкафы автоматики', 'Проект']) await app.tab(name);
  await app.tab('Операторная');
  const kvm = app.$$('input[type="checkbox"]')[0];
  await app.click(kvm);
  assert.ok(app.svgTexts().includes('Щит КВМ-удлинителей'));
  await app.tab('Серверная');
  await app.click(app.button('＋ Добавить сетевой шкаф'));
  assert.ok(app.svgTexts().includes('Шкаф сетевой ШС-02'));
  assert.deepEqual(app.errors, []);
  app.w.close();
});
