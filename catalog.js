// The economy (loop 16): levels, hardness, pay, upgrade tiers and every price, from the doc "Territory economy:
// core equations" and the sheet's Economy, Upgrades, Items and Skin Rarity tabs (data/economy.json).
// Pure functions, no database. Money is integer tenths of a square ("tenths"); every rounding is down.
//
// The catalog is one registry of everything that can be bought: each row is { key, kind, pricing, effect } and
// the pricing rules below turn a row into a price. A new item, upgrade, building or add-on is a sheet row, plus
// a new effect handler only for a brand-new kind of effect.

const economy = require('./data/economy.json');
const E = economy.economy;
const TIER_COUNT = 10;

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

// ---------- Upgrade tiers ----------
// The value of tier N (1-10): geometric v0 x (vmax/v0)^((N-1)/9), or the Nth entry of a list.
function tierValue(key, N) {
  const u = economy.tiers[key];
  const n = Math.min(Math.max(1, N | 0), TIER_COUNT);
  if (u.step === 'list') return u.list[n - 1];
  return u.v0 * (u.vmax / u.v0) ** ((n - 1) / (TIER_COUNT - 1));
}
// The price of buying tier N (2-10), in tenths: c_u x 1200 x 2^(N-1) squares. Fixed forever (uses N, not a map).
const tierCostTenths = (key, N) => toTenths(economy.tiers[key].cu * W(N));
// The tier an upgrade works at on a map: min(owned tier, the map's level).
const effectiveTier = (owned, mapLevel) => Math.max(1, Math.min(owned | 0 || 1, mapLevel | 0 || 1));
// What each upgrade gives a player with these tiers ({ key: tier }, missing = 1) on a map of level L.
const effectiveValues = (tiers, L) => Object.fromEntries(Object.keys(economy.tiers).map(k => [k, tierValue(k, effectiveTier(tiers?.[k] ?? 1, L))]));
// Whether tier N can be bought: the player has first-claimed a block of level N or higher somewhere.
const tierUnlocked = (N, highestLevel) => (highestLevel | 0) >= N;

// ---------- Pricing rules ----------
// Each takes the row and the context { L (the map's level), n (factories owned + 1), H (the block's hardness) }
// and returns tenths.
const PRICING = {
  PV: (row, { L }) => toTenths(row.P * row.V * W(L)),
  Hours: (row, { L }) => toTenths(row.hours * W(L)),
  Tier: (row, { N }) => tierCostTenths(row.upgrade, N),
  Factory: (row, { L, n }) => toTenths(E.factoryBuildPaybackHours * E.factoryValuePerHour * W(L) * E.factoryBuildGrowth ** (n - 1)),
  Wall: (row, { H }) => toTenths(E.wallPaybackHours * E.wallStrength * H / E.hitsPerSquare),
};
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
  for (const key of Object.keys(economy.tiers ?? {})) rows.push({ key: 'upgrade:' + key, kind: 'upgrade', upgrade: key, pricing: 'Tier', effect: key });
  for (const it of economy.items ?? []) rows.push({ ...it, key: 'item:' + it.id, kind: 'item', pricing: it.pricing, effect: it.effect });
  rows.push({ key: 'building:factory', kind: 'building', pricing: 'Factory', effect: 'factory' });
  rows.push({ key: 'building:wall', kind: 'building', pricing: 'Wall', effect: 'wall' });
  return new Map(rows.map(r => [r.key, r]));
}
const CATALOG = buildCatalog();
// A skin's price in tenths: its rarity's hours x W(L). Flags are Rare.
const skinPriceTenths = (skin, L) => toTenths(skinHours(skin.id?.startsWith('flag-') ? 'Rare' : skin.rarity) * W(L));

const CATALOG_TIERS = economy.tiers;   // the upgrades, from the Upgrades tab: { key: { name, type, v0, vmax, step, cu, unit, about } }
module.exports = { E, TIER_COUNT, CATALOG_TIERS, TENTHS, toTenths, fromTenths, wholeSquares, level, levelStart, levelProgress, W, hardness, payTenths,
  tierValue, tierCostTenths, effectiveTier, effectiveValues, tierUnlocked, PRICING, priceTenths, CATALOG, skinPriceTenths, skinHours };
