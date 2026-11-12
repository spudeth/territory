// The upgrade engine (loop 19; the math is loop 18's, moved here from catalog.js). One row per upgrade on the sheet's
// Upgrades tab; each changes exactly one variable (variables.js), named in its Variable column. Adding an upgrade is a
// sheet row; it shows in the game when its variable exists (the core's, or a loaded plug-in's).
//
// Each upgrade: start (tier 1 start = its variable's base), max1 (tier 1 max), mult (m), tiers, steps (S), tierWh,
// priceCurve (c), gainCurve (g). Tier N runs from lo_N to hi_N: lo_1 = start; lo_N = max1 x m^(N-2) for N >= 2;
// hi_N = max1 x m^(N-1). A player owns a number of steps per upgrade (0 to tiers x S); their s-th step is step
// j = s - (N-1) x S of tier N = ceil(s / S).
//   value after step j of tier N = lo_N + (hi_N - lo_N) x ln(1 + g j/S) / ln(1 + g)
//   price of step j of tier N = tierWh x W(N) x ln(1 + c j/S) / sum(i = 1..S) ln(1 + c i/S)
// Prices are in tenths: each step is the running total (rounded down) minus the one before, so a whole tier costs
// exactly tierWh x W(N) and no step is off by more than a tenth. Fixed forever.
// On a level-L block, every upgrade works at most at hi_L (the end of tier L).
const economy = require('../data/economy.json');
const catalog = require('./catalog');
const variables = require('./variables');

const ROWS = economy.tiers ?? {};   // { key: row }: the Upgrades tab
// The variable an upgrade changes. Rows synced before the Variable column existed use the names Bob set (Q39).
const LEGACY_VARIABLE = variables.LEGACY_UPGRADE_VARIABLE;
const variableOf = key => ROWS[key]?.variable ?? LEGACY_VARIABLE[key] ?? key;

const up = key => ROWS[key];
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
  const S = STEPS(key), N = Math.ceil(s / S), j = s - (N - 1) * S, tier = up(key).tierWh * catalog.W(N) * catalog.TENTHS;
  return Math.floor(tier * priceShare(key, j) + 1e-6) - Math.floor(tier * priceShare(key, j - 1) + 1e-6);
}
// The whole of tier N (every step in it), in tenths: exactly tierWh x W(N).
const tierCostTenths = (key, N) => Math.floor(up(key).tierWh * catalog.W(N) * catalog.TENTHS + 1e-6);
// The steps an upgrade works at on a block of level L: at most the end of tier L (hi_L).
const effectiveSteps = (key, owned, L) => Math.min(Math.max(0, owned | 0), Math.max(1, L | 0) * STEPS(key), topStep(key));
// What a player with these steps ({ key: steps }, missing = 0) gets on a block of level L: { variable: value } for
// every variable an upgrade changes. A variable no upgrade changes isn't listed: it is its base (value() below).
const effectiveValues = (steps, L) => Object.fromEntries(Object.keys(ROWS).map(k => [variableOf(k), stepValue(k, effectiveSteps(k, steps?.[k] ?? 0, L))]));
// One variable from effectiveValues' answer (or null for a visitor): its value, or its base.
const value = (eff, name) => eff?.[name] ?? variables.base(name);
// Whether tier N's steps can be bought: tier 1 always; tier N once a level-N block was first-claimed somewhere.
const tierUnlocked = (N, highestLevel) => N <= 1 || (highestLevel | 0) >= N;
// The upgrades that show in a game whose variables are `known` ({ name: base }): those whose variable exists.
const available = known => Object.keys(ROWS).filter(k => variableOf(k) in known);

module.exports = { ROWS, LEGACY_VARIABLE, variableOf, STEPS, tierCount, topStep, lo, hi, stepValue, tierOfStep, tierValue, stepCostTenths, tierCostTenths,
  effectiveSteps, effectiveValues, value, tierUnlocked, available };
