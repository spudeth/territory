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

test('tiers: geometric or list values, costs c_u x 1200 x 2^(N-1), unlock and the map-level cap', () => {
  assert.equal(catalog.tierValue('clickPower', 1), 1);
  assert.ok(Math.abs(catalog.tierValue('clickPower', 2) - 2) < 1e-9, 'x2 a tier: 512^(1/9) = 2');
  assert.ok(Math.abs(catalog.tierValue('clickPower', 10) - 512) < 1e-9);
  assert.ok(Math.abs(catalog.tierValue('earnings', 10) - 10) < 1e-9);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(N => catalog.tierValue('growth', N)), [1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
  assert.equal(catalog.tierCostTenths('clickPower', 2), 4 * 1200 * 2 * 10, 'c_u 4: 9,600 squares');
  assert.equal(catalog.tierCostTenths('clickPower', 10), 4 * 1200 * 512 * 10);
  assert.equal(catalog.tierUnlocked(3, 2), false);
  assert.equal(catalog.tierUnlocked(3, 3), true);
  assert.equal(catalog.effectiveTier(5, 2), 2, 'tier 5 works at tier 2 on a level-2 map');
  assert.equal(catalog.effectiveTier(2, 5), 2);
});

test('every pricing rule: PV, Hours, Tier, Factory, Wall; skins by rarity hours (flags are Rare)', () => {
  const superClick = catalog.CATALOG.get('item:superClick');
  assert.equal(catalog.priceTenths(superClick, { L: 1 }), 7500, 'the doc: 0.625 x W(1) = 750 squares');
  assert.equal(catalog.priceTenths(superClick, { L: 3 }), 30000);
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('item:demolition'), { L: 1 }), 6000, '0.5 hours = 600 squares');
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('upgrade:earnings'), { N: 3, L: 9 }), 6 * 1200 * 4 * 10, 'tiers use N, not the level');
  const factory = catalog.CATALOG.get('building:factory');
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 1 }), catalog.toTenths(48 * 0.05 * 1200));
  assert.equal(catalog.priceTenths(factory, { L: 1, n: 3 }), catalog.toTenths(48 * 0.05 * 1200 * 1.15 ** 2));
  assert.equal(catalog.priceTenths(catalog.CATALOG.get('building:wall'), { H: 20 }), catalog.toTenths(1 * 2 * 20 / 10), 'P_a x w x H / hitsPerSquare');
  assert.equal(catalog.skinPriceTenths({ id: 'stripes', rarity: 'Common' }, 1), catalog.toTenths(0.3333 * 1200));
  assert.equal(catalog.skinPriceTenths({ id: 'flag-jp', rarity: 'Ultra Rare' }, 2), catalog.toTenths(1 * 2400), 'flags are Rare');
  assert.throws(() => catalog.priceTenths({ key: 'x', pricing: 'Nope' }, {}), /no pricing rule/);
});
