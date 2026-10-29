const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Server } = require('socket.io');
const store = require('./store');
const { adminRouter, bannedMessage } = require('./admin');
const rules = require('./rules');
const chat = require('./chat');
const terrain = require('./public/terrain');
// How each skin is drawn, for the browser: { id: 'pattern' | 'art' }.
const SKIN_KINDS = Object.fromEntries(rules.SKINS.map(s => [s.id, s.kind]));
const stats = require('./stats');
const achievements = require('./achievements');
const { createTotals } = require('./totals');
const { guestName, guestNames, checkName } = require('./names');

const { key } = rules;
const upgradesOf = row => ({ clickPower: row.click_power, defense: row.defense, earnings: row.earnings, growth: row.growth });

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
function createGame(pool, { achievementList = achievements.DEFINITIONS, guestsPerIp = rules.GUESTS_PER_IP, crackDecayMs = rules.CRACK_DECAY_SECONDS * 1000,
  auth = null, publicUrl = null, tapsPerSecond = null, tapLogMs = 60 * 1000, adminKey = null } = {}) {
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
  app.use('/admin', adminRouter({ pool, key: adminKey, production: !!publicUrl, hooks: adminHooks() }));
  // Browsers check every file for a newer version (a quick "not modified" when unchanged), so after an update
  // nobody keeps running old game code from their cache. Also serves /privacy and /terms.
  app.use(express.static(__dirname + '/public', { extensions: ['html'], setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

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
        const map = { id: m.id, name: m.name, style: m.style, seed: m.seed, terrainAt: world ? world.at : () => 'grass',
          room: 'map:' + m.id, cells: new Map(), counts: new Map(),
          players: new Map(m.players.map(p => [p.player_id, { name: p.name, color: p.color, skin: p.skin_id, coverage: p.coverage,
            unlocked: p.unlocked, wipeFloor: p.wipe_floor, upgrades: upgradesOf(p) }])),
          hits: new Map(), claiming: new Set(), queue: Promise.resolve() };
        for (const c of m.cells) {
          map.cells.set(key(c.x, c.y), c.owner_id);
          if (c.owner_id) map.counts.set(c.owner_id, (map.counts.get(c.owner_id) || 0) + 1);
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

  // Lifetime totals (totals.js), checked like any other stat.
  const totals = createTotals(pool, { onStat: (pid, name, value) => events.emit('stat', { pid, name, value }) });

  // A player's balance changed (claims, purchases, rewards, admin): every device, and the Saving achievements.
  function balanceChanged(pid, balance) {
    for (const s of io.sockets.sockets.values()) if (String(s.data.me?.pid) === String(pid)) s.data.me.squares = balance;
    io.to('player:' + pid).emit('squares', rules.shownSquares(balance));
    totals.best(pid, 'squaresHeld', rules.shownSquares(balance));
    if (rules.shownSquares(balance) === 1337) totals.best(pid, 'secret:leet', 1);
  }

  // Every stat an achievement can use, as it stands now: lifetime totals, upgrade levels, records on any map,
  // maps played, achievements earned. For the Achievements screen, and to catch up on connecting.
  async function progressValues(pid, levels, account) {
    const [values, progress, played] = await Promise.all([totals.values(pid), store.achievementProgress(pool, pid), store.mapsPlayed(pool, pid)]);
    const out = { ...values, owned: progress.best.owned, bestSquare: progress.best.bestSquare, bestLine: progress.best.bestLine,
      mapsPlayed: played, achievements: progress.earned.filter(e => knownIds.has(e.id)).length };
    for (const [k, v] of Object.entries(levels)) out['level:' + k] = v;
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

  // Runs claims and wipes on one map in arrival order, so each sees the result of the one before.
  function serial(map, fn) {
    const run = map.queue.then(fn);
    map.queue = run.catch(() => {});
    return run;
  }

  function setOwner(map, k, pid) {
    const old = map.cells.get(k);
    if (old) map.counts.set(old, map.counts.get(old) - 1);
    if (pid) map.counts.set(pid, (map.counts.get(pid) || 0) + 1);
    map.cells.set(k, pid);
  }

  // Browsers see crack progress as a share of the hits needed (p, from 0 to 1), not the hits themselves.
  const share = h => Math.round(Math.min(1, h.n / h.need) * 1000) / 1000;

  // Cracks fade (rules.decayCrack). Tells everyone when progress is lost.
  function decay(map, k, h, now) {
    const d = rules.decayCrack(h, now, crackDecayMs);
    if (!d.lost) return;
    h.n = d.n;
    h.at = d.at;
    if (!h.n) map.hits.delete(k);
    const [x, y] = k.split(',').map(Number);
    io.to(map.room).emit('hit', { x, y, p: share(h) });
  }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const map of loaded) for (const [k, h] of map.hits) decay(map, k, h, now);
  }, Math.min(1000, crackDecayMs / 4));
  sweep.unref();
  server.on('close', () => { clearInterval(sweep); clearInterval(tapLog); });

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
      squaresChanged: balanceChanged,
      // After a restore: forget every loaded map and disconnect everyone, who reconnect to the restored game.
      reloadAll() {
        maps.clear();
        loaded.clear();
        for (const s of io.sockets.sockets.values()) {
          s.emit('notice', { kind: 'restored', message: 'The game was restored from a backup. Reload the page to keep playing.' });
          s.disconnect(true);
        }
      },
    };
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
    let me, map, upgrades, upgraded = false, loginFailed = false;
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
      me = player ? { pid: player.id, name: player.name, account: !!player.auth_user_id, renameAt: renameAt(player.name_changed_at), squares: player.squares,
          tutorial: player.tutorial }
        : { pid: null, name: guestName(), account: false, renameAt: null, squares: 0, tutorial: null };
      upgrades = player ? upgradesOf(player) : rules.NO_UPGRADES;
      if (upgraded) renamed(me.pid, me.name);   // the guest's old name was showing to everyone
      map = (player?.last_map_id && await getMap(player.last_map_id)) || await getMap(await getDefaultMapId());
      if (player && player.last_map_id !== map.id) await store.setLastMap(pool, player.id, map.id);
    } catch (err) {
      console.error(`Could not set up a player: ${err.message}`);
      socket.emit('denied', 'The server is having trouble. Try again in a moment.');
      return socket.disconnect();
    }
    socket.data.me = me;
    socket.data.setUpgrades = u => { upgrades = u; };   // a purchase on any device changes them at once
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
      catchUp(me.pid, upgrades, me.account).catch(err => console.error(`CATCH-UP FAILED (player ${me.pid}): ${err.message}`));
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
      const mine = map.players.get(me.pid);
      color = mine?.color ?? rules.COLORS[Math.floor(Math.random() * rules.COLORS.length)].hex;
      skin = mine?.skin ?? 'default';
      coverage = mine?.coverage ?? rules.COVERAGES[0];
      socket.emit('welcome', {
        // locked: color, skin and coverage are set here; wipeFloor: see the wipe rule; squares: whole squares
        me: { ...me, color, skin, coverage, locked: lockedHere(), wipeFloor: mine?.wipeFloor ?? 0, squares: rules.shownSquares(me.squares) },
        choices: { colors: rules.COLORS, coverages: rules.COVERAGES },
        hitsPerBlock: rules.HITS_PER_BLOCK,
        settings: { nameLabelShare: rules.NAME_LABEL_SHARE, nameMaxLength: rules.NAME_MAX_LENGTH, sound: rules.SOUND, terrain: rules.TERRAIN,
          skinKinds: SKIN_KINDS },   // how to draw each skin: pattern (in the owner's color) or art
        accounts: !!auth,                         // false when logins aren't set up on this server
        upgraded: false, loginFailed: false,      // see `flags`
        ...flags,
        map: { id: map.id, name: map.name, style: map.style, seed: map.seed },
        cells: [...map.cells].map(([k, owner]) => [...k.split(',').map(Number), owner]),
        players: Object.fromEntries([...map.players].map(([pid, { upgrades, ...shown }]) => [pid, shown])),
        hits: [...map.hits].map(([k, h]) => [...k.split(',').map(Number), share(h)]),
        chat: chats.get(map.id) ?? [],
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
      const error = checkHit(map, me.pid, x, y);
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
      const earn = rules.squaresForFirstClaim(upgrades) + (ground === 'gold' ? rules.GOLD_BONUS_SQUARES : 0);
      const r = await store.claimBlock(pool, { mapId: map.id, x, y, from, playerId: me.pid, newGuest,
        color: joining ? color : null, coverage, skin, earn, grow: rules.growthBlocks(upgrades), stats: st.stats });
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
        map.players.set(me.pid, { name: me.name, color, skin, coverage, unlocked: false, wipeFloor: before?.wipeFloor ?? 0, upgrades });
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
        io.to(map.room).emit('grow', g);
      }
      if (r.squares !== null) {
        // Whole squares this claim mined, for the rising-square animation (rewards don't animate).
        const mined = rules.shownSquares(r.squares) - rules.shownSquares(me.squares);
        if (mined > 0) socket.emit('mined', { x, y, count: mined });
        balanceChanged(me.pid, r.squares);
      }
      claimStats({ x, y, k, from, ground, grown: r.grown.length, earned: r.squares !== null ? earn : 0, joinedMap: r.joinedMap });
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
        if (!map.counts.get(from)) comeback.add(from + '|' + map.id);
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
      const error = checkHit(map, me.pid, x, y);
      if (error) {
        if (error === 'You already own this block' && ++session.pokes === 50) totals.best(me.pid, 'secret:poke', 1);
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

      // Progress only counts while the same player keeps hitting the block, and fades when they stop.
      // Each click adds the player's Click Power; the owner's Defense sets the hits needed.
      const by = me.pid ?? 'visitor:' + socket.id, now = Date.now();
      let h = map.hits.get(k);
      if (h) decay(map, k, h, now);
      h = map.hits.get(k);
      const owner = map.cells.get(k);
      const need = rules.hitsNeeded(owner ? map.players.get(owner)?.upgrades ?? rules.NO_UPGRADES : null, map.terrainAt(x, y));
      // Hit power left over from the tap that took the last block counts toward the next one, so a higher Click
      // Power level never wastes power (GAME-RULES.md).
      if (h?.by !== by) { map.hits.set(k, h = { by, n: session.spare }); session.spare = 0; }
      h.at = now;
      h.need = need;
      h.n += rules.hitPower(upgrades);
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

    // Clears this player's whole territory on this map, and unlocks their color, skin and coverage here.
    socket.on('wipe', () => {
      if (!me.pid) return;
      const here = map;
      serial(here, async () => {
        const r = await wipeOn(here, me.pid);
        if (!r) return socket.emit('denied', 'You have no blocks to wipe');
        totals.bump(me.pid, 'wipes');
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
      const msg = { pid: me.pid, name: me.name, text, at: now };
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
      if (!me.pid) return reply({ list: shown(new Set()), earned: [], values: {} });
      try {
        const { values, earned: rows } = await progressValues(me.pid, upgrades, me.account);
        reply({ list: shown(new Set(rows.map(e => e.id))), earned: rows, values });
      } catch { reply({ error: 'Could not load achievements. Try again.' }); }
    });

    // The Upgrades screen: this player's levels and what each level does, from rules.js.
    socket.on('upgrades', (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      reply({ levels: upgrades, hitsPerBlock: rules.HITS_PER_BLOCK, squaresPerClaim: rules.SQUARES_PER_FIRST_CLAIM,
        upgrades: rules.UPGRADES,       // { clickPower: [{ level, value, cost }, …], … } from the sheet
        balance: Number(me.squares) }); // the exact balance, so "Need X more" is right with fractions
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
        const r = await store.buySkin(pool, me.pid, skin);
        if (r.error) return reply(r);
        balanceChanged(me.pid, r.squares);
        totals.bump(me.pid, 'squaresSpent', r.price);
        reply({ squares: rules.shownSquares(r.squares), balance: r.squares });
      } catch (err) {
        console.error(`SKIN PURCHASE FAILED (player ${me.pid}, ${p?.skin}): ${err.message}`);
        reply({ error: 'Could not buy that. Try again.' });
      } finally {
        buying = false;
      }
    });

    // Buys the next level of an upgrade with squares: { upgrade, level } where level is the one the player
    // sees (so a double tap can't buy twice). Guests may buy. Answers with { levels, squares, balance } or
    // { error, need }. The new level works straight away on every device and map.
    socket.on('buyUpgrade', async (p, reply) => {
      if (typeof reply !== 'function') return;
      if (!me.pid) return reply({ error: 'Claim a block first' });
      if (!p || !(p.upgrade in rules.UPGRADES) || !Number.isInteger(p.level)) return reply({ error: 'Unknown upgrade' });
      if (buying) return reply({ error: 'One purchase at a time' });
      buying = true;
      try {
        const r = await store.buyUpgrade(pool, me.pid, p.upgrade, p.level, rules.UPGRADES[p.upgrade]);
        if (r.error) return reply({ error: r.error, need: r.need });
        upgradesChanged(me.pid, { ...upgrades, [p.upgrade]: r.level }, r.squares);
        totals.bump(me.pid, 'purchases');
        totals.bump(me.pid, 'squaresSpent', rules.UPGRADES[p.upgrade][r.level].cost);
        totals.best(me.pid, 'level:' + p.upgrade, r.level);
        reply({ levels: upgrades, squares: rules.shownSquares(r.squares), balance: r.squares });
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
      try { reply(await store.skinsFor(pool, me.pid)); } catch { reply([]); }
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

  return { server, io, events, totals };
}

module.exports = { createGame };
