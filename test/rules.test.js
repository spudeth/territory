// The pure game rules, in memory: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');

// A map from rows of text: '.' empty, a letter is that player's block, ' ' is outside the map.
function grid(...rows) {
  const cells = new Map(), counts = new Map();
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ' ') return;
    const owner = ch === '.' ? null : ch;
    cells.set(rules.key(x, y), owner);
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
  }));
  return { cells, counts };
}

test('hit rules: first block empty, then next to your territory; retakes allowed; never your own', () => {
  const m = grid(
    'A..',
    '.B.',
    '.. ');
  assert.equal(rules.hitError(m, null, 2, 0), null, 'a visitor may take an empty block');
  assert.equal(rules.hitError(m, null, 1, 1), 'Your first block must be unclaimed');
  assert.equal(rules.hitError(m, 'C', 2, 2), 'Invalid block', 'outside the map');
  assert.equal(rules.hitError(m, 'C', 9, 9), 'Invalid block');
  assert.equal(rules.hitError(m, 'C', 2, 1), null, 'a player with no blocks starts anywhere empty');
  assert.equal(rules.hitError(m, 'A', 0, 0), 'You already own this block');
  assert.equal(rules.hitError(m, 'A', 1, 0), null, 'next to A');
  assert.equal(rules.hitError(m, 'A', 1, 1), 'You can only take blocks next to your territory', 'diagonal does not count');
  assert.equal(rules.hitError(m, 'B', 1, 0), null, 'B may take an empty neighbour');
  const m2 = grid('AB');
  assert.equal(rules.hitError(m2, 'A', 1, 0), null, 'retaking a neighbour from another player');
});

test('cracks fade one level per period, never below zero, keeping the leftover time', () => {
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 1500, 1000), { n: 2, at: 1000, lost: 0 });
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 2100, 1000), { n: 1, at: 2000, lost: 1 });
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 9000, 1000), { n: 0, at: 9000, lost: 8 });
  assert.deepEqual(rules.decayCrack({ n: 1, at: 5000 }, 4000, 1000), { n: 1, at: 5000, lost: 0 }, 'clock went back');
});

test('wipe rule: squares only beyond the most blocks owned at any wipe', () => {
  assert.equal(rules.earnsSquares(1, 0), true, 'never wiped');
  assert.equal(rules.earnsSquares(3, 3), false);
  assert.equal(rules.earnsSquares(4, 3), true);
  assert.equal(rules.wipeFloorAfterWipe(3, 2), 3, 'a smaller wipe never lowers the floor');
  assert.equal(rules.wipeFloorAfterWipe(3, 5), 5);
});

test('defaults: 3 hits, 1 square, 60-second fade', () => {
  assert.equal(rules.hitsToTake('A', null), 3);
  assert.equal(rules.hitsToTake('A', 'B'), 3);
  assert.equal(rules.squaresForFirstClaim('A'), 1);
  assert.equal(rules.CRACK_DECAY_SECONDS, 60);
});
