// Name labels, in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { namesToShow } = require('../public/labels');
const rules = require('../rules');

const square = (owner, x0, y0, n, cells = new Map()) => {
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) cells.set(x + ',' + y, owner);
  return cells;
};

test('a territory gets its name once it covers a quarter of the view', () => {
  assert.equal(rules.NAME_LABEL_SHARE, 0.25);
  const cells = square('A', 0, 0, 5);   // 25 blocks
  assert.deepEqual(namesToShow(cells, { x: 0, y: 0, width: 10, height: 10 }), [{ owner: 'A', share: 0.25, cx: 2.5, cy: 2.5 }]);
  assert.deepEqual(namesToShow(cells, { x: 0, y: 0, width: 10, height: 10.1 }), [], 'just under a quarter');
  assert.deepEqual(namesToShow(cells, { x: -50, y: -50, width: 100, height: 100 }), [], 'zoomed out: too small');
});

test('blocks cut by the edge of the view count by the part showing', () => {
  const cells = square('A', 0, 0, 2);
  // View from 0.5 to 2.5 across, 0 to 2 down: A shows 1.5 x 2 = 3 of 4 units.
  const [a] = namesToShow(cells, { x: 0.5, y: 0, width: 2, height: 2 });
  assert.equal(a.share, 0.75);
  assert.equal(a.cx, 1.25);
  assert.equal(a.cy, 1);
});

test('several owners, biggest first; empty blocks and nothing at all never count', () => {
  const cells = square('A', 0, 0, 6, square('B', 6, 0, 4));
  cells.set('9,9', null);
  const shown = namesToShow(cells, { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(shown.map(s => [s.owner, s.share]), [['A', 0.36]]);
  assert.deepEqual(namesToShow(cells, { x: 0, y: 0, width: 10, height: 10 }, 0.1).map(s => s.owner), ['A', 'B']);
  assert.deepEqual(namesToShow(new Map(), { x: 0, y: 0, width: 0, height: 5 }), []);
});
