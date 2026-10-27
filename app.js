const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const store = require('./store');
const { guestName, guestNames, randomColor } = require('./names');

const HITS = 3;                       // clicks needed to take a block
const GUESTS_PER_IP = 5;              // new guest players one network may create…
const GUEST_WINDOW_MS = 60 * 60 * 1000;   // …per hour

const key = (x, y) => x + ',' + y;
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Behind Render the socket address is a proxy's. Cloudflare (in front of every public Render service) sets
// CF-Connecting-IP and overwrites any value the visitor sends, so prefer it. X-Forwarded-For is only a fallback:
// Render appends to it without clearing it, so its first entry can be forged.
function clientIp(socket) {
  const h = socket.handshake.headers;
  return h['cf-connecting-ip'] || h['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
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
function createGame(pool, { guestsPerIp = GUESTS_PER_IP } = {}) {
  const app = express();
  app.use(express.static(__dirname + '/public'));
  const server = http.createServer(app);
  const io = new Server(server);
  const limiter = guestLimiter(guestsPerIp, GUEST_WINDOW_MS);

  // In-memory copy of each loaded map:
  //   cells:   "x,y" -> owner id or null    players: id -> { name, color }
  //   counts:  owner id -> blocks owned      hits:    "x,y" -> { by, n } (crack progress, never saved)
  const maps = new Map();   // id -> Promise of the map
  function getMap(id) {
    if (!maps.has(id)) {
      maps.set(id, store.loadMap(pool, id).then(m => {
        if (!m) return null;
        const map = { id: m.id, name: m.name, style: m.style, room: 'map:' + m.id, cells: new Map(), counts: new Map(),
          players: new Map(m.players.map(p => [p.player_id, { name: p.name, color: p.color }])), hits: new Map(), queue: Promise.resolve() };
        for (const c of m.cells) {
          map.cells.set(key(c.x, c.y), c.owner_id);
          if (c.owner_id) map.counts.set(c.owner_id, (map.counts.get(c.owner_id) || 0) + 1);
        }
        return map;
      }).catch(err => { maps.delete(id); throw err; }));
    }
    return maps.get(id);
  }
  let defaultMap;
  const getDefaultMapId = () => (defaultMap ??= store.defaultMapId(pool).catch(err => { defaultMap = null; throw err; }));

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

  // Returns an error message, or null if player `pid` (null for a visitor with no account yet) may hit (x, y).
  function checkHit(map, pid, x, y) {
    const k = key(x, y);
    if (!map.cells.has(k)) return 'Invalid block';
    const owner = map.cells.get(k);
    if (pid && owner === pid) return 'You already own this block';
    if (!pid || !map.counts.get(pid)) return owner ? 'Your first block must be unclaimed' : null;
    const near = NEIGHBORS.some(([dx, dy]) => map.cells.get(key(x + dx, y + dy)) === pid);
    return near ? null : 'You can only take blocks next to your territory';
  }

  io.on('connection', async socket => {
    const ip = clientIp(socket);
    let me, map, color;
    try {
      // Returning players are recognised by their secret token. Visitors get a name and color to show,
      // but no database row until their first claim.
      const player = await store.findPlayerByToken(pool, socket.handshake.auth?.token);
      me = player ? { pid: player.id, name: player.name } : { pid: null, name: guestName() };
      map = (player?.last_map_id && await getMap(player.last_map_id)) || await getMap(await getDefaultMapId());
      if (player && player.last_map_id !== map.id) await store.setLastMap(pool, player.id, map.id);
    } catch (err) {
      console.error(`Could not set up a player: ${err.message}`);
      socket.emit('denied', 'The server is having trouble. Try again in a moment.');
      return socket.disconnect();
    }
    color = map.players.get(me.pid)?.color ?? randomColor();
    socket.join(map.room);
    if (me.pid) socket.join('player:' + me.pid);

    socket.emit('welcome', {
      me: { pid: me.pid, name: me.name, color },
      map: { id: map.id, name: map.name, style: map.style },
      cells: [...map.cells].map(([k, owner]) => [...k.split(',').map(Number), owner]),
      players: Object.fromEntries(map.players),
      hits: [...map.hits].map(([k, h]) => [...k.split(',').map(Number), h.n]),
    });

    const clearCrack = (x, y) => io.to(map.room).emit('hit', { x, y, n: 0 });

    // Runs in the map's queue after the third hit. Checks the rules again, since the map may have changed.
    async function finishClaim(x, y) {
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

      const r = await store.claimBlock(pool, { mapId: map.id, x, y, from, playerId: me.pid, newGuest,
        color: map.players.has(me.pid) ? null : color });
      if (r.conflict) {
        // Another server got there first (e.g. during a deploy). Resync this block for everyone.
        setOwner(map, k, await store.cellOwner(pool, map.id, x, y));
        socket.emit('denied', 'Someone got there first');
        io.to(map.room).emit('claim', { x, y, pid: map.cells.get(k) });
        return;
      }

      if (newGuest) {
        limiter.record(ip);
        me = { pid: r.playerId, name: r.name };
        socket.join('player:' + me.pid);
        socket.emit('you', { token, pid: me.pid, name: me.name });
      }
      if (r.joinedMap) {
        map.players.set(me.pid, { name: me.name, color });
        io.to(map.room).emit('player', { pid: me.pid, name: me.name, color });
      }
      setOwner(map, k, me.pid);
      io.to(map.room).emit('claim', { x, y, pid: me.pid });
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

      // Progress only counts while the same player keeps hitting the block.
      const by = me.pid ?? 'visitor:' + socket.id;
      let h = map.hits.get(k);
      if (h?.by !== by) map.hits.set(k, h = { by, n: 0 });
      if (++h.n < HITS) return io.to(map.room).emit('hit', { x, y, n: h.n });

      map.hits.delete(k);
      serial(map, () => finishClaim(x, y)).catch(err => {
        console.error(`CLAIM FAILED (map ${map.id}, ${k}): ${err.message}`);
        socket.emit('denied', 'Could not save your claim. Try again.');
        clearCrack(x, y);
      });
    });

    // Clears this player's whole territory on this map. There is no button for it yet.
    socket.on('wipe', () => {
      if (!me.pid) return;
      serial(map, async () => {
        const r = await store.wipeTerritory(pool, map.id, me.pid);
        if (!r) return socket.emit('denied', 'You have no blocks to wipe');
        for (const [x, y] of r.cells) setOwner(map, key(x, y), null);
        io.to(map.room).emit('wipe', { pid: me.pid, cells: r.cells });
      }).catch(err => {
        console.error(`WIPE FAILED (map ${map.id}, player ${me.pid}): ${err.message}`);
        socket.emit('denied', 'Could not wipe your territory. Try again.');
      });
    });
  });

  return { server, io };
}

module.exports = { createGame };
