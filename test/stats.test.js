// Player stats, in memory: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../stats');

// Brute force, for comparison: every square and line on the map.
function slowBest(cells, pid) {
  const owns = (x, y) => cells.get(x + ',' + y) === pid;
  let sq = 0, line = 0;
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    if (!owns(x, y)) continue;
    let s = 1;
    for (;;) {
      let ok = true;
      for (let j = 0; j <= s && ok; j++) for (let i = 0; i <= s && ok; i++) ok = owns(x + i, y + j);
      if (!ok) break;
      s++;
    }
    sq = Math.max(sq, s);
    let h = 0; while (owns(x + h, y)) h++;
    let v = 0; while (owns(x, y + v)) v++;
    line = Math.max(line, h, v);
  }
  return { bestSquare: sq, bestLine: line };
}

// A seeded random map: a few players over a 12x12 grid.
function randomMap(seed) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const cells = new Map();
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const r = rand();
    cells.set(x + ',' + y, r < 0.55 ? 'A' : r < 0.75 ? 'B' : r < 0.85 ? 'C' : null);
  }
  return cells;
}

test('lines and squares through a block', () => {
  const owned = new Set(['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2', '5,5']);
  const owns = (x, y) => owned.has(x + ',' + y);
  assert.equal(stats.lineThrough(owns, 1, 0), 4);
  assert.equal(stats.lineThrough(owns, 0, 1), 3);
  assert.equal(stats.lineThrough(owns, 5, 5), 1);
  assert.equal(stats.squareThrough(owns, 1, 1), 3);
  assert.equal(stats.squareThrough(owns, 2, 2), 3);
  assert.equal(stats.squareThrough(owns, 3, 0), 1, 'the 3x3 does not include this block');
  assert.equal(stats.squareThrough(owns, 3, 0, 3), 3, 'never below what is already known');
});

test('whole-map bests match brute force on random maps', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const cells = randomMap(seed), best = stats.bestOnMap(cells);
    for (const pid of ['A', 'B', 'C']) {
      assert.deepEqual(best.get(pid) ?? { bestSquare: 0, bestLine: 0 }, slowBest(cells, pid), `seed ${seed} ${pid}`);
    }
  }
});

test('claiming block by block keeps the records equal to brute force', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const target = randomMap(seed), cells = new Map([...target.keys()].map(k => [k, null]));
    let st = stats.empty(), owned = 0;
    for (const [k, pid] of target) {
      if (pid !== 'A') continue;
      cells.set(k, 'A');
      owned++;
      const [x, y] = k.split(',').map(Number);
      st = stats.afterClaim(st, { owns: (a, b) => cells.get(a + ',' + b) === 'A', x, y, owned, from: null }).stats;
      const slow = slowBest(cells, 'A');
      assert.equal(st.bestSquare, slow.bestSquare, `seed ${seed} square`);
      assert.equal(st.bestLine, slow.bestLine, `seed ${seed} line`);
    }
    assert.equal(st.firstClaims, owned);
    assert.equal(st.ownedMax, owned);
  }
});

test('afterClaim counts first claims and retakes and lists what changed', () => {
  const cells = new Map([['0,0', 'A'], ['1,0', 'A']]);
  const owns = (x, y) => cells.get(x + ',' + y) === 'A';
  const prev = { ...stats.empty(), ownedMax: 5, firstClaims: 1, bestLine: 1, bestSquare: 1 };
  const r = stats.afterClaim(prev, { owns, x: 1, y: 0, owned: 2, from: 'B' });
  assert.deepEqual(r.stats, { ...prev, retakes: 1, bestLine: 2 });
  assert.deepEqual(r.changed, ['retakes', 'bestLine']);
});

test('a 300x300 square is found quickly', () => {
  const n = 300, owns = (x, y) => x >= 0 && y >= 0 && x < n && y < n;
  const t0 = Date.now();
  assert.equal(stats.squareThrough(owns, 150, 150, n - 1), n);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0}ms`);
});
