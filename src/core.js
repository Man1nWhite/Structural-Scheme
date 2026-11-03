/*
 * Ядро генератора структурных схем: модель проекта, раскладка, трассировка,
 * рендер в SVG и Draw.io, сохранение/загрузка проекта.
 *
 * Чистый JavaScript без зависимостей и без DOM. Подключается в браузере
 * обычным <script> (глобальный объект window.SchemeCore) и через require()
 * в Node.js-тестах.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SchemeCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = {
    'Витая пара': '#2563eb',
    'Оптика': '#f97316',
    'KVM': '#6b7280',
    'RS-485': '#16a34a',
    'DI': '#0891b2',
    'DO': '#7c3aed',
    'AI': '#db2777',
    'AO': '#a16207',
  };
  const NAME_BY_COLOR = {};
  Object.keys(COLORS).forEach(k => { NAME_BY_COLOR[COLORS[k]] = k; });

  const OP_TYPES = ['АРМ', 'Принтер', 'Панель управления'];
  const OP_LINKS = ['Витая пара', 'Оптика', 'KVM'];
  const AUTO_UPLINKS = ['Витая пара', 'Оптика'];
  // Шкаф автоматики может не иметь связи сверху: он подключается только
  // к другому шкафу по RS-485 (или вообще стоит отдельно).
  const UPLINK_NONE = 'Без связи';
  const AUTO_UPLINK_OPTIONS = [...AUTO_UPLINKS, UPLINK_NONE];
  const KVM_PANEL_ID = 'kvmpanel';

  // ---------- Утилиты ----------
  const uid = () => Math.random().toString(36).slice(2, 9);
  const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };
  const groupBy = (arr, keyFn) => {
    const m = new Map();
    arr.forEach(x => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.values()];
  };
  const fit = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const pad2 = n => String(n).padStart(2, '0');
  const signalLabel = (signal, showCounts) =>
    showCounts && signal.n != null && signal.n !== '' ? `${signal.k} (${signal.n})` : signal.k;
  // Блоков в ряду: значение из поля ввода может быть строкой, пустым или мусором.
  // Верхний предел нужен, чтобы лист не растянулся на десятки тысяч пикселей
  // (экспорт в PNG ограничен размерами canvas).
  const PER_ROW_MAX = 12;
  const clampPerRow = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(PER_ROW_MAX, Math.max(1, n)) : 1;
  };
  // Количества (серверов, коммутаторов, сигналов…) — целые неотрицательные числа.
  // Верхний предел отсекает мусор из чужих файлов вроде 1e9 в подписи схемы.
  const COUNT_MAX = 99999;
  const toCount = (value, fallback = 0) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(COUNT_MAX, Math.max(0, n)) : fallback;
  };
  const signalsOf = (c) => {
    const s = [];
    if (c.di) s.push({ k: 'DI', n: c.diN });
    if (c.dO) s.push({ k: 'DO', n: c.doN });
    if (c.ai) s.push({ k: 'AI', n: c.aiN });
    if (c.ao) s.push({ k: 'AO', n: c.aoN });
    if (c.rs485) s.push({ k: 'RS-485' });
    return s;
  };
  const fileNameOf = (project) => (project.fileName || 'scheme').replace(/[^\wа-яА-ЯёЁ-]+/g, '_');

  // ---------- Концы связей шкаф-шкаф на нижней грани ----------
  // По нижней грани шкафа равномерно стоят стрелки DI/DO/AI/AO/RS-485. Связь
  // RS-485 между шкафами выходит из грани справа после всех стрелок, а входит
  // слева до них: иначе вертикаль совпадает со стрелкой и читается как ещё
  // один сигнал. Сами стрелки при этом не сдвигаются.
  const CAB_EDGE_PAD = 10; // минимальный отступ конца связи от боковой грани блока
  const cabEdge = (b) => {
    const n = signalsOf(b.item).length;
    return {
      first: b.x + b.w / (n + 1),                    // первая стрелка
      last: b.x + b.w * n / (n + 1),                 // последняя стрелка
      hasSignals: n > 0,
    };
  };
  // index — номер связи на своей стороне (0 — ближняя к стрелкам), count — сколько их.
  function cabLinkX(b, side, index, count) {
    const e = cabEdge(b);
    const x0 = b.x, x1 = b.x + b.w;
    if (!e.hasSignals) {                             // стрелок нет: делим всю грань
      return x0 + (x1 - x0) * (index + 1) / (count + 1);
    }
    if (side === 'out') {
      const free = (x1 - CAB_EDGE_PAD) - e.last;     // поле справа от стрелок
      return e.last + free * (index + 1) / (count + 1);
    }
    const free = e.first - (x0 + CAB_EDGE_PAD);      // поле слева от стрелок
    return e.first - free * (index + 1) / (count + 1);
  }

  // ---------- Экспорт растровой картинки ----------
  // Браузеры отказываются растрировать слишком большой лист: canvas ограничен по
  // площади, и вместо картинки приходит пустой результат. Считаем масштаб заранее.
  const RASTER_SCALE = 2;          // обычный масштаб вывода — для чёткости линий
  const RASTER_MAX_PIXELS = 16e6;  // предел площади canvas (учитывает лимиты браузеров)
  const rasterScale = (width, height) => {
    const fit = Math.sqrt(RASTER_MAX_PIXELS / Math.max(1, width * height));
    return Math.max(0.1, Math.min(RASTER_SCALE, fit));
  };

  // ---------- Геометрия ----------
  const BW = 190;        // ширина блока
  const ARM_W = BW * 0.75; // блоки операторной (АРМ, принтер, панель) на четверть уже
  const GAP_MIN = 30;    // минимальный зазор между колонками
  const SLOT = 7;        // шаг вертикалей, идущих по межколоночному зазору
  const SLOT_M = 8;      // отступ первой такой вертикали от блока
  const LSTEP = 8;       // шаг горизонтальных каналов в полосе
  const EXIT_STEP = 20;  // разнос точек выхода на одной грани блока
  // Высота блока зависит от числа строк описания: пустого низа под текстом нет.
  const BLOCK_TEXT_TOP = 40;    // первая строка текста от верхней грани блока
  const BLOCK_LINE_STEP = 16;   // шаг строк описания
  const BLOCK_BOTTOM_PAD = 14;  // поле под последней строкой
  const blockHeight = (lines) =>
    BLOCK_TEXT_TOP + (Math.max(1, lines) - 1) * BLOCK_LINE_STEP + BLOCK_BOTTOM_PAD;
  const SIG_H = 64;      // зона стрелок сигналов под шкафами автоматики
  const SIG_LEN = 44;    // длина стрелки сигнала
  const HEAD = 32;       // заголовок уровня (помещения)
  const MARGIN = 18;     // поле листа
  const LEVEL_FILL = { op: '#eff6ff', srv: '#f0fdf4', auto: '#fefce8' };
  const LEGEND_ITEM_W = 170;

  // ============================================================
  // МОДЕЛЬ ПРОЕКТА
  // ============================================================
  // Значения по умолчанию одновременно задают схему данных: при загрузке
  // проекта принимаются только эти поля и только совместимых типов.
  const PROJECT_DEFAULTS = {
    title: 'Структурная схема комплекса',
    subtitle: 'АСУ ТП установки',
    fileName: 'structural_scheme',
    operatorName: 'Операторная',
    serverName: 'Серверная',
    autoName: 'Помещение шкафов автоматики',
    blocksPerRow: 4,
    showNotes: true,
    showSignalCounts: false,
    kvmPanel: false,
    kvmPanelName: 'Щит КВМ-удлинителей',
    notesText: '',
  };
  const ITEM_DEFAULTS = {
    opItems: { id: '', name: 'АРМ оператора', type: 'АРМ', link: 'Витая пара', target: null, kvmToPanel: false },
    racks: { id: '', name: 'Серверная стойка', servers: 2, kvm: false, ntp: false, ups: true, netTarget: null },
    netCabs: { id: '', name: 'Шкаф сетевой', switches: 2, fw: 0, cross: 1, external: false, ups: true },
    autoCabs: {
      id: '', name: 'Шкаф ША', ctrls: 1, uplink: 'Витая пара', netTarget: null,
      di: true, dO: true, ai: true, ao: false, rs485: false, rs485Cab: false, rs485Target: null,
      diN: 16, doN: 8, aiN: 8, aoN: 0,
    },
  };
  const LIST_KEYS = Object.keys(ITEM_DEFAULTS);

  // Новые элементы, которые добавляются кнопками «Добавить …».
  const firstNetId = (state) => state.netCabs[0] ? state.netCabs[0].id : null;
  const newOpItem = (state) => ({
    ...ITEM_DEFAULTS.opItems, id: uid(), name: 'АРМ оператора №' + (state.opItems.length + 1), target: firstNetId(state),
  });
  const newRack = (state) => ({
    ...ITEM_DEFAULTS.racks, id: uid(), name: 'Серверная стойка №' + (state.racks.length + 1), netTarget: firstNetId(state),
  });
  const newNetCab = (state) => ({
    ...ITEM_DEFAULTS.netCabs, id: uid(), name: 'Шкаф сетевой ШС-' + pad2(state.netCabs.length + 1),
  });
  const newAutoCab = (state) => ({
    ...ITEM_DEFAULTS.autoCabs, id: uid(), name: 'Шкаф ША-' + pad2(state.autoCabs.length + 1),
    netTarget: firstNetId(state), rs485Target: state.autoCabs[0] ? state.autoCabs[0].id : null,
  });

  // Демонстрационный проект, который открывается при первом запуске.
  function createDefaultState() {
    const net1 = uid();
    const auto = (name, ctrls) => ({
      ...ITEM_DEFAULTS.autoCabs, id: uid(), name, ctrls, netTarget: net1,
      di: true, dO: true, ai: true, ao: true, rs485: true, diN: 32, doN: 32, aiN: 16, aoN: 2,
    });
    const op = (name, type, kvmToPanel) => ({ id: uid(), name, type, link: 'Витая пара', target: net1, kvmToPanel });
    return {
      project: { ...PROJECT_DEFAULTS },
      opItems: [
        op('АРМ оператора №1', 'АРМ', true),
        op('АРМ оператора №2', 'АРМ', true),
        op('Принтер сетевой', 'Принтер', false),
        op('Панель управления', 'Панель управления', false),
      ],
      racks: [
        { id: uid(), name: 'Серверная стойка №1', servers: 3, kvm: true, ntp: true, ups: true, netTarget: net1 },
      ],
      netCabs: [
        { id: net1, name: 'Шкаф сетевой ШС-01', switches: 2, fw: 1, cross: 2, external: true, ups: true },
      ],
      autoCabs: [auto('Шкаф ША-01', 2), auto('Шкаф ША-02', 1), auto('Шкаф ША-03', 1)],
    };
  }

  // ---------- Сохранение / загрузка ----------
  const FORMAT = 'structural-scheme';
  const FORMAT_VERSION = 1;
  const STORAGE_KEY = 'structural-scheme:project';
  // Копия сохранения, которое не удалось прочитать: она откладывается рядом и не затирается.
  const STORAGE_BACKUP_KEY = STORAGE_KEY + ':unreadable';

  function serializeState(state) {
    const out = { format: FORMAT, version: FORMAT_VERSION, project: state.project };
    LIST_KEYS.forEach(k => { out[k] = state[k]; });
    return JSON.stringify(out, null, 2);
  }

  const isPlainObject = v => v != null && typeof v === 'object' && !Array.isArray(v);
  // Берёт из src только известные поля с подходящим типом, остальное — из defaults.
  function pickKnown(src, defaults) {
    const out = { ...defaults };
    if (!isPlainObject(src)) return out;
    Object.keys(defaults).forEach(key => {
      const v = src[key], d = defaults[key];
      if (v === undefined) return;
      const ok = d === null ? (v === null || typeof v === 'string')
        : typeof d === 'number' ? (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string'
        : typeof v === typeof d;
      if (ok) out[key] = v;
    });
    return out;
  }

  function normalizeState(raw) {
    if (!isPlainObject(raw)) throw new Error('Файл не содержит проект структурной схемы.');
    if (raw.format !== undefined && raw.format !== FORMAT) throw new Error('Файл не является проектом структурной схемы.');
    if (typeof raw.version === 'number' && raw.version > FORMAT_VERSION) {
      throw new Error('Проект сохранён в более новом формате, обновите приложение.');
    }
    const state = { project: pickKnown(raw.project, PROJECT_DEFAULTS) };
    // Из поля ввода число приходит строкой: сохраняем строку, если в ней было число.
    const perRow = state.project.blocksPerRow;
    const wasNumber = typeof perRow === 'string' && perRow.trim() !== '' && Number.isFinite(Number(perRow));
    state.project.blocksPerRow = wasNumber ? String(clampPerRow(perRow)) : clampPerRow(perRow);
    const seen = new Set([KVM_PANEL_ID]);
    LIST_KEYS.forEach(k => {
      const list = Array.isArray(raw[k]) ? raw[k] : [];
      state[k] = list.filter(isPlainObject).map(item => {
        const it = pickKnown(item, ITEM_DEFAULTS[k]);
        // Числовые поля элемента приводим к целым неотрицательным. Пустая строка
        // остаётся пустой: так подпись сигнала не показывает количество (signalLabel).
        Object.keys(ITEM_DEFAULTS[k]).forEach(f => {
          const d = ITEM_DEFAULTS[k][f];
          if (typeof d !== 'number') return;
          it[f] = typeof it[f] === 'string' && it[f].trim() === '' ? '' : toCount(it[f], d);
        });
        if (!it.id || seen.has(it.id)) it.id = uid();
        seen.add(it.id);
        return it;
      });
    });
    return state;
  }

  function parseState(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('Файл повреждён или не является JSON.'); }
    return normalizeState(raw);
  }

  // ---------- Цели соединений ----------
  // Ссылки на удалённые элементы не ломают схему: они заменяются первым подходящим.
  function makeResolvers(state) {
    const { project, racks, netCabs, autoCabs } = state;
    const srvTargetIds = new Set([...netCabs.map(c => c.id), ...racks.map(r => r.id)]);
    const effTarget = (id, allowPanel) => {
      if (allowPanel && id === KVM_PANEL_ID && project.kvmPanel) return KVM_PANEL_ID;
      if (srvTargetIds.has(id)) return id;
      return netCabs[0] ? netCabs[0].id : (racks[0] ? racks[0].id : null);
    };
    const effNet = (id) => netCabs.some(c => c.id === id) ? id : (netCabs[0] ? netCabs[0].id : null);
    const effAutoTarget = (id, sourceId) => {
      if (id !== sourceId && autoCabs.some(c => c.id === id)) return id;
      const target = autoCabs.find(c => c.id !== sourceId);
      return target ? target.id : null;
    };
    return { effTarget, effNet, effAutoTarget };
  }

  // ============================================================
  // ТРАССИРОВКА
  // ============================================================
  // Раздача каналов внутри одной горизонтальной полосы.
  // h: { x1, x2, top:[x...], bot:[x...] } — пролёт и абсциссы вертикалей, подходящих к нему сверху/снизу.
  // Строится граф «кто обязан быть выше кого», затем каналы раздаются без пересечений (где это возможно).
  function routeBand(hs, opts = {}) {
    const n = hs.length;
    hs.forEach(h => { h.track = -1; });
    if (!n) return 0;
    const above = hs.map(() => new Set()); // above[i] — пролёты, которые должны лежать ВЫШЕ i
    const sameX = (a, b) => Math.abs(a - b) < 0.5;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const A = hs[i], B = hs[j];
        const inside = x => x > A.x1 && x < A.x2;
        if (B.top.some(inside)) above[i].add(j); // вертикаль B сверху пересекает пролёт A → A ниже B
        if (B.bot.some(inside)) above[j].add(i); // вертикаль B снизу пересекает пролёт A → A выше B
        // Жёсткая ступень (opts.hard): вертикаль уходит вниз с пролёта A и приходит
        // сверху на ту же абсциссу к пролёту B — B обязан лежать выше A. Обычная
        // проверка «внутри пролёта» строгая и такой случай пропускает.
        if (opts.hard && B.top.some(x => A.bot.some(y => sameX(x, y)))) above[i].add(j);
      }
    }
    const placed = new Array(n).fill(false), order = [];
    for (let s = 0; s < n; s++) {
      let best = -1, bestCnt = Infinity, bestLen = Infinity;
      for (let i = 0; i < n; i++) {
        if (placed[i]) continue;
        let cnt = 0;
        above[i].forEach(j => { if (!placed[j]) cnt++; });
        const len = hs[i].x2 - hs[i].x1;
        if (cnt < bestCnt || (cnt === bestCnt && len < bestLen)) { best = i; bestCnt = cnt; bestLen = len; }
      }
      placed[best] = true;
      order.push(best);
    }
    let tracks = 0;
    order.forEach(i => {
      let t = 0;
      above[i].forEach(j => { if (hs[j].track >= 0) t = Math.max(t, hs[j].track + 1); });
      const busy = tt => hs.some((h, k) => k !== i && h.track === tt && !(h.x2 + 4 < hs[i].x1 || h.x1 > hs[i].x2 + 4));
      while (busy(t)) t++;
      hs[i].track = t;
      tracks = Math.max(tracks, t + 1);
    });
    return tracks;
  }

  // Наложения вертикалей: два разных отрезка идут по одной абсциссе и перекрываются
  // по высоте. Проверка ровно та же, что в tests/helpers.js (layoutProblems): тесты
  // не должны знать о внутреннем механизме починки.
  function verticalClashes(conns) {
    const segs = [];
    conns.forEach(c => c.pts.forEach((p, k) => {
      const q = c.pts[k + 1];
      if (q && Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) > 0.01) {
        segs.push({ c, k, x: p[0], y1: Math.min(p[1], q[1]), y2: Math.max(p[1], q[1]) });
      }
    }));
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i], B = segs[j];
        if (A.c === B.c || Math.abs(A.x - B.x) > 0.05) continue;
        if (Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1) > 1.5) out.push([A, B]);
      }
    }
    return out;
  }

  // ============================================================
  // РАСКЛАДКА
  // ============================================================
  // opts.nudges — карта «связь|грань → сдвиг конца» для починки наложений (layoutWithRepair).
  function layout(state, GAPX, opts = {}) {
    const { project, opItems, racks, netCabs, autoCabs } = state;
    const { effTarget, effNet, effAutoTarget } = makeResolvers(state);
    const perRow = clampPerRow(project.blocksPerRow);
    const hasExternal = netCabs.some(c => c.external);
    const titleH = project.subtitle ? 82 : 58;

    const colStep = BW + GAPX;
    const sidePad = Math.max(GAPX, hasExternal ? 84 : 0);

    // Полоса — горизонтальная область для горизонтальных участков линий:
    // межрядные зазоры внутри уровня ('inner') и коридоры между уровнями ('corridor').
    const mkBand = (id, kind, reserved, last) =>
      ({ id, kind, reserved, last, hs: [], tracks: 0, y: 0, height: 0, pad: kind === 'corridor' ? 22 : 12 });

    // Уровень: ряды блоков на ОБЩЕЙ сетке колонок. Ширина и высота блока
    // зависят от содержимого: у блока АРМ колонка уже, высота — по числу строк.
    const mkLevel = (key, items, hOf, reserved) => {
      const raw = chunk(items, perRow);
      const cols = Math.max(1, ...raw.map(r => r.length));
      const blocks = [];
      const rows = raw.map((row, r) => {
        const off = Math.floor((cols - row.length) / 2);
        return row.map((item, c) => {
          const b = {
            id: item.id, item, kind: item.kind, level: key, row: r, col: off + c,
            w: item.kind === 'item' ? ARM_W : BW, h: hOf(item), x: 0, y: 0,
          };
          blocks.push(b);
          return b;
        });
      });
      return {
        key, rows, cols, blocks, nRows: rows.length,
        rowH: rows.map(row => Math.max(...row.map(b => b.h))),
        bands: rows.map((_, r) => mkBand(key + ':' + r, 'inner', reserved, r === rows.length - 1)),
        gapRuns: {}, startX: 0, y: 0, height: 0,
      };
    };

    const opAll = [
      ...opItems.map(i => ({ ...i, kind: 'item' })),
      ...(project.kvmPanel ? [{ id: KVM_PANEL_ID, kind: 'panel', name: project.kvmPanelName }] : []),
    ];
    const srvAll = [...racks.map(r => ({ ...r, kind: 'rack' })), ...netCabs.map(c => ({ ...c, kind: 'net' }))];
    const autoAll = autoCabs.map(c => ({ ...c, kind: 'auto' }));

    const linesOf = (item) => blockLines({ kind: item.kind, item }, state);
    const LV = {
      op: mkLevel('op', opAll, it => blockHeight(linesOf(it).length), 0),
      srv: mkLevel('srv', srvAll, it => blockHeight(linesOf(it).length), 0),
      auto: mkLevel('auto', autoAll, it => blockHeight(linesOf(it).length), SIG_H),
    };
    const levels = [LV.op, LV.srv, LV.auto];
    const C1 = mkBand('C1', 'corridor', 0, false); // операторная ↔ серверная
    const C2 = mkBand('C2', 'corridor', 0, false); // серверная ↔ автоматика

    const maxCols = Math.max(...levels.map(L => L.cols));
    const width = Math.max(880, 2 * (MARGIN + sidePad) + maxCols * colStep - GAPX);
    levels.forEach(L => {
      L.startX = (width - (L.cols * colStep - GAPX)) / 2;
      // Узкий блок стоит по центру своей колонки: зазоры справа и слева равны.
      L.blocks.forEach(b => { b.x = L.startX + b.col * colStep + (BW - b.w) / 2; });
    });
    const blk = {};
    levels.forEach(L => L.blocks.forEach(b => { blk[b.id] = b; }));
    const cx = b => b.x + b.w / 2;
    const firstNet = LV.srv.blocks.find(b => b.kind === 'net') || LV.srv.blocks[0] || null;
    const panel = blk[KVM_PANEL_ID] || null;

    // ---- логические связи ----
    const conns = [];
    LV.op.blocks.forEach(b => {
      if (b.kind !== 'item') return;
      const it = b.item;
      const tId = effTarget(it.target, true);
      const toPanel = tId === KVM_PANEL_ID && !!panel;
      const tgt = toPanel ? panel : (blk[tId] || firstNet);
      if (tgt) conns.push({ src: b, tgt, color: COLORS[toPanel ? 'KVM' : it.link] || COLORS['Витая пара'] });
      if (panel && it.kvmToPanel && !toPanel) conns.push({ src: b, tgt: panel, color: COLORS['KVM'] });
    });
    LV.srv.blocks.forEach(b => {
      if (b.kind !== 'rack') return;
      if (panel && b.item.kvm) conns.push({ src: b, tgt: panel, color: COLORS['KVM'] });
      const t = blk[effNet(b.item.netTarget)];
      if (t) conns.push({ src: b, tgt: t, color: COLORS['Витая пара'] });
    });
    const rs485CabLinks = new Set();
    LV.auto.blocks.forEach(b => {
      // «Без связи» — шкаф не подключается к сети, только к другому шкафу.
      if (b.item.uplink !== UPLINK_NONE) {
        const t = blk[effNet(b.item.netTarget)];
        if (t) conns.push({ src: b, tgt: t, color: COLORS[b.item.uplink] || COLORS['Витая пара'] });
      }

      if (b.item.rs485Cab) {
        const targetId = effAutoTarget(b.item.rs485Target, b.id);
        const target = blk[targetId];
        const linkKey = target ? [b.id, target.id].sort().join('|') : null;
        if (target && !rs485CabLinks.has(linkKey)) {
          rs485CabLinks.add(linkKey);
          conns.push({ src: b, tgt: target, color: COLORS['RS-485'], cabLink: true });
        }
      }
    });

    // ---- грани выхода/входа и основная полоса ----
    const ORD = { op: 0, srv: 1, auto: 2 };
    conns.forEach(c => {
      const S = c.src, T = c.tgt;
      c.u = false;
      if (S.level === T.level) {
        const L = LV[S.level];
        if (S.row < T.row) { c.sEdge = 'bottom'; c.tEdge = 'top'; c.band = L.bands[T.row - 1]; }
        else if (S.row > T.row) { c.sEdge = 'top'; c.tEdge = 'bottom'; c.band = L.bands[T.row]; }
        else { c.u = true; c.sEdge = 'bottom'; c.tEdge = 'bottom'; c.band = L.bands[S.row]; } // U-образная в зазоре под рядом
      } else {
        const down = ORD[S.level] < ORD[T.level];
        c.sEdge = down ? 'bottom' : 'top';
        c.tEdge = down ? 'top' : 'bottom';
        c.band = (S.level === 'op' || T.level === 'op') ? C1 : C2;
      }
    });

    // ---- точки выхода: разнос по грани в порядке положения целей ----
    groupBy(conns, c => c.src.id + '|' + c.sEdge).forEach(g => {
      g.sort((a, b) => cx(a.tgt) - cx(b.tgt));
      g.forEach((c, i) => { c.sx = cx(c.src) + (i - (g.length - 1) / 2) * EXIT_STEP; });
    });
    // Сдвиг конца связи на полшага (см. layoutWithRepair): конец остаётся на своей
    // грани и не выходит за её пределы. Концы RS-485 между шкафами не двигаются.
    const connKey = c => c.src.id + '>' + c.tgt.id;
    const shiftEnd = (c, side, x, b) => {
      const dx = opts.nudges && !c.cabLink && opts.nudges.get(connKey(c) + '|' + side);
      if (!dx) return x;
      return Math.min(b.x + b.w - 6, Math.max(b.x + 6, x + dx));
    };
    conns.forEach(c => { c.sx = shiftEnd(c, 'out', c.sx, c.src); });

    // RS-485 между шкафами выходит из нижней грани справа после всех стрелок
    // сигналов (см. cabLinkX), а не по центру блока.
    LV.auto.blocks.forEach(b => {
      const outs = conns.filter(c => c.cabLink && c.src === b && c.sEdge === 'bottom')
        .sort((a, b2) => cx(a.tgt) - cx(b2.tgt));
      outs.forEach((c, i) => { c.sx = cabLinkX(b, 'out', i, outs.length); });
    });

    // ---- подход от грани блока к полосе: прямой либо через межколоночный зазор ----
    const approach = (c, isSrc, otherX) => {
      const B = isSrc ? c.src : c.tgt, O = isSrc ? c.tgt : c.src;
      const edge = isSrc ? c.sEdge : c.tEdge;
      const px = isSrc ? c.sx : c.tx;
      const L = LV[B.level];
      let r0, r1; // ряды, которые пересекает вертикаль
      if (B.level === O.level) {
        if (isSrc) { r0 = Math.min(B.row, O.row) + 1; r1 = Math.max(B.row, O.row) - 1; }
        else { r0 = 1; r1 = 0; }
      } else if (edge === 'bottom') { r0 = B.row + 1; r1 = L.nRows - 1; }
      else { r0 = 0; r1 = B.row - 1; }
      let len = 0, blocked = false;
      for (let r = r0; r <= r1; r++) { len++; if (L.rows[r].some(o => o.col === B.col)) blocked = true; }
      if (!blocked) return { x: px, run: null, jog: null };
      const dir = otherX >= cx(B) ? 'R' : 'L';           // в какую сторону от блока уходим
      const g = dir === 'R' ? B.col + 1 : B.col;          // зазор g — между колонками g-1 и g
      const run = { g, side: dir === 'R' ? 'L' : 'R', len, px, ax: cx(B) };
      (L.gapRuns[g] = L.gapRuns[g] || []).push(run);
      return { x: px, run, jog: edge === 'bottom' ? L.bands[B.row] : L.bands[B.row - 1] };
    };
    const proxyOf = a => a.run ? a.run.ax : a.x;
    const assignSlots = () => levels.forEach(L => Object.keys(L.gapRuns).forEach(k => {
      const g = Number(k), runs = L.gapRuns[k];
      const gl = L.startX + g * colStep - GAPX;
      const Ls = runs.filter(r => r.side === 'L').sort((a, b) => a.len - b.len || a.px - b.px);
      const Rs = runs.filter(r => r.side === 'R').sort((a, b) => a.len - b.len || b.px - a.px);
      const place = (r, x) => { r.ax = x; r.gl = gl; r.limit = GAPX; };
      Ls.forEach((r, i) => place(r, gl + SLOT_M + i * SLOT));
      Rs.forEach((r, i) => place(r, gl + GAPX - SLOT_M - i * SLOT));
    }));

    // Сдвиг места в межколоночном зазоре (см. layoutWithRepair): вертикаль,
    // идущая по зазору, переезжает на другое место того же зазора.
    const applySlots = () => {
      if (!opts.slots || !opts.slots.size) return;
      conns.forEach(c => {
        [['out', c.sApp], ['in', c.tApp]].forEach(([side, app]) => {
          if (!app || !app.run) return;
          const x = opts.slots.get(connKey(c) + '|slot:' + side);
          if (x != null) app.run.ax = x;
        });
      });
    };
    conns.forEach(c => { c.sApp = approach(c, true, cx(c.tgt)); });
    assignSlots();
    applySlots();

    // ---- точки входа: U-образные слева, сквозные по x источника, U-образные справа ----
    groupBy(conns, c => c.tgt.id + '|' + c.tEdge).forEach(g => {
      const T = g[0].tgt, tc = cx(T);
      const key = c => c.u ? (cx(c.src) < tc ? 0 : 2) : 1;
      g.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka !== kb) return ka - kb;
        return ka === 1 ? proxyOf(a.sApp) - proxyOf(b.sApp) : b.sx - a.sx;
      });
      g.forEach((c, j) => { c.tx = T.x + T.w * (j + 1) / (g.length + 1); });
    });
    // Вход RS-485 между шкафами в нижнюю грань — слева от стрелок, по порядку
    // источников, чтобы линии не пересекались у грани.
    LV.auto.blocks.forEach(b => {
      const ins = conns.filter(c => c.cabLink && c.tgt === b && c.tEdge === 'bottom')
        .sort((a, b2) => proxyOf(a.sApp) - proxyOf(b2.sApp));
      ins.forEach((c, i) => { c.tx = cabLinkX(b, 'in', i, ins.length); });
    });
    conns.forEach(c => { c.tx = shiftEnd(c, 'in', c.tx, c.tgt); });
    conns.forEach(c => { c.tApp = approach(c, false, proxyOf(c.sApp)); });
    assignSlots();
    applySlots();

    let needGap = 0;
    levels.forEach(L => Object.values(L.gapRuns).forEach(runs => {
      needGap = Math.max(needGap, 2 * SLOT_M + (runs.length - 1) * SLOT);
    }));

    // ---- горизонтальные участки → полосы ----
    const mk = (a, b) => ({ x1: Math.min(a, b), x2: Math.max(a, b), top: [], bot: [], track: 0 });
    conns.forEach(c => {
      const sX = proxyOf(c.sApp), tX = proxyOf(c.tApp);
      c.main = mk(sX, tX);
      (c.sEdge === 'bottom' ? c.main.top : c.main.bot).push(sX);
      (c.tEdge === 'top' ? c.main.bot : c.main.top).push(tX);
      c.band.hs.push(c.main);
      if (c.sApp.run) {
        c.sJog = mk(c.sx, sX);
        if (c.sEdge === 'bottom') { c.sJog.top.push(c.sx); c.sJog.bot.push(sX); }
        else { c.sJog.bot.push(c.sx); c.sJog.top.push(sX); }
        c.sApp.jog.hs.push(c.sJog);
      }
      if (c.tApp.run) {
        c.tJog = mk(tX, c.tx);
        if (c.tEdge === 'top') { c.tJog.top.push(tX); c.tJog.bot.push(c.tx); }
        else { c.tJog.bot.push(tX); c.tJog.top.push(c.tx); }
        c.tApp.jog.hs.push(c.tJog);
      }
    });
    const allBands = [C1, C2, ...levels.flatMap(L => L.bands)];
    allBands.forEach(b => { b.tracks = routeBand(b.hs, opts); });
    // Переопределение канала пролёта (обмен каналами, см. layoutWithRepair).
    if (opts.tracks && opts.tracks.size) {
      conns.forEach(c => {
        [['main', c.main], ['sout', c.sJog], ['tin', c.tJog]].forEach(([tag, h]) => {
          if (!h) return;
          const band = tag === 'main' ? c.band : (tag === 'sout' ? c.sApp.jog : c.tApp.jog);
          const t = opts.tracks.get(connKey(c) + '|' + tag);
          if (!band || t == null || t < 0 || t >= band.tracks) return;
          h.track = t;
        });
      });
    }

    // ---- вертикальная раскладка ----
    const bandH = (b) => {
      const lines = b.tracks ? 2 * b.pad + (b.tracks - 1) * LSTEP : 0;
      if (b.kind === 'corridor') return Math.max(44, lines);
      return b.reserved + Math.max(b.last ? 8 : 18, lines);
    };
    const trackY = (b, t) => b.y + b.reserved + b.pad + t * LSTEP;
    let y = titleH;
    const layoutLevel = (L) => {
      L.y = y; let cy = y + HEAD;
      L.rows.forEach((row, r) => {
        row.forEach(b => { b.y = cy; });
        cy += L.rowH[r];
        const b = L.bands[r]; b.y = cy; b.height = bandH(b); cy += b.height;
      });
      if (!L.nRows) cy += 12;
      L.height = cy + 6 - y; y += L.height;
    };
    layoutLevel(LV.op);
    C1.y = y; C1.height = bandH(C1); y += C1.height;
    layoutLevel(LV.srv);
    C2.y = y; C2.height = bandH(C2); y += C2.height;
    layoutLevel(LV.auto);

    // ---- точки маршрутов ----
    conns.forEach(c => {
      const S = c.src, T = c.tgt;
      c.sy = c.sEdge === 'bottom' ? S.y + S.h : S.y;
      c.ty = c.tEdge === 'top' ? T.y : T.y + T.h;
      const sX = proxyOf(c.sApp), tX = proxyOf(c.tApp);
      const pts = [[c.sx, c.sy]];
      if (c.sApp.run) { const jy = trackY(c.sApp.jog, c.sJog.track); pts.push([c.sx, jy], [sX, jy]); }
      const my = trackY(c.band, c.main.track); pts.push([sX, my], [tX, my]);
      if (c.tApp.run) { const jy = trackY(c.tApp.jog, c.tJog.track); pts.push([tX, jy], [c.tx, jy]); }
      pts.push([c.tx, c.ty]);
      c.pts = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 0.01 || Math.abs(p[1] - pts[i - 1][1]) > 0.01);
    });

    // ---- внешняя связь ----
    const ext = LV.srv.blocks.filter(b => b.kind === 'net' && b.item.external).map(b => {
      const row = LV.srv.rows[b.row];
      const rightmost = row[row.length - 1] === b;
      return {
        b, y: b.y + b.h - 12, x1: b.x + b.w,
        x2: rightmost ? width - MARGIN + 14 : b.x + b.w + GAPX - 6,
        label: rightmost,
      };
    });

    return { width, titleH, LV, levels, conns, C1, C2, blk, ext, needGap, bottom: y };
  }

  // ---------- Починка наложений ----------
  // Основа — трассировка backup: первый проход повторяет её без единого изменения.
  // Дальше найденные наложения разводятся тремя заходами (см. layoutWithRepair):
  //   • перебор ходов по первому наложению — сдвиг конца связи на полшага по грани
  //     блока, переезд вертикали на другое место зазора, другой канал полосы;
  //   • мелкие места в зазоре, когда все обычные заняты вертикалями других уровней;
  //   • прямой сдвиг слипшейся вертикали в готовом маршруте (fixVerticals).
  // Сетка полос (число каналов и ширина листа) — это опорная геометрия из backup:
  // ход, который её меняет, не принимается, иначе лист уезжает целиком и опорные
  // маршруты перестают совпадать. Последний заход пересчёт не запускает вовсе,
  // поэтому остальные линии от него не двигаются.
  const NUDGE = EXIT_STEP / 2;
  const spanTrackY = (band, t) => band.y + band.reserved + band.pad + t * LSTEP;

  // Кандидат на сдвиг — конец связи, лежащий на грани блока. Вход предпочитаем
  // выходу: выходы упорядочены по положению целей, входы распределены ровно.
  // Концы RS-485 между шкафами не двигаем: их положение задано стрелками сигналов.
  function nudgeCandidates(pair, used, conns, allEnds) {
    const ends = [];
    pair.forEach(seg => {
      const pts = seg.c.pts;
      const last = seg.k === pts.length - 2, first = seg.k === 0;
      if (!last && !first) return;
      if (seg.c.cabLink) return;
      const key = seg.c.src.id + '>' + seg.c.tgt.id + '|' + (last ? 'in' : 'out');
      ends.push({ seg, key, last });
    });
    if (!ends.length) return [];
    ends.sort((a, b) => Number(b.last) - Number(a.last));
    const out = [];
    (allEnds ? ends : ends.slice(0, 1)).forEach(({ seg, key }) => {
      const free = x => !conns.some(c => c !== seg.c && c.pts.some((p, k) => {
        const q = c.pts[k + 1];
        if (!q || Math.abs(p[0] - q[0]) >= 0.01 || Math.abs(p[0] - x) >= 0.05) return false;
        const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
        return Math.min(y2, seg.y2) - Math.max(y1, seg.y1) > 1.5;
      }));
      const pts = seg.c.pts;
      const near = seg.k === pts.length - 2 ? pts[seg.k - 1] : pts[seg.k + 2];
      const toward = near && Math.abs(near[0] - seg.x) > 0.01 ? Math.sign(near[0] - seg.x) : 0;
      const dirs = toward ? [toward, -toward] : [1, -1];
      dirs.map(d => d * NUDGE).filter(d => free(seg.x + d)).forEach(dx => out.push({
        id: key + '=' + dx,
        changes: [['nudges', key, dx]],
      }));
    });
    return out;
  }

  // Кандидат на переезд — вертикаль, идущая по межколоночному зазору: её абсцисса
  // это место в зазоре, а не грань блока. Места раздаются отдельно по уровням,
  // поэтому вертикали разных уровней могут встать на одно место и слипнуться.
  function slotCandidates(pair, used, conns, fine) {
    const cands = [];
    pair.forEach(seg => {
      if (seg.c.cabLink) return;
      for (const side of ['out', 'in']) {
        const app = side === 'out' ? seg.c.sApp : seg.c.tApp;
        if (!app || !app.run || Math.abs(app.run.ax - seg.x) > 0.05) continue;
        cands.push({ seg, key: seg.c.src.id + '>' + seg.c.tgt.id + '|slot:' + side, run: app.run });
      }
    });
    if (!cands.length) return [];
    const out = [];
    (fine ? cands : cands.slice(0, 1)).forEach(({ seg, key, run }) => {
      const { gl, limit } = run;
      const xs = [];
      for (let i = 0; i < 4; i++) xs.push(gl + SLOT_M + i * SLOT, gl + limit - SLOT_M - i * SLOT);
      // Соседние места в зазоре заняты вертикалями других уровней: во втором
      // заходе разрешаем встать рядом с текущим местом, с шагом в пару пикселей.
      if (fine) [3, -3, 5, -5, 6, -6].forEach(d => xs.push(run.ax + d));
      const free = x => x > gl + 2 && x < gl + limit - 2 && !conns.some(c => c !== seg.c && c.pts.some((p, k) => {
        const q = c.pts[k + 1];
        if (!q || Math.abs(p[0] - q[0]) >= 0.01 || Math.abs(p[0] - x) >= 0.05) return false;
        const y1 = Math.min(p[1], q[1]), y2 = Math.max(p[1], q[1]);
        return Math.min(y2, seg.y2) - Math.max(y1, seg.y1) > 1.5;
      }));
      [...new Set(xs)].filter(x => Math.abs(x - seg.x) > 0.5 && free(x))
        .sort((a, b) => Math.abs(a - seg.x) - Math.abs(b - seg.x))
        .forEach(x => out.push({ id: key + '=' + x, changes: [['slots', key, x]] }));
    });
    return out;
  }

  // Пролёт, которому принадлежит вертикаль: внутренний конец вертикали лежит
  // на канале полосы (другой конец — на грани блока).
  function spanOf(seg) {
    const c = seg.c;
    const list = [
      [c.main, c.band, 'main'],
      [c.sJog, c.sApp && c.sApp.jog, 'sout'],
      [c.tJog, c.tApp && c.tApp.jog, 'tin'],
    ];
    for (const [h, band, tag] of list) {
      if (!h || !band || band.tracks < 1) continue;
      if (seg.x < h.x1 - 0.5 || seg.x > h.x2 + 0.5) continue;
      const y = spanTrackY(band, h.track);
      if (Math.abs(y - seg.y1) < 0.5 || Math.abs(y - seg.y2) < 0.5) {
        return { key: c.src.id + '>' + c.tgt.id + '|' + tag, band, span: h, track: h.track };
      }
    }
    return null;
  }

  // Перестановка канала: одна из двух слипшихся вертикалей переезжает на другой
  // канал той же полосы. Высота полосы при этом не меняется, поэтому остальные
  // линии чертежа остаются на месте; пересечения с горизонталями допустимы.
  function trackCandidates(pair, used) {
    const out = [];
    pair.forEach(seg => {
      const s = spanOf(seg);
      if (!s) return;
      // Канал, на котором уже лежит перекрывающийся пролёт, не годится: получилась
      // бы слипшаяся горизонталь вместо слипшейся вертикали.
      const busy = (t, self) => s.band.hs.some(h => h !== self && h.track === t
        && !(h.x2 + 4 < self.x1 || h.x1 > self.x2 + 4));
      const self = s.span;
      for (let t = 0; t < s.band.tracks; t++) {
        if (t === s.track || busy(t, self)) continue;
        const id = `track|${s.key}|${s.track}>${t}`;
        if (used.has(id)) continue;
        out.push({ id, dist: Math.abs(t - s.track), changes: [['tracks', s.key, t]] });
      }
    });
    return out.sort((a, b) => a.dist - b.dist);
  }

  // Замечания к готовому чертежу: слипшиеся отрезки и линии сквозь блоки. Это та же
  // проверка, что в tests/helpers.js (layoutProblems); здесь она нужна, чтобы
  // сравнивать проходы починки между собой.
  const spanLen = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2))
    - Math.max(Math.min(a1, a2), Math.min(b1, b2));
  const hitsBlock = (s, b) => Math.min(s.x1, s.x2) < b.x + b.w - 0.5
    && Math.max(s.x1, s.x2) > b.x + 0.5
    && Math.min(s.y1, s.y2) < b.y + b.h - 0.5
    && Math.max(s.y1, s.y2) > b.y + 0.5;

  function schemeProblems(M) {
    const segs = [];
    const bad = new Set();
    M.conns.forEach(c => c.pts.forEach((p, k) => {
      const q = c.pts[k + 1];
      if (!q) return;
      segs.push({
        c, k, x1: p[0], y1: p[1], x2: q[0], y2: q[1],
        horizontal: Math.abs(p[1] - q[1]) < 0.01,
        length: Math.hypot(q[0] - p[0], q[1] - p[1]),
      });
    }));
    let count = 0;
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        const A = segs[a], B = segs[b];
        if (A.c === B.c || A.horizontal !== B.horizontal) continue;
        if (A.length < 0.01 || B.length < 0.01) continue;
        const len = A.horizontal
          ? (Math.abs(A.y1 - B.y1) < 0.05 ? spanLen(A.x1, A.x2, B.x1, B.x2) : 0)
          : (Math.abs(A.x1 - B.x1) < 0.05 ? spanLen(A.y1, A.y2, B.y1, B.y2) : 0);
        if (len > 1.5) { count++; bad.add(keyOfConn(A.c)); bad.add(keyOfConn(B.c)); }
      }
    }
    const blocks = M.levels ? M.levels.flatMap(L => L.blocks) : M.blocks;
    segs.forEach(s => {
      if (s.length < 0.01) { count++; bad.add(keyOfConn(s.c)); return; }
      blocks.forEach(b => {
        if (b !== s.c.src && b !== s.c.tgt && hitsBlock(s, b)) { count++; bad.add(keyOfConn(s.c)); }
      });
    });
    return { count, bad };
  }

  const keyOfConn = (c) => c.src.id + '>' + c.tgt.id;

  // Подбор ширины межколоночного зазора — как раньше, с учётом ходов починки.
  function fitGap(state, opts) {
    let M = null, gapx = GAP_MIN;
    for (let i = 0; i < 4; i++) {
      M = layout(state, gapx, opts);
      if (M.needGap <= gapx) break;
      gapx = M.needGap;
    }
    return M;
  }

  // Сетка полос: ширина листа и число каналов в каждой полосе.
  const bandGrid = (M) =>
    M.width + '|' + [...M.levels.flatMap(L => L.bands), M.C1, M.C2].map(b => b.tracks).join(',');
  // Положение блоков: по нему видно, что ход не перестроил уровни целиком.
  const poseOf = (M) => M.levels.flatMap(L => L.blocks).map(b => b.id + ':' + b.x + ':' + b.y).join('|');
  // Концы линии — точки на гранях блоков.
  const endsOf = (c) => [c.pts[0], c.pts[c.pts.length - 1]]
    .map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');

  // Последний заход: наложение осталось, и пересчёт чертежа уже ничего не даёт.
  // Двигаем одну из слипшихся вертикалей прямо в готовом маршруте: точка на грани
  // блока переезжает вдоль этой грани, точка в зазоре — на свободное место зазора.
  // Остальные линии при этом не пересчитываются и не сдвигаются.
  const DELTAS = [3, -3, 5, -5, 6, -6, 7, -7, 10, -10, 14, -14, 20, -20];

  // Пределы сдвига точки по грани блока; null — грань вертикальная, x не двигаем.
  function faceRange(block, pt) {
    if (!block) return null;
    const top = Math.abs(pt[1] - block.y) < 0.6;
    const bottom = Math.abs(pt[1] - (block.y + block.h)) < 0.6;
    if (!top && !bottom) return null;
    return [block.x + 6, block.x + block.w - 6];
  }

  function fixVerticals(M) {
    const count = (X) => schemeProblems(X).count;
    let best = { M, count: count(M) };
    for (let step = 0; step < 12 && best.count; step++) {
      let applied = false;
      for (const pair of verticalClashes(best.M.conns)) {
        const options = [];
        pair.forEach(seg => {
          const c = seg.c;
          // Концы RS-485 между шкафами стоят после стрелок сигналов — их не двигаем.
          if (c.cabLink) return;
          const last = c.pts.length - 1;
          let lo = -Infinity, hi = Infinity;
          if (seg.k === 0) {
            const r = faceRange(c.src, c.pts[0]);
            if (!r) { lo = hi = seg.x; } else { lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); }
          }
          if (seg.k === last - 1) {
            const r = faceRange(c.tgt, c.pts[last]);
            if (!r) { lo = hi = seg.x; } else { lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); }
          }
          if (lo > hi) return;
          const xs = DELTAS.map(d => seg.x + d);
          ['out', 'in'].forEach(side => {
            const app = side === 'out' ? c.sApp : c.tApp;
            if (!app || !app.run || Math.abs(app.run.ax - seg.x) > 0.05) return;
            const { gl, limit } = app.run;
            for (let i = 0; i < 4; i++) xs.push(gl + SLOT_M + i * SLOT, gl + limit - SLOT_M - i * SLOT);
          });
          xs.filter(x => x >= lo && x <= hi && Math.abs(x - seg.x) > 0.5)
            .forEach(x => options.push({ seg, x }));
        });
        options.sort((a, b) => Math.abs(a.x - a.seg.x) - Math.abs(b.x - b.seg.x));
        for (const { seg, x } of options) {
          const pts = seg.c.pts.map((p, i) => (i === seg.k || i === seg.k + 1 ? [x, p[1]] : p));
          // Соседние горизонтали не должны выродиться в точку.
          const jammed = pts.some((p, i) => {
            const q = pts[i + 1];
            return q && Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
          });
          if (jammed) continue;
          const moved = { ...seg.c, pts };
          const M2 = { ...best.M, conns: best.M.conns.map(c => (c === seg.c ? moved : c)) };
          const c2 = count(M2);
          if (c2 < best.count) {
            best = { M: M2, count: c2 };
            applied = true;
            break;
          }
        }
        if (applied) break;
      }
      if (!applied) break;
    }
    return best.M;
  }

  // Починка трассировки идёт тремя заходами: перебор ходов по первому наложению,
  // затем мелкие места в зазоре, затем прямой сдвиг слипшейся вертикали в готовом
  // маршруте. Уже правильные линии при этом не перерисовываются.
  function layoutWithRepair(state) {
    const base = fitGap(state, {});
    const baseReport = schemeProblems(base);

    const over = { nudges: new Map(), slots: new Map(), tracks: new Map() };
    const used = new Set();
    let best = { M: base, count: baseReport.count };

    const baseGrid = bandGrid(base);

    const moveOptions = (hard) => ({
      nudges: over.nudges, slots: over.slots, tracks: over.tracks, hard,
    });
    const applyMove = (move) => move.changes.map(([map, key, value]) => {
      const prev = over[map].has(key) ? over[map].get(key) : undefined;
      over[map].set(key, value);
      return [map, key, prev];
    });
    const revertMove = (saved) => saved.forEach(([map, key, prev]) => {
      if (prev === undefined) over[map].delete(key);
      else over[map].set(key, prev);
    });
    // Ход принимается, только если сетка полос не изменилась: иначе лист уезжает
    // целиком и опорные маршруты перестают совпадать. Ходы, которые не улучшают
    // чертёж, но и не портят его, разрешены: они бывают нужны как промежуточный шаг.
    const accept = (hard) => {
      const M = fitGap(state, moveOptions(hard));
      if (bandGrid(M) !== baseGrid) return false;
      const report = schemeProblems(M);
      if (report.count > best.count) return false;
      best = { M, count: report.count };
      return true;
    };
    // Ходы перебираются от первого наложения: сдвиг конца, переезд места в зазоре,
    // перестановка канала. Неудачный ход не отменяет остальные и не повторяется.
    const pass = (hard) => {
      for (let step = 0; step < 160 && best.count; step++) {
        let applied = false;
        for (const pair of verticalClashes(best.M.conns)) {
          const candidates = [
            ...nudgeCandidates(pair, used, best.M.conns),
            ...slotCandidates(pair, used, best.M.conns),
            ...trackCandidates(pair, used),
          ];
          for (const move of candidates) {
            if (used.has(move.id)) continue;
            used.add(move.id);
            const saved = applyMove(move);
            if (accept(hard)) { applied = true; break; }
            revertMove(saved);
          }
          if (applied) break;
        }
        if (!applied) break;
      }
    };

    // Второй заход: строгие ходы кончились, а наложения остались. Разрешаем встать
    // на мелкое место в зазоре рядом с занятым, но только если от этого не съезжают
    // места выходов и входов на гранях блоков у уже нарисованных правильно линий.
    const aggressive = () => {
      if (!best.count) return;
      const ref = best.M;
      const refReport = schemeProblems(ref);
      const refPose = poseOf(ref);
      // Места выходов и входов на гранях блоков не двигаем: это опорные точки
      // чертежа, по ним сверяется трассировка.
      const refEnds = new Map();
      ref.conns.forEach(c => {
        if (!refReport.bad.has(keyOfConn(c))) refEnds.set(keyOfConn(c), endsOf(c));
      });
      // Внутренние изломы соседних правильных линий могут переехать на другой
      // канал — это не меняет чертёж, а вот места на гранях блоков меняют.
      const calm = (M) => M.width === ref.width && poseOf(M) === refPose
        && M.conns.every(c => !refEnds.has(keyOfConn(c)) || endsOf(c) === refEnds.get(keyOfConn(c)));
      for (let step = 0; step < 160 && best.count; step++) {
        let applied = false;
        for (const pair of verticalClashes(best.M.conns)) {
          const candidates = slotCandidates(pair, used, best.M.conns, true);
          for (const move of candidates) {
            if (used.has(move.id)) continue;
            const saved = applyMove(move);
            const M = fitGap(state, moveOptions(false));
            const count = schemeProblems(M).count;
            if (calm(M) && count < best.count) {
              used.add(move.id);
              best = { M, count };
              applied = true;
              break;
            }
            revertMove(saved);
          }
          if (applied) break;
        }
        if (!applied) break;
      }
    };

    pass(false);
    // Ходы не помогли: пробуем жёсткий порядок каналов и снова ходы.
    if (best.count) { accept(true); pass(true); }
    aggressive();
    return fixVerticals(best.M);
  }

  // ---------- Описания блоков ----------
  function blockLines(b, state) {
    const it = b.item;
    if (b.kind === 'item') return [it.type];
    if (b.kind === 'panel') return ['KVM-удлинители', `Стоек подключено: ${state.racks.filter(r => r.kvm).length}`];
    if (b.kind === 'rack') {
      const l = [`Серверов: ${it.servers}`];
      if (it.ntp) l.push('Сервер NTP');
      if (it.kvm) l.push('KVM');
      if (it.ups) l.push('ИБП RACK');
      return l;
    }
    if (b.kind === 'net') {
      const l = [`Коммутаторов: ${it.switches}`];
      if (it.fw > 0) l.push(`Межсетевых экранов: ${it.fw}`);
      if (it.cross > 0) l.push(`Опт. кроссов: ${it.cross}`);
      if (it.external) l.push('Внешняя связь');
      if (it.ups) l.push('ИБП RACK');
      return l;
    }
    return [`Контроллеров: ${it.ctrls}`];
  }

  // ============================================================
  // ПОЛНАЯ МОДЕЛЬ СХЕМЫ
  // ============================================================
  // Единственный источник геометрии и текстов для всех форматов вывода:
  // toSvg() (предпросмотр, SVG, PNG, JPG) и toDrawio() рисуют одну и ту же модель.
  function buildScheme(state) {
    const { project, autoCabs, netCabs } = state;

    // Раскладка с починкой наложений: первый проход — как в backup, дальше концы
    // наложившихся связей разводятся на полшага (ширина зазора подбирается там же).
    const M = layoutWithRepair(state);
    const { width, LV, levels, conns, ext } = M;
    const levelX = MARGIN, levelW = width - 2 * MARGIN;

    const blocks = levels.flatMap(L => L.blocks);
    blocks.forEach(b => {
      b.name = b.item.name;
      b.lines = blockLines(b, state);
      // Заголовок обрезается по ширине блока: у узкого АРМ символов меньше.
      b.nameText = fit(b.name, Math.max(8, Math.floor((b.w - 14) / 6.25)));
      b.fill = b.kind === 'panel' ? '#f1f5f9' : '#ffffff';
    });

    const rooms = [
      { id: 'lvl_op', L: LV.op, name: project.operatorName, fill: LEVEL_FILL.op },
      { id: 'lvl_srv', L: LV.srv, name: project.serverName, fill: LEVEL_FILL.srv },
      { id: 'lvl_auto', L: LV.auto, name: project.autoName, fill: LEVEL_FILL.auto },
    ].map(r => ({ id: r.id, name: r.name, fill: r.fill, x: levelX, y: r.L.y, w: levelW, h: r.L.height }));

    // ---- стрелки сигналов под шкафами автоматики ----
    const signals = [];
    LV.auto.blocks.forEach(b => {
      const sigs = signalsOf(b.item);
      sigs.forEach((s, i) => {
        signals.push({
          block: b, kind: s.k, color: COLORS[s.k],
          label: signalLabel(s, project.showSignalCounts),
          exitX: (i + 1) / (sigs.length + 1),
          x: b.x + b.w * (i + 1) / (sigs.length + 1),
          y1: b.y + b.h, y2: b.y + b.h + SIG_LEN,
        });
      });
    });

    // ---- легенда ----
    const used = new Set();
    conns.forEach(c => { if (NAME_BY_COLOR[c.color]) used.add(NAME_BY_COLOR[c.color]); });
    autoCabs.forEach(c => {
      if (c.rs485) used.add('RS-485');
      if (c.di) used.add('DI'); if (c.dO) used.add('DO');
      if (c.ai) used.add('AI'); if (c.ao) used.add('AO');
    });
    if (netCabs.some(c => c.external)) used.add('Оптика');
    const legendNames = Object.keys(COLORS).filter(k => used.has(k));
    const legCols = Math.max(1, Math.floor((width - 2 * MARGIN) / LEGEND_ITEM_W));
    const legRows = Math.ceil(legendNames.length / legCols) || 1;
    const legendY = M.bottom + 24;
    const legend = {
      x: levelX, y: legendY, w: levelW, h: 34 + legRows * 24, itemW: LEGEND_ITEM_W,
      items: legendNames.map((name, i) => ({
        name, color: COLORS[name],
        x: levelX + 14 + (i % legCols) * LEGEND_ITEM_W,
        y: legendY + 36 + Math.floor(i / legCols) * 24,
      })),
    };

    // ---- примечания ----
    const noteLines = project.showNotes ? String(project.notesText || '').split('\n').filter(Boolean) : [];
    const notesY = legend.y + legend.h + 18;
    const notes = noteLines.length ? { x: levelX, y: notesY, lines: noteLines } : null;
    const height = notesY + (noteLines.length ? 20 + noteLines.length * 16 : 0) + 24;

    return {
      width, height, title: project.title, subtitle: project.subtitle, fileName: fileNameOf(project),
      rooms, blocks, conns, ext, signals, legend, notes,
    };
  }

  // ============================================================
  // ВЫВОД В SVG
  // ============================================================
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svgAttrs = (attrs) => Object.keys(attrs)
    .filter(k => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false)
    .map(k => ` ${k}="${esc(attrs[k])}"`).join('');
  const el = (tag, attrs, content) =>
    content === undefined ? `<${tag}${svgAttrs(attrs)}/>` : `<${tag}${svgAttrs(attrs)}>${content}</${tag}>`;
  const txt = (attrs, s) => el('text', attrs, esc(s));

  function toSvg(m) {
    const out = [];
    out.push(el('rect', { x: 0, y: 0, width: m.width, height: m.height, fill: '#ffffff' }));
    out.push(txt({ x: m.width / 2, y: 30, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 'bold', fill: '#111827' }, m.title));
    if (m.subtitle) out.push(txt({ x: m.width / 2, y: 52, 'text-anchor': 'middle', 'font-size': 12, fill: '#6b7280' }, m.subtitle));

    // помещения
    m.rooms.forEach(r => out.push(el('rect', {
      x: r.x, y: r.y, width: r.w, height: r.h, rx: 8,
      fill: r.fill, stroke: '#94a3b8', 'stroke-width': 1, 'stroke-dasharray': '6 4',
    })));

    // связи
    m.conns.forEach(c => out.push(el('path', {
      d: c.pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
      stroke: c.color, 'stroke-width': 1.7, fill: 'none', 'stroke-linejoin': 'round',
    })));

    // внешняя связь
    const optic = COLORS['Оптика'];
    m.ext.forEach(e => out.push(el('g', {}, [
      el('line', { x1: e.x1, y1: e.y, x2: e.x2, y2: e.y, stroke: optic, 'stroke-width': 1.7, 'stroke-dasharray': '7 4' }),
      el('polygon', { points: `${e.x2},${e.y} ${e.x2 - 8},${e.y - 4} ${e.x2 - 8},${e.y + 4}`, fill: optic }),
      e.label ? txt({ x: e.x2 - 4, y: e.y - 7, 'text-anchor': 'end', 'font-size': 9, fill: optic }, 'Внешняя связь') : '',
    ].join(''))));

    // блоки
    m.blocks.forEach(b => out.push(el('g', {}, [
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, fill: b.fill, stroke: '#334155', 'stroke-width': 1.3 }),
      txt({ x: b.x + b.w / 2, y: b.y + 16, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 'bold', fill: '#111827' }, b.nameText),
      el('line', { x1: b.x + 8, y1: b.y + 24, x2: b.x + b.w - 8, y2: b.y + 24, stroke: '#cbd5e1' }),
      ...b.lines.map((t, i) => txt({ x: b.x + 12, y: b.y + BLOCK_TEXT_TOP + i * BLOCK_LINE_STEP, 'font-size': 10, fill: '#374151' }, '• ' + fit(t, Math.max(8, Math.floor((b.w - 25) / 6))))),
    ].join(''))));

    // подписи помещений (поверх линий)
    m.rooms.forEach(r => out.push(el('g', {}, [
      el('rect', { x: r.x + 8, y: r.y + 7, width: String(r.name).length * 7.2 + 12, height: 19, rx: 4, fill: r.fill }),
      txt({ x: r.x + 14, y: r.y + 21, 'font-size': 12, 'font-weight': 'bold', fill: '#475569' }, r.name),
    ].join(''))));

    // стрелки сигналов
    m.signals.forEach(s => out.push(el('g', {}, [
      el('line', { x1: s.x, y1: s.y1, x2: s.x, y2: s.y2 - 6, stroke: s.color, 'stroke-width': 1.7 }),
      el('polygon', { points: `${s.x},${s.y2} ${s.x - 4},${s.y2 - 7} ${s.x + 4},${s.y2 - 7}`, fill: s.color }),
      txt({ x: s.x, y: s.y2 + 13, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 'bold', fill: s.color }, s.label),
    ].join(''))));

    // легенда
    const lg = m.legend;
    out.push(el('g', {}, [
      el('rect', { x: lg.x, y: lg.y, width: lg.w, height: lg.h, rx: 6, fill: '#ffffff', stroke: '#94a3b8' }),
      txt({ x: lg.x + 14, y: lg.y + 18, 'font-size': 11, 'font-weight': 'bold', fill: '#374151' }, 'Условные обозначения:'),
      ...lg.items.map(it => el('g', {}, [
        el('line', { x1: it.x, y1: it.y, x2: it.x + 30, y2: it.y, stroke: it.color, 'stroke-width': 3 }),
        txt({ x: it.x + 38, y: it.y + 4, 'font-size': 10, fill: '#374151' }, it.name),
      ].join(''))),
    ].join('')));

    // примечания
    if (m.notes) {
      const n = m.notes;
      out.push(el('g', {}, [
        txt({ x: n.x, y: n.y + 12, 'font-size': 11, 'font-weight': 'bold', fill: '#374151' }, 'Примечания:'),
        ...n.lines.map((t, i) => txt({ x: n.x, y: n.y + 30 + i * 16, 'font-size': 10, fill: '#4b5563' }, t)),
      ].join('')));
    }

    return el('svg', {
      xmlns: 'http://www.w3.org/2000/svg', width: m.width, height: m.height,
      viewBox: `0 0 ${m.width} ${m.height}`, 'font-family': 'Arial, Helvetica, sans-serif', style: 'background: #fff',
    }, out.join(''));
  }

  // ============================================================
  // ВЫВОД В DRAW.IO
  // ============================================================
  function toDrawio(m) {
    const xesc = esc;
    const hesc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const R = n => Math.round(n);
    const cells = [];
    let eid = 0;

    // id приходит из файла проекта и может содержать любые символы: в XML его
    // экранируем так же, как значения, иначе файл .drawio перестаёт разбираться.
    const vtx = (id, value, x, y, w, h, style) =>
      cells.push(`<mxCell id="${xesc(id)}" value="${xesc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${R(x)}" y="${R(y)}" width="${R(w)}" height="${R(h)}" as="geometry"/></mxCell>`);
    const edge = (value, style, attrs, geometry) =>
      cells.push(`<mxCell id="e${eid++}" value="${xesc(value)}" style="${style}" edge="1" parent="1"${attrs}><mxGeometry relative="1" as="geometry">${geometry}</mxGeometry></mxCell>`);

    vtx('t1', `<b>${hesc(m.title)}</b>`, MARGIN, 8, m.width - 2 * MARGIN, 26,
      'text;html=1;align=center;verticalAlign=middle;fontSize=18;fontColor=#111827;');
    if (m.subtitle) vtx('t2', hesc(m.subtitle), MARGIN, 38, m.width - 2 * MARGIN, 18,
      'text;html=1;align=center;verticalAlign=middle;fontSize=12;fontColor=#6b7280;');

    const roomStyle = f => `rounded=1;dashed=1;dashPattern=6 4;fillColor=${f};strokeColor=#94a3b8;verticalAlign=top;align=left;spacingLeft=10;spacingTop=2;fontSize=12;fontStyle=1;fontColor=#475569;html=1;`;
    m.rooms.forEach(r => vtx(r.id, hesc(r.name), r.x, r.y, r.w, r.h, roomStyle(r.fill)));

    const blockVal = (title, lines) =>
      `<b>${hesc(title)}</b><hr size="1"/>` + lines.map(l => `<div style="text-align:left;">• ${hesc(l)}</div>`).join('');
    const blockStyle = f => `rounded=1;whiteSpace=wrap;html=1;fillColor=${f};strokeColor=#334155;verticalAlign=top;align=center;fontSize=10;fontColor=#111827;spacing=4;`;
    m.blocks.forEach(b => vtx('b_' + b.id, blockVal(b.name, b.lines), b.x, b.y, b.w, b.h, blockStyle(b.fill)));

    m.conns.forEach(c => {
      const S = c.src, T = c.tgt;
      const exitX = ((c.sx - S.x) / S.w).toFixed(3), exitY = c.sEdge === 'top' ? 0 : 1;
      const entryX = ((c.tx - T.x) / T.w).toFixed(3), entryY = c.tEdge === 'top' ? 0 : 1;
      const inner = c.pts.slice(1, -1).map(p => `<mxPoint x="${R(p[0])}" y="${R(p[1])}"/>`).join('');
      edge('', `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeWidth=2;strokeColor=${c.color};exitX=${exitX};exitY=${exitY};exitDx=0;exitDy=0;entryX=${entryX};entryY=${entryY};entryDx=0;entryDy=0;`,
        ` source="b_${xesc(S.id)}" target="b_${xesc(T.id)}"`, `<Array as="points">${inner}</Array>`);
    });

    const optic = COLORS['Оптика'];
    m.ext.forEach(e => {
      const exitY = ((e.y - e.b.y) / e.b.h).toFixed(3);
      edge(e.label ? 'Внешняя связь' : '', `endArrow=block;endFill=1;dashed=1;dashPattern=7 4;html=1;strokeWidth=2;strokeColor=${optic};fontColor=${optic};fontSize=9;verticalAlign=bottom;exitX=1;exitY=${exitY};exitDx=0;exitDy=0;`,
        ` source="b_${xesc(e.b.id)}"`, `<mxPoint x="${R(e.x2)}" y="${R(e.y)}" as="targetPoint"/>`);
    });

    m.signals.forEach(s => {
      edge(s.label, `endArrow=block;endFill=1;html=1;strokeWidth=2;strokeColor=${s.color};fontColor=${s.color};fontSize=9;fontStyle=1;verticalAlign=bottom;exitX=${s.exitX.toFixed(3)};exitY=1;exitDx=0;exitDy=0;`,
        ` source="b_${xesc(s.block.id)}"`, `<mxPoint x="${R(s.x)}" y="${R(s.y2)}" as="targetPoint"/>`);
    });

    const lg = m.legend;
    vtx('leg', '<b>Условные обозначения:</b>', lg.x, lg.y, lg.w, lg.h,
      'rounded=1;html=1;fillColor=#ffffff;strokeColor=#94a3b8;verticalAlign=top;align=left;spacingLeft=10;spacingTop=2;fontSize=11;fontColor=#374151;');
    lg.items.forEach((it, i) => {
      vtx('leg_' + i, `<font color="${it.color}">▬▬▬</font> ${hesc(it.name)}`, it.x, it.y - 10, lg.itemW - 12, 20,
        'text;html=1;align=left;verticalAlign=middle;fontSize=10;fontColor=#374151;');
    });

    if (m.notes) {
      const val = '<b>Примечания:</b>' + m.notes.lines.map(t => `<div>${hesc(t)}</div>`).join('');
      vtx('notes', val, m.notes.x, m.notes.y, lg.w, 20 + m.notes.lines.length * 16,
        'text;html=1;align=left;verticalAlign=top;fontSize=10;fontColor=#4b5563;');
    }

    return `<mxfile host="app.diagrams.net" agent="scheme-generator" version="1.1"><diagram id="d1" name="Схема"><mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${R(m.width)}" pageHeight="${R(m.height)}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
  }

  return {
    COLORS, NAME_BY_COLOR, OP_TYPES, OP_LINKS, AUTO_UPLINKS, AUTO_UPLINK_OPTIONS, UPLINK_NONE, KVM_PANEL_ID,
    PROJECT_DEFAULTS, ITEM_DEFAULTS, FORMAT, FORMAT_VERSION, STORAGE_KEY, STORAGE_BACKUP_KEY,
    PER_ROW_MAX, COUNT_MAX, RASTER_SCALE, RASTER_MAX_PIXELS,
    uid, fit, pad2, clampPerRow, toCount, rasterScale, signalLabel, signalsOf, fileNameOf, routeBand,
    createDefaultState, newOpItem, newRack, newNetCab, newAutoCab,
    serializeState, normalizeState, parseState, makeResolvers,
    buildScheme, toSvg, toDrawio,
  };
});
