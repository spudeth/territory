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
  assert.equal(rules.hitsToTake(rules.NO_UPGRADES, null), 3);
  assert.equal(rules.hitsToTake(rules.NO_UPGRADES, rules.NO_UPGRADES), 3);
  assert.equal(rules.squaresForFirstClaim(rules.NO_UPGRADES), 1);
  assert.equal(rules.CRACK_DECAY_SECONDS, 60);
});

test('upgrades: Click Power takes hits off, Defense multiplies (rounded up), Earnings multiplies (rounded down)', t => {
  const saved = ['CLICK_POWER_HITS_REMOVED', 'DEFENSE_MULTIPLIER', 'EARNINGS_MULTIPLIER', 'HITS_TO_CLAIM', 'SQUARES_PER_FIRST_CLAIM']
    .map(k => [k, rules[k]]);
  t.after(() => { for (const [k, v] of saved) rules[k] = v; });
  const none = rules.NO_UPGRADES, lv = (clickPower, defense, earnings) => ({ clickPower, defense, earnings });

  // Defaults: no effect at any level.
  assert.equal(rules.hitsToTake(lv(5, 5, 5), lv(5, 5, 5)), 3);
  assert.equal(rules.squaresForFirstClaim(lv(5, 5, 5)), 1);
  assert.equal(rules.hitsToTake(null, null), 3, 'a visitor with no levels');

  rules.CLICK_POWER_HITS_REMOVED = [0, 1, 2];
  rules.DEFENSE_MULTIPLIER = [1, 1.5, 2];
  rules.EARNINGS_MULTIPLIER = [1, 1.5, 3];
  assert.equal(rules.hitsToTake(lv(1, 0, 0), null), 2, 'Click Power 1 on an empty block');
  assert.equal(rules.hitsToTake(lv(9, 0, 0), null), 1, 'past the table uses the last entry, never below MIN_HITS');
  assert.equal(rules.hitsToTake(none, lv(0, 1, 0)), 5, '3 x 1.5 = 4.5, rounded up');
  assert.equal(rules.hitsToTake(lv(1, 0, 0), lv(0, 2, 0)), 4, '(3 - 1) x 2');
  assert.equal(rules.hitsToTake(lv(2, 0, 0), lv(0, 1, 0)), 2, '(3 - 2) x 1.5 = 1.5, rounded up');
  assert.equal(rules.hitsToTake(lv(0, 0, 0), lv(0, -3, 0)), 3, 'a bad level counts as 0');
  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 1)), 1, '1 x 1.5 = 1.5, rounded down');
  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 2)), 3);
  rules.SQUARES_PER_FIRST_CLAIM = 2;
  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 1)), 3);
});
