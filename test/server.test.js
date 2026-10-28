const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createGame } = require('../app');
const rules = require('../rules');
const { testDb, connectPlayer } = require('./helpers');

const DECAY_MS = 400;   // crack decay, sped up from 60 seconds so the test is quick
let db, pool, mapId, game, url;
const sockets = [];
before(async () => {
  ({ pool, mapId } = db = await testDb());
  game = createGame(pool, { guestsPerIp: 2, crackDecayMs: DECAY_MS, publicUrl: 'https://territory.sarl' });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db?.drop();
});

function player(opts) {
  const s = connectPlayer(url, opts);
  sockets.push(s);
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

test('cracks fade one level per decay period after the last hit, for everyone', async () => {
  const a = player(), watcher = player();
  await Promise.all([a.welcome, watcher.welcome]);
  a.emit('hit', { x: 3, y: 25 });
  a.emit('hit', { x: 3, y: 25 });
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.n === 2);
  const t0 = Date.now();
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.n === 1);
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.n === 0);
  const took = Date.now() - t0;
  assert.ok(took >= DECAY_MS * 1.5 && took < DECAY_MS * 4, `two levels faded in ${took}ms`);
  assert.equal(watcher.events.filter(([n]) => n === 'claim').length, 0, 'nothing was claimed');

  // A hit after some fading continues from the faded level: two hits, one level fades, so two more are needed.
  a.emit('hit', { x: 4, y: 25 });
  a.emit('hit', { x: 4, y: 25 });
  await watcher.next('hit', d => d.x === 4 && d.n === 1);   // the hits themselves
  await watcher.next('hit', d => d.x === 4 && d.n === 2);
  await watcher.next('hit', d => d.x === 4 && d.n === 1);   // then the fade
  a.emit('hit', { x: 4, y: 25 });
  await watcher.next('hit', d => d.x === 4 && d.n === 2);
  a.emit('hit', { x: 4, y: 25 });
  await watcher.next('claim', at(4, 25));
});

test('coverage is picked before the first claim on a map, then locked there for good', async () => {
  const a = player();
  const w = await a.welcome;
  assert.equal(w.me.coverage, 'tile', 'tile unless they pick');
  assert.equal(w.me.locked, false);
  assert.deepEqual(await a.ask('coverage', 'sideways'), { error: 'Unknown coverage' });
  assert.deepEqual(await a.ask('coverage', 'stretch'), { coverage: 'stretch' });
  a.hit3(12, 25);
  const you = await a.next('you');
  assert.equal((await a.next('player', d => d.pid === you.pid)).coverage, 'stretch');
  assert.deepEqual(await a.ask('coverage', 'tile'), { error: 'Your coverage is locked for this map' });
  const saved = 'SELECT coverage FROM player_map_settings WHERE player_id = $1';
  assert.equal((await pool.query(saved, [you.pid])).rows[0].coverage, 'stretch');

  // Coming back: still stretch, still locked.
  const again = player({ token: you.token });
  const w2 = await again.welcome;
  assert.equal(w2.me.coverage, 'stretch');
  assert.equal(w2.me.locked, true);
  assert.equal(w2.players[you.pid].coverage, 'stretch');
  assert.deepEqual(await again.ask('coverage', 'tile'), { error: 'Your coverage is locked for this map' });
});

test('the database refuses to change color, skin or coverage once set, but wipes still work', async () => {
  const a = player();
  await a.welcome;
  a.hit3(14, 25);
  const you = await a.next('you');
  for (const change of ["coverage = 'stretch'", "color = 'hsl(1, 75%, 55%)'", "skin_id = 'default', color = 'x'", "coverage_options = '{\"a\":1}'"]) {
    await assert.rejects(pool.query(`UPDATE player_map_settings SET ${change} WHERE player_id = $1`, [you.pid]),
      /locked once chosen/, change);
  }
  await assert.rejects(pool.query("INSERT INTO player_map_settings (player_id, map_id, color, skin_id, coverage) VALUES ($1, $2, 'red', 'default', 'sideways')",
    [you.pid, '999']), /player_map_settings_coverage|violates/);
  a.emit('wipe');
  await a.next('wipe');
  assert.equal((await pool.query('SELECT wipe_floor FROM player_map_settings WHERE player_id = $1', [you.pid])).rows[0].wipe_floor, 1);
});

test("a player's upgrade levels change the hits they need and the squares they earn", async t => {
  const saved = [rules.CLICK_POWER_HITS_REMOVED, rules.EARNINGS_MULTIPLIER];
  t.after(() => { [rules.CLICK_POWER_HITS_REMOVED, rules.EARNINGS_MULTIPLIER] = saved; });
  const a = player();
  await a.welcome;
  a.hit3(16, 25);
  const you = await a.next('you');
  a.disconnect();
  rules.CLICK_POWER_HITS_REMOVED = [0, 2];
  rules.EARNINGS_MULTIPLIER = [1, 5];
  await pool.query('UPDATE players SET click_power = 1, earnings = 1 WHERE id = $1', [you.pid]);
  const b = player({ token: you.token });
  await b.welcome;
  b.emit('hit', { x: 17, y: 25 });   // one hit is enough now
  await b.next('claim', d => d.x === 17 && d.y === 25);
  const squares = await b.next('squares');
  assert.equal(squares, 6, '1 for the first block, then 5 with Earnings');
});

test('stats: counted per claim, saved, announced to the player and on the server, lost blocks counted too', async () => {
  const seen = [];
  game.events.on('stat', e => seen.push(e));
  const a = player(), b = player();
  await Promise.all([a.welcome, b.welcome]);
  a.hit3(20, 25);
  const youA = await a.next('you');
  a.hit3(21, 25);
  await a.next('stat', d => d.name === 'bestLine' && d.value === 2);
  b.hit3(23, 25);
  const youB = await b.next('you');
  b.hit3(22, 25);
  await b.next('claim', d => d.x === 22);
  a.hit3(22, 25);   // A retakes it from B
  await a.next('stat', d => d.name === 'retakes' && d.value === 1);
  await b.next('stat', d => d.name === 'blocksLost' && d.value === 1);
  assert.ok(seen.some(e => e.pid === youA.pid && e.mapId === mapId && e.name === 'bestLine' && e.value === 3));
  const row = pid => pool.query('SELECT owned_max, first_claims, retakes, blocks_lost, best_square, best_line FROM player_map_stats WHERE player_id = $1', [pid]).then(r => r.rows[0]);
  assert.deepEqual(await row(youA.pid), { owned_max: 3, first_claims: 2, retakes: 1, blocks_lost: 0, best_square: 1, best_line: 3 });
  assert.deepEqual(await row(youB.pid), { owned_max: 2, first_claims: 2, retakes: 0, blocks_lost: 1, best_square: 1, best_line: 2 });
});

test('guests cannot rename', async () => {
  const a = player();
  await a.welcome;
  assert.deepEqual(await a.ask('rename', 'Cool Name'), { error: 'Create an account to change your name' });
  a.hit3(8, 25);
  await a.next('you');
  assert.deepEqual(await a.ask('rename', 'Cool Name'), { error: 'Create an account to change your name' });
});

test('without accounts set up, the server says so and treats a login token as a failed login', async () => {
  const w = await player({ jwt: 'not-a-real-token' }).welcome;
  assert.equal(w.accounts, false);
  assert.equal(w.me.pid, null);
  assert.equal((await fetch(url + '/api/auth/token')).status, 404);
});

test('other hosts (www, onrender.com) redirect to the site address; localhost is left alone', async () => {
  // fetch() won't send a different Host header, so use a plain HTTP request.
  const get = host => new Promise((resolve, reject) =>
    http.get(url + '/terms?x=1', { headers: { host } }, res => { res.resume(); resolve(res); }).on('error', reject));
  for (const host of ['www.territory.sarl', 'territory.onrender.com']) {
    const res = await get(host);
    assert.equal(res.statusCode, 301, host);
    assert.equal(res.headers.location, 'https://territory.sarl/terms?x=1');
  }
  assert.equal((await get('territory.sarl')).statusCode, 200);
  assert.equal((await fetch(url + '/', { redirect: 'manual' })).status, 200);
});

test('/api/ip shows the address the guest limit uses', async () => {
  const res = await fetch(url + '/api/ip', { headers: { 'cf-connecting-ip': '198.51.100.23', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } });
  assert.deepEqual(await res.json(), { ip: '198.51.100.23' });
});

test('the Privacy Policy and Terms pages are served, marked as placeholders', async () => {
  for (const page of ['/privacy', '/terms']) {
    const res = await fetch(url + page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /PLACEHOLDER/);
  }
});
