const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
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
  a.take(0, 0);
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
  a.take(5, 5);
  b.take(6, 5);
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
    for (let i = 0; i < 12; i++) { a.emit('hit', { x, y }); b.emit('hit', { x, y }); }
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
  a.take(20, 20);
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
  p1.take(0, 30); await p1.next('you');
  p2.take(2, 30); await p2.next('you');
  p3.take(4, 30);
  assert.match(await p3.next('denied'), /Too many new players/);
  assert.equal(await db.count('SELECT count(*) FROM players'), players + 2);

  const other = player();   // a different network is unaffected
  await other.welcome;
  other.take(6, 30);
  await other.next('you');
});

test('a wipe clears the territory for everyone and frees the land', async () => {
  const a = player(), watcher = player();
  await Promise.all([a.welcome, watcher.welcome]);
  a.take(10, 15); const you = await a.next('you');
  a.take(11, 15); await a.next('claim', at(11, 15));
  a.emit('wipe');
  const w = await watcher.next('wipe');
  assert.equal(w.pid, you.pid);
  assert.deepEqual(w.cells.map(c => c.join(',')).sort(), ['10,15', '11,15']);
  assert.equal(await owner(10, 15), null);
  assert.equal(await db.count('SELECT count(*) FROM map_wipes WHERE player_id = $1 AND blocks_owned = 2', [you.pid]), 1);

  // Retaking freed land is a first claim again: the map grows, but no square is earned (2 blocks is not more than N = 2).
  const cells = await cellCount();
  a.take(10, 15); await a.next('claim', at(10, 15));
  a.take(11, 15); await a.next('claim', at(11, 15));
  assert.equal(await cellCount(), cells + 2);
  a.take(12, 15); await a.next('claim', at(12, 15));
  assert.equal(await a.next('squares', n => n === 3), 3, 'the third block is beyond N and earns a square');
});

test('cracks fade one hit per decay period after the last hit, for everyone, shown as a share of 10', async () => {
  const a = player(), watcher = player();
  await Promise.all([a.welcome, watcher.welcome]);
  a.emit('hit', { x: 3, y: 25 });
  a.emit('hit', { x: 3, y: 25 });
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.p === 0.2);
  const t0 = Date.now();
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.p === 0.1);
  await watcher.next('hit', d => d.x === 3 && d.y === 25 && d.p === 0);
  const took = Date.now() - t0;
  assert.ok(took >= DECAY_MS * 1.5 && took < DECAY_MS * 4, `two hits faded in ${took}ms`);
  assert.equal(watcher.events.filter(([n]) => n === 'claim').length, 0, 'nothing was claimed');

  // A hit after some fading continues from the faded progress: two hits, one fades, so nine more are needed.
  a.emit('hit', { x: 4, y: 25 });
  a.emit('hit', { x: 4, y: 25 });
  await watcher.next('hit', d => d.x === 4 && d.p === 0.1);   // the hits themselves
  await watcher.next('hit', d => d.x === 4 && d.p === 0.2);
  await watcher.next('hit', d => d.x === 4 && d.p === 0.1);   // then the fade
  for (let i = 0; i < 8; i++) a.emit('hit', { x: 4, y: 25 });
  await watcher.next('hit', d => d.x === 4 && d.p === 0.9);
  assert.equal(watcher.events.filter(([n]) => n === 'claim').length, 0, 'not yet');
  a.emit('hit', { x: 4, y: 25 });
  await watcher.next('claim', at(4, 25));
});

test('color, skin and coverage are picked before the first claim on a map, then locked there', async () => {
  const LOCKED = { error: 'Your color, skin and coverage are locked for this map' };
  const a = player();
  const w = await a.welcome;
  assert.equal(w.me.coverage, 'tile', 'tile unless they pick');
  assert.equal(w.me.skin, 'default');
  assert.ok(w.choices.colors.some(c => c.hex === w.me.color), 'the proposed color is one of the 8');
  assert.equal(w.choices.colors.length, 8);
  assert.equal(w.me.locked, false);
  assert.deepEqual(await a.ask('setup', { coverage: 'sideways' }), { error: 'Unknown coverage' });
  assert.deepEqual(await a.ask('setup', { color: '#123456' }), { error: 'Pick one of the colors shown' });
  assert.deepEqual(await a.ask('setup', { skin: 'checker' }), { error: "You don't own that skin" });
  assert.deepEqual(await a.ask('setup', { color: '#ffa300', skin: 'default', coverage: 'stretch' }),
    { color: '#ffa300', skin: 'default', coverage: 'stretch' });
  a.take(12, 25);
  const you = await a.next('you');
  const joined = await a.next('player', d => d.pid === you.pid);
  assert.deepEqual([joined.color, joined.coverage], ['#ffa300', 'stretch']);
  assert.deepEqual(await a.ask('setup', { coverage: 'tile' }), LOCKED);
  const saved = 'SELECT color, coverage FROM player_map_settings WHERE player_id = $1';
  assert.deepEqual((await pool.query(saved, [you.pid])).rows[0], { color: '#ffa300', coverage: 'stretch' });

  // Coming back: still stretch, still locked.
  const again = player({ token: you.token });
  const w2 = await again.welcome;
  assert.equal(w2.me.coverage, 'stretch');
  assert.equal(w2.me.locked, true);
  assert.equal(w2.players[you.pid].coverage, 'stretch');
  assert.deepEqual(await again.ask('setup', { coverage: 'tile' }), LOCKED);
});

test('the database refuses to change color, skin or coverage once set, but wipes still work', async () => {
  const a = player();
  await a.welcome;
  a.take(14, 25);
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

test('a wipe unlocks color, skin and coverage on that map only, until the next claim there', async () => {
  const LOCKED = { error: 'Your color, skin and coverage are locked for this map' };
  const settings = 'SELECT color, coverage, unlocked FROM player_map_settings WHERE player_id = $1 AND map_id = $2';
  const other = await store.createMap(pool, { name: 'Unlock Test', style: 'white', width: 3, height: 3 });
  const a = player();
  const w = await a.welcome;
  const home = w.map.id;
  assert.equal((await a.ask('setup', { color: '#29adff' })).color, '#29adff');
  a.take(15, 27);
  const you = await a.next('you');
  await a.next('claim', at(15, 27));
  assert.deepEqual(await a.ask('switchMap', other), { ok: true });
  await a.next('welcome', d => d.map.id === other);
  a.take(1, 1);
  await a.next('claim', at(1, 1));
  assert.deepEqual(await a.ask('switchMap', home), { ok: true });
  await a.next('welcome', d => d.map.id === home);

  a.emit('wipe');
  assert.equal((await a.next('wipe')).floor, 1);
  assert.deepEqual((await pool.query(settings, [you.pid, home])).rows[0], { color: '#29adff', coverage: 'tile', unlocked: true });
  assert.equal((await pool.query(settings, [you.pid, other])).rows[0].unlocked, false, 'the other map stays locked');
  await assert.rejects(pool.query('UPDATE player_map_settings SET color = $3 WHERE player_id = $1 AND map_id = $2', [you.pid, other, 'x']),
    /locked once chosen/);

  // The setup screen works again, here and on reconnecting, and the next claim locks the new choices.
  assert.deepEqual(await a.ask('setup', { color: '#ff4d4d', coverage: 'stretch' }), { color: '#ff4d4d', skin: 'default', coverage: 'stretch' });
  const b = player({ token: you.token });
  const wb = await b.welcome;
  assert.equal(wb.me.locked, false);
  assert.equal(wb.me.wipeFloor, 1);
  a.take(15, 27);
  const joined = await a.next('player', d => d.pid === you.pid && d.color === '#ff4d4d');
  assert.deepEqual([joined.color, joined.coverage], ['#ff4d4d', 'stretch']);
  assert.deepEqual((await pool.query(settings, [you.pid, home])).rows[0], { color: '#ff4d4d', coverage: 'stretch', unlocked: false });
  assert.deepEqual(await a.ask('setup', { color: '#29adff' }), LOCKED);
  await assert.rejects(pool.query('UPDATE player_map_settings SET color = $3 WHERE player_id = $1 AND map_id = $2', [you.pid, home, 'x']),
    /locked once chosen/);
});

test("upgrades: Click Power and Defense multiply hits (Bob's example: 17 clicks), Earnings keeps fractions", async t => {
  const keys = ['CLICK_POWER_MULTIPLIER', 'DEFENSE_MULTIPLIER', 'EARNINGS_MULTIPLIER'], saved = keys.map(k => rules[k]);
  t.after(() => keys.forEach((k, i) => { rules[k] = saved[i]; }));
  const a = player();
  await a.welcome;
  a.take(16, 25);
  const you = await a.next('you');
  a.disconnect();
  rules.EARNINGS_MULTIPLIER = [1, 1.5];
  rules.CLICK_POWER_MULTIPLIER = [1, 2.5];
  await pool.query('UPDATE players SET click_power = 1, earnings = 1 WHERE id = $1', [you.pid]);
  const b = player({ token: you.token });
  await b.welcome;
  for (let i = 0; i < 4; i++) b.emit('hit', { x: 17, y: 25 });   // 4 clicks of 2.5
  await b.next('claim', d => d.x === 17 && d.y === 25);
  assert.equal(await b.next('squares'), 2, '1 + 1.5 = 2.5, shown as 2');
  assert.equal(Number((await pool.query('SELECT squares FROM players WHERE id = $1', [you.pid])).rows[0].squares), 2.5,
    'the exact balance is kept');
  const { rows: ledger } = await pool.query('SELECT delta, balance_after FROM square_ledger WHERE player_id = $1 ORDER BY id', [you.pid]);
  assert.deepEqual(ledger.map(r => [Number(r.delta), Number(r.balance_after)]), [[1, 1], [1.5, 2.5]]);

  // Everyone's Defense doubles and Click Power is 1.2 for all: 20 hits to take their block, 17 clicks.
  rules.CLICK_POWER_MULTIPLIER = [1.2];
  rules.DEFENSE_MULTIPLIER = [2];
  const c = player();
  await c.welcome;
  for (let i = 0; i < 9; i++) c.emit('hit', { x: 18, y: 25 });   // Defense never applies to empty blocks: 9 clicks
  await c.next('claim', at(18, 25));
  for (let i = 0; i < 16; i++) c.emit('hit', { x: 17, y: 25 });
  await c.next('hit', d => d.x === 17 && d.y === 25 && d.p === 0.96);   // 16 x 1.2 = 19.2 of 20
  c.emit('hit', { x: 17, y: 25 });
  await c.next('claim', d => d.x === 17 && d.y === 25 && d.pid !== you.pid);
});

test('stats: counted per claim, saved, announced to the player and on the server, lost blocks counted too', async () => {
  const seen = [];
  game.events.on('stat', e => seen.push(e));
  const a = player(), b = player();
  await Promise.all([a.welcome, b.welcome]);
  a.take(20, 25);
  const youA = await a.next('you');
  a.take(21, 25);
  await a.next('stat', d => d.name === 'bestLine' && d.value === 2);
  b.take(23, 25);
  const youB = await b.next('you');
  b.take(22, 25);
  await b.next('claim', d => d.x === 22);
  a.take(22, 25);   // A retakes it from B
  await a.next('stat', d => d.name === 'retakes' && d.value === 1);
  await b.next('stat', d => d.name === 'blocksLost' && d.value === 1);
  assert.ok(seen.some(e => e.pid === youA.pid && e.mapId === mapId && e.name === 'bestLine' && e.value === 3));
  const row = pid => pool.query('SELECT owned_max, first_claims, retakes, blocks_lost, best_square, best_line FROM player_map_stats WHERE player_id = $1', [pid]).then(r => r.rows[0]);
  assert.deepEqual(await row(youA.pid), { owned_max: 3, first_claims: 2, retakes: 1, blocks_lost: 0, best_square: 1, best_line: 3 });
  assert.deepEqual(await row(youB.pid), { owned_max: 2, first_claims: 2, retakes: 0, blocks_lost: 1, best_square: 1, best_line: 2 });
});

test('achievements: earned once on the stat event, saved, and announced', async () => {
  const a = player();
  await a.welcome;
  a.take(26, 25);
  const you = await a.next('you');
  assert.deepEqual(await a.next('achievement'), { id: 'first-block', name: 'First Block', mapId });
  a.take(27, 25);
  await a.next('claim', d => d.x === 27);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(a.events.filter(([n]) => n === 'achievement').length, 0, 'not earned twice');
  assert.equal(await db.count('SELECT count(*) FROM player_achievements WHERE player_id = $1', [you.pid]), 1);
});

test('maps: switch, claim there with a separate look, and come back to the last map', async () => {
  const second = await store.createMap(pool, { name: 'Snow', style: 'white', width: 4, height: 4 });
  await assert.rejects(store.createMap(pool, { name: 'X', style: 'lava', width: 4, height: 4 }), /style/);
  const a = player();
  await a.welcome;
  a.take(28, 25);
  const you = await a.next('you');
  const maps = await a.ask('maps');
  assert.deepEqual(maps.map(m => m.name).filter(n => n !== 'Unlock Test'), ['Grass', 'Snow']);
  assert.deepEqual(await a.ask('switchMap', '99999'), { error: 'That map does not exist' });
  assert.deepEqual(await a.ask('switchMap', second), { ok: true });
  const w = await a.next('welcome');
  assert.equal(w.map.id, second);
  assert.equal(w.map.style, 'white');
  assert.equal(w.cells.length, 16);
  assert.equal(w.me.locked, false, 'a new map means a new color, skin and coverage');
  a.take(1, 1);
  await a.next('claim', d => d.x === 1 && d.y === 1);
  assert.equal(await db.count('SELECT count(*) FROM player_map_settings WHERE player_id = $1', [you.pid]), 2);

  const watcher = player();
  assert.equal((await watcher.welcome).map.id, mapId, 'others stay where they are');

  // Reconnecting returns to the last map.
  const back = player({ token: you.token });
  assert.equal((await back.welcome).map.id, second);
  assert.deepEqual(await back.ask('switchMap', mapId), { ok: true });
  assert.equal((await back.next('welcome')).map.id, mapId);
  assert.equal((await player({ token: you.token }).welcome).map.id, mapId);
});

test('reconnecting keeps crack progress, and a restarted server remembers stats and achievements', async t => {
  const a = player();
  await a.welcome;
  a.take(2, 27);
  const you = await a.next('you');
  await a.next('achievement');
  a.emit('hit', { x: 3, y: 27 });
  a.emit('hit', { x: 3, y: 27 });
  await a.next('hit', d => d.x === 3 && d.p === 0.2);
  a.disconnect();
  const b = player({ token: you.token });
  const w = await b.welcome;
  assert.deepEqual(w.hits.find(([x, y]) => x === 3 && y === 27), [3, 27, 0.2], 'the cracks are still there');
  for (let i = 0; i < 8; i++) b.emit('hit', { x: 3, y: 27 });
  await b.next('claim', d => d.x === 3 && d.y === 27 && d.pid === you.pid);
  b.disconnect();

  // A second server on the same database, as after a restart or deploy.
  const other = createGame(pool);
  await new Promise(r => other.server.listen(0, r));
  t.after(() => other.io.close());
  const c = connectPlayer(`http://localhost:${other.server.address().port}`, { token: you.token });
  sockets.push(c);
  await c.welcome;
  c.take(4, 27);
  await c.next('stat', d => d.name === 'firstClaims' && d.value === 3, 15000);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(c.events.filter(([n]) => n === 'achievement').length, 0, 'First Block is not earned again');
});

test('random play by four players: database, server and every screen agree; the map grows once per first claim', async () => {
  const store = require('../store');
  const id = await store.createMap(pool, { name: 'Soak', style: 'grass', width: 6, height: 6 });
  const players = [player(), player(), player(), player()];
  await Promise.all(players.map(p => p.welcome));
  // Everyone's own copy of the map, built only from what the server tells them.
  const views = players.map(p => {
    const v = new Map();
    p.on('welcome', w => { v.clear(); for (const [x, y, o] of w.cells) v.set(x + ',' + y, o); });
    p.on('claim', d => v.set(d.x + ',' + d.y, d.pid));
    p.on('grow', d => v.set(d.x + ',' + d.y, null));
    return v;
  });
  for (const p of players) { await p.ask('switchMap', id); await p.next('welcome'); }

  let seed = 7;
  const rand = n => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const pids = [null, null, null, null];
  let firstClaims = 0;
  for (let round = 0; round < 30; round++) {
    const i = rand(4), p = players[i], view = views[i];
    // Pick a block this player may take, as the rules see it in their view.
    const counts = new Map();
    for (const o of view.values()) if (o) counts.set(o, (counts.get(o) || 0) + 1);
    const options = [...view.keys()].filter(k => {
      const [x, y] = k.split(',').map(Number);
      return rules.hitError({ cells: view, counts }, pids[i], x, y) === null;
    });
    if (!options.length) continue;
    const [x, y] = options[rand(options.length)].split(',').map(Number);
    const wasEmpty = view.get(x + ',' + y) === null;
    p.take(x, y);
    const c = await p.next('claim', d => d.x === x && d.y === y, 15000);
    if (!pids[i]) pids[i] = (await p.next('you')).pid;
    assert.equal(c.pid, pids[i]);
    if (wasEmpty) { firstClaims++; await p.next('grow'); }
  }
  await new Promise(r => setTimeout(r, 300));   // let the last events arrive everywhere

  const { rows } = await pool.query('SELECT x, y, owner_id FROM map_cells WHERE map_id = $1', [id]);
  const db = new Map(rows.map(r => [r.x + ',' + r.y, r.owner_id]));
  assert.equal(db.size, 36 + firstClaims, 'one new block per first claim');
  for (const [i, v] of views.entries()) assert.deepEqual(new Map([...v].sort()), new Map([...db].sort()), `player ${i} sees the database`);
  const kept = await pool.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [id]);
  await store.rebuildEdges(pool, id);
  assert.deepEqual(kept.rows, (await pool.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [id])).rows);
  for (const pid of pids.filter(Boolean)) {
    const owned = [...db.values()].filter(o => o === pid).length;
    const st = (await pool.query('SELECT owned_max FROM player_map_stats WHERE map_id = $1 AND player_id = $2', [id, pid])).rows[0];
    assert.ok(st.owned_max >= owned, 'most ever owned is at least what they own now');
  }
});

test('guests cannot rename', async () => {
  const a = player();
  await a.welcome;
  assert.deepEqual(await a.ask('rename', 'Cool Name'), { error: 'Create an account to change your name' });
  a.take(8, 25);
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
