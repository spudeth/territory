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

// Upgrades: the step math lives in upgrades.js (loop 19).

// ---------- Pricing rules ----------
// Each takes the row and the context { L (the map's level), n (factories owned + 1), H (the block's hardness) }
// and returns tenths.
const PRICING = {
  PV: (row, { L }) => toTenths(row.P * row.V * W(L)),
  Hours: (row, { L }) => toTenths(row.hours * W(L)),
  Step: (row, { s }) => require('./upgrades').stepCostTenths(row.upgrade, s),   // required here: upgrades.js needs this file
  Factory: (row, { L, n }) => toTenths(E.factoryBuildPaybackHours * E.factoryValuePerHour * W(L) * E.factoryBuildGrowth ** (n - 1)),
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
  for (const key of Object.keys(economy.tiers ?? {})) rows.push({ key: 'upgrade:' + key, kind: 'upgrade', upgrade: key, pricing: 'Step', effect: key });
  rows.push({ key: 'building:factory', kind: 'building', pricing: 'Factory', effect: 'factory' });
  return new Map(rows.map(r => [r.key, r]));
}
const CATALOG = buildCatalog();
// A skin's price in tenths: its rarity's hours x W(L). Flags are Rare.
const skinPriceTenths = (skin, L) => toTenths(skinHours(skin.id?.startsWith('flag-') ? 'Rare' : skin.rarity) * W(L));

const CATALOG_TIERS = economy.tiers;   // the upgrades, from the Upgrades tab: { key: { name, type, start, max1, mult, tiers, steps, tierWh, priceCurve, gainCurve, unit, about } }
module.exports = { E, CATALOG_TIERS, TENTHS, toTenths, fromTenths, wholeSquares, level, levelStart, levelProgress, W, hardness, payTenths,
  PRICING, priceTenths, CATALOG, skinPriceTenths, skinHours };
