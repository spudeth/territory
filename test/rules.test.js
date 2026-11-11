// The pure game rules, in memory: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');
const catalog = require('../catalog');
const upgrades = require('../upgrades');

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
  assert.equal(rules.firstClaimTenths(rules.NO_UPGRADES), 10, '1 square, in tenths');
  assert.equal(rules.CRACK_DECAY_SECONDS, 60);
  assert.equal(rules.CRACK_DECAY_HITS, 1);
});

// Clicks needed with these dials: what a player actually feels.
const clicks = (attacker, owner) => {
  let n = 0, c = 0;
  while (!rules.isTaken(n, rules.hitsNeeded(owner))) { n += rules.hitPower(attacker); c++; }
  return c;
};

test('upgrade values: Click Power multiplies each click, Defense multiplies hits needed, Earnings keeps tenths', () => {
  const none = rules.NO_UPGRADES;
  assert.equal(clicks(none, none), 10, 'tier 1 everywhere: no change');
  assert.equal(rules.firstClaimTenths(none), 10);
  assert.equal(clicks(null, null), 10, 'a visitor');
  assert.equal(clicks({ clickPower: 1.2 }, { defense: 2 }), 17, "Bob's example: Click Power 1.2 against Defense x2 is 20 hits, 17 clicks");
  assert.equal(rules.hitsNeeded({ defense: 2 }), 20);
  assert.equal(clicks({ clickPower: 1.2 }, null), 9, '10 / 1.2 = 8.33, so 9 clicks; Defense never applies to empty blocks');
  assert.equal(clicks({ clickPower: 0.1 }, null), 100, 'fractions add up exactly: 100 x 0.1 is 10');
  assert.equal(rules.firstClaimTenths({ earnings: 1.5 }), 15, 'tenths are kept');
  assert.equal(rules.firstClaimTenths({ earnings: 1.19 }), 11, '11.9 tenths rounds down to 11');
  assert.equal(rules.firstClaimTenths(none, 'sand'), 5, 'sand: half the hits, half the pay');
  assert.equal(rules.firstClaimTenths(none, 'gold'), 10 + rules.GOLD_BONUS_SQUARES * 10, 'gold: plus the bonus');
  assert.equal(rules.firstClaimTenths(none, 'grass', 3), 40, 'a level-3 block: 4x the hits, 4x the pay');
  assert.equal(rules.growthBlocks({ growth: 3 }), 3);
  // On a block: each upgrade is capped at the end of the block's level's tier (loop 18).
  const S = upgrades.STEPS('clickPower'), eff = upgrades.effectiveValues({ clickPower: 5 * S, earnings: 2 * S }, 2);
  assert.ok(Math.abs(eff.clickPower - upgrades.hi('clickPower', 2)) < 1e-9, 'the end of tier 5 works at the end of tier 2 on a level-2 block');
  assert.equal(eff.defense, 1, 'no steps bought: the start');
  assert.ok(Math.abs(upgrades.effectiveValues({ clickPower: 5 * S }, 9).clickPower - upgrades.hi('clickPower', 5)) < 1e-9, 'in full on a level-9 block');
  // Growth: the fractional part is the chance of one more block.
  assert.equal(rules.growthBlocks({ growth: 1.4 }, 0.39), 2, '1.4: a second block 40% of the time');
  assert.equal(rules.growthBlocks({ growth: 1.4 }, 0.41), 1);
  assert.equal(rules.growthBlocks({ growth: 3 }, 0.99), 3);
});

test('players see whole squares, rounded down, from a balance in tenths', () => {
  assert.equal(rules.shownSquares(0), 0);
  assert.equal(rules.shownSquares(29), 2);
  assert.equal(rules.shownSquares('30'), 3, 'as the database returns it (bigint as a string)');
  assert.equal(rules.shownSquares(33), 3);
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
