// The economy's formulas (catalog.js): levels, hardness, pay, tiers and every pricing rule. In memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog');
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

test('upgrades in steps: anchors a_N = v0 x (vmax/v0)^(N/10); stepsPerTier geometric steps per tier; costs one smooth curve; the cap is a_L', () => {
  const S = catalog.E.stepsPerTier, near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, b), `${msg}: ${a} vs ${b}`);
  assert.equal(S, 90);
  near(catalog.anchor('clickPower', 0), 1, 'a_0 = v0');
  near(catalog.anchor('clickPower', 10), 512, 'a_10 = vmax');
  near(catalog.anchor('clickPower', 5), 512 ** 0.5, 'a_5');
  near(catalog.anchor('growth', 10), 6, 'Growth is geometric now');
  near(catalog.stepValue('clickPower', 0), 1, 'no steps: the start');
  near(catalog.stepValue('clickPower', S), catalog.anchor('clickPower', 1), 'the end of tier 1 is a_1');
  near(catalog.stepValue('clickPower', S + 45), catalog.anchor('clickPower', 1) * (catalog.anchor('clickPower', 2) / catalog.anchor('clickPower', 1)) ** 0.5, 'half way through tier 2');
  near(catalog.stepValue('clickPower', 10 * S), 512, 'the top');
  for (let s = 1; s <= 10 * S; s++) assert.ok(catalog.stepValue('clickPower', s) > catalog.stepValue('clickPower', s - 1), `step ${s} goes up`);
  assert.equal(catalog.tierOfStep(0), 1);
  assert.equal(catalog.tierOfStep(S), 1);
  assert.equal(catalog.tierOfStep(S + 1), 2);
  // Costs: each step 2^(1/S) times the one before; tier N totals about c_u x 1200 x 2^(N-1); tier N+1's first step is twice tier N's.
  const r = 2 ** (1 / S);
  for (const N of [1, 2, 5, 10]) {
    const total = catalog.fromTenths(catalog.tierCostTenths('clickPower', N)), want = 4 * 1200 * 2 ** (N - 1);
    assert.ok(Math.abs(total - want) / want < 0.002, `tier ${N}: ${total} vs ${want}`);
  }
  assert.ok(Math.abs(catalog.stepCostTenths('clickPower', S + 1) / catalog.stepCostTenths('clickPower', 1) - 2) < 0.01, 'twice the first step of the tier before');
  assert.ok(Math.abs(catalog.stepCostTenths('clickPower', 2) / catalog.stepCostTenths('clickPower', 1) - r) < 0.01, 'no jump between steps');
  assert.ok(Math.abs(catalog.stepCostTenths('clickPower', S + 1) / catalog.stepCostTenths('clickPower', S) - r) < 0.01, 'no jump at a tier boundary');
  // Unlocks and the cap.
  assert.equal(catalog.tierUnlocked(1, 1), true, 'tier 1 is open from the start');
  assert.equal(catalog.tierUnlocked(3, 2), false);
  assert.equal(catalog.tierUnlocked(3, 3), true);
  assert.equal(catalog.effectiveSteps(5 * S, 2), 2 * S, 'on a level-2 map: at most the end of tier 2');
  assert.equal(catalog.effectiveSteps(30, 5), 30);
  near(catalog.effectiveValues({ clickPower: 5 * S }, 2).clickPower, catalog.anchor('clickPower', 2), 'works at a_2 on a level-2 map');
  near(catalog.effectiveValues({}, 1).defense, 1, 'no steps: the start');
});

test('every pricing rule: PV, Hours, Step, Factory, Wall; skins by rarity hours (flags are Rare)', () => {
  const superClick = catalog.CATALOG.get('item:superClick');
  assert.equal(catalog.priceTenths(superClick, { L: 1 }), 7500, 'the doc: 0.625 x W(1) = 750 squares');
  assert.equal(catalog.priceTenths(superClick, { L: 3 }), 30000);
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('item:demolition'), { L: 1 }), 6000, '0.5 hours = 600 squares');
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('upgrade:earnings'), { s: 7, L: 9 }), catalog.stepCostTenths('earnings', 7), 'steps use their number, not the level');
  const factory = catalog.CATALOG.get('building:factory');
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 1 }), catalog.toTenths(48 * 0.05 * 1200));
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 3 }), catalog.toTenths(48 * 0.05 * 1200 * 1.15 ** 2));
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('building:wall'), { H: 20 }), catalog.toTenths(1 * 2 * 20 / 10), 'P_a x w x H / hitsPerSquare');
  assert.equal(catalog.skinPriceTenths({ id: 'stripes', rarity: 'Common' }, 1), catalog.toTenths(0.3333 * 1200));
  assert.equal(catalog.skinPriceTenths({ id: 'flag-jp', rarity: 'Ultra Rare' }, 2), catalog.toTenths(1 * 2400), 'flags are Rare');
  assert.throws(() => catalog.priceTenths({ key: 'x', pricing: 'Nope' }, {}), /no pricing rule/);
});
