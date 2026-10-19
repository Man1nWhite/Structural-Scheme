// Опорные маршруты рассчитаны приложенным пользователем «index backup.html».
// Проверяем геометрию, а не реализацию: обход рядов и KVM остаются как в backup.
// Связь RS-485 между шкафами по просьбе пользователя выходит из нижней грани
// справа после стрелок сигналов, поэтому её точки отличаются от backup.
const assert = require('node:assert/strict');
const test = require('node:test');
const { core, sampleState } = require('./helpers');

const cases = [
  { perRow: 4, width: 1054, routes: [
    ['op1', 'net1', [[187, 200], [187, 268], [527, 268], [527, 330]]],
    ['rack1', 'kvmpanel', [[307, 330], [307, 276], [904.5, 276], [904.5, 200]]],
    // Выход — в поле справа от стрелок a1, вход — в поле слева от стрелок a2.
    ['a1', 'a2', [[381.17, 660], [381.17, 736], [460.75, 736], [460.75, 660]]],
  ] },
  { perRow: 2, width: 880, routes: [
    ['op1', 'net1', [[320, 200], [320, 220], [433, 220], [433, 378], [550, 378], [550, 440]]],
    ['rack1', 'kvmpanel', [[330, 440], [330, 386], [581.6666666666666, 386], [581.6666666666666, 318]]],
    ['a1', 'a2', [[404.17, 914], [404.17, 990], [483.75, 990], [483.75, 914]]],
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
