// Factories, on the server (loop 16; live hits loop 18; a plug-in since loop 19). Build one on your own land (Build →
// Factory): it mines the closest empty block touching your land, even while you're away, at Factory Speed, and each
// block it takes pays Factory Yield. After waking it works for Factory Lifetime hours, then sleeps until woken from
// its info card. One per factoryBlocksPerFactory blocks owned; the newest pause when land shrinks. A factory goes when
// its block is taken or freed, or by Demolition; it moves with its land when the land is sold.
// Its data: the factories table and map_cells.factory_id (core tables: Q42; the core's block SQL clears them when a
// block is freed or taken). Its numbers: the Factories tab (data.json). Its variables: factories.speed, .lifetime,
// .yield (plugin.json). Events sent: factories:changed { x, y, owner, awakeUntil, paused } or { x, y, gone }.
// Events taken: factories:wake { x, y }.
const text = require('./text');

module.exports = api => {
  const { pool, catalog, rules } = api;
  const D = api.plugin.data;
  const fac = require('./rules')(catalog, rules, D);
  const { key } = fac;
  const HOUR = 3600000;

  // ---------- A map's factories: "x,y" -> { id, owner, x, y, built, awake (ms), processed (ms), target, charge } ----------
  const of = map => (map.factories ??= new Map());
  // The owner's values for these variables on a level-L block (its target; for its lifetime, the block it stands on).
  const valueOn = (map, owner, L, name) => api.values(map, owner, L)[name];
  const ownFactories = (map, owner) => [...of(map).values()].filter(f => String(f.owner) === String(owner));
  // The owner's newest factories pause while their land is below the limit.
  const pausedOn = (map, owner) => fac.pausedIds(ownFactories(map, owner).map(f => ({ id: f.id, builtAt: f.built })), map.counts.get(owner) || 0);
  const out = (map, f) => ({ x: f.x, y: f.y, owner: f.owner, awakeUntil: f.awake, paused: pausedOn(map, f.owner).has(f.id) });
  const changed = (map, f) => api.toMap(map, 'factories:changed', out(map, f));
  function drop(map, k) {
    const f = of(map).get(k);
    if (!f) return;
    of(map).delete(k);
    api.toMap(map, 'factories:changed', { x: f.x, y: f.y, gone: true });
  }

  // Loading: the map's factories, and each one's saved progress as a crack on its target (one that never fades).
  api.on('mapLoaded', async map => {
    const { rows } = await pool.query(`SELECT id, owner_id, x, y, extract(epoch FROM built_at) * 1000 AS built, extract(epoch FROM awake_until) * 1000 AS awake,
      extract(epoch FROM processed_at) * 1000 AS processed, target_x, target_y, progress FROM factories WHERE map_id = $1`, [map.id]);
    for (const r of rows) {
      const f = { id: r.id, owner: r.owner_id, x: r.x, y: r.y, built: Number(r.built), awake: Number(r.awake), processed: Number(r.processed),
        target: r.target_x === null ? null : { x: r.target_x, y: r.target_y } };
      of(map).set(key(r.x, r.y), f);
      if (f.target && r.progress > 0) map.hits.set(key(f.target.x, f.target.y), { by: f.owner, n: r.progress, at: Date.now(), keep: true,
        need: fac.hitsFor(map, f.target.x, f.target.y, f.x, f.y, map.level()) });
    }
  });
  api.on('welcome', map => ({ factories: [...of(map).values()].map(f => out(map, f)) }));
  // A block changed hands or was freed: its factory is gone (the database cleared it in the same change).
  api.on('ownerChanged', (map, k) => drop(map, k));
  // Land sold: its factories go with it (the database moved them in the sale).
  api.on('transferred', (map, blocks, from, to) => {
    for (const [x, y] of blocks) {
      const f = of(map).get(key(x, y));
      if (f) { f.owner = to; changed(map, f); }
    }
  });

  // ---------- The info card ----------
  // New blocks an hour a factory mines: its rate on its target (or the one it would pick next), over that block's
  // hits. 0 with nothing to mine.
  function perHour(map, f) {
    const t = f.target && fac.stillTarget(map, f.owner, f.target) ? f.target : fac.chooseTarget(map, f.owner, f.x, f.y, `${map.seed}:${f.x},${f.y}`);
    if (!t) return 0;
    const rate = fac.hitsPerSecond(valueOn(map, f.owner, api.blocks.levelAt(map, t.x, t.y), 'factories.speed'));
    return rate * 3600 / fac.hitsFor(map, t.x, t.y, f.x, f.y, map.level());
  }
  api.on('blockInfo', (map, x, y, pid) => {
    const f = of(map).get(key(x, y));
    return f ? { factory: { ...out(map, f), mine: String(f.owner) === String(pid), target: f.target, perHour: perHour(map, f) } } : null;
  });

  // ---------- Building (Build → Factory) ----------
  // Why a factory can't go on (x, y) for `pid`, or null.
  function refusal(map, pid, x, y) {
    const k = key(x, y);
    if (map.cells.get(k) !== pid) return 'Only on your own land';
    if (map.terrainAt(x, y) === 'water') return 'Not on water';
    if (of(map).has(k)) return 'There is a factory here already';
    if (api.blocks.listed(map, x, y)) return 'Not on land for sale';
    return null;
  }
  // What the Build menu needs to know: factories owned here, the limit, the next one's price, blocks still needed.
  function info(map, pid) {
    const n = ownFactories(map, pid).length, owned = map.counts.get(pid) || 0, limit = fac.factoryLimit(owned);
    const per = D.factoryBlocksPerFactory, needBlocks = Math.max(0, (n + 1) * per - owned);
    // Why not, said before anything is placed (null when another one can go down).
    const reason = n < limit ? null : n === 0 ? `You need ${per} blocks for your first factory (you have ${owned}).`
      : `Own ${needBlocks} more blocks for another factory (you have ${owned}).`;
    return { count: n, limit, price: catalog.fromTenths(fac.priceTenths(map.level(), n + 1)), needBlocks, reason };
  }
  api.builders.add('factory', async (map, pid, { x, y }) => {
    const why = refusal(map, pid, x, y);
    if (why) return { error: why };
    const i = info(map, pid);
    if (i.reason) return { error: i.reason };
    const price = catalog.toTenths(i.price), awakeMs = valueOn(map, pid, api.blocks.levelAt(map, x, y), 'factories.lifetime') * HOUR;
    const r = await build({ mapId: map.id, playerId: pid, x, y, price, limit: i.limit, awakeMs });
    if (r.error) return { error: r.error, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) };
    const now = Date.now(), f = { id: r.id, owner: pid, x, y, built: now, awake: now + awakeMs, processed: fac.stepFloor(now), target: null };
    of(map).set(key(x, y), f);
    api.ticker.wake();   // a factory is awake: the tick has work
    api.money.changed(pid, r.squares);
    api.stats.bump(pid, 'squaresSpent', i.price);
    changed(map, f);
    return { ok: true, squares: catalog.fromTenths(r.squares) };
  }, (map, pid) => info(map, pid).reason);
  api.on('buildInfo', (map, pid) => ({ factory: info(map, pid) }));
  // Demolition removes a factory through the core.
  api.built.add('factory', {
    has: (map, x, y) => of(map).has(key(x, y)),
    remove: async (c, map, x, y) => {
      await c.query('UPDATE map_cells SET factory_id = NULL WHERE map_id = $1 AND x = $2 AND y = $3', [map.id, x, y]);
      await c.query('DELETE FROM factories WHERE map_id = $1 AND x = $2 AND y = $3', [map.id, x, y]);
    },
    removed: (map, x, y) => drop(map, key(x, y)),
  });

  // Wakes one of your factories: { x, y }. It works for its Factory Lifetime hours from now.
  api.socket('wake', async ({ me, map: here }, p, reply) => {
    if (typeof reply !== 'function') return;
    const f = p && of(here).get(key(p.x, p.y));
    if (!f || String(f.owner) !== String(me.pid)) return reply({ error: 'Not your factory' });
    try {
      await api.serial(here, async () => {
        const now = Date.now(), awakeMs = valueOn(here, f.owner, api.blocks.levelAt(here, f.x, f.y), 'factories.lifetime') * HOUR;
        await pool.query(`UPDATE factories SET awake_until = to_timestamp($3 / 1000.0),
          processed_at = GREATEST(processed_at, to_timestamp($4 / 1000.0)) WHERE id = $1 AND owner_id = $2`, [f.id, f.owner, now + awakeMs, fac.stepFloor(now)]);
        f.awake = now + awakeMs;
        f.processed = Math.max(f.processed, fac.stepFloor(now));
        api.ticker.wake();
        changed(here, f);
        reply({ ok: true, awakeUntil: f.awake });
      });
    } catch { reply({ error: 'Could not wake it. Try again.' }); }
  });

  // ---------- Working ----------
  // `secs` of work by factory f (loop 18: whole hits, so watchers see each one). It hits its target until it's
  // taken: Factory Speed (capped at the target's level) x the base player rate, in hits a second; the fraction of a
  // hit carries to the next second. The closest target is chosen again each minute, after each block it takes, and
  // whenever its target stops being one. Answers whether it took a block.
  async function work(map, f, secs, t) {
    const pick = () => (f.target = fac.chooseTarget(map, f.owner, f.x, f.y, `${map.seed}:${f.x},${f.y}`));   // ties: the same seeded order every time
    if (!f.target || t % 60000 === 0 || !fac.stillTarget(map, f.owner, f.target)) pick();
    if (!f.target) { f.charge = 0; return false; }   // nothing to mine: it idles
    f.charge = (f.charge ?? 0) + fac.hitsPerSecond(valueOn(map, f.owner, api.blocks.levelAt(map, f.target.x, f.target.y), 'factories.speed')) * secs;
    let hits = Math.floor(f.charge + 1e-9), took = false;
    f.charge = Math.max(0, f.charge - hits);
    while (hits > 0) {
      const tg = f.target, k = key(tg.x, tg.y), need = fac.hitsFor(map, tg.x, tg.y, f.x, f.y, map.level());
      let h = map.hits.get(k);
      if (!h || h.by !== f.owner) h = { by: f.owner, n: 0 };   // another player's progress doesn't count
      Object.assign(h, { keep: true, need, at: Date.now() });   // a factory's progress never fades (its hits can be hours apart)
      const use = Math.min(hits, Math.max(1, Math.ceil(need - h.n - 1e-9)));
      h.n += use;
      hits -= use;
      if (!rules.isTaken(h.n, need)) {
        map.hits.set(k, h);
        api.cracks.show(map, { x: tg.x, y: tg.y, p: api.cracks.share(h) });
        return took;
      }
      map.hits.delete(k);
      // The same claim as a player's, paying its owner Factory Yield (capped at the block's pay).
      const pay = fac.yieldTenths(valueOn(map, f.owner, api.blocks.levelAt(map, tg.x, tg.y), 'factories.yield'), map, tg.x, tg.y);
      if (!(await api.blocks.claim(map, f.owner, tg.x, tg.y, pay))) return took;
      took = true;
      if (!pick()) { f.charge = 0; return took; }
    }
    return took;
  }
  // Brings every factory on a map up to `until` (a step boundary), one step (a second) at a time in time order, so a
  // long sleep gives exactly what running live would. `save`: write where each got to (the tick does; the live loop,
  // every second while someone watches, doesn't, to spare the database).
  async function run(map, until, { save = true } = {}) {
    const STEP = fac.STEP_MS(), list = [...of(map).values()].sort((a, b) => a.id - b.id);
    const here = f => of(map).get(key(f.x, f.y)) === f;
    // Asleep factories skip ahead: nothing happens until they're woken.
    const skipAsleep = f => { if (f.awake <= f.processed && f.processed < until) f.processed = until; };
    list.forEach(skipAsleep);
    const next = () => Math.min(...list.filter(f => here(f) && f.processed < until).map(f => f.processed));
    let paused = null;   // owner -> paused ids, worked out again after any claim
    const isPaused = f => (paused ??= new Map()).get(f.owner)?.has(f.id) ?? paused.set(f.owner, pausedOn(map, f.owner)).get(f.owner).has(f.id);
    for (let t = next(); t < until; t = next()) {
      for (const f of list) {
        if (f.processed !== t || !here(f)) continue;
        const secs = Math.max(0, Math.min(t + STEP, f.awake) - t) / 1000;
        if (secs > 0 && !isPaused(f) && map.players.has(f.owner) && await work(map, f, secs, t)) paused = null;
        f.processed = t + STEP;
        skipAsleep(f);
      }
    }
    if (!save) return;
    const saved = list.filter(here).map(f => {
      const h = f.target && map.hits.get(key(f.target.x, f.target.y));
      return { id: f.id, processed: f.processed, tx: f.target?.x ?? null, ty: f.target?.y ?? null, progress: h?.keep && h.by === f.owner ? h.n : 0 };
    });
    if (saved.length) {
      await pool.query(`UPDATE factories f SET processed_at = to_timestamp(v.p / 1000.0), target_x = v.tx, target_y = v.ty, progress = v.g
        FROM unnest($1::bigint[], $2::float8[], $3::int[], $4::int[], $5::float8[]) AS v(id, p, tx, ty, g) WHERE f.id = v.id`,
      [saved.map(s => s.id), saved.map(s => s.processed), saved.map(s => s.tx), saved.map(s => s.ty), saved.map(s => s.progress)]);
    }
    for (const f of list) if (here(f)) changed(map, f);
  }
  // Live (loop 18): every second, each map someone is watching runs its factories up to now, so every hit shows.
  // The tick below still catches up maps nobody watches, and saves.
  api.on('live', (map, now) => {
    if (!of(map).size || map.liveRun) return null;
    map.liveRun = true;
    return api.serial(map, () => run(map, fac.stepFloor(now), { save: false }))
      .catch(err => console.error(`LIVE FACTORIES FAILED (map ${map.id}): ${err.message}`)).finally(() => { map.liveRun = false; });
  });
  // The tick: every map with factories still to bring up to date (loaded if it isn't). With no factory awake anywhere
  // it says 'idle' (the tick then spares the database until a factory is built or woken).
  api.ticker.on(async function factoriesTick(from, to) {
    const until = fac.stepFloor(to);
    const { rows } = await pool.query(`SELECT map_id, bool_or(processed_at < LEAST(awake_until, to_timestamp($1 / 1000.0))) AS due,
      bool_or(awake_until > to_timestamp($2 / 1000.0)) AS awake FROM factories GROUP BY map_id`, [until, to]);
    for (const { map_id: id } of rows.filter(r => r.due)) {
      const map = await api.getMap(id);
      if (map) await api.serial(map, () => run(map, until));
    }
    return rows.some(r => r.awake) ? null : 'idle';
  });

  // ---------- The database ----------
  // Builds a factory on the player's own block for `price` tenths, in one transaction with the player row locked,
  // so two at once can't both pass the check: the block must be theirs, not for sale and empty of factories, and they
  // must still be under their limit (`limit`: how many they may have on this map). Returns the factory row or { error }.
  const build = ({ mapId, playerId, x, y, price, limit, awakeMs, now = Date.now() }) => api.tx(async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const { rows: [cell] } = await c.query('SELECT owner_id, factory_id, listing_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3 FOR UPDATE', [mapId, x, y]);
    if (!cell || String(cell.owner_id) !== String(playerId)) return { error: 'Only on your own land' };
    if (cell.factory_id) return { error: 'There is a factory here already' };
    if (cell.listing_id) return { error: 'Not on land for sale' };
    const { rows: [n] } = await c.query('SELECT count(*)::int AS n FROM factories WHERE map_id = $1 AND owner_id = $2', [mapId, playerId]);
    if (n.n >= limit) return { error: 'You have all the factories your land allows' };
    const paid = await api.spend(c, playerId, price, 'build:factory');
    if (paid.error) return paid;
    const { rows: [f] } = await c.query(`INSERT INTO factories (map_id, owner_id, x, y, built_at, awake_until, processed_at)
      VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0)) RETURNING id`,
    [mapId, playerId, x, y, now, now + awakeMs, fac.stepFloor(now)]);
    await c.query('UPDATE map_cells SET factory_id = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y, f.id]);
    return { id: f.id, squares: paid.squares };
  });

  // ---------- The Game Guide ----------
  api.on('guide', ({ n, E }) => {
    const price = k => catalog.fromTenths(fac.priceTenths(1, k));
    return { id: 'factories', title: text.name, html: `<h2 id="factories">${text.name}</h2>
    <p>Build one on your own land (Build → Factory). It mines the closest empty block touching your land, on its own, even while you're away,
      at (${rules.HITS_PER_BLOCK} ÷ ${n(E.baseBlockSeconds)}) × Factory Speed hits a second. Outside its ${D.factoryAreaSize}×${D.factoryAreaSize}
      home square each block of distance adds ${n(D.factoryDistancePenaltyWh)} × W(L) × ${n(E.hitsPerSquare)} hits. Each block it mines pays
      Factory Yield squares (never more than the block's own pay). After waking it works for Factory Lifetime hours, then sleeps until you wake it
      from its info card.</p>
    <p class="formula">Price of your nth factory = ${n(D.factoryBuildPaybackHours)} × ${n(D.factoryValuePerHour)} × W(L) × ${n(D.factoryBuildGrowth)}^(n−1)</p>
    <p>You may have 1 factory per ${D.factoryBlocksPerFactory} blocks you own; if your land shrinks, your newest ones pause. Level 1 prices:
      ${[1, 2, 3, 4, 5].map(k => `#${k}: ${n(price(k), 1)}`).join(', ')}.</p>` };
  });
};
