// Seeds and terrain (public/terrain.js): the same seed makes the same map; each terrain's rules. In memory, and on
// the dev database in a throwaway schema.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
const terrain = require('../public/terrain');
const { testDb, connectPlayer } = require('./helpers');

// ---------- In memory ----------
test('the same seed gives the same terrain and starting shape; another seed gives another', () => {
  const a = terrain.makeWorld('frosty hills', rules.TERRAIN), b = terrain.makeWorld('frosty hills', rules.TERRAIN);
  const c = terrain.makeWorld('sunny shores', rules.TERRAIN);
  let differ = 0;
  for (let y = -60; y < 60; y++) for (let x = -60; x < 60; x++) {
    assert.equal(a.at(x, y), b.at(x, y));
    if (a.at(x, y) !== c.at(x, y)) differ++;
  }
  assert.ok(differ > 2000, 'other seeds look different');
  assert.deepEqual(terrain.startingShape('frosty hills', 500), terrain.startingShape('frosty hills', 500));
  assert.notDeepEqual(terrain.startingShape('frosty hills', 500), terrain.startingShape('sunny shores', 500));
});

test('the starting shape has exactly the blocks asked for, all different and all connected', () => {
  const shape = terrain.startingShape('island', rules.NEW_MAP_BLOCKS);
  assert.equal(rules.NEW_MAP_BLOCKS, 10240);
  assert.equal(shape.length, 10240);
  const set = new Set(shape.map(([x, y]) => x + ',' + y));
  assert.equal(set.size, 10240);
  const seen = new Set(['0,0']), queue = [[0, 0]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const k of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].map(p => p.join(','))) {
      if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push(k.split(',').map(Number)); }
    }
  }
  assert.equal(seen.size, 10240, 'one piece');
  const xs = shape.map(p => p[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 260, 'continent-sized, not a line');
});

test("over a big area, each terrain covers about its share from the Game Rules tab", () => {
  const w = terrain.makeWorld('shares', rules.TERRAIN), count = {};
  for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) count[w.at(x, y)] = (count[w.at(x, y)] ?? 0) + 1;
  const share = t => (count[t] ?? 0) / 160000;
  for (const t of ['water', 'sand', 'forest', 'stone']) {
    assert.ok(Math.abs(share(t) - rules.TERRAIN[t]) < 0.06, `${t}: ${share(t).toFixed(3)} vs ${rules.TERRAIN[t]}`);
  }
  assert.ok(share('gold') > 0.003 && share('gold') < 0.02, 'gold is rare: ' + share('gold'));
  assert.ok(share('grass') > 0.3, 'mostly grass');
});

test("each terrain's hits, from the Game Rules tab", () => {
  const h = rules.HITS_PER_BLOCK;
  assert.equal(rules.hitsNeeded(null), h);
  assert.equal(rules.hitsNeeded(null, 'grass'), h);
  assert.equal(rules.hitsNeeded(null, 'sand'), h * rules.TERRAIN_HITS.sand);
  assert.ok(rules.hitsNeeded(null, 'sand') < h && rules.hitsNeeded(null, 'forest') > h && rules.hitsNeeded(null, 'stone') > rules.hitsNeeded(null, 'forest'));
  assert.equal(rules.hitsNeeded(null, 'gold'), h * rules.TERRAIN_HITS.gold);
  const defended = { ...rules.NO_UPGRADES, defense: 3 };
  assert.equal(rules.hitsNeeded(defended, 'stone'), rules.hitsNeeded(defended) * rules.TERRAIN_HITS.stone, 'Defense and terrain multiply');
  const map = { cells: new Map([['0,0', null], ['1,0', null]]), counts: new Map(), terrainAt: x => (x === 0 ? 'water' : 'grass') };
  assert.equal(rules.hitError(map, null, 0, 0), "Water can't be claimed");
  assert.equal(rules.hitError(map, null, 1, 0), null);
});

// ---------- On the database ----------
let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('terrain');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000 });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db.drop();
});
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
const cellsOf = async id => (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 ORDER BY x, y', [id])).rows.map(r => r.x + ',' + r.y);

test('the same seed plus the same claims always gives the same map, growth included', async () => {
  const a = await store.createMap(pool, { name: 'Twin A', seed: 'twins', blocks: 400 });
  const b = await store.createMap(pool, { name: 'Twin B', seed: 'twins', blocks: 400 });
  const c = await store.createMap(pool, { name: 'Other', seed: 'not twins', blocks: 400 });
  const start = await cellsOf(a);
  assert.deepEqual(start, await cellsOf(b), 'same starting shape');
  assert.notDeepEqual(await cellsOf(a), await cellsOf(c));
  const { rows: [p] } = await pool.query("INSERT INTO players (name) VALUES ('Twin Player') RETURNING id");
  const world = terrain.makeWorld('twins', rules.TERRAIN);
  const land = (await cellsOf(a)).map(k => k.split(',').map(Number)).filter(([x, y]) => world.at(x, y) !== 'water').slice(0, 12);
  for (const [x, y] of land) {
    for (const id of [a, b]) {
      const r = await store.claimBlock(pool, { mapId: id, x, y, from: null, playerId: p.id, color: '#29adff', grow: 2 });
      assert.equal(r.grown.length, 2);
    }
  }
  assert.deepEqual(await cellsOf(a), await cellsOf(b), 'same growth, block for block');
  assert.equal((await cellsOf(a)).length, 400 + 24);
  const grown = await pool.query('SELECT grown FROM maps WHERE id = ANY($1::bigint[])', [[a, b]]);
  assert.deepEqual(grown.rows.map(r => r.grown), [24, 24]);
  // A fresh start (wipe-map --reset-size) puts the seed's island back and grows the same way again.
  await store.wipeMap(pool, a, { blocks: 400 });
  assert.deepEqual(await cellsOf(a), start, 'the starting island again');
  assert.equal((await pool.query('SELECT grown FROM maps WHERE id = $1', [a])).rows[0].grown, 0);
});

test("on a seeded map: water can't be claimed, sand, forest and stone take their hits, gold pays its bonus", async () => {
  const seed = 'terrain rules';
  const id = await store.createMap(pool, { name: 'Terrain', seed, blocks: 3000 });
  const world = terrain.makeWorld(seed, rules.TERRAIN);
  const cells = (await cellsOf(id)).map(k => k.split(',').map(Number));
  const find = t => cells.find(([x, y]) => world.at(x, y) === t);
  for (const t of ['water', 'sand', 'forest', 'stone', 'gold', 'grass']) assert.ok(find(t), `the test map has ${t}`);

  // Each check is a fresh guest's first block, which may be anywhere on the map.
  async function onMap() {
    const s = player();
    await s.welcome;
    assert.deepEqual(await s.ask('switchMap', id), { ok: true });
    const w = await s.next('welcome');
    assert.equal(w.map.seed, seed, 'the browser gets the seed to draw the terrain');
    assert.deepEqual(w.settings.terrain, rules.TERRAIN);
    return s;
  }
  const tap = (s, [x, y], n) => { for (let i = 0; i < n; i++) s.emit('hit', { x, y }); };
  const claimed = (s, [x, y]) => s.next('claim', d => d.x === x && d.y === y, 3000).then(() => true, () => false);

  const w = await onMap();
  tap(w, find('water'), rules.HITS_PER_BLOCK * 3);
  assert.equal(await w.next('denied'), "Water can't be claimed");
  assert.equal(await claimed(w, find('water')), false);

  for (const t of ['sand', 'forest', 'stone']) {
    const s = await onMap(), need = rules.hitsNeeded(null, t);
    tap(s, find(t), need - 1);
    assert.equal(await claimed(s, find(t)), false, `${t}: not yet after ${need - 1} hits`);
    tap(s, find(t), 1);
    assert.equal(await claimed(s, find(t)), true, `${t}: taken with ${need} hits`);
  }

  const g = await onMap();
  tap(g, find('gold'), rules.hitsNeeded(null, 'gold'));
  assert.equal(await claimed(g, find('gold')), true);
  assert.equal(await g.next('squares'), rules.SQUARES_PER_FIRST_CLAIM + rules.GOLD_BONUS_SQUARES, 'gold: the normal square plus the bonus');
  const p = await onMap();
  tap(p, find('grass'), rules.HITS_PER_BLOCK);
  assert.equal(await claimed(p, find('grass')), true);
  assert.equal(await p.next('squares'), rules.SQUARES_PER_FIRST_CLAIM, 'grass: the normal square');
});

test('create-map makes a seeded island, random seed if none; map shows the seed', async () => {
  const id = await store.createMap(pool, { name: 'Random Seed' });
  const m = await store.findMap(pool, '#' + id);
  assert.match(m.seed, /^[a-z2-9]{8}$/);
  assert.equal((await cellsOf(id)).length, rules.NEW_MAP_BLOCKS);
  const plain = await store.createMap(pool, { name: 'Plain', width: 3, height: 3 });
  assert.equal((await store.findMap(pool, '#' + plain)).seed, null, 'a rectangle without a seed stays plain grass');
});

test('white maps never have terrain: no seed from create-map, and one with a seed still plays as plain white', async () => {
  const id = await store.createMap(pool, { name: 'White Test', style: 'white', width: 5, height: 5, seed: 'ignored' });
  assert.equal((await store.findMap(pool, '#' + id)).seed, null);
  await pool.query("UPDATE maps SET seed = 'oops' WHERE id = $1", [id]);   // as the live map made before the fix
  const s = player();
  await s.welcome;
  await s.ask('switchMap', id);
  await s.next('welcome');
  for (let i = 0; i < rules.HITS_PER_BLOCK; i++) s.emit('hit', { x: 2, y: 2 });   // plain hits, whatever 'oops' terrain says
  await s.next('claim', d => d.x === 2 && d.y === 2);
});
