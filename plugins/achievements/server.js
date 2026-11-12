// Achievements, on the server (loop 7; secrets loop 12; a plug-in since loop 19). The Achievements tab (data.json):
// each is earned once per player, the first time one of their stats reaches its threshold, and pays its reward in
// squares. The core counts the stats (totals.js, stats.js) and says when one changes (the stat hook); this plug-in only
// reads them and awards. The secret checks (Speedrun, Revenge, Castaway, …) watch the core's hooks and count their
// own secret:<name> stats. Its data: the player_achievements table (a core table: Q42).
// Events sent: achievements:earned { id, name, category, description, reward, secret, stat, threshold, mapId }.
// Events taken: achievements:list ({ pid } for another player's, read-only).
const text = require('./text');
const { index, reached } = require('./rules');

module.exports = api => {
  const { pool, catalog, rules, upgrades } = api;
  // The definitions: the sheet's (data.json), or a test's own list.
  const LIST = api.options?.achievementList ?? api.plugin.data.achievements ?? [];
  const byStat = index(LIST);
  const knownIds = new Set(LIST.map(d => d.id));

  // ---------- Earning ----------
  // Each player's earned ids are loaded once and kept in memory.
  const earned = new Map();   // pid -> Promise of a Set of ids
  const earnedBy = pid => {
    if (!earned.has(pid)) {
      earned.set(pid, earnedIds(pid).then(ids => new Set(ids)).catch(err => { earned.delete(pid); throw err; }));
    }
    return earned.get(pid);
  };
  // A progress reset: their earned ids are loaded again (from the emptied table).
  api.on('progressReset', pid => { earned.delete(pid); });
  const checks = new Map();   // pid -> the player's queue of checks: one at a time per player, players in parallel
  // Checked on every stat change. An earned one is saved, paid, then announced to the player's browsers; earning
  // also counts toward the Collector achievements (and a secret toward Snoop).
  api.on('stat', ({ mapId = null, pid, name, value }) => {
    if (!pid || !byStat.has(name)) return;
    const queued = (checks.get(pid) ?? Promise.resolve()).then(async () => {
      const have = await earnedBy(pid);
      const hits = reached(byStat, name, value, have);
      if (!hits.length) return;
      // A deadlock with a claim at the same moment is retried once rather than losing the achievement.
      const earn = () => earnNow(pid, hits.map(d => d.id), Object.fromEntries(hits.map(d => [d.id, d.reward])));
      const r = await earn().catch(err => { if (err.code === '40P01') return earn(); throw err; });
      const fresh = new Set(r.fresh);
      let secrets = 0;
      for (const d of hits) {
        have.add(d.id);
        if (!fresh.has(d.id)) continue;
        if (d.secret) secrets++;
        api.toPlayer(pid, 'achievements:earned', { id: d.id, name: d.name, category: d.category, description: d.description, reward: d.reward, secret: d.secret,
          stat: d.stat, threshold: d.threshold, mapId });
      }
      if (r.squares !== null) api.money.changed(pid, r.squares);
      if (fresh.size) api.stats.best(pid, 'achievements', [...have].filter(id => knownIds.has(id)).length);
      if (secrets) api.stats.bump(pid, 'secrets', secrets);
    }).catch(err => console.error(`ACHIEVEMENT CHECK FAILED (player ${pid}): ${err.message}`));
    checks.set(pid, queued);
    queued.then(() => { if (checks.get(pid) === queued) checks.delete(pid); });
  });

  // Every stat an achievement can use, as it stands now: lifetime totals, upgrade levels, records on any map,
  // maps played, achievements earned. For the Achievements screen, and to catch up on connecting.
  async function progressValues(pid, levels, account) {
    const [values, progress, played] = await Promise.all([api.stats.values(pid), progressOf(pid), api.store.mapsPlayed(pool, pid)]);
    const out = { ...values, owned: progress.best.owned, bestSquare: progress.best.bestSquare, bestLine: progress.best.bestLine,
      mapsPlayed: played, achievements: progress.earned.filter(e => knownIds.has(e.id)).length };
    for (const k of Object.keys(catalog.CATALOG_TIERS)) out['level:' + k] = upgrades.tierOfStep(k, levels[k] ?? 0);   // each upgrade's tier
    out.tiers = Object.keys(catalog.CATALOG_TIERS).reduce((n, k) => n + (levels[k] ?? 0), 0);   // steps bought in all
    if (account) out.account = 1;
    return { values: out, earned: progress.earned };
  }
  // Connecting earns anything a player has already reached (new achievements, or progress from before they existed).
  api.on('connected', ({ pid, steps, account }) => {
    progressValues(pid, steps, account)
      .then(({ values }) => { for (const [name, value] of Object.entries(values)) api.stats.changed(pid, name, value); })
      .catch(err => console.error(`CATCH-UP FAILED (player ${pid}): ${err.message}`));
  });

  // The Achievements screen: { list: [{ id, name, stat, threshold, … }], earned: [{ id, map }], values: { stat: value } }.
  api.socket('list', async ({ me, mySteps }, ...args) => {
    const reply = args.at(-1);   // with or without an argument before it
    if (typeof reply !== 'function') return;
    // Secret ones show as "???" until earned.
    const shown = got => LIST.map(d => d.secret && !got.has(d.id)
      ? { id: d.id, name: '???', category: d.category, secret: true, stat: null, threshold: 1, reward: null, description: 'A secret achievement' }
      : { id: d.id, name: d.name, category: d.category, secret: d.secret, stat: d.stat, threshold: d.threshold, reward: d.reward, description: d.description });
    // Another player's (read-only, from their profile): { pid } before the reply.
    const other = args.length > 1 && args[0]?.pid && String(args[0].pid) !== String(me.pid) ? args[0].pid : null;
    const pid = other ?? me.pid;
    if (!pid) return reply({ list: shown(new Set()), earned: [], values: {} });
    try {
      const theirs = other ? (await pool.query('SELECT upgrade_steps, highest_level, auth_user_id FROM players WHERE id = $1', [other])).rows[0] : null;
      const levels = theirs ? { ...(theirs.upgrade_steps ?? {}) } : mySteps, account = theirs ? !!theirs.auth_user_id : me.account;
      const { values, earned: rows } = await progressValues(pid, levels, account);
      reply({ list: shown(new Set(rows.map(e => e.id))), earned: rows, values });
    } catch { reply({ error: 'Could not load achievements. Try again.' }); }
  });
  // The profile: how many they've earned (known ids only), and their latest five.
  api.on('profile', p => {
    const known = p.earned.filter(id => knownIds.has(id));
    return { achievements: { earned: known.length, total: LIST.length,
      recent: known.slice(0, 5).map(id => LIST.find(d => d.id === id)).map(d => ({ id: d.id, name: d.name, description: d.description })) } };
  });

  // ---------- The secrets: each counts its own secret:<name> stat ----------
  const secret = (pid, name) => api.stats.best(pid, 'secret:' + name, 1);
  const lostTo = new Map();     // "pid|map|x,y" -> { by, at }: who took a block from whom, for Revenge
  const comeback = new Set();   // "pid|map": lost every block there to others (Comeback Kid)
  const sweep = setInterval(() => {
    const old = Date.now() - 60000;
    for (const [k, v] of lostTo) if (v.at < old) lostTo.delete(k);
  }, 60000);
  sweep.unref();
  // A claim (visit: this connection's own notes, kept by the core for its plug-ins).
  api.on('claimed', (map, pid, { x, y, k, from, ground, now, visit }) => {
    const here = map.id + '|';
    if (from === null) {
      visit.recent = [...(visit.recent ?? []).filter(t => now - t < 60000), now];
      if (visit.recent.length >= 10) secret(pid, 'speedrun');
    } else {
      const mine = lostTo.get(pid + '|' + here + k);
      if (mine && String(mine.by) === String(from) && now - mine.at <= 60000) secret(pid, 'revenge');
      lostTo.set(from + '|' + here + k, { by: pid, at: now });
      if (!map.counts.get(from)) comeback.add(from + '|' + map.id);
    }
    visit.forestRun = ground === 'forest' ? (visit.forestRun ?? 0) + 1 : 0;
    if (visit.forestRun >= 25) secret(pid, 'treehugger');
    if (map.seed && rules.NEIGHBORS.every(([dx, dy]) => map.terrainAt(x + dx, y + dy) === 'water')) secret(pid, 'castaway');
    if (new Date(now).getUTCHours() === 3) secret(pid, 'witching');
    if (comeback.has(pid + '|' + map.id) && (map.counts.get(pid) || 0) >= 100) {
      comeback.delete(pid + '|' + map.id);
      secret(pid, 'comeback');
    }
  });
  // A tap on your own block that does nothing: the 50th this visit is the Poke secret.
  api.on('poke', (pid, visit) => { visit.pokes = (visit.pokes ?? 0) + 1; if (visit.pokes === 50) secret(pid, 'poke'); });
  api.on('wiped', (map, pid, blocks) => {
    if (blocks >= 1000) secret(pid, 'wipedout');
    comeback.delete(pid + '|' + map.id);
  });
  api.on('chat', (pid, said) => { if (said.toLowerCase().replace(/[^a-z]+/g, ' ').trim() === 'hello world') secret(pid, 'helloworld'); });
  api.on('balance', (pid, tenths) => { if (rules.shownSquares(tenths) === 1337) secret(pid, 'leet'); });

  // ---------- The database ----------
  // Achievement ids a player has earned.
  async function earnedIds(playerId) {
    const { rows } = await pool.query('SELECT achievement_id FROM player_achievements WHERE player_id = $1', [playerId]);
    return rows.map(r => r.achievement_id);
  }
  // Records achievements. rewards: { id: squares } for the ids given. Each newly earned one pays its reward (ledger
  // 'achievement:<id>'). Returns { fresh: the ids that were new, squares: the new exact balance, or null if nothing was paid }.
  const earnNow = (playerId, ids, rewards = {}) => api.tx(async c => {
    // Locks: only a key-share lock on the player (it waits for an account being deleted, so a deleted account
    // earns nothing more, but never for a claim), and no map: a claim holds its map while it updates the player,
    // so touching the map here could deadlock.
    const { rows: [who] } = await c.query('SELECT deleted_at FROM players WHERE id = $1 FOR KEY SHARE', [playerId]);
    if (!who || who.deleted_at) return { fresh: [], squares: null };
    const { rows } = await c.query(
      `INSERT INTO player_achievements (player_id, achievement_id) SELECT $1, unnest($2::text[])
       ON CONFLICT DO NOTHING RETURNING achievement_id`, [playerId, ids]);
    const fresh = rows.map(r => r.achievement_id);
    let squares = null;
    for (const id of fresh) {
      const pay = catalog.toTenths(Number(rewards[id]) || 0);
      if (!pay) continue;
      const { rows: [p] } = await c.query('UPDATE players SET squares = squares + $2 WHERE id = $1 AND deleted_at IS NULL RETURNING squares', [playerId, pay]);
      if (!p) continue;
      await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)',
        [playerId, pay, p.squares, 'achievement:' + id]);
      squares = Number(p.squares);
    }
    return { fresh, squares };
  });
  // A player's best value of each stat on any map (the progress shown), and the achievements they have earned with
  // the map each was earned on.
  async function progressOf(playerId) {
    const [best, got] = await Promise.all([
      pool.query(`SELECT max(owned_max) AS "owned", max(first_claims) AS "firstClaims", max(retakes) AS "retakes",
        max(blocks_lost) AS "blocksLost", max(best_square) AS "bestSquare", max(best_line) AS "bestLine"
        FROM player_map_stats WHERE player_id = $1`, [playerId]),
      pool.query(`SELECT a.achievement_id AS id, m.name AS map FROM player_achievements a LEFT JOIN maps m ON m.id = a.map_id
        WHERE a.player_id = $1`, [playerId]),
    ]);
    return { best: Object.fromEntries(Object.entries(best.rows[0]).map(([k, v]) => [k, v ?? 0])), earned: got.rows };
  }

  // ---------- The Game Guide ----------
  api.on('guide', ({ n, table }) => ({ id: 'achievements', title: text.name, html: `<h2 id="achievements">${text.name}</h2>`
    + table(['Achievement', 'What to do', 'Reward (squares)'], LIST.map(a => a.secret ? ['???', 'A secret', '?'] : [a.name, a.description, n(a.reward, 1)])) }));
};
