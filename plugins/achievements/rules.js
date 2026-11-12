// Achievements, defined as data: the Achievements tab of Xoren's sheet (this plug-in's data.json, via npm run sync-rules).
// Each is earned once per player, the first time one of their stats reaches its threshold, and pays its reward
// in squares. Stats are listed in economy.js (STATS); most count up, bestRank counts down ("#3 or better").
// Ids are stored in the database: never reuse or rename one; add new ones instead.
const { COUNTS_DOWN } = require('../../server/totals');   // the core's: bestRank counts down

// The checks a stat event needs, found by stat name so hundreds of definitions stay cheap.
function index(definitions) {
  const ids = new Set(), byStat = new Map();
  for (const d of definitions) {
    if (!d.id || !d.name || !d.stat || !(d.threshold > 0)) throw new Error(`bad achievement ${JSON.stringify(d)}`);
    if (ids.has(d.id)) throw new Error(`duplicate achievement id ${d.id}`);
    ids.add(d.id);
    (byStat.get(d.stat) ?? byStat.set(d.stat, []).get(d.stat)).push(d);
  }
  return byStat;
}

// Whether `value` of `stat` meets `threshold`.
const meets = (stat, value, threshold) => COUNTS_DOWN.has(stat) ? value > 0 && value <= threshold : value >= threshold - 1e-9;

// The definitions a stat reaching `value` earns, leaving out ids in `earned` (a Set).
const reached = (byStat, stat, value, earned) =>
  (byStat.get(stat) || []).filter(d => meets(stat, value, d.threshold) && !earned.has(d.id));

module.exports = { COUNTS_DOWN, index, meets, reached };
