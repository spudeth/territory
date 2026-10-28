// Name tags (labels.js), in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameSpots, withoutOverlaps } = require('../public/labels');

const fill = (cells, owner, blocks) => { for (const [x, y] of blocks) cells.set(x + ',' + y, owner); return cells; };
const rect = (x0, y0, w, h) => { const out = []; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]); return out; };
const view = { x: 0, y: 0, width: 20, height: 20 };

test('every territory in view gets a spot, even a single block, biggest first', () => {
  const cells = fill(fill(new Map(), 'A', rect(0, 0, 5, 5)), 'B', [[10, 10]]);
  const spots = nameSpots(cells, view);
  assert.deepEqual(spots.map(s => [s.owner, s.blocks]), [['A', 25], ['B', 1]]);
  assert.deepEqual([spots[0].cx, spots[0].cy, spots[0].depth], [2.5, 2.5, 3], 'the middle of a square');
  assert.deepEqual([spots[1].cx, spots[1].cy], [10.5, 10.5]);
});

test("the spot is always on the owner's own land, deep inside, even for an L shape whose middle is outside it", () => {
  // An L: a long bar along the top and down the left side. Its average position is on empty grass.
  const L = [...rect(0, 0, 12, 3), ...rect(0, 3, 3, 9)];
  const cells = fill(new Map(), 'A', L);
  for (const [x, y] of rect(3, 3, 9, 9)) cells.set(x + ',' + y, null);   // empty grass inside the L
  const [s] = nameSpots(cells, view);
  assert.equal(cells.get(Math.floor(s.cx) + ',' + Math.floor(s.cy)), 'A');
  assert.equal(s.depth, 2, 'the middle row of the 3-wide bar');
});

test('only what is in view counts: a territory cut by the edge of the screen is labeled on its visible part', () => {
  const cells = fill(new Map(), 'A', rect(-10, 0, 14, 4));   // mostly off screen to the left
  const [s] = nameSpots(cells, view);
  assert.ok(s.cx >= 0 && s.cx < 4, 'inside the visible part');
  assert.equal(s.blocks, 16);
  assert.deepEqual(nameSpots(cells, { x: 50, y: 50, width: 5, height: 5 }), [], 'nothing in view');
});

test('tags that would overlap: the earlier one wins, the later one waits', () => {
  const tag = (id, x, y) => ({ id, box: { x, y, w: 50, h: 20 } });
  assert.deepEqual(withoutOverlaps([tag('mine', 0, 0), tag('big', 30, 10), tag('far', 200, 0)]).map(t => t.id), ['mine', 'far']);
  assert.deepEqual(withoutOverlaps([tag('a', 0, 0), tag('b', 0, 30)], 4).map(t => t.id), ['a', 'b'], '10 px apart is enough');
});
