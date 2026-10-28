const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Server } = require('socket.io');
const store = require('./store');
const rules = require('./rules');
const stats = require('./stats');
const achievements = require('./achievements');
const { guestName, guestNames, checkName, randomColor } = require('./names');

const { key } = rules;
const upgradesOf = row => ({ clickPower: row.click_power, defense: row.defense, earnings: row.earnings });

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
  auth = null, publicUrl = null } = {}) {
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
  app.use(express.static(__dirname + '/public', { extensions: ['html'] }));   // also serves /privacy and /terms

  const server = http.createServer(app);
  // Large messages (the whole map on joining: 1.4 MB at 100,000 blocks) are compressed, fast setting, to about
  // a fifth. Small ones (hits, claims) are sent as they are.
  const io = new Server(server, { perMessageDeflate: { threshold: 4096, zlibDeflateOptions: { level: 1 } } });
  const limiter = guestLimiter(guestsPerIp, rules.GUEST_WINDOW_MINUTES * 60 * 1000);

  // In-memory copy of each loaded map:
  //   cells:   "x,y" -> owner id or null    players: id -> { name, color, coverage }
  //   counts:  owner id -> blocks owned      hits:    "x,y" -> { by, n, at } (crack progress, never saved)
  const maps = new Map();     // id -> Promise of the map
  const loaded = new Set();   // the maps that have finished loading
  function getMap(id) {
    if (!maps.has(id)) {
      maps.set(id, store.loadMap(pool, id).then(m => {
        if (!m) return null;
        const map = { id: m.id, name: m.name, style: m.style, room: 'map:' + m.id, cells: new Map(), counts: new Map(),
          players: new Map(m.players.map(p => [p.player_id, { name: p.name, color: p.color, coverage: p.coverage, upgrades: upgradesOf(p) }])),
          hits: new Map(), queue: Promise.resolve() };
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
  let checks = Promise.resolve();   // one player's checks never overlap another's save
  events.on('stat', ({ mapId, pid, name, value }) => {
    if (!byStat.has(name)) return;
    checks = checks.then(async () => {
      const have = await earnedBy(pid);
      const hits = achievements.reached(byStat, name, value, have);
      if (!hits.length) return;
      const fresh = new Set(await store.earnAchievements(pool, pid, mapId, hits.map(d => d.id)));
      for (const d of hits) {
        have.add(d.id);
        if (!fresh.has(d.id)) continue;
        const a = { id: d.id, name: d.name, mapId };
        events.emit('achievement', { pid, ...a });
        io.to('player:' + pid).emit('achievement', a);
      }
    }).catch(err => console.error(`ACHIEVEMENT CHECK FAILED (player ${pid}): ${err.message}`));
  });

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

  // Cracks fade (rules.decayCrack). Tells everyone when a level is lost.
  function decay(map, k, h, now) {
    const d = rules.decayCrack(h, now, crackDecayMs);
    if (!d.lost) return;
    h.n = d.n;
    h.at = d.at;
    if (!h.n) map.hits.delete(k);
    const [x, y] = k.split(',').map(Number);
    io.to(map.room).emit('hit', { x, y, n: h.n });
  }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const map of loaded) for (const [k, h] of map.hits) decay(map, k, h, now);
  }, Math.min(1000, crackDecayMs / 4));
  sweep.unref();
  server.on('close', () => clearInterval(sweep));

  const checkHit = rules.hitError;

  // When this player may rename again (ms since 1970), or null if they may now.
  const renameAt = changedAt => {
    const t = changedAt && new Date(changedAt).getTime() + rules.RENAME_COOLDOWN_MINUTES * 60 * 1000;
    return t > Date.now() ? t : null;
  };

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
      if (jwt && auth) {
        const authUserId = await auth.verify(jwt);
        if (authUserId) {
          const ownGuest = upgrade === true && player && !player.auth_user_id ? player.id : null;
          ({ player, upgraded } = await store.accountPlayer(pool, authUserId, ownGuest));
        } else {
          loginFailed = true;
        }
      }
      me = player ? { pid: player.id, name: player.name, account: !!player.auth_user_id, renameAt: renameAt(player.name_changed_at) }
        : { pid: null, name: guestName(), account: false, renameAt: null };
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
    // Color, skin and coverage are fixed on the first claim on a map. Until then they are only proposals:
    // color is random for now, and the player may pick a coverage (the 'coverage' event).
    let color, coverage;
    if (me.pid) socket.join('player:' + me.pid);

    // Puts this connection on `next` and sends the whole map. Also used when switching maps, so the browser
    // handles a switch like a fresh welcome.
    function enter(next, flags = {}) {
      if (map) socket.leave(map.room);
      map = next;
      socket.join(map.room);
      color = map.players.get(me.pid)?.color ?? randomColor();
      coverage = map.players.get(me.pid)?.coverage ?? rules.COVERAGES[0];
      socket.emit('welcome', {
        me: { ...me, color, coverage, locked: map.players.has(me.pid) },   // locked: color, skin and coverage are set here
        accounts: !!auth,                         // false when logins aren't set up on this server
        upgraded: false, loginFailed: false,      // see `flags`
        ...flags,
        map: { id: map.id, name: map.name, style: map.style },
        cells: [...map.cells].map(([k, owner]) => [...k.split(',').map(Number), owner]),
        players: Object.fromEntries([...map.players].map(([pid, { upgrades, ...shown }]) => [pid, shown])),
        hits: [...map.hits].map(([k, h]) => [...k.split(',').map(Number), h.n]),
      });
    }
    // upgraded: the guest profile just became an account; the browser can forget its guest token
    // loginFailed: a login token was sent but wasn't valid
    const first = map;
    map = null;
    enter(first, { upgraded, loginFailed });

    const clearCrack = (x, y) => io.to(map.room).emit('hit', { x, y, n: 0 });

    // Runs in the map's queue after the last hit. Checks the rules again, since the map may have changed.
    // `here` is the map the last hit was on; if the player has switched maps since, the claim is dropped.
    async function finishClaim(here, x, y) {
      if (here !== map) return;
      const error = checkHit(map, me.pid, x, y);
      if (error) { socket.emit('denied', error); return clearCrack(x, y); }
      const k = key(x, y), from = map.cells.get(k);

      let token = null, newGuest = null;
      if (!me.pid) {
        if (!limiter.allowed(ip)) {
          socket.emit('denied', 'Too many new players from your network. Try again later.');
          return clearCrack(x, y);
        }
        token = crypto.randomUUID();
        newGuest = { names: guestNames(me.name), tokenHash: store.hashToken(token) };
      }

      const joining = !map.players.has(me.pid);
      const owns = (a, b) => (a === x && b === y) || (me.pid !== null && map.cells.get(key(a, b)) === me.pid);
      const st = stats.afterClaim(me.pid ? statsOf(map, me.pid) : stats.empty(),
        { owns, x, y, owned: (map.counts.get(me.pid) || 0) + 1, from });
      const r = await store.claimBlock(pool, { mapId: map.id, x, y, from, playerId: me.pid, newGuest,
        color: joining ? color : null, coverage, earn: rules.squaresForFirstClaim(upgrades),
        stats: st.stats });
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
      }
      if (r.joinedMap) {
        map.players.set(me.pid, { name: me.name, color, coverage, upgrades });
        io.to(map.room).emit('player', { pid: me.pid, name: me.name, color, coverage });
      }
      setOwner(map, k, me.pid);
      io.to(map.room).emit('claim', { x, y, pid: me.pid });
      map.stats.set(me.pid, st.stats);
      statChanged(map, me.pid, 'owned', map.counts.get(me.pid));
      for (const name of st.changed) statChanged(map, me.pid, name, st.stats[name]);
      if (from) {
        statChanged(map, from, 'owned', map.counts.get(from));
        statChanged(map, from, 'blocksLost', ++statsOf(map, from).blocksLost);
      }
      if (r.grown) {
        map.cells.set(key(r.grown.x, r.grown.y), null);
        io.to(map.room).emit('grow', r.grown);
      }
      if (r.squares !== null) io.to('player:' + me.pid).emit('squares', r.squares);
    }

    socket.on('hit', p => {
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return;
      const { x, y } = p, k = key(x, y);
      const error = checkHit(map, me.pid, x, y);
      if (error) return socket.emit('denied', error);

      // Progress only counts while the same player keeps hitting the block, and fades when they stop.
      const by = me.pid ?? 'visitor:' + socket.id, now = Date.now();
      let h = map.hits.get(k);
      if (h) decay(map, k, h, now);
      h = map.hits.get(k);
      if (h?.by !== by) map.hits.set(k, h = { by, n: 0 });
      h.at = now;
      const owner = map.cells.get(k);
      if (++h.n < rules.hitsToTake(upgrades, owner ? map.players.get(owner)?.upgrades ?? rules.NO_UPGRADES : null)) return io.to(map.room).emit('hit', { x, y, n: h.n });

      map.hits.delete(k);
      const here = map;
      serial(map, () => finishClaim(here, x, y)).catch(err => {
        console.error(`CLAIM FAILED (map ${map.id}, ${k}): ${err.message}`);
        socket.emit('denied', 'Could not save your claim. Try again.');
        clearCrack(x, y);
      });
    });

    // Clears this player's whole territory on this map. There is no button for it yet.
    socket.on('wipe', () => {
      if (!me.pid) return;
      const here = map;
      serial(here, async () => {
        const r = await store.wipeTerritory(pool, here.id, me.pid);
        if (!r) return socket.emit('denied', 'You have no blocks to wipe');
        for (const [x, y] of r.cells) setOwner(here, key(x, y), null);
        io.to(here.room).emit('wipe', { pid: me.pid, cells: r.cells });
        statChanged(here, me.pid, 'owned', 0);
      }).catch(err => {
        console.error(`WIPE FAILED (map ${here.id}, player ${me.pid}): ${err.message}`);
        socket.emit('denied', 'Could not wipe your territory. Try again.');
      });
    });

    // Picks how the player's skin will cover their territory on this map. Only before their first claim here:
    // after that it is locked, like color and skin. Answers with { coverage } or { error }.
    socket.on('coverage', (value, reply) => {
      if (typeof reply !== 'function') return;
      if (map.players.has(me.pid)) return reply({ error: 'Your coverage is locked for this map' });
      if (!rules.COVERAGES.includes(value)) return reply({ error: 'Unknown coverage' });
      coverage = value;
      reply({ coverage });
    });

    // The maps this player can go to. Answers with [{ id, name, style }].
    socket.on('maps', async (...args) => {
      const reply = args.at(-1);   // with or without an argument before it
      if (typeof reply !== 'function') return;
      try { reply(await store.listMaps(pool)); } catch { reply([]); }
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
        reply({ name: r.name, renameAt: me.renameAt });
      } catch (err) {
        console.error(`RENAME FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Could not change your name. Try again.' });
      }
    });
  });

  return { server, io, events };
}

module.exports = { createGame };
