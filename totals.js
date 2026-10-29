// Lifetime totals per player, for achievements: blocks claimed, taps, squares earned, days played, and so on
// (the stat names are STATS in economy.js). Kept in memory and saved to player_totals every few seconds and
// when a player leaves, so busy stats like taps don't cost a database write each.
const store = require('./store');
const { COUNTS_DOWN } = require('./achievements');

const DAY_MS = 24 * 60 * 60 * 1000;

// onStat(pid, stat, value): called whenever a stat changes, for the achievement checks.
function createTotals(pool, { onStat, saveMs = 15000 } = {}) {
  const players = new Map();   // pid -> Promise of { values, dirty: Set }
  const load = pid => {
    if (!players.has(pid)) {
      players.set(pid, store.loadTotals(pool, pid).then(values => ({ values, dirty: new Set() }))
        .catch(err => { players.delete(pid); throw err; }));
    }
    return players.get(pid);
  };
  const put = (t, pid, stat, value) => {
    t.values[stat] = value;
    t.dirty.add(stat);
    onStat(pid, stat, value);
    return value;
  };

  // Adds to a count. Returns the new total.
  async function bump(pid, stat, by = 1) {
    if (!pid || !by) return;
    const t = await load(pid);
    return put(t, pid, stat, (t.values[stat] ?? 0) + by);
  }
  // A record: kept if it beats the old one (higher, or lower for bestRank). Returns the record.
  async function best(pid, stat, value) {
    if (!pid) return;
    const t = await load(pid), old = t.values[stat];
    const better = old === undefined || (COUNTS_DOWN.has(stat) ? value < old : value > old);
    return better ? put(t, pid, stat, value) : old;
  }
  // Days played and streaks, by the UTC day: the first activity of a new day counts it.
  async function touchDay(pid, now = Date.now()) {
    if (!pid) return;
    const t = await load(pid), today = Math.floor(now / DAY_MS), last = t.values.lastDay;
    if (last === today) return;
    const streak = last === today - 1 ? (t.values.streak ?? 0) + 1 : 1;
    put(t, pid, 'lastDay', today);
    put(t, pid, 'dayClaims', 0);
    put(t, pid, 'streak', streak);
    put(t, pid, 'daysPlayed', (t.values.daysPlayed ?? 0) + 1);
    if (streak > (t.values.bestStreak ?? 0)) put(t, pid, 'bestStreak', streak);
  }
  async function values(pid) { return (await load(pid)).values; }
  // Counting never stops the game: a failure is logged, and the stat simply isn't counted that time.
  const safe = fn => (...args) => fn(...args).catch(err => console.error(`TOTALS FAILED (${args[1] ?? 'day'}): ${err.message}`));

  // Saves changed totals: one player's, or everyone's.
  async function save(pid) {
    for (const [id, p] of pid === undefined ? players : [[pid, players.get(pid)]]) {
      if (!p) continue;
      const t = await p.catch(() => null);
      if (!t || !t.dirty.size) continue;
      const changes = Object.fromEntries([...t.dirty].map(k => [k, t.values[k]]));
      t.dirty.clear();
      await store.saveTotals(pool, id, changes).catch(err => {
        for (const k of Object.keys(changes)) t.dirty.add(k);   // try again next time
        console.error(`TOTALS SAVE FAILED (player ${id}): ${err.message}`);
      });
    }
  }
  // Forgets a player (after a reset): the next use loads them again.
  const forget = pid => players.delete(pid);

  const timer = setInterval(() => save(), saveMs);
  timer.unref();
  const stop = () => { clearInterval(timer); return save(); };
  return { bump: safe(bump), best: safe(best), touchDay: safe(touchDay), values, save, forget, stop };
}

module.exports = { createTotals };
