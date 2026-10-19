// Опорные маршруты рассчитаны приложенным пользователем «index backup.html».
// Проверяем геометрию, а не реализацию: обход рядов и KVM остаются как в backup.
// Два отличия от backup — по просьбе пользователя: высота блоков зависит от числа
// строк описания (поэтому сдвинулись все Y), а связь RS-485 между шкафами выходит
// из нижней грани справа после стрелок сигналов.
const assert = require('node:assert/strict');
const test = require('node:test');
const { core, sampleState } = require('./helpers');

const cases = [
  { perRow: 4, width: 1054, routes: [
    ['op1', 'net1', [[187, 168], [187, 252], [527, 252], [527, 314]]],
    ['rack1', 'kvmpanel', [[307, 314], [307, 260], [904.5, 260], [904.5, 184]]],
    // Выход — в поле справа от стрелок a1, вход — в поле слева от стрелок a2.
    ['a1', 'a2', [[381.17, 600], [381.17, 676], [460.75, 676], [460.75, 600]]],
  ] },
  { perRow: 2, width: 880, routes: [
    ['op1', 'net1', [[320, 168], [320, 188], [433, 188], [433, 330], [550, 330], [550, 392]]],
    ['rack1', 'kvmpanel', [[330, 392], [330, 338], [581.6666666666666, 338], [581.6666666666666, 270]]],
    ['a1', 'a2', [[404.17, 748], [404.17, 824], [483.75, 824], [483.75, 748]]],
  ] },
];

// Доли масштаба (например, 190/7) дают длинные дроби: сверяем с точностью до сотых.
const round = pts => pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);

for (const { perRow, width, routes } of cases) {
  test(`трассировка как в backup: ${perRow} блока в ряду`, () => {
    const state = sampleState();
    state.project.blocksPerRow = perRow;
    const model = core.buildScheme(state);
    assert.equal(model.width, width);
    for (const [src, tgt, pts] of routes) {
      const conn = model.conns.find(c => c.src.id === src && c.tgt.id === tgt);
      assert.ok(conn, `${src} → ${tgt}`);
      assert.deepEqual(round(conn.pts), round(pts));
    }
  });
}
