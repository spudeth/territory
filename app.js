const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Server } = require('socket.io');
const store = require('./store');
const { adminRouter, bannedMessage } = require('./admin');
const rules = require('./rules');
const catalog = require('./catalog');
const upgrades = require('./upgrades');
const { createTicker } = require('./ticker');
const pluginHost = require('./plugins');
const { tx } = require('./db');
const variables = require('./variables');
const path = require('path');
const fac = require('./factories');
const { renderGuide } = require('./guide');
const chat = require('./chat');
const terrain = require('./public/terrain');
// How each skin is drawn, for the browser: { id: 'pattern' | 'art' }.
const SKIN_KINDS = Object.fromEntries(rules.SKINS.map(s => [s.id, s.kind]));
const stats = require('./stats');
const achievements = require('./achievements');
const { createTotals } = require('./totals');
const { createEmail } = require('./email');
const { guestName, guestNames, checkName } = require('./names');

const { key } = rules;
// A player's upgrade steps ({ key: steps }, missing = 0). What they give on a level-L block: tiersOn(steps, L), each
// upgrade capped at the end of tier L (loop 18: the block's level, not the map's).
const upgradesOf = row => ({ ...(row.upgrade_steps ?? {}) });
const tiersOn = (steps, L) => upgrades.effectiveValues(steps, L);

// Behind Render the socket address is a proxy's. Cloudflare (in front of every public Render service) sets
// CF-Connecting-IP and overwrites any value the visitor sends, so prefer it. X-Forwarded-For is only a fallback:
// Render appends to it without clearing it, so its first entry can be forged.
function clientIp(headers, address) {
  return headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0].trim() || address;
}

// Counts recent guest creations per IP address, in memory.
function guestLimiter(limit, windowMs) {
  const seen = new Map();   // ip -> creation times
  const recent = ip => (seen.get(ip) || []).filter(t => Date.now() - t < windowMs);
  return {
    allowed: ip => recent(ip).length < limit,
    record: ip => seen.set(ip, [...recent(ip), Date.now()]),
  };
}

// The game server. Postgres is the source of truth; each map is cached in memory once loaded, and the cache is
// only changed after a database write commits. Claims and wipes on one map run one at a time.
//   auth:      from createAuth(), or null to run with guests only
//   publicUrl: the site's address (https://territory.sarl); requests for any other host, such as www or
//              the onrender.com address, are sent there. Unset locally.
function createGame(pool, { startTicker = false, email = createEmail(), achievementList = achievements.DEFINITIONS, guestsPerIp = rules.GUESTS_PER_IP, crackDecayMs = rules.CRACK_DECAY_SECONDS * 1000,
  auth = null, publicUrl = null, tapsPerSecond = null, tapLogMs = 60 * 1000, adminKey = null, plugins = null, pluginDir = pluginHost.DIR } = {}) {
  // plugins: the plug-in folders to load (names), or null for every folder in pluginDir (loop 19; tests use a fixture folder).
  // adminKey: the secret npm run admin must send (ADMIN_KEY); without it, admin commands are off.
  // The server counts as production when it has a publicUrl; admin commands then need --prod.
  // tapsPerSecond: the tap-rate limit, or null for rules.MAX_TAPS_PER_SECOND (tests that tap like a bot raise it)
  const app = express();
  app.set('trust proxy', true);   // so req.protocol is https behind Render
  if (publicUrl) {
    const site = new URL(publicUrl);
    app.use((req, res, next) => {
      if (req.hostname === site.hostname || req.hostname === 'localhost') return next();
      res.redirect(301, site.origin + req.originalUrl);
    });
  }
  // The IP address the server sees for you, to check the per-IP guest limit works behind the custom domain.
  app.get('/api/ip', (req, res) => res.json({ ip: clientIp(req.headers, req.socket.remoteAddress) }));
  if (auth) app.use(auth.router);
  // The one-click unsubscribe link from every email: no login needed (loop 15).
  // The Game Guide: public, built from data/economy.json on every visit (guide.js).
  app.get('/guide', async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT name, base_blocks::float AS base FROM maps WHERE type = 'official' ORDER BY id");
      res.type('html').send(renderGuide({ maps: rows, pluginSections: helpers => hooks.collect('guide', helpers) }));
    } catch (err) {
      console.error(`GUIDE FAILED: ${err.message}`);
      res.status(500).type('text').send('The guide could not load. Try again in a moment.');
    }
  });

  app.get('/unsubscribe', async (req, res) => {
    const r = await store.unsubscribeByToken(pool, req.query.t).catch(() => null);
    if (r?.email) email.sync(r.email, false).catch(err => console.error(`AUDIENCE SYNC FAILED: ${err.message}`));
    res.status(r ? 200 : 404).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Territory</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Pixelify+Sans:wght@400;600&display=swap">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f131a;color:#f2f4f8;font:17px 'Pixelify Sans',system-ui;padding:16px;box-sizing:border-box}
div{background:#1b2230;padding:24px;max-width:420px;box-shadow:0 0 0 3px #0a0d12,4px 4px 0 3px #0a0d12;text-align:center}h1{font:14px/1.6 'Press Start 2P',monospace;color:#f7c948;margin:0 0 12px}a{color:#f7c948}</style>
<div><h1>${r ? "YOU'RE UNSUBSCRIBED" : 'LINK NOT FOUND'}</h1><p>${r ? "You won't get any more update emails from Territory. You can join again any time in Settings." : 'This unsubscribe link is not valid. You can turn emails off in Settings.'}</p><p><a href="/">Back to the game</a></p></div>`);
  });
  app.use('/admin', adminRouter({ pool, key: adminKey, production: !!publicUrl, hooks: adminHooks(), email }));
  // Browsers check every file for a newer version (a quick "not modified" when unchanged), so after an update
  // nobody keeps running old game code from their cache. Also serves /privacy and /terms.
  app.use(express.static(__dirname + '/public', { extensions: ['html'], setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

  // Plug-ins (loop 19): only their browser files and look/ are served, never their server code.
  const loadedPlugins = pluginHost.list({ dir: pluginDir, names: plugins });
  const hooks = pluginHost.createHooks();
  for (const p of loadedPlugins) {
    for (const f of p.client) app.get(`/plugins/${p.name}/${f}`, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(p.dir, f)));
    app.use(`/plugins/${p.name}/look`, express.static(path.join(p.dir, 'look'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
  }
  // The variables this game has (the core's and its plug-ins'), and so the upgrades that show: those changing one.
  const known = variables.declared(loadedPlugins);
  const shownUpgrades = new Set(upgrades.available(known));
  // Plug-in socket events, named "<plug-in>:<event>": [[name, handler(ctx, …args)]], added to every connection.
  const pluginEvents = [];

  const server = http.createServer(app);
  // Large messages (the whole map on joining: 1.4 MB at 100,000 blocks) are compressed, fast setting, to about
  // a fifth. Small ones (hits, claims) are sent as they are.
  const io = new Server(server, { perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 1 } } });
  const limiter = guestLimiter(guestsPerIp, rules.GUEST_WINDOW_MINUTES * 60 * 1000);

  // The tap-rate limit (anti-bot): taps over the rate are ignored (rules.tapAllowed). Each minute, players who
  // went over are written to tap_limit_log and the server log, so bots can be spotted later. No bans yet.
  const taps = new Map();      // player id (or 'visitor:<socket>') -> token bucket
  const ignoredTaps = new Map();
  const tapLog = setInterval(() => {
    const over = [...ignoredTaps].filter(([who]) => !String(who).startsWith('visitor:'));
    for (const [who, n] of ignoredTaps) console.log(`TAP LIMIT: ${who} had ${n} tap${n === 1 ? '' : 's'} ignored`);
    ignoredTaps.clear();
    for (const [who, b] of taps) if (Date.now() - b.at > 60 * 1000) taps.delete(who);
    if (over.length) store.logTapLimits(pool, over).catch(err => console.error(`TAP LOG FAILED: ${err.message}`));
  }, tapLogMs);
  tapLog.unref();

  // In-memory copy of each loaded map:
  //   cells:   "x,y" -> owner id or null    players: id -> { name, color, skin, coverage, unlocked, wipeFloor, upgrades }
  //   counts:  owner id -> blocks owned      hits:    "x,y" -> { by, n, need, at } (crack progress in hits, never saved)
  const maps = new Map();     // id -> Promise of the map
  const loaded = new Set();   // the maps that have finished loading
  const chats = new Map();    // map id -> its last chat.HISTORY messages (memory only; kept when a map reloads)
  const lastChat = new Map(); // player id -> when they last sent a message (chat.MIN_GAP_MS)
  function getMap(id) {
    if (!maps.has(id)) {
      maps.set(id, store.loadMap(pool, id).then(m => {
        if (!m) return null;
        // terrainAt(x, y): a seeded map's terrain (public/terrain.js); maps without a seed are all grass.
        // White maps never have terrain, even with a seed (one was made with a random seed by mistake).
        const world = m.seed && m.style !== 'white' ? terrain.makeWorld(m.seed, rules.TERRAIN) : null;
        // Terraformer changes (a block's own terrain) win over the seed's terrain.
        const overrides = new Map(m.overrides.map(o => [key(o.x, o.y), o.terrain]));
        // base: E (its starting size, fixed forever); mined: first claims so far. Level: catalog.level(mined, base).
        const map = { id: m.id, name: m.name, style: m.style, seed: m.seed, overrides, base: m.base, mined: m.mined,
          level: () => catalog.level(map.mined, map.base),
          terrainAt: (x, y) => overrides.get(key(x, y)) ?? (world ? world.at(x, y) : 'grass'),
          room: 'map:' + m.id, cells: new Map(), counts: new Map(), birth: new Map(),   // birth: "x,y" -> level, when above 1
          players: new Map(m.players.map(p => [p.player_id, { name: p.name, color: p.color, skin: p.skin_id, coverage: p.coverage,
            unlocked: p.unlocked, wipeFloor: p.wipe_floor, upgrades: upgradesOf(p) }])),
          hits: new Map(), claiming: new Set(), queue: Promise.resolve() };
        for (const c of m.cells) {
          map.cells.set(key(c.x, c.y), c.owner_id);
          if (c.birth_level > 1) map.birth.set(key(c.x, c.y), c.birth_level);
          if (c.owner_id) map.counts.set(c.owner_id, (map.counts.get(c.owner_id) || 0) + 1);
        }
        // Plug-ins keep their own state on the map (loop 19): they get its rows once it's loaded. blocked(x, y, side):
        // whether anything a plug-in built (a wall) stops crossing that side of (x, y).
        map.blocked = (x, y, side) => hooks.first('blocked', map, x, y, side) === true;
        hooks.runSync('mapLoaded', map, m.cells);
        // Factories: "x,y" -> { id, owner, x, y, built, awake (ms), processed (ms), target }. Their saved progress is
        // a crack on the target, tagged `factory` (it never fades).
        map.listings = new Map();
        map.listingInfo = new Map();
        for (const l of m.listings) {
          const info = { id: l.id, seller: l.seller_id, price: Number(l.price), created: Number(l.created), blocks: l.xs.map((x, i) => [x, l.ys[i]]) };
          map.listingInfo.set(l.id, info);
          for (const [x, y] of info.blocks) map.listings.set(key(x, y), l.id);
        }
        map.factories = new Map();
        for (const r of m.factories) {
          const f = { id: r.id, owner: r.owner_id, x: r.x, y: r.y, built: Number(r.built), awake: Number(r.awake), processed: Number(r.processed),
            target: r.target_x === null ? null : { x: r.target_x, y: r.target_y } };
          map.factories.set(key(r.x, r.y), f);
          if (f.target && r.progress > 0) map.hits.set(key(f.target.x, f.target.y), { by: f.owner, n: r.progress, at: Date.now(), factory: true,
            need: fac.hitsFor(map, f.target.x, f.target.y, f.x, f.y, map.level()) });
        }
        // Stats as saved, with squares and lines recomputed from the map in case they are behind.
        map.stats = new Map(m.stats.map(r => [r.player_id, { ownedMax: r.owned_max, firstClaims: r.first_claims,
          retakes: r.retakes, blocksLost: r.blocks_lost, bestSquare: r.best_square, bestLine: r.best_line }]));
        for (const [pid, best] of stats.bestOnMap(map.cells)) {
          const st = statsOf(map, pid);
          st.bestSquare = Math.max(st.bestSquare, best.bestSquare);
          st.bestLine = Math.max(st.bestLine, best.bestLine);
        }
        loaded.add(map);
        return map;
      }).catch(err => { maps.delete(id); throw err; }));
    }
    return maps.get(id);
  }
  let defaultMap;
  const getDefaultMapId = () => (defaultMap ??= store.defaultMapId(pool).catch(err => { defaultMap = null; throw err; }));

  // Stats (stats.js) per player per map, in memory, saved with each claim. Every change is announced as a
  // 'stat' event: on `events` for the server (achievements), and to the player's own browsers.
  // 'owned' (blocks owned now) is announced too, though it is counted from the map rather than stored.
  const events = new EventEmitter();
  const statsOf = (map, pid) => map.stats.get(pid) ?? map.stats.set(pid, stats.empty()).get(pid);
  function statChanged(map, pid, name, value) {
    events.emit('stat', { mapId: map.id, pid, name, value });
    io.to('player:' + pid).emit('stat', { map: map.id, name, value });
  }

  // Achievements: checked on every stat event. Each player's earned ids are loaded once and kept in memory.
  // An earned achievement is saved, then announced as 'achievement' on `events` and to the player's browsers.
  const byStat = achievements.index(achievementList);
  const earned = new Map();   // pid -> Promise of a Set of ids
  const earnedBy = pid => {
    if (!earned.has(pid)) {
      earned.set(pid, store.earnedAchievements(pool, pid).then(ids => new Set(ids))
        .catch(err => { earned.delete(pid); throw err; }));
    }
    return earned.get(pid);
  };
  const checks = new Map();   // pid -> the player's queue of checks: one at a time per player, players in parallel
  // Each one earned pays its reward in squares; earning also counts toward the Collector achievements.
  const knownIds = new Set(achievementList.map(d => d.id));
  events.on('stat', ({ mapId = null, pid, name, value }) => {
    if (!pid || !byStat.has(name)) return;
    const queued = (checks.get(pid) ?? Promise.resolve()).then(async () => {
      const have = await earnedBy(pid);
      const hits = achievements.reached(byStat, name, value, have);
      if (!hits.length) return;
      // A deadlock with a claim at the same moment is retried once rather than losing the achievement.
      const earn = () => store.earnAchievements(pool, pid, mapId, hits.map(d => d.id), Object.fromEntries(hits.map(d => [d.id, d.reward])));
      const r = await earn().catch(err => { if (err.code === '40P01') return earn(); throw err; });
      const fresh = new Set(r.fresh);
      let secrets = 0;
      for (const d of hits) {
        have.add(d.id);
        if (!fresh.has(d.id)) continue;
        if (d.secret) secrets++;
        const a = { id: d.id, name: d.name, category: d.category, description: d.description, reward: d.reward, secret: d.secret,
          stat: d.stat, threshold: d.threshold, mapId };
        events.emit('achievement', { pid, ...a });
        io.to('player:' + pid).emit('achievement', a);
      }
      if (r.squares !== null) balanceChanged(pid, r.squares);
      if (fresh.size) totals.best(pid, 'achievements', [...have].filter(id => knownIds.has(id)).length);
      if (secrets) totals.bump(pid, 'secrets', secrets);
    }).catch(err => console.error(`ACHIEVEMENT CHECK FAILED (player ${pid}): ${err.message}`));
    checks.set(pid, queued);
    queued.then(() => { if (checks.get(pid) === queued) checks.delete(pid); });
  });

  // The server tick (ticker.js): factories and timers, caught up after every sleep.
  const ticker = createTicker(pool, { seconds: catalog.E.tickSeconds });

  // Lifetime totals (totals.js), checked like any other stat.
  const totals = createTotals(pool, { onStat: (pid, name, value) => events.emit('stat', { pid, name, value }) });

  // A player's balance changed (claims, purchases, rewards, admin): every device, and the Saving achievements.
  function balanceChanged(pid, balance) {
    for (const s of io.sockets.sockets.values()) if (String(s.data.me?.pid) === String(pid)) s.data.me.squares = balance;
    io.to('player:' + pid).emit('squares', catalog.fromTenths(balance));
    totals.best(pid, 'squaresHeld', rules.shownSquares(balance));
    if (rules.shownSquares(balance) === 1337) totals.best(pid, 'secret:leet', 1);
  }

  // A block as the info card shows it, for player `pid` (with `upgrades`): coordinates, terrain, level and
  // hardness; its pay if mined, or the hits to take it; its owner. Later phases add walls, factories, listings.
  function blockInfo(map, x, y, pid, steps) {
    const k = key(x, y), owner = map.cells.get(k) ?? null, terrain = map.terrainAt(x, y), level = map.birth.get(k) ?? 1;
    const H = rules.hardness(terrain, level);
    const info = { x, y, terrain, level, hardness: H, owner: owner && { pid: owner, name: map.players.get(owner)?.name ?? null } };
    if (terrain === 'water') info.water = true;
    else if (owner === null) info.pay = catalog.fromTenths(rules.firstClaimTenths(tiersOn(steps, level), terrain, level));
    else if (String(owner) !== String(pid)) info.hits = rules.hitsNeeded(tiersOn(map.players.get(owner)?.upgrades, level), terrain, level);
    const f = map.factories.get(k);
    if (f) info.factory = { ...factoryOut(map, f), mine: String(f.owner) === String(pid), target: f.target, perHour: factoryPerHour(map, f) };
    if (map.listings.has(k)) info.listing = { ...listingOut(map, map.listingInfo.get(map.listings.get(k))), mine: String(map.listingInfo.get(map.listings.get(k)).seller) === String(pid) };
    for (const part of hooks.collect('blockInfo', map, x, y, pid)) Object.assign(info, part);   // plug-ins' parts (walls, …)
    return info;
  }

  // Every upgrade: [{ key, name, type, unit, about, start, max1, mult, gain, steps (a tier), tiers: [{ tier, from, to, cost: the
  // whole tier in squares }] }]: enough for the screen to work out any step's value (upgrades.stepValue). Worked out once.
  let upgradeListCache = null;
  const upgradeList = () => (upgradeListCache ??= Object.entries(catalog.CATALOG_TIERS).filter(([key]) => shownUpgrades.has(key)).map(([key, u]) => ({ key, name: u.name, type: u.type, unit: u.unit, about: u.about,
    start: u.start, max1: u.max1, mult: u.mult, gain: u.gainCurve, steps: u.steps,
    tiers: Array.from({ length: u.tiers }, (_, i) => ({ tier: i + 1, from: upgrades.lo(key, i + 1), to: upgrades.hi(key, i + 1), cost: catalog.fromTenths(upgrades.tierCostTenths(key, i + 1)) })) })));
  // For one upgrade at `s` steps: the next step's value and price (squares), or null at the top.
  const nextPrices = (key, s) => s >= upgrades.topStep(key) ? null
    : { value: upgrades.stepValue(key, s + 1), price: catalog.fromTenths(upgrades.stepCostTenths(key, s + 1)), tier: upgrades.tierOfStep(key, s + 1) };

  // Growth's fractional part is a chance of one more block: a seeded roll, so the same map and claims grow the same way.
  const growRoll = (map, x, y) => fac.tieRank(`grow:${map.seed}:${map.mined}`, x, y) / 4294967296;

  // ---------- Factories (loop 16; the rules are in factories.js) ----------
  // The owner's upgrades on a level-L block (a factory's target; for its lifetime, the block it stands on).
  const ownerValues = (map, owner, L) => tiersOn(map.players.get(owner)?.upgrades, L);
  const levelAt = (map, x, y) => map.birth.get(key(x, y)) ?? 1;
  // New blocks an hour a factory mines (its info card): its rate on its target (or the one it would pick next),
  // over that block's hits. 0 with nothing to mine.
  function factoryPerHour(map, f) {
    const t = f.target && fac.stillTarget(map, f.owner, f.target) ? f.target : fac.chooseTarget(map, f.owner, f.x, f.y, `${map.seed}:${f.x},${f.y}`);
    if (!t) return 0;
    const rate = fac.hitsPerSecond(ownerValues(map, f.owner, levelAt(map, t.x, t.y))['factories.speed']);
    return rate * 3600 / fac.hitsFor(map, t.x, t.y, f.x, f.y, map.level());
  }
  const ownFactories = (map, owner) => [...map.factories.values()].filter(f => String(f.owner) === String(owner));
  // The owner's newest factories pause while their land is below the limit.
  const pausedOn = (map, owner) => fac.pausedIds(ownFactories(map, owner).map(f => ({ id: f.id, builtAt: f.built })), map.counts.get(owner) || 0);
  const factoryOut = (map, f) => ({ x: f.x, y: f.y, owner: f.owner, awakeUntil: f.awake, paused: pausedOn(map, f.owner).has(f.id) });
  function dropFactory(map, k) {
    const f = map.factories.get(k);
    if (!f) return;
    map.factories.delete(k);
    io.to(map.room).emit('factory', { x: f.x, y: f.y, gone: true });
  }
  // Why a factory can't go on (x, y) for `pid`, or null.
  function factoryRefusal(map, pid, x, y) {
    const k = key(x, y);
    if (map.cells.get(k) !== pid) return 'Only on your own land';
    if (map.terrainAt(x, y) === 'water') return 'Not on water';
    if (map.factories.has(k)) return 'There is a factory here already';
    if (map.listings?.has(k)) return 'Not on land for sale';
    return null;
  }
  // What the Build menu needs to know: factories owned here, the limit, the next one's price, blocks still needed.
  function factoryInfo(map, pid) {
    const n = ownFactories(map, pid).length, owned = map.counts.get(pid) || 0, limit = fac.factoryLimit(owned);
    const per = catalog.E.factoryBlocksPerFactory, needBlocks = Math.max(0, (n + 1) * per - owned);
    // Why not, said before anything is placed (null when another one can go down).
    const reason = n < limit ? null : n === 0 ? `You need ${per} blocks for your first factory (you have ${owned}).`
      : `Own ${needBlocks} more blocks for another factory (you have ${owned}).`;
    return { count: n, limit, price: catalog.fromTenths(catalog.priceTenths(catalog.CATALOG.get('building:factory'), { L: map.level(), n: n + 1 })), needBlocks, reason };
  }
  // Why each Build tool can't be used now, or null: shown when the tool is picked, before any ghost.
  async function buildReasons(map, pid) {
    const owned = map.counts.get(pid) || 0;
    const { rows: [p] } = await pool.query('SELECT auth_user_id IS NOT NULL AS account, created_at > now() - make_interval(secs => $2 * 86400) AS young FROM players WHERE id = $1',
      [pid, catalog.E.marketMinAccountDays]);
    return {
      // Each building tool's own reason (builders[kind].reason), then the land market's.
      ...Object.fromEntries(Object.entries(builders).map(([kind, b]) => [kind, b.reason?.(map, pid) ?? null])),
      sell: !p?.account ? 'Only accounts can buy and sell land.' : p.young ? `Accounts can trade land once they are ${catalog.E.marketMinAccountDays} days old.`
        : owned ? null : 'You have no land on this map to sell.',
    };
  }
  // What can be built: { kind: async (map, pid, request) -> answer }. Walls add themselves.
  const builders = {
    async factory(map, pid, { x, y }) {
      const refusal = factoryRefusal(map, pid, x, y);
      if (refusal) return { error: refusal };
      const info = factoryInfo(map, pid);
      if (info.reason) return { error: info.reason };
      const price = catalog.toTenths(info.price), awakeMs = ownerValues(map, pid, levelAt(map, x, y))['factories.lifetime'] * 3600000;
      const r = await store.buildFactory(pool, { mapId: map.id, playerId: pid, x, y, price, limit: info.limit, awakeMs });
      if (r.error) return { error: r.error, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) };
      const now = Date.now(), f = { id: r.id, owner: pid, x, y, built: now, awake: now + awakeMs, processed: fac.stepFloor(now), target: null };
      map.factories.set(key(x, y), f);
      balanceChanged(pid, r.squares);
      totals.bump(pid, 'squaresSpent', info.price);
      io.to(map.room).emit('factory', factoryOut(map, f));
      return { ok: true, squares: catalog.fromTenths(r.squares) };
    },
  };

  builders.factory.reason = (map, pid) => factoryInfo(map, pid).reason;
  // ---------- The land market ----------
  // A listing as players see it: size, price (squares), seller, the levels of its blocks, its blocks.
  function listingOut(map, l) {
    const levels = l.blocks.map(([x, y]) => map.birth.get(key(x, y)) ?? 1);
    return { id: l.id, seller: { pid: l.seller, name: map.players.get(l.seller)?.name ?? null }, price: catalog.fromTenths(l.price), size: l.blocks.length,
      levels: [Math.min(...levels), Math.max(...levels)], blocks: l.blocks };
  }
  // A listing ends (cancelled, attacked, a block lost): in memory and for everyone. The database is done already
  // when a block was freed or taken; cancelling saves it.
  function dropListing(map, id) {
    const l = map.listingInfo.get(id);
    if (!l) return;
    map.listingInfo.delete(id);
    for (const [x, y] of l.blocks) map.listings.delete(key(x, y));
    io.to(map.room).emit('listing', { id, gone: true });
  }
  async function cancelListingNow(map, id) {
    if (!map.listingInfo.has(id)) return;
    await store.cancelListing(pool, id);
    dropListing(map, id);
  }

  // A factory took (x, y): the same claim as a player's, paying its owner Factory Yield (capped at the block's pay).
  async function factoryClaim(map, f, x, y) {
    const owner = f.owner, k = key(x, y), level = map.birth.get(k) ?? 1, eff = ownerValues(map, owner, level);
    const r = await store.claimBlock(pool, { mapId: map.id, x, y, from: null, playerId: owner, newGuest: null, color: null,
      grow: rules.growthBlocks(eff, growRoll(map, x, y)), birth: catalog.level(map.mined + 1, map.base), level, earn: fac.yieldTenths(eff['factories.yield'], map, x, y) });
    if (r.conflict) {
      setOwner(map, k, await store.cellOwner(pool, map.id, x, y));
      io.to(map.room).emit('claim', { x, y, pid: map.cells.get(k) });
      return false;
    }
    setOwner(map, k, owner);
    io.to(map.room).emit('claim', { x, y, pid: owner });
    for (const g of r.grown) {
      map.cells.set(key(g.x, g.y), null);
      if (g.l > 1) map.birth.set(key(g.x, g.y), g.l);
      io.to(map.room).emit('grow', g);
    }
    mapMined(map);
    if (r.squares !== null) balanceChanged(owner, r.squares);
    statChanged(map, owner, 'owned', map.counts.get(owner));
    totals.bump(owner, 'claims');
    if (level > 1) for (const s of io.sockets.sockets.values()) if (String(s.data.me?.pid) === String(owner) && (s.data.me.highest ?? 1) < level) s.data.me.highest = level;
    return true;
  }
  // `secs` of work by factory f (loop 18: whole hits, so watchers see each one). It hits its target until it's
  // taken: Factory Speed (capped at the target's level) x the base player rate, in hits a second; the fraction of a
  // hit carries to the next second. The closest target is chosen again each minute, after each block it takes, and
  // whenever its target stops being one. Answers whether it took a block.
  async function factoryWork(map, f, secs, t) {
    const pick = () => (f.target = fac.chooseTarget(map, f.owner, f.x, f.y, `${map.seed}:${f.x},${f.y}`));   // ties: the same seeded order every time
    if (!f.target || t % 60000 === 0 || !fac.stillTarget(map, f.owner, f.target)) pick();
    if (!f.target) { f.charge = 0; return false; }   // nothing to mine: it idles
    f.charge = (f.charge ?? 0) + fac.hitsPerSecond(ownerValues(map, f.owner, levelAt(map, f.target.x, f.target.y))['factories.speed']) * secs;
    let hits = Math.floor(f.charge + 1e-9), took = false;
    f.charge = Math.max(0, f.charge - hits);
    while (hits > 0) {
      const tg = f.target, k = key(tg.x, tg.y), need = fac.hitsFor(map, tg.x, tg.y, f.x, f.y, map.level());
      let h = map.hits.get(k);
      if (!h || h.by !== f.owner) h = { by: f.owner, n: 0 };   // another player's progress doesn't count
      Object.assign(h, { factory: true, need, at: Date.now() });
      const use = Math.min(hits, Math.max(1, Math.ceil(need - h.n - 1e-9)));
      h.n += use;
      hits -= use;
      if (!rules.isTaken(h.n, need)) {
        map.hits.set(k, h);
        io.to(map.room).emit('hit', { x: tg.x, y: tg.y, p: share(h) });
        return took;
      }
      map.hits.delete(k);
      if (!(await factoryClaim(map, f, tg.x, tg.y))) return took;
      took = true;
      if (!pick()) { f.charge = 0; return took; }
    }
    return took;
  }
  // Brings every factory on a map up to `until` (a step boundary), one step (a second) at a time in time order, so a
  // long sleep gives exactly what running live would. `save`: write where each got to (the tick does; the live loop,
  // every second while someone watches, doesn't, to spare the database).
  async function runFactories(map, until, { save = true } = {}) {
    const STEP = fac.STEP_MS(), list = [...map.factories.values()].sort((a, b) => a.id - b.id);
    const here = f => map.factories.get(key(f.x, f.y)) === f;
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
        if (secs > 0 && !isPaused(f) && map.players.has(f.owner) && await factoryWork(map, f, secs, t)) paused = null;
        f.processed = t + STEP;
        skipAsleep(f);
      }
    }
    if (!save) return;
    await store.saveFactories(pool, list.filter(here).map(f => {
      const h = f.target && map.hits.get(key(f.target.x, f.target.y));
      return { id: f.id, processed: f.processed, tx: f.target?.x ?? null, ty: f.target?.y ?? null, progress: h?.factory && h.by === f.owner ? h.n : 0 };
    }));
    for (const f of list) if (here(f)) io.to(map.room).emit('factory', factoryOut(map, f));
  }
  // Live (loop 18): every second, each map someone is watching runs its factories up to now, so every hit shows.
  // `now` for tests. The tick below still catches up maps nobody watches, and saves.
  function liveFactories(now = Date.now()) {
    const until = fac.stepFloor(now), runs = [];
    for (const map of loaded) {
      if (!map.factories?.size || map.liveRun || !io.sockets.adapter.rooms.get(map.room)?.size) continue;
      map.liveRun = true;
      runs.push(serial(map, () => runFactories(map, until, { save: false }))
        .catch(err => console.error(`LIVE FACTORIES FAILED (map ${map.id}): ${err.message}`)).finally(() => { map.liveRun = false; }));
    }
    return Promise.all(runs);
  }
  const liveTimer = startTicker ? setInterval(liveFactories, fac.STEP_MS()) : null;
  liveTimer?.unref();
  // The tick: every map with factories still to bring up to date (loaded if it isn't).
  ticker.on(async function factoriesTick(from, to) {
    const until = fac.stepFloor(to);
    for (const id of await store.factoryMaps(pool, until)) {
      const map = await getMap(id);
      if (map) await serial(map, () => runFactories(map, until));
    }
  });

  // What's built on a block (loop 18; a core service since loop 19): { kind: { has(map, x, y), remove(client, map, x, y)
  // inside a transaction, removed(map, x, y) after it } }. Demolition clears a block through this, so it never touches
  // walls or factories itself. A new building is one more entry.
  const builtProviders = {
    factory: {
      has: (map, x, y) => map.factories.has(key(x, y)),
      remove: (c, map, x, y) => store.removeFactory(c, map.id, x, y),
      removed: (map, x, y) => dropFactory(map, key(x, y)),
    },
  };
  const builtOn = (map, x, y) => Object.values(builtProviders).filter(d => d.has(map, x, y));

  // A first claim on a map (by a player or a factory): its mined count goes up; everyone there sees the level's
  // progress (the level is worked out from mined and E).
  function mapMined(map) {
    map.mined++;
    io.to(map.room).emit('mapMined', map.mined);
  }


  // Every stat an achievement can use, as it stands now: lifetime totals, upgrade levels, records on any map,
  // maps played, achievements earned. For the Achievements screen, and to catch up on connecting.
  async function progressValues(pid, levels, account) {
    const [values, progress, played] = await Promise.all([totals.values(pid), store.achievementProgress(pool, pid), store.mapsPlayed(pool, pid)]);
    const out = { ...values, owned: progress.best.owned, bestSquare: progress.best.bestSquare, bestLine: progress.best.bestLine,
      mapsPlayed: played, achievements: progress.earned.filter(e => knownIds.has(e.id)).length };
    for (const k of Object.keys(catalog.CATALOG_TIERS)) out['level:' + k] = upgrades.tierOfStep(k, levels[k] ?? 0);   // each upgrade's tier
    out.tiers = Object.keys(catalog.CATALOG_TIERS).reduce((n, k) => n + (levels[k] ?? 0), 0);   // steps bought in all
    if (account) out.account = 1;
    return { values: out, earned: progress.earned };
  }
  // Earns anything a player has already reached (e.g. new achievements, or progress from before they existed).
  async function catchUp(pid, levels, account) {
    const { values } = await progressValues(pid, levels, account);
    for (const [name, value] of Object.entries(values)) events.emit('stat', { pid, name, value });
  }

  // Rank and reign: on maps where enough players own blocks, a player's place, and a minute at #1 for the
  // leader each minute.
  // A tie counts against you (two players level at the top are both #2), and a rank only counts with at least
  // RANK_MIN_BLOCKS blocks, so a single block among many beginners isn't "#1".
  const rankOn = (map, pid) => {
    const counts = [...map.counts.values()].filter(n => n > 0);
    if (counts.length < rules.RANK_MIN_PLAYERS) return null;
    const mine = map.counts.get(pid) || 0;
    return mine >= rules.RANK_MIN_BLOCKS ? counts.filter(n => n >= mine).length : null;
  };
  const lostTo = new Map();     // "pid|map|x,y" -> { by, at }: who took a block from whom, for Revenge
  const comeback = new Set();   // "pid|map": lost every block there to others (Comeback Kid)
  const reign = setInterval(() => {
    for (const map of loaded) {
      const top = [...map.counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      if (top.length < rules.RANK_MIN_PLAYERS || top[0][1] === top[1][1] || top[0][1] < rules.RANK_MIN_BLOCKS) continue;
      totals.bump(top[0][0], 'reignMinutes', 1);
    }
    const old = Date.now() - 60000;
    for (const [k, v] of lostTo) if (v.at < old) lostTo.delete(k);
  }, 60000);
  reign.unref();

  // A block's terrain changed for good (saved already): everyone sees it; water frees the block (loop 19: a core
  // service; the Terraformer item uses it).
  function terrainSet(map, x, y, terrain) {
    const k = key(x, y), owner = map.cells.get(k);
    map.overrides.set(k, terrain);
    map.hits.delete(k);
    io.to(map.room).emit('terrain', { x, y, terrain });
    if (terrain === 'water' && owner) { setOwner(map, k, null); io.to(map.room).emit('claim', { x, y, pid: null }); statChanged(map, owner, 'owned', map.counts.get(owner) || 0); }
  }

  // Runs claims and wipes on one map in arrival order, so each sees the result of the one before.
  function serial(map, fn) {
    const run = map.queue.then(fn);
    map.queue = run.catch(() => {});
    return run;
  }

  // A sale: the block changes hands with what's built on it (setOwner would clear it).
  function transferOwner(map, k, pid) {
    const old = map.cells.get(k);
    if (old) map.counts.set(old, map.counts.get(old) - 1);
    map.counts.set(pid, (map.counts.get(pid) || 0) + 1);
    map.cells.set(k, pid);
    map.hits.delete(k);
  }
  function dropListingQuiet(map, id) {
    const l = map.listingInfo.get(id);
    if (!l) return;
    map.listingInfo.delete(id);
    for (const [x, y] of l.blocks) map.listings.delete(key(x, y));
  }

  function setOwner(map, k, pid) {
    const old = map.cells.get(k);
    if (old !== pid && map.factories?.has(k)) dropFactory(map, k);
    if (old !== pid && map.listings?.has(k)) dropListing(map, map.listings.get(k));
    if (old !== pid) hooks.runSync('ownerChanged', map, k, old, pid);   // plug-ins: what was built on it goes (walls)
    if (old) map.counts.set(old, map.counts.get(old) - 1);
    if (pid) map.counts.set(pid, (map.counts.get(pid) || 0) + 1);
    map.cells.set(k, pid);
  }

  // Browsers see crack progress as a share of the hits needed (p, from 0 to 1), not the hits themselves.
  const share = h => Math.round(Math.min(1, h.n / h.need) * 1000) / 1000;

  // Cracks fade (rules.decayCrack). Tells everyone when progress is lost.
  function decay(map, k, h, now) {
    if (h.factory) return;   // a factory's progress never fades (its hits can be hours apart)
    const d = rules.decayCrack(h, now, crackDecayMs);
    if (!d.lost) return;
    h.n = d.n;
    h.at = d.at;
    if (!h.n) map.hits.delete(k);
    const [at, side] = k.split('|'), [x, y] = at.split(',').map(Number);
    io.to(map.room).emit('hit', { x, y, ...(side ? { side } : {}), p: share(h) });
  }
  // Cracks for plug-ins (loop 19): `crackKey` is "x,y|<part>" (a wall's side); `at` goes out with the progress.
  // crackHit adds `power` hits by `by` toward `need`; true once taken (the crack is gone). crackRepair takes hits off.
  function crackHit(map, crackKey, by, power, need, at) {
    const now = Date.now();
    let h = map.hits.get(crackKey);
    if (h) decay(map, crackKey, h, now);
    h = map.hits.get(crackKey);
    if (h?.by !== by) map.hits.set(crackKey, h = { by, n: 0 });
    h.at = now;
    h.need = need;
    h.n += power;
    if (!rules.isTaken(h.n, h.need)) { io.to(map.room).emit('hit', { ...at, p: share(h) }); return false; }
    map.hits.delete(crackKey);
    return true;
  }
  function crackRepair(map, crackKey, power, at) {
    const h = map.hits.get(crackKey);
    if (!h) return;
    decay(map, crackKey, h, Date.now());
    if (!map.hits.has(crackKey)) return;
    h.n -= power;
    if (h.n > 1e-9) return io.to(map.room).emit('hit', { ...at, p: share(h) });
    map.hits.delete(crackKey);
    io.to(map.room).emit('hit', { ...at, p: 0 });
  }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const map of loaded) for (const [k, h] of map.hits) decay(map, k, h, now);
  }, Math.min(1000, crackDecayMs / 4));
  sweep.unref();
  server.on('close', () => { clearInterval(sweep); clearInterval(tapLog); clearInterval(liveTimer); });

  const checkHit = rules.hitError;

  // When this player may rename again (ms since 1970), or null if they may now.
  const renameAt = changedAt => {
    const t = changedAt && new Date(changedAt).getTime() + rules.RENAME_COOLDOWN_MINUTES * 60 * 1000;
    return t > Date.now() ? t : null;
  };

  // Clears one player's territory on a loaded map (their own wipe, or an admin's), in the map's queue.
  // Returns store.wipeTerritory's { cells, floor }, or null if they had no blocks there.
  async function wipeOn(map, pid) {
    const r = await store.wipeTerritory(pool, map.id, pid);
    if (!r) return null;
    for (const [x, y] of r.cells) setOwner(map, key(x, y), null);
    Object.assign(map.players.get(pid), { unlocked: true, wipeFloor: r.floor });
    io.to(map.room).emit('wipe', { pid, cells: r.cells, floor: r.floor });
    statChanged(map, pid, 'owned', 0);
    return r;
  }

  // What admin commands (admin.js) do to the live game, so players see the change at once.
  function adminHooks() {
    const socketsOf = ids => [...io.sockets.sockets.values()].filter(s => ids.some(id => String(id) === String(s.data.me?.pid)));
    // Loads a map again from the database and sends it to everyone on it.
    async function reloadMap(id) {
      const old = [...loaded].find(m => String(m.id) === String(id));
      if (old) loaded.delete(old);
      maps.delete(old?.id ?? id);
      const fresh = await getMap(old?.id ?? id);
      for (const s of io.sockets.sockets.values()) if (s.data.mapId !== undefined && String(s.data.mapId) === String(id)) s.data.reenter(fresh);
    }
    return {
      // Plug-ins' saved data, inside the admin's transaction (loop 19): an account deleted, the economy reset.
      accountDeleted: (c, playerId) => hooks.run('accountDeleted', c, playerId),
      reset: c => hooks.run('reset', c),
      // Disconnects these players' connections with a message (kind: kicked, banned, deleted). Returns how many.
      kick(ids, kind, message) {
        const list = socketsOf(ids);
        for (const s of list) { s.emit('notice', { kind, message }); s.disconnect(true); }
        return list.length;
      },
      async wipePlayer(mapId, pid) {
        const m = await getMap(mapId);
        return serial(m, () => wipeOn(m, pid));
      },
      async wipeMap(mapId, size) {
        const m = await getMap(mapId);
        const r = await serial(m, () => store.wipeMap(pool, mapId, size));
        await reloadMap(mapId);
        return r;
      },
      async reloadMaps(ids) { for (const id of ids) await reloadMap(id); },
      // A deleted map: forget it, and move everyone on it to the main map.
      async mapDeleted(id) {
        const old = [...loaded].find(m => String(m.id) === String(id));
        if (old) loaded.delete(old);
        maps.delete(old?.id ?? id);
        const main = await getMap(await getDefaultMapId());
        for (const s of io.sockets.sockets.values()) if (String(s.data.mapId) === String(id)) s.data.reenter(main);
      },
      squaresChanged: balanceChanged,
      // After a restore: forget every loaded map and disconnect everyone, who reconnect to the restored game.
      reloadAll(message = 'The game was restored from a backup. Reload the page to keep playing.') {
        maps.clear();
        loaded.clear();
        for (const s of io.sockets.sockets.values()) {
          s.emit('notice', { kind: 'restored', message });
          s.disconnect(true);
        }
      },
    };
  }

  // Modifiers (loop 19): a variable multiplied for a while for one player (Super Click: clickPower x 10 for 5 seconds).
  // pid -> [{ variable, factor, until }]. factorOf multiplies the ones still running.
  const modifiers = new Map();
  const addModifier = (pid, variable, factor, until) => modifiers.set(String(pid), [...(modifiers.get(String(pid)) ?? []).filter(m => m.until > Date.now()), { variable, factor, until }]);
  const factorOf = (pid, variable, now = Date.now()) => (modifiers.get(String(pid)) ?? []).reduce((f, m) => (m.variable === variable && m.until > now ? f * m.factor : f), 1);

  // A death: shown at once on the player's connections on that map; one that happens while they're away waits
  // for their return (store.unseenDeath, on entering the map).
  function announceDeath(pid, mapId, life) {
    let shown = false;
    for (const s of io.sockets.sockets.values()) {
      if (String(s.data.me?.pid) === String(pid) && String(s.data.mapId) === String(mapId)) { s.emit('died', life); shown = true; }
    }
    if (shown) store.markLifeSeen(pool, life.id).catch(() => {});
  }

  // Who has the game open in a visible tab on a map: sent to everyone there as 'online' (a list of player ids).
  function sendOnline(map) {
    if (!map) return;
    const pids = new Set();
    for (const s of io.sockets.sockets.values()) if (s.data.mapId === map.id && s.data.visible && s.data.me?.pid) pids.add(String(s.data.me.pid));
    io.to(map.room).emit('online', [...pids]);
  }

  // A purchase: new upgrade levels and balance for every connection of the player and every loaded map (where
  // Defense is read from), so the new level counts from the next tap.
  function upgradesChanged(pid, levels, balance) {
    for (const s of io.sockets.sockets.values()) {
      if (s.data.me?.pid !== pid) continue;
      s.data.setUpgrades(levels);
      s.data.me.squares = balance;
    }
    for (const map of loaded) { const p = map.players.get(pid); if (p) p.upgrades = levels; }
    balanceChanged(pid, balance);
  }

  // A new name shows to everyone at once: every loaded map, every connection of that player, every browser.
  function renamed(pid, name) {
    for (const map of loaded) { const p = map.players.get(pid); if (p) p.name = name; }
    for (const s of io.sockets.sockets.values()) if (s.data.me?.pid === pid) s.data.me.name = name;
    io.emit('rename', { pid, name });
  }

  io.on('connection', async socket => {
    const ip = clientIp(socket.handshake.headers, socket.handshake.address);
    // What the browser sends: the guest's secret token (if it has one), a login token (if logged in), and
    // upgrade = true when the player has just signed up from their guest profile.
    const { token, jwt, upgrade } = socket.handshake.auth || {};
    let me, map, mySteps, upgraded = false, loginFailed = false;
    try {
      // Returning guests are recognised by their secret token. Visitors get a name and color to show,
      // but no database row until their first claim.
      let player = await store.findPlayerByToken(pool, token);
      const tokenPlayer = player;   // the guest this browser holds, if any
      if (jwt && auth) {
        const authUserId = await auth.verify(jwt);
        if (authUserId) {
          const ownGuest = upgrade === true && player && !player.auth_user_id ? player.id : null;
          ({ player, upgraded } = await store.accountPlayer(pool, authUserId, ownGuest));
        } else {
          loginFailed = true;
        }
      }
      // A logged-in account and a different guest on one device belong to the same person (bans cover both).
      if (player && tokenPlayer && player.id !== tokenPlayer.id) await store.linkPlayers(pool, player.id, tokenPlayer.id);
      const ban = await store.activeBan(pool, [player?.id, tokenPlayer?.id]);
      if (ban) {
        socket.emit('notice', { kind: 'banned', message: bannedMessage(ban) });
        return socket.disconnect(true);
      }
      me = player ? { pid: player.id, name: player.name, account: !!player.auth_user_id, renameAt: renameAt(player.name_changed_at), squares: Number(player.squares),
          tutorial: player.tutorial, showTenths: player.show_tenths, highest: player.highest_level }
        : { pid: null, name: guestName(), account: false, renameAt: null, squares: 0, tutorial: null, showTenths: false };
      mySteps = player ? upgradesOf(player) : rules.NO_UPGRADES;
      if (upgraded) renamed(me.pid, me.name);   // the guest's old name was showing to everyone
      map = (player?.last_map_id && await getMap(player.last_map_id)) || await getMap(await getDefaultMapId());
      if (player && player.last_map_id !== map.id) await store.setLastMap(pool, player.id, map.id);
    } catch (err) {
      console.error(`Could not set up a player: ${err.message}`);
      socket.emit('denied', 'The server is having trouble. Try again in a moment.');
      return socket.disconnect();
    }
    socket.data.me = me;
    socket.data.setUpgrades = u => { mySteps = u; };   // a purchase on any device changes them at once
    socket.data.reenter = fresh => enter(fresh);         // an admin reloaded this map: send it again
    // Color, skin and coverage are fixed on the first claim on a map (or the first since a wipe there). Until
    // then they are only proposals, which the player picks on the setup screen (the 'setup' event).
    let color, skin, coverage;
    let tutorialSaves = Promise.resolve();
    const lockedHere = () => map.players.has(me.pid) && !map.players.get(me.pid).unlocked;
    if (me.pid) socket.join('player:' + me.pid);
    if (me.pid) {
      if (me.account) totals.best(me.pid, 'account', 1);
      if (me.tutorial?.done) totals.best(me.pid, 'tutorialDone', 1);
      catchUp(me.pid, mySteps, me.account).catch(err => console.error(`CATCH-UP FAILED (player ${me.pid}): ${err.message}`));
    }
    // This visit, for the Sessions achievements and some secrets.
    const session = { claims: 0, recent: [], forestRun: 0, pokes: 0, minute: null, visitorTaps: 0, spare: 0 };
    socket.data.visible = true;
    socket.on('disconnect', () => { if (me.pid) totals.save(me.pid); sendOnline(map); });
    // The browser says when its tab is shown or hidden (online dots).
    socket.on('visible', v => { socket.data.visible = !!v; sendOnline(map); });

    // Puts this connection on `next` and sends the whole map. Also used when switching maps, so the browser
    // handles a switch like a fresh welcome.
    function enter(next, flags = {}) {
      const old = map;
      if (map) socket.leave(map.room);
      map = next;
      socket.data.mapId = map.id;
      socket.join(map.room);
      if (old && old !== map) sendOnline(old);
      setTimeout(() => sendOnline(map));   // after the welcome below
      // A death on this map while they were away: the death screen, now.
      if (me.pid) store.unseenDeath(pool, me.pid, map.id).then(l => l && socket.emit('died', { ...l, offline: true }), () => {});
      const mine = map.players.get(me.pid);
      color = mine?.color ?? rules.COLORS[Math.floor(Math.random() * rules.COLORS.length)].hex;
      skin = mine?.skin ?? 'default';
      coverage = mine?.coverage ?? rules.COVERAGES[0];
      socket.emit('welcome', {
        // locked: color, skin and coverage are set here; wipeFloor: see the wipe rule; squares: whole squares
        me: { ...me, color, skin, coverage, locked: lockedHere(), wipeFloor: mine?.wipeFloor ?? 0, squares: catalog.fromTenths(me.squares) },
        level: { ...catalog.levelProgress(map.mined, map.base), base: map.base, max: catalog.E.maxLevel },
        choices: { colors: rules.COLORS, coverages: rules.COVERAGES },
        hitsPerBlock: rules.HITS_PER_BLOCK,
        inspectHoldMs: catalog.E.inspectHoldMs,
        settings: { nameLabelShare: rules.NAME_LABEL_SHARE, nameMaxLength: rules.NAME_MAX_LENGTH, sound: rules.SOUND, terrain: rules.TERRAIN,
          skinKinds: SKIN_KINDS,
          skinAnimated: rules.SKINS.filter(s => s.rarity === 'Legendary').map(s => s.id) },   // drawn from <id>-anim.png, 4 frames   // how to draw each skin: pattern (in the owner's color) or art
        accounts: !!auth,                         // false when logins aren't set up on this server
        upgraded: false, loginFailed: false,      // see `flags`
        ...flags,
        map: { id: map.id, name: map.name, style: map.style, seed: map.seed },
        // [x, y, owner] or [x, y, owner, birth level] for blocks above level 1
        cells: [...map.cells].map(([k, owner]) => { const b = map.birth.get(k); return b ? [...k.split(',').map(Number), owner, b] : [...k.split(',').map(Number), owner]; }),
        players: Object.fromEntries([...map.players].map(([pid, { upgrades, ...shown }]) => [pid, shown])),
        hits: [...map.hits].filter(([k]) => !k.includes('|')).map(([k, h]) => [...k.split(',').map(Number), share(h)]),   // not walls' cracks
        chat: chats.get(map.id) ?? [],
        terrain: [...map.overrides].map(([k, t]) => [...k.split(',').map(Number), t]),   // Terraformer changes
        factories: [...map.factories.values()].map(f => factoryOut(map, f)),
        listings: [...map.listingInfo.values()].map(l => listingOut(map, l)),
        build: { blocksPerFactory: catalog.E.factoryBlocksPerFactory, areaSize: catalog.E.factoryAreaSize },
        plugins: pluginHost.clientList(loadedPlugins),   // the browser loads these after the map is drawn
        pluginData: Object.fromEntries(hooks.collectBy('welcome', map, me.pid)),   // each plug-in's part, by name
      });
    }
    // upgraded: the guest profile just became an account; the browser can forget its guest token
    // loginFailed: a login token was sent but wasn't valid
    const first = map;
    map = null;
    enter(first, { upgraded, loginFailed });

    const clearCrack = (x, y) => io.to(map.room).emit('hit', { x, y, p: 0 });

    // Runs in the map's queue after the last hit. Checks the rules again, since the map may have changed.
    // `here` is the map the last hit was on; if the player has switched maps since, the claim is dropped.
    async function finishClaim(here, x, y) {
      if (here !== map) return;
      const error = checkHit(map, me.pid, x, y) ?? hooks.first('hitRefusal', map, me.pid, x, y);
      if (error) { socket.emit('denied', error); return clearCrack(x, y); }
      const k = key(x, y), from = map.cells.get(k);

      let token = null, newGuest = null;
      if (!me.pid) {
        // A visitor who has gone could never receive their new player's token: the block would belong to a
        // guest nobody can play. Drop the claim instead.
        if (!socket.connected) return clearCrack(x, y);
        if (!limiter.allowed(ip)) {
          socket.emit('denied', 'Too many new players from your network. Try again later.');
          return clearCrack(x, y);
        }
        token = crypto.randomUUID();
        newGuest = { names: guestNames(me.name), tokenHash: store.hashToken(token) };
      }

      const joining = !lockedHere();
      const owns = (a, b) => (a === x && b === y) || (me.pid !== null && map.cells.get(key(a, b)) === me.pid);
      const st = stats.afterClaim(me.pid ? statsOf(map, me.pid) : stats.empty(),
        { owns, x, y, owned: (map.counts.get(me.pid) || 0) + 1, from });
      const ground = map.terrainAt(x, y);
      const level = map.birth.get(k) ?? 1, eff = tiersOn(mySteps, level);
      const earn = rules.firstClaimTenths(eff, ground, level);
      const r = await store.claimBlock(pool, { mapId: map.id, x, y, from, playerId: me.pid, newGuest,
        color: joining ? color : null, coverage, skin, earn, grow: rules.growthBlocks(eff, growRoll(map, x, y)), stats: st.stats,
        birth: catalog.level(map.mined + 1, map.base), level });
      if (r.conflict) {
        // Another server got there first (e.g. during a deploy). Resync this block for everyone.
        setOwner(map, k, await store.cellOwner(pool, map.id, x, y));
        socket.emit('denied', 'Someone got there first');
        io.to(map.room).emit('claim', { x, y, pid: map.cells.get(k) });
        return;
      }

      if (newGuest) {
        limiter.record(ip);
        me.pid = r.playerId;
        me.name = r.name;
        socket.join('player:' + me.pid);
        socket.emit('you', { token, pid: me.pid, name: me.name });
        sendOnline(map);
        totals.bump(me.pid, 'taps', session.visitorTaps);
        session.visitorTaps = 0;
        session.minute = Math.floor(Date.now() / 60000);
        totals.bump(me.pid, 'hoursPlayed', 1 / 60);
      }
      if (r.joinedMap) {
        const before = map.players.get(me.pid);
        map.players.set(me.pid, { name: me.name, color, skin, coverage, unlocked: false, wipeFloor: before?.wipeFloor ?? 0, upgrades: mySteps });
        io.to(map.room).emit('player', { pid: me.pid, name: me.name, color, skin, coverage });
      }
      setOwner(map, k, me.pid);
      map.hits.delete(k);   // no crack carries over to the new owner
      io.to(map.room).emit('claim', { x, y, pid: me.pid });
      map.stats.set(me.pid, st.stats);
      statChanged(map, me.pid, 'owned', map.counts.get(me.pid));
      for (const name of st.changed) statChanged(map, me.pid, name, st.stats[name]);
      if (from) {
        statChanged(map, from, 'owned', map.counts.get(from));
        statChanged(map, from, 'blocksLost', ++statsOf(map, from).blocksLost);
      }
      for (const g of r.grown) {   // one new block, or more with Growth
        map.cells.set(key(g.x, g.y), null);
        if (g.l > 1) map.birth.set(key(g.x, g.y), g.l);
        io.to(map.room).emit('grow', g);
      }
      if (r.squares !== null) {
        // Whole squares this claim mined, for the rising-square animation (rewards don't animate).
        const mined = rules.shownSquares(r.squares) - rules.shownSquares(me.squares);
        if (mined > 0) socket.emit('mined', { x, y, count: mined });
        if (from === null) mapMined(map);
        balanceChanged(me.pid, r.squares);
      }
      if (r.squares === null && from === null) mapMined(map);
      if (from === null && level > (me.highest ?? 1)) { me.highest = level; totals.best(me.pid, 'highestLevel', level); }
      claimStats({ x, y, k, from, ground, grown: r.grown.length, earned: r.squares !== null ? catalog.fromTenths(earn) : 0, joinedMap: r.joinedMap });
    }

    // What a claim counts toward: lifetime totals, records, rank, and the secrets.
    function claimStats({ x, y, k, from, ground, grown, earned, joinedMap }) {
      const pid = me.pid, now = Date.now(), here = map.id + '|';
      if (ground !== 'grass') totals.bump(pid, 'terrain:' + ground);
      if (from === null) {
        totals.bump(pid, 'claims');
        totals.best(pid, 'sessionClaims', ++session.claims);
        totals.touchDay(pid, now).then(() => totals.bump(pid, 'dayClaims')).then(n => n && totals.best(pid, 'bestDayClaims', n));
        totals.bump(pid, 'mapGrown', grown);
        totals.bump(pid, 'growthBlocks', Math.max(0, grown - 1));
        totals.bump(pid, 'squaresEarned', earned);
        session.recent = [...session.recent.filter(t => now - t < 60000), now];
        if (session.recent.length >= 10) totals.best(pid, 'secret:speedrun', 1);
      } else {
        totals.bump(pid, 'taken');
        totals.bump(from, 'lost');
        const mine = lostTo.get(pid + '|' + here + k);
        if (mine && String(mine.by) === String(from) && now - mine.at <= 60000) totals.best(pid, 'secret:revenge', 1);
        lostTo.set(from + '|' + here + k, { by: pid, at: now });
        if (!map.counts.get(from)) {
          comeback.add(from + '|' + map.id);
          // Their last block here: they die on this map (loop 13).
          store.endLife(pool, from, map.id, pid, x, y).then(life => life && announceDeath(from, map.id, life))
            .catch(err => console.error(`DEATH FAILED (player ${from}): ${err.message}`));
        }
        const theirs = rankOn(map, from);
        if (theirs) totals.best(from, 'bestRank', theirs);
      }
      session.forestRun = ground === 'forest' ? session.forestRun + 1 : 0;
      if (session.forestRun >= 25) totals.best(pid, 'secret:treehugger', 1);
      if (map.seed && rules.NEIGHBORS.every(([dx, dy]) => map.terrainAt(x + dx, y + dy) === 'water')) totals.best(pid, 'secret:castaway', 1);
      if (new Date(now).getUTCHours() === 3) totals.best(pid, 'secret:witching', 1);
      if (comeback.has(pid + '|' + map.id) && (map.counts.get(pid) || 0) >= 100) {
        comeback.delete(pid + '|' + map.id);
        totals.best(pid, 'secret:comeback', 1);
      }
      const rank = rankOn(map, pid);
      if (rank) totals.best(pid, 'bestRank', rank);
      store.lifeClaim(pool, pid, map.id, map.counts.get(pid) || 0, earned).catch(err => console.error(`LIFE FAILED (player ${pid}): ${err.message}`));
      if (joinedMap) store.mapsPlayed(pool, pid).then(n => totals.best(pid, 'mapsPlayed', n), () => {});
    }

    socket.on('hit', p => {
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return;
      const who = me.pid ?? 'visitor:' + socket.id;
      const t = rules.tapAllowed(taps.get(who), Date.now(), tapsPerSecond ?? rules.MAX_TAPS_PER_SECOND);
      taps.set(who, t.bucket);
      if (!t.allowed) return ignoredTaps.set(who, (ignoredTaps.get(who) || 0) + 1);
      const { x, y } = p, k = key(x, y);
      if (map.claiming.has(k)) return;   // taps still arriving while the claim is being saved don't count
      const error = checkHit(map, me.pid, x, y) ?? hooks.first('hitRefusal', map, me.pid, x, y);
      if (error) {
        // Your own block: if someone has cracked it, the tap repairs it (loop 18). If not, it does nothing at all
        // (players tap once more after a claim all the time); it only counts toward the Poke secret.
        if (error === 'You already own this block') {
          if (map.hits.has(k)) return repair(x, y);
          if (hooks.first('ownTap', map, me.pid, x, y, powerOn(x, y))) return totals.bump(me.pid, 'taps');
          if (++session.pokes === 50) totals.best(me.pid, 'secret:poke', 1);
          return;
        }
        return socket.emit('denied', error);
      }
      if (!me.pid) session.visitorTaps++;   // counted once the first claim makes them a player
      else {
        totals.bump(me.pid, 'taps');
        const minute = Math.floor(Date.now() / 60000);   // a minute with a tap is a minute played
        if (minute !== session.minute) {
          session.minute = minute;
          totals.bump(me.pid, 'hoursPlayed', 1 / 60);
          totals.touchDay(me.pid);
        }
      }

      // Any attack on a listed block ends the listing.
      if (map.listings.has(k) && map.cells.get(k) !== me.pid) {
        const here = map, id = map.listings.get(k);
        serial(here, () => cancelListingNow(here, id)).catch(err => console.error(`LISTING CANCEL FAILED (${id}): ${err.message}`));
      }
      // A plug-in may take the hit instead (a wall, when every way in runs through the owner's walls).
      if (me.pid && hooks.first('beforeHit', map, me.pid, x, y, powerOn(x, y))) return;

      // Progress only counts while the same player keeps hitting the block, and fades when they stop.
      // Each click adds the player's Click Power; the owner's Defense sets the hits needed.
      const by = me.pid ?? 'visitor:' + socket.id, now = Date.now();
      let h = map.hits.get(k);
      if (h) decay(map, k, h, now);
      h = map.hits.get(k);
      const owner = map.cells.get(k);
      const level = map.birth.get(k) ?? 1;
      const need = rules.hitsNeeded(owner ? tiersOn(map.players.get(owner)?.upgrades, level) : null, map.terrainAt(x, y), level);
      // Hit power left over from the tap that took the last block counts toward the next one, so a higher Click
      // Power level never wastes power (GAME-RULES.md).
      if (h?.by !== by) { map.hits.set(k, h = { by, n: session.spare }); session.spare = 0; }
      h.at = now;
      h.need = need;
      h.n += powerOn(x, y, now);
      if (!rules.isTaken(h.n, need)) return io.to(map.room).emit('hit', { x, y, p: share(h) });

      session.spare = Math.max(0, h.n - need);
      map.hits.delete(k);
      const here = map;
      here.claiming.add(k);
      serial(map, () => finishClaim(here, x, y)).finally(() => here.claiming.delete(k)).catch(err => {
        console.error(`CLAIM FAILED (map ${map.id}, ${k}): ${err.message}`);
        socket.emit('denied', 'Could not save your claim. Try again.');
        clearCrack(x, y);
      });
    });

    // This player's hit power on (x, y): Click Power capped at the block's level, times any modifier (Super Click).
    const powerOn = (x, y, now = Date.now()) => rules.hitPower(tiersOn(mySteps, map.birth.get(key(x, y)) ?? 1)) * factorOf(me.pid, 'clickPower', now);

    // Repair (loop 18): a tap on your own cracked block takes off hits equal to your Click Power (capped at the
    // block's level; Super Click counts), like mining in reverse. Free. At 0 the crack is gone.
    function repair(x, y) {
      const k = key(x, y), now = Date.now();
      decay(map, k, map.hits.get(k), now);
      const h = map.hits.get(k);
      if (!h) return;
      totals.bump(me.pid, 'taps');
      h.n -= powerOn(x, y, now);
      if (h.n > 1e-9) return io.to(map.room).emit('hit', { x, y, p: share(h) });
      map.hits.delete(k);
      io.to(map.room).emit('hit', { x, y, p: 0 });
    }

    // Clears this player's whole territory on this map, and unlocks their color, skin and coverage here.
    socket.on('wipe', () => {
      if (!me.pid) return;
      const here = map;
      serial(here, async () => {
        const r = await wipeOn(here, me.pid);
        if (!r) return socket.emit('denied', 'You have no blocks to wipe');
        totals.bump(me.pid, 'wipes');
        store.endLife(pool, me.pid, here.id).catch(() => {});   // a wipe ends the life, but isn't a death
        if (r.cells.length >= 1000) totals.best(me.pid, 'secret:wipedout', 1);
        comeback.delete(me.pid + '|' + here.id);
      }).catch(err => {
        console.error(`WIPE FAILED (map ${here.id}, player ${me.pid}): ${err.message}`);
        socket.emit('denied', 'Could not wipe your territory. Try again.');
      });
    });

    // Starts this player over everywhere (store.resetProgress). Answers { ok } or { error }; then every
    // connection of theirs, this one too, is closed and reloads into the fresh start.
    // A chat message to everyone on this map: { pid, name, text, at }. Answers {} or { error }.
    socket.on('chat', (raw, reply) => {
      if (typeof reply !== 'function') reply = () => {};
      if (!me.pid) return reply({ error: 'Claim a block first to chat' });
      const now = Date.now();
      if (now - (lastChat.get(me.pid) ?? 0) < chat.MIN_GAP_MS) return reply({ error: 'Slow down: one message every 2 seconds' });
      const text = chat.cleanMessage(raw);
      if (!text) return reply({ error: 'Type a message first' });
      lastChat.set(me.pid, now);
      // @-mentions (loop 15): only real names of players on this map, at most 3 per message.
      const lower = text.toLowerCase(), mentions = [];
      for (const [pid, p] of [...map.players].sort((a, b) => b[1].name.length - a[1].name.length)) {
        if (mentions.length < 3 && p.name && lower.includes('@' + p.name.toLowerCase()) && !mentions.some(m => m.name.toLowerCase().includes(p.name.toLowerCase()))) {
          mentions.push({ pid, name: p.name });
        }
      }
      const msg = { pid: me.pid, name: me.name, text, at: now, mentions };
      const list = chats.get(map.id) ?? [];
      list.push(msg);
      if (list.length > chat.HISTORY) list.shift();
      chats.set(map.id, list);
      io.to(map.room).emit('chat', msg);
      totals.bump(me.pid, 'chatMessages');
      if (text.toLowerCase().replace(/[^a-z]+/g, ' ').trim() === 'hello world') totals.best(me.pid, 'secret:helloworld', 1);
      reply({});
    });

    socket.on('resetProgress', async (...args) => {
      const reply = args.at(-1);   // the answer callback, with or without data before it
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'You have no progress to reset' });
      const pid = me.pid;
      try {
        const hooks = adminHooks();
        const r = await store.resetProgress(pool, pid);
        totals.forget(pid);
        earned.delete(pid);
        reply({ ok: true });
        hooks.kick([pid], 'reset', 'Your progress was reset. Reload the page to start again.');
        await hooks.reloadMaps(r.maps);
      } catch (err) {
        console.error(`RESET FAILED (player ${pid}): ${err.message}`);
        reply({ error: 'Could not reset your progress. Try again.' });
      }
    });

    // The setup screen: picks this player's color, skin and coverage on this map, which lock on their next
    // claim here. Only while unlocked (before their first claim here, or after a wipe). Any field may be left
    // out. Answers with { color, skin, coverage } or { error }.
    socket.on('setup', async (choice, reply) => {
      if (typeof reply !== 'function') return;
      if (lockedHere()) return reply({ error: 'Your color, skin and coverage are locked for this map' });
      const c = choice || {};
      if (c.color !== undefined && !rules.COLORS.some(k => k.hex === c.color)) return reply({ error: 'Pick one of the colors shown' });
      if (c.coverage !== undefined && !rules.COVERAGES.includes(c.coverage)) return reply({ error: 'Unknown coverage' });
      if (c.skin !== undefined) {
        try {
          if (!(await store.skinsFor(pool, me.pid)).some(s => s.id === c.skin && s.owned)) return reply({ error: "You don't own that skin" });
        } catch { return reply({ error: 'Could not check your skins. Try again.' }); }
      }
      color = c.color ?? color;
      skin = c.skin ?? skin;
      coverage = c.coverage ?? coverage;
      reply({ color, skin, coverage });
    });

    // The Achievements screen: { list: [{ id, name, stat, threshold }], earned: [{ id, map }], best: { stat: value } }.
    socket.on('achievements', async (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      // Secret ones show as "???" until earned.
      const shown = got => achievementList.map(d => d.secret && !got.has(d.id)
        ? { id: d.id, name: '???', category: d.category, secret: true, stat: null, threshold: 1, reward: null, description: 'A secret achievement' }
        : { id: d.id, name: d.name, category: d.category, secret: d.secret, stat: d.stat, threshold: d.threshold, reward: d.reward, description: d.description });
      // Another player's (read-only, from their profile): { pid } before the reply.
      const other = args.length > 1 && args[0]?.pid && String(args[0].pid) !== String(me.pid) ? args[0].pid : null;
      const pid = other ?? me.pid;
      if (!pid) return reply({ list: shown(new Set()), earned: [], values: {} });
      try {
        const theirs = other ? (await pool.query('SELECT upgrade_steps, highest_level, auth_user_id FROM players WHERE id = $1', [other])).rows[0] : null;
        const levels = theirs ? upgradesOf(theirs) : mySteps, account = theirs ? !!theirs.auth_user_id : me.account;
        const { values, earned: rows } = await progressValues(pid, levels, account);
        reply({ list: shown(new Set(rows.map(e => e.id))), earned: rows, values });
      } catch { reply({ error: 'Could not load achievements. Try again.' }); }
    });

    // The Upgrades screen: this player's levels and what each level does, from rules.js.
    // steps: { key: steps owned } (missing = 0); highest: the highest block level they've ever first-claimed (unlocks);
    // mapLevel: this map's level; list: each upgrade from the Upgrades tab with its curve and each tier's range and
    // total cost. On a level-L block an upgrade works at most at the end of tier L.
    // Plug-in events: each gets { socket, me, map } as they are when it arrives.
    for (const [name, fn] of pluginEvents) socket.on(name, (...args) => fn({ socket, me, map, mySteps }, ...args));

    socket.on('upgrades', (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      reply({ steps: mySteps, highest: me.highest ?? 1, mapLevel: map.level(), list: upgradeList(),
        prices: Object.fromEntries([...shownUpgrades].map(k => [k, nextPrices(k, mySteps[k] ?? 0)])), balance: catalog.fromTenths(me.squares) });
    });

    // Saves this player's tutorial progress: { step: id or null, done, tips: [ids] }. Visitors keep theirs in
    // the browser until their first claim, which sends it here.
    socket.on('tutorial', (p, ...args) => {
      const reply = typeof args.at(-1) === 'function' ? args.at(-1) : () => {};
      const ok = p && typeof p === 'object' && (p.step === null || (typeof p.step === 'string' && p.step.length <= 40))
        && typeof p.done === 'boolean' && Array.isArray(p.tips) && p.tips.length <= 50
        && p.tips.every(t => typeof t === 'string' && t.length <= 40);
      if (!me.pid || !ok) return reply({ error: 'Not saved' });
      const progress = { step: p.step, done: p.done, tips: [...new Set(p.tips)] };
      me.tutorial = progress;
      if (progress.done) totals.best(me.pid, 'tutorialDone', 1);
      // One save at a time, in the order sent, so an older save can never land last.
      tutorialSaves = tutorialSaves.then(() => store.saveTutorial(pool, me.pid, progress)).then(() => reply({ ok: true }), err => {
        console.error(`TUTORIAL SAVE FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Not saved' });
      });
    });

    let buying = false;   // one purchase at a time per connection (skins and upgrades)
    // Prices at the level of the map this player is on (catalog.js); answers carry squares, not tenths.
    const squaresOut = r => ({ ...r, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) });

    // Settings > Show tenths: one decimal place everywhere (remembered per player).
    socket.on('showTenths', async (on, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      try {
        await store.setShowTenths(pool, me.pid, !!on);
        me.showTenths = !!on;
        reply({ on: !!on });
      } catch { reply({ error: 'Could not save that. Try again.' }); }
    });
    // A player's profile ({ pid }): see store.profile. Achievements as the list's names (known ids only), and
    // whether they have the game open right now.
    // Builds on this map: { kind: 'factory' | 'wall', x, y, side? }. Answers { ok, squares } or { error, need? }.
    socket.on('build', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      const b = builders[p?.kind];
      if (!b) return reply({ error: 'Pick something to build and a block' });   // each builder checks its own request
      if (buying) return reply({ error: 'One purchase at a time' });
      buying = true;
      const here = map;
      try { await serial(here, async () => reply(await b(here, me.pid, p))); } catch (err) {
        console.error(`BUILD FAILED (player ${me.pid}, ${p.kind}): ${err.message}`);
        reply({ error: 'Could not build that. Try again.' });
      } finally { buying = false; }
    });
    // The Build menu's numbers for this player here.
    socket.on('buildInfo', async (...args) => {
      const reply = args.at(-1);
      if (typeof reply !== 'function') return;
      const here = map;
      try {
        reply({ factory: me.pid ? factoryInfo(here, me.pid) : null, balance: catalog.fromTenths(me.squares),
          reasons: me.pid ? await buildReasons(here, me.pid) : { factory: 'Claim a block first.', wall: 'Claim a block first.', sell: 'Claim a block first.' },
          ...(me.pid ? Object.assign({}, ...hooks.collect('buildInfo', here, me.pid)) : {}) });   // plug-ins' parts (wall prices, …)
      } catch { reply({ error: 'No answer from the server. Try again.' }); }
    });
    // ---------- The land market ----------
    // Lists connected blocks of yours: { blocks: [[x, y]], price } (squares). Accounts at least marketMinAccountDays old.
    socket.on('listLand', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      const blocks = Array.isArray(p?.blocks) ? p.blocks.filter(b => Array.isArray(b) && Number.isInteger(b[0]) && Number.isInteger(b[1])) : [];
      const price = catalog.toTenths(Number(p?.price));
      if (!blocks.length || blocks.length !== p.blocks.length || blocks.length > 10000) return reply({ error: 'Pick some of your blocks' });
      if (new Set(blocks.map(b => key(...b))).size !== blocks.length) return reply({ error: 'Pick each block once' });
      if (!(price > 0) || price > 1e15) return reply({ error: 'Enter a price above 0' });
      if (!rules.connected(blocks)) return reply({ error: 'The blocks must be connected side to side' });
      const here = map;
      try {
        await serial(here, async () => {
          if (blocks.some(b => here.cells.get(key(...b)) !== me.pid)) return reply({ error: 'Only your own blocks' });
          if (blocks.some(b => here.listings.has(key(...b)))) return reply({ error: 'Some of those blocks are already for sale' });
          const r = await store.createListing(pool, { mapId: here.id, sellerId: me.pid, blocks, price, minDays: catalog.E.marketMinAccountDays });
          if (r.error) return reply(r);
          const l = { id: r.id, seller: me.pid, price, created: Date.now(), blocks };
          here.listingInfo.set(r.id, l);
          for (const b of blocks) here.listings.set(key(...b), r.id);
          io.to(here.room).emit('listing', listingOut(here, l));
          reply({ ok: true, id: r.id });
        });
      } catch (err) {
        console.error(`LISTING FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Could not list that. Try again.' });
      }
    });
    socket.on('cancelListing', async (p, reply) => {
      if (typeof reply !== 'function') return;
      const here = map, l = here.listingInfo.get(p?.id);
      if (!l || String(l.seller) !== String(me.pid)) return reply({ error: 'Not your listing' });
      try { await serial(here, () => cancelListingNow(here, l.id)); reply({ ok: true }); } catch { reply({ error: 'Could not cancel it. Try again.' }); }
    });
    // The Land tab: every listing on this map.
    socket.on('landList', (...args) => {
      const reply = args.at(-1);
      if (typeof reply !== 'function') return;
      reply({ list: [...map.listingInfo.values()].map(l => ({ ...listingOut(map, l), mine: String(l.seller) === String(me.pid) })), balance: catalog.fromTenths(me.squares) });
    });
    // Buys a listing: { id }. Everything moves to the buyer in one transaction.
    socket.on('buyLand', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      if (buying) return reply({ error: 'One purchase at a time' });
      const here = map, l = here.listingInfo.get(p?.id);
      if (!l) return reply({ error: 'That land is no longer for sale' });
      buying = true;
      try {
        await serial(here, async () => {
          const mine = here.players.get(me.pid);
          const look = { color: mine?.color ?? color, skin: mine?.skin ?? 'default', coverage: mine?.coverage ?? rules.COVERAGES[0] };
          const r = await store.buyListing(pool, { id: l.id, buyerId: me.pid, fee: catalog.E.marketFee, minDays: catalog.E.marketMinAccountDays, look });
          if (r.error) return reply({ error: r.error, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) });
          if (r.joined || !mine) {
            here.players.set(me.pid, { name: me.name, ...look, unlocked: false, wipeFloor: 0, upgrades: mySteps });
            io.to(here.room).emit('player', { pid: me.pid, name: me.name, ...look });
          }
          // The sale: listing gone, then the blocks (with their factories and walls) change hands.
          dropListingQuiet(here, l.id);
          io.to(here.room).emit('listing', { id: l.id, gone: true, sold: true });
          for (const [x, y] of r.blocks) {
            const k = key(x, y), f = here.factories.get(k);
            if (f) f.owner = me.pid;
            transferOwner(here, k, me.pid);
            io.to(here.room).emit('claim', { x, y, pid: me.pid, sold: true });
            if (f) io.to(here.room).emit('factory', factoryOut(here, f));
          }
          balanceChanged(me.pid, r.buyerSquares);
          balanceChanged(r.seller, r.sellerSquares);
          statChanged(here, me.pid, 'owned', here.counts.get(me.pid));
          statChanged(here, r.seller, 'owned', here.counts.get(r.seller) || 0);
          totals.bump(me.pid, 'squaresSpent', catalog.fromTenths(r.price));
          reply({ ok: true, blocks: r.blocks.length, squares: catalog.fromTenths(r.buyerSquares) });
        });
      } catch (err) {
        console.error(`LAND PURCHASE FAILED (player ${me.pid}, ${p?.id}): ${err.message}`);
        reply({ error: 'Could not buy that. Try again.' });
      } finally { buying = false; }
    });

    // Wakes one of your factories: { x, y }. It works for its Factory Lifetime hours from now.
    socket.on('wakeFactory', async (p, reply) => {
      if (typeof reply !== 'function') return;
      const here = map, f = p && here.factories.get(key(p.x, p.y));
      if (!f || String(f.owner) !== String(me.pid)) return reply({ error: 'Not your factory' });
      try {
        await serial(here, async () => {
          const now = Date.now(), awakeMs = ownerValues(here, f.owner, levelAt(here, f.x, f.y))['factories.lifetime'] * 3600000;
          await store.wakeFactory(pool, f.id, f.owner, awakeMs, now);
          f.awake = now + awakeMs;
          f.processed = Math.max(f.processed, fac.stepFloor(now));
          io.to(here.room).emit('factory', factoryOut(here, f));
          reply({ ok: true, awakeUntil: f.awake });
        });
      } catch { reply({ error: 'Could not wake it. Try again.' }); }
    });

    // The info card (press and hold, or right-click, a block): { x, y } -> what's there. Never anything private.
    socket.on('inspect', (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return reply({ error: 'Unknown block' });
      const k = key(p.x, p.y);
      if (!map.cells.has(k)) return reply({ error: 'There is no block there' });
      reply(blockInfo(map, p.x, p.y, me.pid, mySteps));
    });

    socket.on('profile', async (p, reply) => {
      if (typeof reply !== 'function') return;
      try {
        const pr = await store.profile(pool, p?.pid ?? me.pid);
        if (!pr) return reply({ error: 'No such player' });
        const known = pr.earned.filter(id => knownIds.has(id));
        const online = [...io.sockets.sockets.values()].some(s => String(s.data.me?.pid) === String(pr.id) && s.data.visible);
        reply({ id: pr.id, name: pr.name, account: pr.account, squares: pr.squares, color: pr.color, online, since: pr.created_at,
          map: pr.map, blocks: pr.blocks, rank: pr.rank, best: pr.best, stars: { pattern: pr.star_pattern, art: pr.star_art },
          achievements: { earned: known.length, total: achievementList.length,
            recent: known.slice(0, 5).map(id => achievementList.find(d => d.id === id)).map(d => ({ id: d.id, name: d.name, description: d.description })) } });
      } catch (err) {
        console.error(`PROFILE FAILED (${p?.pid}): ${err.message}`);
        reply({ error: 'Could not load that profile. Try again.' });
      }
    });

    // Email updates (accounts only): { on, source } sets it ('signup' or 'settings'); with no data, answers { on, account }.
    socket.on('emailUpdates', async (p, ...rest) => {
      const reply = typeof p === 'function' ? p : rest.at(-1);
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ on: false, account: false });
      try {
        if (typeof p !== 'object' || p === null || typeof p.on !== 'boolean') return reply(await store.emailUpdates(pool, me.pid));
        const r = await store.setEmailUpdates(pool, me.pid, p.on, p.source === 'signup' ? 'signup' : 'settings');
        if (r.error) return reply(r);
        email.sync(r.email, r.on).catch(err => console.error(`AUDIENCE SYNC FAILED: ${err.message}`));
        reply({ on: r.on });
      } catch (err) {
        console.error(`EMAIL UPDATES FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Could not save that. Try again.' });
      }
    });

    // Stars an owned skin ({ skin, on }): one pattern and one Rare-or-better art skin per player, saved on the server.
    socket.on('starSkin', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      const skin = rules.SKINS.find(s => s.id === p?.skin);
      if (!skin) return reply({ error: 'Unknown skin' });
      try { reply(await store.starSkin(pool, me.pid, skin, !!p.on)); } catch { reply({ error: 'Could not save that. Try again.' }); }
    });

    // Buys a skin with squares: { skin: id }. Answers { squares, balance } or { error, need }. Owned skins work on
    // every map; a guest's carry over when they make an account (it's the same player).
    socket.on('buySkin', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      const skin = rules.SKINS.find(s => s.id === p?.skin && s.enabled);
      if (!skin) return reply({ error: 'That skin is not for sale' });
      if (buying) return reply({ error: 'One purchase at a time' });
      buying = true;
      try {
        const r = await store.buySkin(pool, me.pid, skin, catalog.skinPriceTenths(skin, map.level()));
        if (r.error) return reply(squaresOut(r));
        balanceChanged(me.pid, r.squares);
        totals.bump(me.pid, 'squaresSpent', catalog.fromTenths(r.price));
        reply({ squares: catalog.fromTenths(r.squares), balance: catalog.fromTenths(r.squares) });
      } catch (err) {
        console.error(`SKIN PURCHASE FAILED (player ${me.pid}, ${p?.skin}): ${err.message}`);
        reply({ error: 'Could not buy that. Try again.' });
      } finally {
        buying = false;
      }
    });

    // Buys steps: { upgrade, from, count } (from: the steps the player saw, so a double tap can't buy twice; count: 1,
    // or 'max' for as many as they can afford in one transaction). Guests may buy. Answers { steps, bought, squares,
    // balance } or { error, need }. It works at once on every device and map (up to each map's level).
    socket.on('buyUpgrade', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      if (!p || !shownUpgrades.has(p.upgrade) || !Number.isInteger(p.from) || !(p.count === 'max' || (Number.isInteger(p.count) && p.count >= 1 && p.count <= 1000))) {
        return reply({ error: 'Unknown upgrade' });
      }
      if (buying) return reply({ error: 'One purchase at a time' });
      buying = true;
      try {
        const r = await store.buySteps(pool, me.pid, p.upgrade, p.from, p.count);
        if (r.error) return reply({ error: r.error, need: r.need === undefined ? undefined : catalog.fromTenths(r.need) });
        upgradesChanged(me.pid, r.steps, r.squares);
        totals.bump(me.pid, 'purchases', r.bought);
        totals.bump(me.pid, 'squaresSpent', catalog.fromTenths(r.cost));
        totals.best(me.pid, 'level:' + p.upgrade, upgrades.tierOfStep(p.upgrade, r.steps[p.upgrade]));
        reply({ steps: mySteps, bought: r.bought, squares: catalog.fromTenths(r.squares), balance: catalog.fromTenths(r.squares) });
      } catch (err) {
        console.error(`PURCHASE FAILED (player ${me.pid}, ${p.upgrade}): ${err.message}`);
        reply({ error: 'Could not buy that. Try again.' });
      } finally {
        buying = false;
      }
    });

    // The skin catalog for the Skins screen: [{ id, name, owned }].
    socket.on('skins', async (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      try { reply(await store.skinsFor(pool, me.pid, map.level())); } catch { reply([]); }
    });

    // The maps this player can go to, with their place on each (store.mapsFor). Answers with an array.
    socket.on('maps', async (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      try { reply(await store.mapsFor(pool, me.pid)); } catch { reply([]); }
    });

    // Moves to another map; the next map loaded on any device is this one. Answers with { ok } or { error };
    // the map itself arrives as a 'welcome'.
    socket.on('switchMap', async (id, reply) => {
      if (typeof reply !== 'function') return;
      try {
        const target = (await store.listMaps(pool)).find(m => String(m.id) === String(id));
        if (!target) return reply({ error: 'That map does not exist' });
        if (target.id === map.id) return reply({ ok: true });
        const next = await getMap(target.id);
        if (me.pid) await store.setLastMap(pool, me.pid, next.id);
        enter(next);
        reply({ ok: true });
      } catch (err) {
        console.error(`SWITCH FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Could not switch maps. Try again.' });
      }
    });

    // Accounts only. Answers with { name, renameAt } or { error }.
    socket.on('rename', async (raw, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.account) return reply({ error: 'Create an account to change your name' });
      const checked = checkName(raw);
      if (checked.error) return reply(checked);
      try {
        const r = await store.renamePlayer(pool, me.pid, checked.name);
        if (r.error) return reply(r);
        renamed(me.pid, r.name);
        me.renameAt = renameAt(r.changedAt);
        totals.bump(me.pid, 'renames');
        reply({ name: r.name, renameAt: me.renameAt });
      } catch (err) {
        console.error(`RENAME FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Could not change your name. Try again.' });
      }
    });
  });

  // The plug-ins start last, when everything they may call exists. Their api (docs/ARCHITECTURE.md): hooks, their
  // own socket events, and the core's services; it grows as plug-ins move out of the core.
  pluginHost.start(loadedPlugins, {
    on: hooks.on,
    socket: (event, fn) => pluginEvents.push([event, fn]),
    io, pool, store, catalog, rules, upgrades, variables: known,
    tx: fn => tx(pool, fn),                                   // a database transaction
    spend: (c, pid, tenths, reason) => store.spend(c, pid, tenths, reason),
    serial,                                                   // runs fn after everything queued on that map
    money: { changed: (pid, tenths) => balanceChanged(pid, tenths) },
    stats: { bump: (pid, name, n) => totals.bump(pid, name, n) },
    toPlayer: (pid, event, data) => io.to('player:' + pid).emit(event, data),
    toMap: (map, event, data) => io.to(map.room).emit(event, data),
    builders: { add: (kind, fn, reason) => { builders[kind] = fn; fn.reason = reason; } },
    built: { add: (kind, provider) => { builtProviders[kind] = provider; } },
    cracks: { hit: crackHit, repair: crackRepair },
    modifiers: { add: addModifier, factor: factorOf },
    blocks: {
      owner: (map, x, y) => map.cells.get(key(x, y)),        // undefined: no such block; null: empty
      terrainAt: (map, x, y) => map.terrainAt(x, y),
      touches: (map, x, y, pid) => rules.NEIGHBORS.some(([dx, dy]) => map.cells.get(key(x + dx, y + dy)) === pid),
      builtOn: (map, x, y) => builtOn(map, x, y).length > 0,
      clear: async (c, map, x, y) => { for (const d of builtOn(map, x, y)) await d.remove(c, map, x, y); },
      cleared: (map, x, y) => { for (const d of builtOn(map, x, y)) d.removed(map, x, y); },
      setTerrain: (c, map, x, y, terrain) => store.setTerrain(c, map.id, x, y, terrain),
      levelAt: (map, x, y) => levelAt(map, x, y),
      listed: (map, x, y) => !!map.listings?.has(key(x, y)),
      terrainSet: (map, x, y, terrain) => terrainSet(map, x, y, terrain),
    },
  });

  if (startTicker) ticker.start();
  return { server, io, events, totals, ticker, liveFactories, plugins: loadedPlugins.map(p => p.name), hooks };
}

module.exports = { createGame };
