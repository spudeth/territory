// The economy's formulas (catalog.js): levels, hardness, pay, tiers and every pricing rule. In memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog');
const upgrades = require('../upgrades');
const { E } = catalog;

test('levels: L = 1 + floor(log2(mined / E + 1)), up to maxLevel; level L starts at (2^(L-1) - 1) x E', () => {
  const base = 1000;
  assert.equal(catalog.level(0, base), 1);
  assert.equal(catalog.level(999, base), 1);
  assert.equal(catalog.level(1000, base), 2, 'level 2 at E');
  assert.equal(catalog.level(2999, base), 2);
  assert.equal(catalog.level(3000, base), 3, 'level 3 at 3E');
  assert.equal(catalog.level(7000, base), 4, 'level 4 at 7E');
  for (let L = 1; L <= E.maxLevel; L++) {
    assert.equal(catalog.levelStart(L, base), (2 ** (L - 1) - 1) * base);
    assert.equal(catalog.level(catalog.levelStart(L, base), base), L);
    if (L > 1) assert.equal(catalog.level(catalog.levelStart(L, base) - 1, base), L - 1);
  }
  assert.equal(catalog.level(1e15, base), E.maxLevel, 'never above maxLevel');
  assert.equal(catalog.level(511 * 431649, 431649), 10, 'the doc: level 10 starts at 511E');
  assert.deepEqual(catalog.levelProgress(1500, base), { level: 2, from: 1000, to: 3000, mined: 1500 });
});

test('money is whole tenths, always rounded down; players see whole squares rounded down', () => {
  assert.equal(catalog.toTenths(1), 10);
  assert.equal(catalog.toTenths(0.55), 5);
  assert.equal(catalog.toTenths(0.3333 * 1200), 3999, '399.96 squares is 3,999 tenths');
  assert.equal(catalog.toTenths(0.1 + 0.2), 3, 'floating-point noise does not lose a tenth');
  assert.equal(catalog.wholeSquares(19), 1);
  assert.equal(catalog.wholeSquares(20), 2);
  assert.equal(catalog.fromTenths(125), 12.5);
});

test('W(L) = (3600 / baseBlockSeconds) x 2^(L-1): 1,200 at level 1, 614,400 at level 10', () => {
  assert.equal(catalog.W(1), 1200);
  assert.equal(catalog.W(2), 2400);
  assert.equal(catalog.W(10), 614400);
});

test('hardness and pay at each level and terrain: pay tracks hits (1 square per hitsPerSquare hits), plus gold', () => {
  const terrains = { sand: 0.5, grass: 1, forest: 1.5, stone: 3, gold: 1 };
  for (let L = 1; L <= 10; L++) for (const [t, f] of Object.entries(terrains)) {
    const H = catalog.hardness(10, L, f);
    assert.equal(H, 10 * 2 ** (L - 1) * f);
    const gold = t === 'gold' ? 5 : 0;
    assert.equal(catalog.payTenths(H, 1, gold), Math.floor(H * 10 / E.hitsPerSquare) + gold * 10, `L${L} ${t}`);
  }
  assert.equal(catalog.payTenths(10, 1), 10, 'a level-1 grass block pays 1 square');
  assert.equal(catalog.payTenths(5, 1), 5, 'sand pays half a square');
  assert.equal(catalog.payTenths(5120, 1), 5120, 'the doc: a level-10 grass block pays 512 squares');
  assert.equal(catalog.payTenths(10, 1.292), 12, 'Earnings applies, rounded down');
});

test('upgrades (loop 18): tier ranges, log-curve values and prices, the Charts tab numbers, and the cap by block level', () => {
  const near = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
  const sq = t => catalog.fromTenths(t), S = upgrades.STEPS('clickPower');
  assert.equal(S, 90);
  // Ranges: lo_1 = start, lo_N = max1 x m^(N-2), hi_N = max1 x m^(N-1).
  near(upgrades.lo('clickPower', 1), 1, 'lo_1 = start');
  near(upgrades.hi('clickPower', 1), 10, 'hi_1 = max1');
  near(upgrades.lo('clickPower', 2), 10, 'lo_2 = max1');
  near(upgrades.hi('clickPower', 2), 20, 'hi_2');
  near(upgrades.hi('clickPower', 10), 10 * 2 ** 9, 'hi_10');
  near(upgrades.hi('factorySpeed', 1), 0.1, 'factory speed tier 1 max');
  // The Charts tab (clickPower): prices and values.
  assert.equal(sq(upgrades.stepCostTenths('clickPower', 1)), 9.7);
  assert.equal(sq(upgrades.stepCostTenths('clickPower', 90)), 234.5);
  assert.equal(sq(upgrades.tierCostTenths('clickPower', 1)), 14400);
  assert.equal(sq(upgrades.stepCostTenths('clickPower', 91)), 19.4, 'tier 2 step 1');
  near(upgrades.stepValue('clickPower', 1), 1.373, 'after step 1', 1e-3);
  near(upgrades.stepValue('clickPower', 10), 3.709, 'after step 10', 1e-3);
  near(upgrades.stepValue('clickPower', 90), 10, 'after step 90');
  near(upgrades.stepValue('clickPower', 180), 20, 'after tier 2');
  near(upgrades.stepValue('clickPower', 0), 1, 'no steps: the start');
  for (let s = 1; s <= upgrades.topStep('clickPower'); s++) assert.ok(upgrades.stepValue('clickPower', s) > upgrades.stepValue('clickPower', s - 1), `step ${s} goes up`);
  // Each tier adds up exactly to tierWh x W(N); steps rise within a tier.
  for (const N of [1, 2, 5, 10]) {
    let t = 0;
    for (let s = (N - 1) * S + 1; s <= N * S; s++) t += upgrades.stepCostTenths('clickPower', s);
    assert.equal(t, upgrades.tierCostTenths('clickPower', N), `tier ${N} adds up`);
    assert.equal(sq(t), 12 * 1200 * 2 ** (N - 1), `tier ${N} = T x W(N)`);
  }
  for (let s = 2; s <= S; s++) assert.ok(upgrades.stepCostTenths('clickPower', s) >= upgrades.stepCostTenths('clickPower', s - 1), `step ${s} costs no less`);
  assert.equal(upgrades.tierOfStep('clickPower', 0), 1);
  assert.equal(upgrades.tierOfStep('clickPower', S), 1);
  assert.equal(upgrades.tierOfStep('clickPower', S + 1), 2);
  // Unlocks, and the cap: on a level-L block, at most hi_L.
  assert.equal(upgrades.tierUnlocked(1, 1), true, 'tier 1 is open from the start');
  assert.equal(upgrades.tierUnlocked(3, 2), false);
  assert.equal(upgrades.tierUnlocked(3, 3), true);
  assert.equal(upgrades.effectiveSteps('clickPower', 5 * S, 2), 2 * S, 'on a level-2 block: at most the end of tier 2');
  assert.equal(upgrades.effectiveSteps('clickPower', 30, 5), 30);
  near(upgrades.effectiveValues({ clickPower: 5 * S }, 2).clickPower, 20, 'works at hi_2 on a level-2 block');
  near(upgrades.effectiveValues({ clickPower: 5 * S }, 1).clickPower, 10, 'and at hi_1 on a level-1 block');
  near(upgrades.effectiveValues({}, 1).defense, 1, 'no steps: the start');
});

test('every pricing rule: PV, Hours, Step, Factory, Wall; skins by rarity hours (flags are Rare)', () => {
  const superClick = require('../plugins/items/data.json').items.find(i => i.id === 'superClick');
  assert.equal(catalog.priceTenths(superClick, { L: 1 }), 7500, 'the doc: 0.625 x W(1) = 750 squares');
  assert.equal(catalog.priceTenths(superClick, { L: 3 }), 30000);
  assert.equal(catalog.priceTenths(require('../plugins/items/data.json').items.find(i => i.id === 'demolition'), { L: 1 }), 6000, '0.5 hours = 600 squares');
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('upgrade:earnings'), { s: 7, L: 9 }), upgrades.stepCostTenths('earnings', 7), 'steps use their number, not the level');
  const factory = catalog.CATALOG.get('building:factory');
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 1 }), catalog.toTenths(48 * 0.05 * 1200));
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 3 }), catalog.toTenths(48 * 0.05 * 1200 * 1.15 ** 2));
  // Walls (loop 18): wallPriceWh x W(L) x max(1, sqrt(walls owned) / 2).
  const wall = catalog.CATALOG.get('building:wall');
  assert.equal(catalog.priceTenths(wall, { L: 1, owned: 0 }), 120, '0.01 x 1200 = 12 squares');
  assert.equal(catalog.priceTenths(wall, { L: 1, owned: 4 }), 120, 'up to 4 walls owned: no extra');
  assert.equal(catalog.priceTenths(wall, { L: 1, owned: 16 }), 240, '16 owned: x2');
  assert.equal(catalog.priceTenths(wall, { L: 3, owned: 100 }), catalog.toTenths(0.01 * 4800 * 5), 'level 3, 100 owned: x5');
  assert.equal(catalog.skinPriceTenths({ id: 'stripes', rarity: 'Common' }, 1), catalog.toTenths(0.3333 * 1200));
  assert.equal(catalog.skinPriceTenths({ id: 'flag-jp', rarity: 'Ultra Rare' }, 2), catalog.toTenths(1 * 2400), 'flags are Rare');
  assert.throws(() => catalog.priceTenths({ key: 'x', pricing: 'Nope' }, {}), /no pricing rule/);
});
