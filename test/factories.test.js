// Loop 16 Phase 5: factories. The rules in memory (factories.js), then building, mining on the tick, catch-up
// after a long sleep, lifetime and waking, and destruction on a throwaway schema in the dev database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../app');
const catalog = require('../catalog');
const fac = require('../factories');
const rules = require('../rules');
const store = require('../store');
const { testDb, newGuest, claim, connectPlayer } = require('./helpers');

const { E } = catalog;
const k = (x, y) => x + ',' + y;
// A little map model: owner 'a' owns `mine`, the rest of a w x h rectangle is empty grass.
function model(w, h, mine, extra = {}) {
  const cells = new Map();
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) cells.set(k(x, y), null);
  for (const [x, y] of mine) cells.set(k(x, y), 'a');
  return { cells, birth: new Map(), terrainAt: () => 'grass', ...extra };
}

test('the target: the closest empty, non-water block touching the owner\'s land; ties in a fixed seeded order', () => {
  const m = model(9, 9, [[4, 4], [5, 4]]);
  assert.deepEqual(fac.chooseTarget(m, 'a', 5, 4, 's'), { x: 6, y: 4 }, 'right next to the factory');
  const water = model(9, 9, [[4, 4], [5, 4]], { terrainAt: (x, y) => (x === 6 ? 'water' : 'grass') });
  const t = fac.chooseTarget(water, 'a', 5, 4, 's');
  assert.ok([k(5, 3), k(5, 5)].includes(k(t.x, t.y)), 'never water; the two equal ones');
  assert.deepEqual(fac.chooseTarget(water, 'a', 5, 4, 's'), t, 'the same tie every time');
  const seeds = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(sd => { const r = fac.chooseTarget(water, 'a', 5, 4, sd); return k(r.x, r.y); }));
  assert.equal(seeds.size, 2, 'other seeds can break the tie the other way');
  const full = model(2, 1, [[0, 0], [1, 0]]);
  assert.equal(fac.chooseTarget(full, 'a', 0, 0, 's'), null, 'nothing to mine: idle');
});

test('hits: H inside the home square; plus d x factoryDistancePenaltyWh x W(L) x hitsPerSquare beyond it', () => {
  const m = model(20, 20, []);
  const half = Math.floor(E.factoryAreaSize / 2);
  assert.equal(fac.beyondHome(10, 10, 10 + half, 10 - half), 0, 'the corner of the home square');
  assert.equal(fac.beyondHome(10, 10, 10 + half + 1, 10), 1);
  assert.equal(fac.beyondHome(10, 10, 10 + half + 3, 10 + half + 1), 3, 'Chebyshev distance');
  assert.equal(fac.hitsFor(m, 11, 10, 10, 10, 1), rules.HITS_PER_BLOCK);
  const d = 4, extra = d * E.factoryDistancePenaltyWh * catalog.W(1) * E.hitsPerSquare;
  assert.ok(Math.abs(fac.hitsFor(m, 10 + half + d, 10, 10, 10, 1) - (rules.HITS_PER_BLOCK + extra)) < 1e-9);
  assert.ok(Math.abs(fac.hitsFor(m, 10 + half + d, 10, 10, 10, 2) - (rules.HITS_PER_BLOCK + 2 * extra)) < 1e-9, 'W(L) doubles per level');
});

test('Yield is never more than the block\'s normal pay; the limit is 1 per factoryBlocksPerFactory blocks; the newest pause', () => {
  const m = model(3, 3, []);
  assert.equal(fac.yieldTenths(1, m, 0, 0), 10, '1 square for a level-1 grass block');
  assert.equal(fac.yieldTenths(512, m, 0, 0), 10, 'capped at the block\'s pay (10 hits = 1 square)');
  m.birth.set(k(0, 0), 3);
  assert.equal(fac.yieldTenths(512, m, 0, 0), 40, 'a level-3 block pays 4 squares, so the cap is 4');
  assert.equal(fac.yieldTenths(2.5, m, 0, 0), 25);
  assert.equal(fac.factoryLimit(E.factoryBlocksPerFactory * 2 - 1), 1);
  assert.equal(fac.factoryLimit(E.factoryBlocksPerFactory * 2), 2);
  assert.deepEqual([...fac.pausedIds([{ id: 1, builtAt: 10 }, { id: 2, builtAt: 30 }, { id: 3, builtAt: 20 }], E.factoryBlocksPerFactory)], [3, 2]);
  assert.equal(fac.pausedIds([{ id: 1, builtAt: 10 }], E.factoryBlocksPerFactory).size, 0);
  assert.equal(fac.hitsPerSecond(1), rules.HITS_PER_BLOCK / E.baseBlockSeconds, 'a base player\'s speed');
});

// ---------- On the database ----------
let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('factories');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
const STEP = fac.STEP_MS();
const T0 = fac.stepFloor(Date.now()) - 6 * 3600000;   // six hours ago, on a step boundary

// A seeded map with a player owning `n` blocks in its top rows (claimed in order); returns { id, pid, token }.
async function landed(name, n, { w = 12, h = 12 } = {}) {
  const id = await store.createMap(pool, { name, seed: 'factory ' + name.replace(/ \d$/, ''), width: w, height: h });
  const spots = [];
  for (let y = 0; y < h && spots.length < n; y++) for (let x = 0; x < w && spots.length < n; x++) spots.push([x, y]);
  const g = await newGuest(pool, id, ...spots[0]);
  for (const [x, y] of spots.slice(1)) await claim(pool, id, g.playerId, x, y);
  return { id, pid: g.playerId, token: g.token };
}
// A factory straight into the database (for clock-exact tests), awake from `from` for `hours`.
async function factoryAt(mapId, pid, x, y, from, hours) {
  const { rows: [f] } = await pool.query(`INSERT INTO factories (map_id, owner_id, x, y, built_at, awake_until, processed_at)
    VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), to_timestamp($5 / 1000.0)) RETURNING id`, [mapId, pid, x, y, from, from + hours * 3600000]);
  await pool.query('UPDATE map_cells SET factory_id = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y, f.id]);
  return f.id;
}
// Waits for the welcome, then makes sure the player is on map `id` (a guest made there starts there).
async function onMap(s, id) {
  const w = await s.welcome;
  if (w.map.id !== id) { await s.ask('switchMap', id); await s.next('welcome', d => d.map.id === id); }
}
const ownedBy = async (mapId, pid) => (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 AND owner_id = $2 ORDER BY x, y', [mapId, pid])).rows.map(r => k(r.x, r.y));

test('building: on your own land, priced P_F x V_F x W(L) x g^(n-1); one per factoryBlocksPerFactory blocks', async () => {
  const { id, pid, token } = await landed('Build', E.factoryBlocksPerFactory);
  const price = catalog.priceTenths(catalog.CATALOG.get('building:factory'), { L: 1, n: 1 });
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, price * 2]);
  const s = player({ token });
  await onMap(s, id);
  const info = await s.ask('buildInfo');
  assert.deepEqual(info.factory, { count: 0, limit: 1, price: price / 10, needBlocks: 0 });
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 0, y: 11 }), { error: 'Only on your own land' });
  const built = s.next('factory');
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 0, y: 0 }), { ok: true, squares: price / 10 });
  const f = await built;
  assert.equal(f.owner, pid);
  assert.ok(Math.abs(f.awakeUntil - Date.now() - catalog.tierValue('factoryLifetime', 1) * 3600000) < 60000, 'awake for Factory Lifetime hours');
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 1, y: 0 }), { error: `Own ${E.factoryBlocksPerFactory} more blocks for another factory` });
  assert.equal((await s.ask('buildInfo')).factory.price, catalog.priceTenths(catalog.CATALOG.get('building:factory'), { L: 1, n: 2 }) / 10, 'the next costs g times more');
  const card = await s.ask('inspect', { x: 0, y: 0 });
  assert.deepEqual([card.factory.mine, card.factory.paused], [true, false]);
});

test('mining on the tick: about a block a minute at tier 1; the same result after a long sleep as ticking every step', async () => {
  const n = E.factoryBlocksPerFactory;
  const a = await landed('Catch 1', n), b = await landed('Catch 2', n);
  assert.deepEqual(await ownedBy(a.id, a.pid), await ownedBy(b.id, b.pid), 'two identical maps');
  await factoryAt(a.id, a.pid, 5, 1, T0, 4);
  await factoryAt(b.id, b.pid, 5, 1, T0, 4);
  const minutes = 30;
  await game.ticker.tick(T0 + minutes * STEP);   // A: one tick after a 30-minute sleep
  for (let i = 1; i <= minutes; i++) {             // B: ticking every step (A is already up to date)
    await game.ticker.tick(T0 + i * STEP);
  }
  const ownA = await ownedBy(a.id, a.pid), ownB = await ownedBy(b.id, b.pid);
  assert.ok(ownA.length > n + 5, `the factory mined (${ownA.length - n} blocks)`);
  assert.ok(ownA.length - n <= minutes, 'at most about one a minute');
  assert.deepEqual(ownA, ownB, 'exactly the same blocks');
  const sq = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares);
  assert.equal(await sq(a.pid), await sq(b.pid), 'and the same squares');
  const { rows: [m] } = await pool.query('SELECT mined::int FROM maps WHERE id = $1', [a.id]);
  assert.equal(m.mined, ownA.length, 'factory blocks count toward the map\'s mined total');
  // Its progress on the next block is saved (it never fades).
  const { rows: [f] } = await pool.query('SELECT progress, target_x FROM factories WHERE map_id = $1', [a.id]);
  assert.ok(f.target_x !== null);
});

test('lifetime: an asleep factory does nothing; Wake up gives it Factory Lifetime hours from now', async () => {
  const n = E.factoryBlocksPerFactory;
  const { id, pid, token } = await landed('Sleepy', n);
  await factoryAt(id, pid, 3, 1, T0, 0.25);   // awake 15 minutes, six hours ago
  await game.ticker.tick(T0 + 120 * STEP);
  const after15 = (await ownedBy(id, pid)).length;
  assert.ok(after15 > n && after15 - n <= 15, `worked only while awake (${after15 - n})`);
  await game.ticker.tick(Date.now());
  assert.equal((await ownedBy(id, pid)).length, after15, 'asleep since: nothing more');
  const s = player({ token });
  await onMap(s, id);
  const card = await s.ask('inspect', { x: 3, y: 1 });
  assert.ok(card.factory.awakeUntil < Date.now(), 'shown asleep');
  const r = await s.ask('wakeFactory', { x: 3, y: 1 });
  assert.ok(r.ok && r.awakeUntil > Date.now() + 3.9 * 3600000);
  await game.ticker.tick(fac.stepFloor(Date.now()) + 3 * STEP);
  assert.ok((await ownedBy(id, pid)).length > after15, 'awake again: it mines');
  assert.deepEqual(await s.ask('wakeFactory', { x: 0, y: 0 }), { error: 'Not your factory' });
});

test('a factory is destroyed when its block is taken; Demolition removes one for good', async () => {
  const n = E.factoryBlocksPerFactory;
  const { id, pid, token } = await landed('Taken', n);
  await factoryAt(id, pid, 0, 0, Date.now(), 4);
  await factoryAt(id, pid, 1, 0, Date.now(), 4);
  const other = player();
  await other.welcome;
  await other.ask('switchMap', id);
  await other.next('welcome', d => d.map.id === id);
  // The other player starts next to it and takes the factory block.
  const empty = (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 AND owner_id IS NULL AND x = 0 ORDER BY y LIMIT 1', [id])).rows[0];
  other.take(empty.x, empty.y);
  await other.next('you');
  let y = empty.y;
  while (y > 1) { y--; other.take(0, y); await other.next('claim', d => d.x === 0 && d.y === y && d.pid !== pid); }
  const gone = other.next('factory', f => f.gone && f.x === 0 && f.y === 0);
  other.take(0, 0);
  await gone;
  assert.equal(await db.count('SELECT count(*) FROM factories WHERE map_id = $1 AND x = 0 AND y = 0', [id]), 0);
  // Demolition: the owner removes their other factory.
  const price = catalog.priceTenths(catalog.CATALOG.get('item:demolition'), { L: 1 });
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, price]);
  const s = player({ token });
  await onMap(s, id);
  await s.ask('buyItem', { item: 'demolition' });
  assert.deepEqual(await s.ask('useItem', { item: 'demolition', x: 2, y: 0, target: 'factory' }), { error: 'There is no factory there' });
  const r = await s.ask('useItem', { item: 'demolition', x: 1, y: 0, target: 'factory' });
  assert.equal(r.ok, true);
  assert.equal(await db.count('SELECT count(*) FROM factories WHERE map_id = $1', [id]), 0);
  assert.equal((await s.ask('inspect', { x: 1, y: 0 })).factory, undefined);
});
