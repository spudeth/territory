// Loop 16 Phase 1, the economy foundation, on a throwaway schema in the dev database: money in tenths, the
// block and map data, E and mined, create-map --base (and the live limit), Show tenths, and the tick's catch-up.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGame } = require('../app');
const { createTicker } = require('../ticker');
const catalog = require('../catalog');
const store = require('../store');
const { main } = require('../scripts/admin');
const { testDb, newGuest, claim, connectPlayer } = require('./helpers');

const KEY = 'test-admin-key-' + crypto.randomUUID();
let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('foundation');
  pool = db.pool;
  game = createGame(pool, { adminKey: KEY, tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });
const admin = async (line, env = {}) => {
  const out = [], argv = line.match(/"[^"]*"|\S+/g).map(w => w.replace(/^"(.*)"$/, '$1'));
  const code = await main(argv, { env: { ADMIN_KEY: KEY, ADMIN_DEV_URL: url, ...env }, backupsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fb-')),
    print: l => out.push(l), ask: async () => 'CONFIRM' });
  return { code, out: out.join('\n') };
};

test('blocks keep birth level, terrain, walls, factory, listing and open attributes; existing blocks are level 1', async () => {
  const { rows } = await pool.query(`SELECT birth_level, terrain, walls, factory_id, listing_id, attrs FROM map_cells WHERE map_id = $1 LIMIT 1`, [db.mapId]);
  assert.deepEqual(rows[0], { birth_level: 1, terrain: null, walls: [], factory_id: null, listing_id: null, attrs: {} });
});

test('first claims count toward the map\'s mined total (Growth\'s extra blocks don\'t); E is the starting size', async () => {
  const id = await store.createMap(pool, { name: 'Mined', seed: 'mined test', blocks: 50 });
  const m = () => pool.query('SELECT base_blocks::int AS base, mined::int AS mined, shape FROM maps WHERE id = $1', [id]).then(r => r.rows[0]);
  assert.deepEqual(await m(), { base: 50, mined: 0, shape: { blocks: 50 } });
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [id]), 50, 'the map starts with all E blocks');
  const { rows: [c] } = await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 ORDER BY x, y LIMIT 1', [id]);
  const g = await newGuest(pool, id, c.x, c.y);
  assert.equal(g.squares, 10, 'a level-1 grass block pays 10 tenths (1 square)');
  const { rows: [l] } = await pool.query("SELECT delta::int, balance_after::int FROM square_ledger WHERE player_id = $1 AND reason = 'first_claim'", [g.playerId]);
  assert.deepEqual(l, { delta: 10, balance_after: 10 });
  await claim(pool, id, g.playerId, g.grown[0].x, g.grown[0].y);
  assert.equal((await m()).mined, 2, 'two first claims; the growth blocks they made are not counted');
  // A wipe-map that resets the size makes it again from its own shape and E, at level 1.
  await store.wipeMap(pool, id, { width: 3, height: 3 });
  assert.deepEqual(await m(), { base: 50, mined: 0, shape: { blocks: 50 } });
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [id]), 50);
});

test('create-map --base sets E; production refuses E above maxBaseBlocksOnline; a rectangle\'s E is width x height', async () => {
  let r = await admin('create-map Basey --seed basey --base 120 --yes');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /E = 120 blocks/);
  const { rows: [m] } = await pool.query("SELECT base_blocks::int AS base FROM maps WHERE name = 'Basey'");
  assert.equal(m.base, 120);
  r = await admin('create-map Rect --width 4 --height 5 --yes');
  assert.equal((await pool.query("SELECT base_blocks::int AS base FROM maps WHERE name = 'Rect'")).rows[0].base, 20);
  r = await admin('create-map Bad --base 1.5 --yes');
  assert.match(r.out, /--base must be a whole number/);

  const prod = createGame(pool, { adminKey: KEY, publicUrl: 'https://territory.sarl', achievementList: [] });
  await new Promise(res => prod.server.listen(0, res));
  try {
    const prodUrl = `http://localhost:${prod.server.address().port}`;
    r = await admin(`create-map Huge --base ${catalog.E.maxBaseBlocksOnline + 1} --prod --yes`, { ADMIN_PROD_URL: prodUrl });
    assert.match(r.out, /more than the live game allows \(maxBaseBlocksOnline/);
    assert.equal(await db.count("SELECT count(*) FROM maps WHERE name = 'Huge'"), 0);
  } finally { prod.io.close(); }
});

test('Settings > Show tenths is saved per player; balances reach the browser as squares with one decimal place', async () => {
  const s = connectPlayer(url);
  sockets.push(s);
  await s.welcome;
  assert.deepEqual(await s.ask('showTenths', true), { error: 'Claim a block first' });
  const { rows: [c] } = await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 AND owner_id IS NULL ORDER BY x DESC, y DESC LIMIT 1', [db.mapId]);
  s.take(c.x, c.y);
  const you = await s.next('you');
  assert.equal(await s.next('squares'), 1);
  await pool.query('UPDATE players SET squares = squares + 5 WHERE id = $1', [you.pid]);
  assert.deepEqual(await s.ask('showTenths', true), { on: true });
  assert.equal((await pool.query('SELECT show_tenths FROM players WHERE id = $1', [you.pid])).rows[0].show_tenths, true);
  const again = connectPlayer(url, { token: you.token });
  sockets.push(again);
  const w = await again.welcome;
  assert.equal(w.me.showTenths, true);
  assert.equal(w.me.squares, 1.5, '15 tenths = 1.5 squares');
  assert.deepEqual([w.level.level, w.level.from, w.level.max], [1, 0, 10]);
});

test('the tick catches up on all the time since the last one, however long the server slept', async () => {
  const spans = [];
  const ticker = createTicker(pool, { seconds: 60, name: 'test-' + crypto.randomUUID() });
  ticker.on((from, to) => spans.push(to - from));
  const t0 = Date.now();
  await ticker.tick(t0);
  await ticker.tick(t0 + 60000);
  await ticker.tick(t0 + 60000 + 5 * 3600000);   // asleep for 5 hours
  assert.deepEqual(spans, [0, 60000, 5 * 3600000]);
  await ticker.tick(t0 + 1000);   // a clock behind the saved tick never goes backwards
  assert.equal(spans.at(-1), 0);
});
