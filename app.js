const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Server } = require('socket.io');
const store = require('./store');
const { adminRouter, bannedMessage } = require('./admin');
const rules = require('./rules');
const chat = require('./chat');
const stats = require('./stats');
const achievements = require('./achievements');
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
  app.use(express.static(__dirname + '/public', { extensions: ['html'] }));   // also serves /privacy and /terms

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
        const map = { id: m.id, name: m.name, style: m.style, room: 'map:' + m.id, cells: new Map(), counts: new Map(),
          players: new Map(m.players.map(p => [p.player_id, { name: p.name, color: p.color, skin: p.skin_id, coverage: p.coverage,
            unlocked: p.unlocked, wipeFloor: p.wipe_floor, upgrades: upgradesOf(p) }])),
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
        const a = { id: d.id, name: d.name, stat: d.stat, threshold: d.threshold, mapId };
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
      squaresChanged(pid, balance) {
        for (const s of socketsOf([pid])) s.data.me.squares = balance;
        io.to('player:' + pid).emit('squares', rules.shownSquares(balance));
      },
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

  // A purchase: new upgrade levels and balance for every connection of the player and every loaded map (where
  // Defense is read from), so the new level counts from the next tap.
  function upgradesChanged(pid, levels, balance) {
    for (const s of io.sockets.sockets.values()) {
      if (s.data.me?.pid !== pid) continue;
      s.data.setUpgrades(levels);
      s.data.me.squares = balance;
    }
    for (const map of loaded) { const p = map.players.get(pid); if (p) p.upgrades = levels; }
    io.to('player:' + pid).emit('squares', rules.shownSquares(balance));
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

    // Puts this connection on `next` and sends the whole map. Also used when switching maps, so the browser
    // handles a switch like a fresh welcome.
    function enter(next, flags = {}) {
      if (map) socket.leave(map.room);
      map = next;
      socket.data.mapId = map.id;
      socket.join(map.room);
      const mine = map.players.get(me.pid);
      color = mine?.color ?? rules.COLORS[Math.floor(Math.random() * rules.COLORS.length)].hex;
      skin = mine?.skin ?? 'default';
      coverage = mine?.coverage ?? rules.COVERAGES[0];
      socket.emit('welcome', {
        // locked: color, skin and coverage are set here; wipeFloor: see the wipe rule; squares: whole squares
        me: { ...me, color, skin, coverage, locked: lockedHere(), wipeFloor: mine?.wipeFloor ?? 0, squares: rules.shownSquares(me.squares) },
        choices: { colors: rules.COLORS, coverages: rules.COVERAGES },
        hitsPerBlock: rules.HITS_PER_BLOCK,
        settings: { nameLabelShare: rules.NAME_LABEL_SHARE, nameMaxLength: rules.NAME_MAX_LENGTH, sound: rules.SOUND },
        accounts: !!auth,                         // false when logins aren't set up on this server
        upgraded: false, loginFailed: false,      // see `flags`
        ...flags,
        map: { id: map.id, name: map.name, style: map.style },
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
      const r = await store.claimBlock(pool, { mapId: map.id, x, y, from, playerId: me.pid, newGuest,
        color: joining ? color : null, coverage, skin, earn: rules.squaresForFirstClaim(upgrades), grow: rules.growthBlocks(upgrades),
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
        const before = map.players.get(me.pid);
        map.players.set(me.pid, { name: me.name, color, skin, coverage, unlocked: false, wipeFloor: before?.wipeFloor ?? 0, upgrades });
        io.to(map.room).emit('player', { pid: me.pid, name: me.name, color, skin, coverage });
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
      for (const g of r.grown) {   // one new block, or more with Growth
        map.cells.set(key(g.x, g.y), null);
        io.to(map.room).emit('grow', g);
      }
      if (r.squares !== null) {
        me.squares = r.squares;
        io.to('player:' + me.pid).emit('squares', rules.shownSquares(r.squares));
      }
    }

    socket.on('hit', p => {
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return;
      const who = me.pid ?? 'visitor:' + socket.id;
      const t = rules.tapAllowed(taps.get(who), Date.now(), tapsPerSecond ?? rules.MAX_TAPS_PER_SECOND);
      taps.set(who, t.bucket);
      if (!t.allowed) return ignoredTaps.set(who, (ignoredTaps.get(who) || 0) + 1);
      const { x, y } = p, k = key(x, y);
      const error = checkHit(map, me.pid, x, y);
      if (error) return socket.emit('denied', error);

      // Progress only counts while the same player keeps hitting the block, and fades when they stop.
      // Each click adds the player's Click Power; the owner's Defense sets the hits needed.
      const by = me.pid ?? 'visitor:' + socket.id, now = Date.now();
      let h = map.hits.get(k);
      if (h) decay(map, k, h, now);
      h = map.hits.get(k);
      const owner = map.cells.get(k);
      const need = rules.hitsNeeded(owner ? map.players.get(owner)?.upgrades ?? rules.NO_UPGRADES : null);
      if (h?.by !== by) map.hits.set(k, h = { by, n: 0 });
      h.at = now;
      h.need = need;
      h.n += rules.hitPower(upgrades);
      if (!rules.isTaken(h.n, need)) return io.to(map.room).emit('hit', { x, y, p: share(h) });

      map.hits.delete(k);
      const here = map;
      serial(map, () => finishClaim(here, x, y)).catch(err => {
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
        if (!await wipeOn(here, me.pid)) socket.emit('denied', 'You have no blocks to wipe');
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
      const list = achievementList.map(({ id, name, stat, threshold }) => ({ id, name, stat, threshold }));
      if (!me.pid) return reply({ list, earned: [], best: {} });
      try { reply({ list, ...await store.achievementProgress(pool, me.pid) }); } catch { reply({ error: 'Could not load achievements. Try again.' }); }
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
      // One save at a time, in the order sent, so an older save can never land last.
      tutorialSaves = tutorialSaves.then(() => store.saveTutorial(pool, me.pid, progress)).then(() => reply({ ok: true }), err => {
        console.error(`TUTORIAL SAVE FAILED (player ${me.pid}): ${err.message}`);
        reply({ error: 'Not saved' });
      });
    });

    // Buys the next level of an upgrade with squares: { upgrade, level } where level is the one the player
    // sees (so a double tap can't buy twice). Guests may buy. Answers with { levels, squares, balance } or
    // { error, need }. The new level works straight away on every device and map.
    let buying = false;
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
