// Loop 16 Phase 2: map levels, hardness and pay by birth level, new blocks born at the map's level, and the
// block info card. A throwaway schema in the dev database; maps with a tiny E so levels come quickly.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../server/app');
const rules = require('../server/rules');
const store = require('../server/store');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('levels');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
// Hits a block until it is taken (each hit is 1 at Click Power level 0).
async function mine(s, x, y, hits) {
  const claimed = s.next('claim', d => d.x === x && d.y === y);
  for (let i = 0; i < hits; i++) s.emit('hit', { x, y });
  return claimed;
}

test('a map levels up at E, 3E, 7E… blocks mined; new blocks are born at its level, harder and paying more', async () => {
  const id = await store.createMap(pool, { name: 'Tiny', width: 2, height: 1 });   // E = 2
  const s = player();
  await s.welcome;
  await s.ask('switchMap', id);
  const w = await s.next('welcome', d => d.map.id === id);
  assert.deepEqual([w.level.level, w.level.mined, w.level.base], [1, 0, 2]);
  const levelUp = s.next('mapMined', n => n === 2);
  await mine(s, 0, 0, 10);
  const you = await s.next('you');
  const grown1 = await s.next('grow');
  assert.equal(grown1.l, 1, 'the first claim leaves the map at level 1: its new block is level 1');
  await mine(s, 1, 0, 10);
  await levelUp;
  const grown2 = await s.next('grow');
  assert.equal(grown2.l, 2, 'the second first claim reaches E = 2: level 2, and the new block is born at level 2');
  const { rows: [b] } = await pool.query('SELECT birth_level FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3', [id, grown2.x, grown2.y]);
  assert.equal(b.birth_level, 2, 'stored with the block, for good');
  // The first new block (level 1) touches the starting blocks: taking it makes sure the level-2 one touches our land.
  await mine(s, grown1.x, grown1.y, 10);
  await s.next('grow');

  // The info card: a level-2 grass block is twice as hard and pays twice as much.
  const info = await s.ask('inspect', { x: grown2.x, y: grown2.y });
  assert.equal(info.level, 2);
  assert.equal(info.hardness, rules.HITS_PER_BLOCK * 2 * (rules.TERRAIN_HITS[info.terrain] ?? 1));
  assert.equal(info.pay, rules.firstClaimTenths(rules.NO_UPGRADES, info.terrain, 2) / 10);
  assert.equal(info.owner, null);

  // Mining it takes 20 hits, not 10, and pays 2 squares.
  const before = Number((await pool.query('SELECT squares FROM players WHERE id = $1', [you.pid])).rows[0].squares);
  for (let i = 0; i < 19; i++) s.emit('hit', grown2);
  await s.ask('inspect', grown2);   // let the 19 hits land
  assert.equal((await s.ask('inspect', grown2)).owner, null, '19 hits are not enough');
  await mine(s, grown2.x, grown2.y, 1);
  await s.next('squares');
  const after = Number((await pool.query('SELECT squares FROM players WHERE id = $1', [you.pid])).rows[0].squares);
  assert.equal(after - before, 20, 'a level-2 grass block pays 20 tenths (2 squares)');

  // Someone else's block: the hits to take it; your own: neither.
  const mineInfo = await s.ask('inspect', { x: 0, y: 0 });
  assert.deepEqual([mineInfo.owner.pid, mineInfo.owner.name, mineInfo.pay, mineInfo.hits], [you.pid, you.name, undefined, undefined]);
  const other = player();
  await other.welcome;
  await other.ask('switchMap', id);
  await other.next('welcome', d => d.map.id === id);
  assert.equal((await other.ask('inspect', { x: 0, y: 0 })).hits, rules.HITS_PER_BLOCK);
  assert.deepEqual(await other.ask('inspect', { x: 50, y: 50 }), { error: 'There is no block there' });
  const again = player({ token: you.token });
  const w2 = await again.welcome;
  assert.equal(w2.map.id, id);
  assert.ok(w2.cells.some(c => c[0] === grown2.x && c[1] === grown2.y && c[3] === 2), 'block levels reach the browser');
  assert.equal(w2.level.level, 2);
});
