// Every Build tool (Factory, Wall, Sell land) with 0, 9, 20 and 40 blocks: what the menu says before anything is
// placed, and what building does. A throwaway schema in the dev database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const catalog = require('../catalog');
const store = require('../store');
const { testDb, newGuest, claim, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('buildtools');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });

// An account (30 days old, plenty of squares) with `n` blocks in the top rows of a fresh 10-wide map, on that map.
async function withBlocks(n) {
  const id = await store.createMap(pool, { name: 'Tools ' + n + ' ' + crypto.randomBytes(2).toString('hex'), width: 10, height: 6 });
  const home = await store.createMap(pool, { name: 'Home ' + crypto.randomBytes(2).toString('hex'), width: 2, height: 1 });
  const g = await newGuest(pool, n ? id : home, 0, 0);   // with 0 blocks: their only block is on another map
  for (let i = 1; i < n; i++) await claim(pool, id, g.playerId, i % 10, Math.floor(i / 10));
  await pool.query(`UPDATE players SET squares = 100000000, auth_user_id = $2, created_at = now() - interval '30 days', last_map_id = $3 WHERE id = $1`,
    [g.playerId, crypto.randomUUID(), id]);
  const s = connectPlayer(url, { token: g.token });
  sockets.push(s);
  const w = await s.welcome;
  assert.equal(w.map.id, id);
  return s;
}
const per = catalog.E.factoryBlocksPerFactory;

test('0 blocks: every tool says why, before placing', async () => {
  const s = await withBlocks(0);
  assert.deepEqual((await s.ask('buildInfo')).reasons, {
    factory: `You need ${per} blocks for your first factory (you have 0).`,
    wall: 'Claim a block first: walls go on the edge of your land.',
    sell: 'You have no land on this map to sell.',
  });
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 0, y: 0 }), { error: 'Only on your own land' });
});

test('9 blocks: no factory yet (it says how many are needed); walls and selling work', async () => {
  const s = await withBlocks(9);
  const info = await s.ask('buildInfo');
  assert.deepEqual(info.reasons, { factory: `You need ${per} blocks for your first factory (you have 9).`, wall: null, sell: null });
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 0, y: 0 }), { error: `You need ${per} blocks for your first factory (you have 9).` });
  assert.equal((await s.ask('build', { kind: 'wall', x: 0, y: 0, side: 'n' })).ok, true);
  assert.equal((await s.ask('listLand', { blocks: [[3, 0], [4, 0]], price: 10 })).ok, true);
});

test('20 blocks: one factory; then it says how many more blocks the next needs', async () => {
  const s = await withBlocks(20);
  assert.deepEqual((await s.ask('buildInfo')).reasons, { factory: null, wall: null, sell: null });
  assert.equal((await s.ask('build', { kind: 'factory', x: 2, y: 1 })).ok, true);
  const after1 = await s.ask('buildInfo');
  assert.equal(after1.reasons.factory, `Own ${per} more blocks for another factory (you have 20).`);
  assert.deepEqual(await s.ask('build', { kind: 'factory', x: 3, y: 1 }), { error: after1.reasons.factory });
  assert.equal((await s.ask('build', { kind: 'wall', x: 5, y: 1, side: 's' })).ok, true);
});

test('40 blocks: two factories, each priced g times the one before', async () => {
  const s = await withBlocks(40);
  const first = (await s.ask('buildInfo')).factory.price;
  assert.equal((await s.ask('build', { kind: 'factory', x: 1, y: 1 })).ok, true);
  const info = await s.ask('buildInfo');
  assert.ok(Math.abs(info.factory.price - first * catalog.E.factoryBuildGrowth) < 0.2, `${info.factory.price} vs ${first} x g`);
  assert.equal((await s.ask('build', { kind: 'factory', x: 2, y: 2 })).ok, true);
  assert.equal((await s.ask('buildInfo')).reasons.factory, `Own ${per} more blocks for another factory (you have 40).`);
  assert.equal((await s.ask('build', { kind: 'wall', x: 9, y: 3, side: 's' })).ok, true);
  assert.equal((await s.ask('listLand', { blocks: [[0, 3]], price: 5 })).ok, true);
});
