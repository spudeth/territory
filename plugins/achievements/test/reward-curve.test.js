// The reward curve (loop 21): cumulative achievement rewards stay under 50% of the work done, at
// every point of a typical progression. The work unit is squares earned from mining at base rates
// (1 block = 10 hits = 1 square). Every stat maps to the work at which a typical player reaches it
// (the proxies below — the same model that generated data.json); the rewards of everything reached
// by work E must sum to at most E/2. Secrets are assumed, pessimistically, to all fire at E=200.
const test = require('node:test');
const assert = require('node:assert');
const data = require('../data.json').achievements;
const economy = require('../../../data/economy.json');
const upgrades = require('../../../server/upgrades.js');

const TERRAIN_SHARE = { sand: economy.rules.sandShare, forest: economy.rules.forestShare, stone: economy.rules.stoneShare, gold: economy.rules.goldShare };
const W = L => (3600 / economy.economy.baseBlockSeconds) * 2 ** (L - 1);
const tierCumCost = (key, N) => { let t = 0; for (let i = 1; i <= N; i++) t += economy.tiers[key].tierWh * W(i); return t; };
// cumulative squares to buy n upgrade steps, buying the cheapest next step across all upgrades
const stepCost = (() => {
  const keys = Object.keys(upgrades.ROWS); const owned = {}; keys.forEach(k => (owned[k] = 0));
  const cum = [0]; let total = 0;
  for (let s = 1; s <= 7000; s++) {
    let best = null, bc = Infinity;
    for (const k of keys) { if (owned[k] >= upgrades.topStep(k)) continue; const c = upgrades.stepCostTenths(k, owned[k] + 1); if (c < bc) { bc = c; best = k; } }
    if (!best) break; owned[best]++; total += bc / 10; cum.push(total);
  }
  return n => cum[Math.min(n, cum.length - 1)];
})();
const PROXY = {
  claims: s => s, owned: s => s, bestSquare: s => s * s, bestLine: s => 2 * s,
  taken: s => s, lost: s => s, taps: s => s / 10,
  squaresEarned: s => s, squaresSpent: s => s, squaresHeld: s => s,
  purchases: s => stepCost(s),
  mapsPlayed: s => 500 * s, daysPlayed: s => 300 * s, bestStreak: s => 300 * s,
  bestRank: s => 2000 * (11 - s), reignMinutes: s => 50 * s, wipes: s => 500 * s,
  hoursPlayed: s => 150 * s, sessionClaims: s => s, bestDayClaims: s => s,
  chatMessages: s => 5 * s, growthBlocks: s => 2 * s, mapGrown: s => s,
};
const FLAT = { renames: 50, account: 50, tutorialDone: 10, secrets: 800 };
const workAt = a => {
  if (a.secret || a.stat.startsWith('secret:')) return 200;
  if (FLAT[a.stat]) return FLAT[a.stat];
  if (a.stat.startsWith('level:')) return tierCumCost(a.stat.slice(6), a.threshold);
  if (a.stat.startsWith('terrain:')) return a.threshold / TERRAIN_SHARE[a.stat.slice(8)];
  return PROXY[a.stat](a.threshold);
};

test('every achievement has a work proxy and a positive reward', () => {
  for (const a of data) {
    assert.ok(a.reward > 0, `${a.id} pays nothing`);
    if (a.stat !== 'achievements') assert.ok(Number.isFinite(workAt(a)) && workAt(a) > 0, `${a.id}: no proxy for stat ${a.stat}`);
  }
});

test('cumulative rewards never exceed 50% of the work done', () => {
  const plain = data.filter(a => a.stat !== 'achievements').map(a => ({ r: a.reward, p: workAt(a) }));
  // Collector: the n-th achievement is earned at the work of the n-th cheapest proxy.
  const sorted = plain.map(i => i.p).sort((x, y) => x - y);
  const items = plain.concat(data.filter(a => a.stat === 'achievements').map(a => ({ r: a.reward, p: sorted[Math.min(a.threshold, sorted.length) - 1] })));
  for (let e = 0; 10 ** (e / 10) <= 2e8; e++) {
    const E = 10 ** (e / 10);
    const sum = items.reduce((t, i) => t + (i.p <= E ? i.r : 0), 0);
    assert.ok(sum <= 0.5 * E + 1e-9, `at work E=${E.toFixed(0)}: rewards ${sum.toFixed(1)} are ${(100 * sum / E).toFixed(0)}% (limit 50%)`);
  }
});

test('ladders: per stat at most 12 steps, strictly rising (Rank falls), rewards rising', () => {
  const groups = new Map();
  for (const a of data) {
    if (a.secret || a.stat.startsWith('secret:') || FLAT[a.stat]) continue;
    if (!groups.has(a.stat)) groups.set(a.stat, []);
    groups.get(a.stat).push(a);
  }
  for (const [stat, rows] of groups) {
    assert.ok(rows.length <= 12, `${stat}: ${rows.length} steps (max 12)`);
    for (let i = 1; i < rows.length; i++) {
      if (stat === 'bestRank') assert.ok(rows[i].threshold < rows[i - 1].threshold, `${stat}: thresholds must fall`);
      else assert.ok(rows[i].threshold > rows[i - 1].threshold, `${stat}: thresholds must rise (${rows[i - 1].threshold} -> ${rows[i].threshold})`);
      assert.ok(rows[i].reward >= rows[i - 1].reward, `${stat}: rewards must not fall (${rows[i - 1].id} ${rows[i - 1].reward} -> ${rows[i].id} ${rows[i].reward})`);
    }
  }
});
