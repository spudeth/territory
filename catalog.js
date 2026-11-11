// The economy (loop 16): levels, hardness, pay, upgrade tiers and every price, from the doc "Territory economy:
// core equations" and the sheet's Economy, Upgrades, Items and Skin Rarity tabs (data/economy.json).
// Pure functions, no database. Money is integer tenths of a square ("tenths"); every rounding is down.
//
// The catalog is one registry of everything that can be bought: each row is { key, kind, pricing, effect } and
// the pricing rules below turn a row into a price. A new item, upgrade, building or add-on is a sheet row, plus
// a new effect handler only for a brand-new kind of effect.

const economy = require('./data/economy.json');
const E = economy.economy;

// ---------- Money ----------
const TENTHS = 10;
const toTenths = squares => Math.floor(Number(squares) * TENTHS + 1e-9);   // squares (may have a fraction) -> tenths, down
const fromTenths = t => Number(t) / TENTHS;                                // tenths -> squares, for the screen
const wholeSquares = t => Math.floor(Number(t) / TENTHS);                  // what players see: whole squares, down

// ---------- Levels ----------
// A map's level from blocks mined (first claims by players and factories) and its base blocks E. Never stored.
//   L = 1 + floor(log2(mined / E + 1)), at most maxLevel
function level(mined, base, maxLevel = E.maxLevel) {
  if (!(base > 0)) return 1;
  let L = 1;
  while (L < maxLevel && mined >= levelStart(L + 1, base)) L++;   // whole-number steps, no floating log
  return L;
}
// Blocks mined on a map when level L begins: (2^(L-1) - 1) x E.
const levelStart = (L, base) => (2 ** (L - 1) - 1) * base;
// How far a map is through its level: { level, from, to, mined } (to = null at the top level).
function levelProgress(mined, base) {
  const L = level(mined, base);
  return { level: L, from: levelStart(L, base), to: L < E.maxLevel ? levelStart(L + 1, base) : null, mined };
}

// W(L): squares one work-hour is worth at level L = (3600 / baseBlockSeconds) x 2^(L-1).
const W = L => 3600 / E.baseBlockSeconds * 2 ** (L - 1);

// ---------- Blocks ----------
// Hardness: hits to mine a block born at level `birth` on terrain factor t. H = hitsPerBlock x 2^(birth-1) x t.
const hardness = (hitsPerBlock, birth, t) => hitsPerBlock * 2 ** ((birth | 0 || 1) - 1) * t;
// Pay for mining a new block, in tenths: H x 10 / hitsPerSquare x Earnings, down, plus the gold bonus.
const payTenths = (H, earn = 1, goldBonusSquares = 0) =>
  Math.floor(H * TENTHS / E.hitsPerSquare * earn + 1e-9) + toTenths(goldBonusSquares);

// ---------- Upgrades (loop 18): tiers of S steps, from the Upgrades tab ----------
// Each upgrade: start (tier 1 start), max1 (tier 1 max), mult (m), tiers, steps (S), tierWh, priceCurve (c), gainCurve (g).
// Tier N runs from lo_N to hi_N: lo_1 = start; lo_N = max1 x m^(N-2) for N >= 2; hi_N = max1 x m^(N-1).
// A player owns a number of steps per upgrade (0 to tiers x S); their s-th step is step j = s - (N-1) x S of tier N = ceil(s / S).
//   value after step j of tier N = lo_N + (hi_N - lo_N) x ln(1 + g j/S) / ln(1 + g)
//   price of step j of tier N = tierWh x W(N) x ln(1 + c j/S) / sum(i = 1..S) ln(1 + c i/S)
// Prices are in tenths: each step is the running total (rounded down) minus the one before, so a whole tier costs
// exactly tierWh x W(N) and no step is off by more than a tenth. Fixed forever.
const up = key => economy.tiers[key];
const STEPS = key => up(key).steps;
const tierCount = key => up(key).tiers;
const topStep = key => up(key).tiers * up(key).steps;
const lo = (key, N) => (N <= 1 ? up(key).start : up(key).max1 * up(key).mult ** (N - 2));
const hi = (key, N) => up(key).max1 * up(key).mult ** (Math.max(1, N) - 1);
// The tier a step is in (step 0: tier 1, the start).
const tierOfStep = (key, s) => Math.max(1, Math.ceil(s / STEPS(key)));
// The value after `s` steps (0: the tier 1 start).
function stepValue(key, s) {
  const u = up(key), S = u.steps, n = Math.min(Math.max(0, Math.floor(s)), topStep(key));
  if (n === 0) return u.start;
  const N = Math.ceil(n / S), j = n - (N - 1) * S;
  return lo(key, N) + (hi(key, N) - lo(key, N)) * Math.log(1 + u.gainCurve * j / S) / Math.log(1 + u.gainCurve);
}
// The value at the end of tier N (hi_N); tier 0 is where everyone starts.
const tierValue = (key, N) => (N <= 0 ? up(key).start : hi(key, N));
// The share of a tier's price paid once its first j steps are bought: sum(i <= j) ln(1 + c i/S) / sum(all).
const shares = new Map();
function priceShare(key, j) {
  const u = up(key), id = `${key}:${u.steps}:${u.priceCurve}`;
  if (!shares.has(id)) {
    const run = [0];
    for (let i = 1; i <= u.steps; i++) run.push(run[i - 1] + Math.log(1 + u.priceCurve * i / u.steps));
    shares.set(id, run.map(v => v / run[u.steps]));
  }
  return shares.get(id)[j];
}
// The price of a player's s-th step (1 to tiers x S), in tenths.
function stepCostTenths(key, s) {
  const S = STEPS(key), N = Math.ceil(s / S), j = s - (N - 1) * S, tier = up(key).tierWh * W(N) * TENTHS;
  return Math.floor(tier * priceShare(key, j) + 1e-6) - Math.floor(tier * priceShare(key, j - 1) + 1e-6);
}
// The whole of tier N (every step in it), in tenths: exactly tierWh x W(N).
const tierCostTenths = (key, N) => Math.floor(up(key).tierWh * W(N) * TENTHS + 1e-6);
// The steps an upgrade works at on a block of level L: at most the end of tier L (hi_L).
const effectiveSteps = (key, owned, L) => Math.min(Math.max(0, owned | 0), Math.max(1, L | 0) * STEPS(key), topStep(key));
// What each upgrade gives a player with these steps ({ key: steps }, missing = 0) on a block of level L.
const effectiveValues = (steps, L) => Object.fromEntries(Object.keys(economy.tiers).map(k => [k, stepValue(k, effectiveSteps(k, steps?.[k] ?? 0, L))]));
// Whether tier N's steps can be bought: tier 1 always; tier N once a level-N block was first-claimed somewhere.
const tierUnlocked = (N, highestLevel) => N <= 1 || (highestLevel | 0) >= N;

// ---------- Pricing rules ----------
// Each takes the row and the context { L (the map's level), n (factories owned + 1), H (the block's hardness) }
// and returns tenths.
const PRICING = {
  PV: (row, { L }) => toTenths(row.P * row.V * W(L)),
  Hours: (row, { L }) => toTenths(row.hours * W(L)),
  Step: (row, { s }) => stepCostTenths(row.upgrade, s),
  Factory: (row, { L, n }) => toTenths(E.factoryBuildPaybackHours * E.factoryValuePerHour * W(L) * E.factoryBuildGrowth ** (n - 1)),
  // Loop 18: wallPriceWh x W(the block's level) x max(1, sqrt(walls you own) / 2), counting the walls owned before a batch.
  Wall: (row, { L, owned = 0 }) => toTenths(E.wallPriceWh * W(L) * wallFactor(owned)),
};
const wallFactor = owned => Math.max(1, Math.sqrt(Math.max(0, owned)) / 2);
const wallPriceTenths = (L, owned) => PRICING.Wall(null, { L, owned });
const priceTenths = (row, ctx) => {
  const rule = PRICING[row.pricing];
  if (!rule) throw new Error(`no pricing rule "${row.pricing}" for ${row.key}`);
  return rule(row, ctx);
};

// ---------- The catalog ----------
// Every purchasable thing, as data. kind: what screen and handler it belongs to. effect: the handler name.
const skinHours = rarity => economy.skinRarity?.[rarity] ?? 0;
function buildCatalog() {
  const rows = [];
  for (const key of Object.keys(economy.tiers ?? {})) rows.push({ key: 'upgrade:' + key, kind: 'upgrade', upgrade: key, pricing: 'Step', effect: key });
  for (const it of economy.items ?? []) rows.push({ ...it, key: 'item:' + it.id, kind: 'item', pricing: it.pricing, effect: it.effect });
  rows.push({ key: 'building:factory', kind: 'building', pricing: 'Factory', effect: 'factory' });
  rows.push({ key: 'building:wall', kind: 'building', pricing: 'Wall', effect: 'wall' });
  return new Map(rows.map(r => [r.key, r]));
}
const CATALOG = buildCatalog();
// A skin's price in tenths: its rarity's hours x W(L). Flags are Rare.
const skinPriceTenths = (skin, L) => toTenths(skinHours(skin.id?.startsWith('flag-') ? 'Rare' : skin.rarity) * W(L));

const CATALOG_TIERS = economy.tiers;   // the upgrades, from the Upgrades tab: { key: { name, type, start, max1, mult, tiers, steps, tierWh, priceCurve, gainCurve, unit, about } }
module.exports = { E, CATALOG_TIERS, TENTHS, toTenths, fromTenths, wholeSquares, level, levelStart, levelProgress, W, hardness, payTenths,
  STEPS, tierCount, topStep, lo, hi, stepValue, tierOfStep, tierValue, stepCostTenths, tierCostTenths, effectiveSteps, effectiveValues, tierUnlocked,
  PRICING, priceTenths, CATALOG, skinPriceTenths, skinHours, wallPriceTenths };
