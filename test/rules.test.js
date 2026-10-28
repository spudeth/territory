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

test('cracks fade one hit per period, never below zero, keeping the leftover time and fractions', () => {
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 1500, 1000), { n: 2, at: 1000, lost: 0 });
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 2100, 1000), { n: 1, at: 2000, lost: 1 });
  assert.deepEqual(rules.decayCrack({ n: 2, at: 1000 }, 9000, 1000), { n: 0, at: 9000, lost: 8 });
  assert.deepEqual(rules.decayCrack({ n: 1, at: 5000 }, 4000, 1000), { n: 1, at: 5000, lost: 0 }, 'clock went back');
  assert.equal(rules.decayCrack({ n: 3.5, at: 0 }, 2000, 1000).n, 1.5);
  assert.equal(rules.decayCrack({ n: 0.4, at: 0 }, 1000, 1000).n, 0);
});

test('wipe rule: squares only beyond the most blocks owned at any wipe', () => {
  assert.equal(rules.earnsSquares(1, 0), true, 'never wiped');
  assert.equal(rules.earnsSquares(3, 3), false);
  assert.equal(rules.earnsSquares(4, 3), true);
  assert.equal(rules.wipeFloorAfterWipe(3, 2), 3, 'a smaller wipe never lowers the floor');
  assert.equal(rules.wipeFloorAfterWipe(3, 5), 5);
});

test('defaults: 10 hits for any block, 1 hit per click, 1 square, fade of 1 hit per 60 seconds', () => {
  assert.equal(rules.HITS_PER_BLOCK, 10);
  assert.equal(rules.hitsNeeded(null), 10);
  assert.equal(rules.hitsNeeded(rules.NO_UPGRADES), 10);
  assert.equal(rules.hitPower(rules.NO_UPGRADES), 1);
  assert.equal(rules.squaresForFirstClaim(rules.NO_UPGRADES), 1);
  assert.equal(rules.CRACK_DECAY_SECONDS, 60);
  assert.equal(rules.CRACK_DECAY_HITS, 1);
});

// Clicks needed with these dials: what a player actually feels.
const clicks = (attacker, owner) => {
  let n = 0, c = 0;
  while (!rules.isTaken(n, rules.hitsNeeded(owner))) { n += rules.hitPower(attacker); c++; }
  return c;
};

test('upgrades: Click Power multiplies each click, Defense multiplies hits needed, Earnings keeps fractions', t => {
  const saved = ['CLICK_POWER_MULTIPLIER', 'DEFENSE_MULTIPLIER', 'EARNINGS_MULTIPLIER', 'HITS_PER_BLOCK', 'SQUARES_PER_FIRST_CLAIM']
    .map(k => [k, rules[k]]);
  t.after(() => { for (const [k, v] of saved) rules[k] = v; });
  const none = rules.NO_UPGRADES, lv = (clickPower, defense, earnings) => ({ clickPower, defense, earnings });

  // With the synced tables, level 0 is no upgrade.
  assert.equal(clicks(none, none), 10);
  assert.equal(rules.squaresForFirstClaim(none), 1);
  assert.equal(clicks(null, null), 10, 'a visitor with no levels');

  // Tables that do nothing: levels make no difference.
  rules.CLICK_POWER_MULTIPLIER = [1];
  rules.DEFENSE_MULTIPLIER = [1];
  rules.EARNINGS_MULTIPLIER = [1];
  assert.equal(clicks(lv(5, 5, 5), lv(5, 5, 5)), 10);
  assert.equal(rules.squaresForFirstClaim(lv(5, 5, 5)), 1);

  rules.CLICK_POWER_MULTIPLIER = [1, 1.2, 2];
  rules.DEFENSE_MULTIPLIER = [1, 1.5, 2];
  rules.EARNINGS_MULTIPLIER = [1, 1.5, 1.1];
  assert.equal(clicks(lv(1, 0, 0), lv(0, 2, 0)), 17, "Bob's example: Click Power 1.2 against Defense x2 is 20 hits, 17 clicks");
  assert.equal(rules.hitsNeeded(lv(0, 2, 0)), 20);
  assert.equal(clicks(lv(1, 0, 0), null), 9, '10 / 1.2 = 8.33, so 9 clicks; Defense never applies to empty blocks');
  assert.equal(clicks(lv(2, 0, 0), lv(0, 1, 0)), 8, '15 hits at 2 per click');
  assert.equal(clicks(lv(9, 0, 0), null), 5, 'past the table uses the last entry');
  assert.equal(clicks(none, lv(0, -3, 0)), 10, 'a bad level counts as 0');
  rules.CLICK_POWER_MULTIPLIER = [0.1];
  assert.equal(clicks(none, null), 100, 'fractions add up exactly: 100 x 0.1 is 10');

  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 1)), 1.5, 'fractions are kept');
  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 2)), 1.1);
  rules.SQUARES_PER_FIRST_CLAIM = 3;
  assert.equal(rules.squaresForFirstClaim(lv(0, 0, 2)), 3.3, 'rounded to 6 places, not 3.3000000000000003');
});

test('players see whole squares, rounded down', () => {
  assert.equal(rules.shownSquares(0), 0);
  assert.equal(rules.shownSquares(2.999999), 2);
  assert.equal(rules.shownSquares('3.000000'), 3, 'as the database returns it');
  assert.equal(rules.shownSquares(3.3), 3);
});

test('tap-rate limit: a burst up to the rate, then the rate per second', () => {
  let b = null, allowed = 0;
  for (let i = 0; i < 20; i++) { const r = rules.tapAllowed(b, 1000, 12); b = r.bucket; allowed += r.allowed; }
  assert.equal(allowed, 12, 'a burst of 12, the rest ignored');
  assert.equal(rules.tapAllowed(b, 1000 + 1000 / 12 - 1, 12).allowed, false, 'not refilled yet');
  assert.equal(rules.tapAllowed(b, 1000 + 1000 / 12 + 1, 12).allowed, true, 'one tap per 1/12 second');
  let steady = 0;
  for (let t = 0; t < 10000; t += 20) { const r = rules.tapAllowed(b, 2000 + t, 12); b = r.bucket; steady += r.allowed; }
  assert.ok(steady >= 118 && steady <= 132, `about 12 a second over 10 s: ${steady}`);
});
