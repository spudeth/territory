const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createGame } = require('../app');
const { testDb } = require('./helpers');

let db, pool, mapId, game, url;
const sockets = [];
before(async () => {
  ({ pool, mapId } = db = await testDb());
  game = createGame(pool, { guestsPerIp: 2 });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db?.drop();
});

// A player's browser. Each gets its own IP unless told otherwise, so the guest limit only bites when meant to.
let nextIp = 1;
function player({ token, ip = `10.0.0.${nextIp++}` } = {}) {
  const s = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false,
    extraHeaders: { 'cf-connecting-ip': ip, 'x-forwarded-for': '203.0.113.9' } });
  sockets.push(s);
  const events = [];
  s.onAny((name, data) => events.push([name, data]));
  s.events = events;
  // Resolves with the first `name` event (already received or still to come) that passes `match`.
  s.next = (name, match = () => true, ms = 15000) => new Promise((resolve, reject) => {
    const hit = events.find(([n, d]) => n === name && match(d));
    if (hit) { events.splice(events.indexOf(hit), 1); return resolve(hit[1]); }
    const timer = setTimeout(() => { s.offAny(on); reject(new Error(`no "${name}" event within ${ms}ms`)); }, ms);
    function on(n, d) {
      if (n !== name || !match(d)) return;
      clearTimeout(timer); s.offAny(on);
      events.splice(events.findIndex(e => e[1] === d), 1);
      resolve(d);
    }
    s.onAny(on);
  });
  s.welcome = s.next('welcome');
  s.hit3 = (x, y) => { for (let i = 0; i < 3; i++) s.emit('hit', { x, y }); };
  return s;
}
const at = (x, y) => d => d.x === x && d.y === y;
const cellCount = () => db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [mapId]);
const owner = async (x, y) => (await pool.query('SELECT owner_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y])).rows[0].owner_id;

test('a visitor has no database row until their first claim, then keeps their player across reconnects', async () => {
  const players = await db.count('SELECT count(*) FROM players');
  const a = player();
  const w = await a.welcome;
  assert.equal(w.me.pid, null);
  assert.ok(w.me.name.length <= 15);
  assert.equal(w.cells.length, 1024);
  assert.equal(await db.count('SELECT count(*) FROM players'), players, 'connecting created nothing');

  const cells = await cellCount();
  a.hit3(0, 0);
  const you = await a.next('you');
  assert.equal(you.name, w.me.name, 'they keep the name they were shown');
  assert.equal((await a.next('claim', at(0, 0))).pid, you.pid);
  assert.ok(await a.next('grow'));
  assert.equal(await a.next('squares'), 1);
  assert.equal(await db.count('SELECT count(*) FROM players'), players + 1);
  assert.equal(await cellCount(), cells + 1);

  a.disconnect();
  const again = player({ token: you.token });
  const w2 = await again.welcome;
  assert.equal(w2.me.pid, you.pid);
  assert.equal(w2.me.name, you.name);
  assert.equal(w2.cells.find(([x, y]) => x === 0 && y === 0)[2], you.pid);
});

test('a "__proto__" or made-up token is treated as a new visitor', async () => {
  for (const token of ['__proto__', 'constructor', 'not-a-real-token']) {
    assert.equal((await player({ token }).welcome).me.pid, null, token);
  }
});

test('two players claiming different blocks at the same time both succeed, and everyone sees both', async () => {
  const a = player(), b = player(), watcher = player();
  await Promise.all([a.welcome, b.welcome, watcher.welcome]);
  const cells = await cellCount();
  a.hit3(5, 5);
  b.hit3(6, 5);
  const [ya, yb] = await Promise.all([a.next('you'), b.next('you')]);
  const [ca, cb] = await Promise.all([watcher.next('claim', at(5, 5)), watcher.next('claim', at(6, 5))]);
  assert.equal(ca.pid, ya.pid);
  assert.equal(cb.pid, yb.pid);
  const grows = [await watcher.next('grow'), await watcher.next('grow')];
  assert.notDeepEqual(grows[0], grows[1]);
  assert.equal(await cellCount(), cells + 2);
  assert.equal(await owner(5, 5), ya.pid);
  assert.equal(await owner(6, 5), yb.pid);
});

test('two players racing for the same block: at most one gets it, and the database agrees with what players saw', async () => {
  // Which hits arrive first is up to the network, so check what must hold whoever wins (or if neither does).
  for (const [x, y] of [[9, 9], [9, 11], [9, 13]]) {
    const a = player(), b = player(), watcher = player();
    await Promise.all([a.welcome, b.welcome, watcher.welcome]);
    const cells = await cellCount();
    for (let i = 0; i < 6; i++) { a.emit('hit', { x, y }); b.emit('hit', { x, y }); }
    await new Promise(r => setTimeout(r, 2500));   // let every claim attempt finish
    const claims = watcher.events.filter(([n, d]) => n === 'claim' && d.x === x && d.y === y).map(([, d]) => d.pid);
    assert.ok(claims.length <= 1, 'the block was claimed at most once');
    assert.equal(await owner(x, y), claims[0] ?? null);
    assert.equal(await cellCount(), cells + claims.length, 'the map grew once per claim');
  }
});

test('the rules still apply: a first block must be empty, later ones must touch your territory', async () => {
  const a = player();
  await a.welcome;
  a.emit('hit', { x: 0, y: 0 });   // owned by the first test's player
  assert.equal(await a.next('denied'), 'Your first block must be unclaimed');
  a.hit3(20, 20);
  await a.next('you');
  a.emit('hit', { x: 25, y: 25 });
  assert.equal(await a.next('denied'), 'You can only take blocks next to your territory');
  a.emit('hit', { x: 1e9, y: 0 });
  assert.equal(await a.next('denied'), 'Invalid block');
});

test('only a limited number of new guests per IP address', async () => {
  const ip = '198.51.100.7';
  const [p1, p2, p3] = [player({ ip }), player({ ip }), player({ ip })];
  await Promise.all([p1.welcome, p2.welcome, p3.welcome]);
  const players = await db.count('SELECT count(*) FROM players');
  p1.hit3(0, 30); await p1.next('you');
  p2.hit3(2, 30); await p2.next('you');
  p3.hit3(4, 30);
  assert.match(await p3.next('denied'), /Too many new players/);
  assert.equal(await db.count('SELECT count(*) FROM players'), players + 2);

  const other = player();   // a different network is unaffected
  await other.welcome;
  other.hit3(6, 30);
  await other.next('you');
});

test('a wipe clears the territory for everyone and frees the land', async () => {
  const a = player(), watcher = player();
  await Promise.all([a.welcome, watcher.welcome]);
  a.hit3(10, 15); const you = await a.next('you');
  a.hit3(11, 15); await a.next('claim', at(11, 15));
  a.emit('wipe');
  const w = await watcher.next('wipe');
  assert.equal(w.pid, you.pid);
  assert.deepEqual(w.cells.map(c => c.join(',')).sort(), ['10,15', '11,15']);
  assert.equal(await owner(10, 15), null);
  assert.equal(await db.count('SELECT count(*) FROM map_wipes WHERE player_id = $1 AND blocks_owned = 2', [you.pid]), 1);

  // Retaking freed land is a first claim again: the map grows, but no square is earned (2 blocks is not more than N = 2).
  const cells = await cellCount();
  a.hit3(10, 15); await a.next('claim', at(10, 15));
  a.hit3(11, 15); await a.next('claim', at(11, 15));
  assert.equal(await cellCount(), cells + 2);
  a.hit3(12, 15); await a.next('claim', at(12, 15));
  assert.equal(await a.next('squares', n => n === 3), 3, 'the third block is beyond N and earns a square');
});
