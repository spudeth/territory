// Achievements, defined as data. Each is earned once per player, the first time one of their stats on any
// map reaches its threshold. Stats are the names in stats.js, plus 'owned' (blocks owned right now).
// These are placeholders until the real list is decided. Ids are stored in the database: never reuse or
// rename one; add new ones instead.
const rules = require('./rules');

const LIST = [
  { id: 'first-block',  name: 'First Block',      stat: 'firstClaims' },
  { id: 'owned-100',    name: '100 Blocks',       stat: 'owned' },
  { id: 'owned-1000',   name: '1,000 Blocks',     stat: 'owned' },
  { id: 'square-10',    name: '10 by 10',         stat: 'bestSquare' },
  { id: 'square-50',    name: '50 by 50',         stat: 'bestSquare' },
  { id: 'line-10',      name: 'Line of 10',       stat: 'bestLine' },
  { id: 'line-100',     name: 'Line of 100',      stat: 'bestLine' },
  { id: 'retakes-10',   name: 'Raider',           stat: 'retakes' },
];
// Thresholds come from the sheet (rules.ACHIEVEMENT_THRESHOLDS); the sync checks every id has one.
const DEFINITIONS = LIST.map(d => ({ ...d, threshold: rules.ACHIEVEMENT_THRESHOLDS[d.id] }));

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

// The definitions a stat reaching `value` earns, leaving out ids in `earned` (a Set).
const reached = (byStat, stat, value, earned) =>
  (byStat.get(stat) || []).filter(d => value >= d.threshold && !earned.has(d.id));

module.exports = { DEFINITIONS, index, reached };
