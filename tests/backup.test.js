// Опорные маршруты рассчитаны приложенным пользователем «index backup.html».
// Проверяем геометрию, а не реализацию: точки остаются как в backup,
// включая обход рядов, KVM и U-образную связь RS-485.
const assert = require('node:assert/strict');
const test = require('node:test');
const { core, sampleState } = require('./helpers');

const cases = [
  { perRow: 4, width: 1054, routes: [
    ['op1', 'net1', [[187, 200], [187, 268], [527, 268], [527, 330]]],
    ['rack1', 'kvmpanel', [[307, 330], [307, 276], [904.5, 276], [904.5, 200]]],
    ['a1', 'a2', [[307, 660], [307, 736], [527, 736], [527, 660]]],
  ] },
  { perRow: 2, width: 880, routes: [
    ['op1', 'net1', [[320, 200], [320, 220], [433, 220], [433, 378], [550, 378], [550, 440]]],
    ['rack1', 'kvmpanel', [[330, 440], [330, 386], [581.6666666666666, 386], [581.6666666666666, 318]]],
    ['a1', 'a2', [[330, 914], [330, 998], [550, 998], [550, 914]]],
  ] },
];

for (const { perRow, width, routes } of cases) {
  test(`трассировка как в backup: ${perRow} блока в ряду`, () => {
    const state = sampleState();
    state.project.blocksPerRow = perRow;
    const model = core.buildScheme(state);
    assert.equal(model.width, width);
    for (const [src, tgt, pts] of routes) {
      const conn = model.conns.find(c => c.src.id === src && c.tgt.id === tgt);
      assert.ok(conn, `${src} → ${tgt}`);
      assert.deepEqual(conn.pts, pts);
    }
  });
}
