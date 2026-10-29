// Items (loop 14): buying, limits (too early, two devices), Super Click timing, the Terraformer's rules, and
// everyone seeing terrain changes. The dev database, a throwaway schema.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('items');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db.drop();
});
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
const at = (x, y) => d => d.x === x && d.y === y;
const SUPER = rules.ITEMS.find(i => i.id === 'super-click'), TERRA = rules.ITEMS.find(i => i.id === 'terraformer');
let row = 0;
// A guest with a block at (0, y) and `balance` squares, on a fresh connection.
async function guestWith(balance) {
  const s = player(), y = row++ * 3;
  await s.welcome;
  s.take(0, y);
  const { pid, token } = await s.next('you');
  await s.next('claim', at(0, y));
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, balance]);
  const fresh = player({ token });
  await fresh.welcome;
  return { s: fresh, pid, token, y };
}

test('the items: Super Click and Terraformer, 28,800 squares each, from the data', () => {
  assert.deepEqual([SUPER.price, SUPER.uses, SUPER.perMinutes, SUPER.value, SUPER.seconds], [28800, 1, 60, 10, 5]);
  assert.deepEqual([TERRA.price, TERRA.uses, TERRA.perMinutes, TERRA.effect], [28800, 5, 60, 'terraform']);
});

test('buying: exactly the price works once; one short is refused', async () => {
  const g = await guestWith(28800);
  assert.deepEqual(await g.s.ask('buyItem', { item: 'super-click' }), { squares: 0, balance: 0 });
  assert.deepEqual(await g.s.ask('buyItem', { item: 'super-click' }), { error: 'You already own this item' });
  const short = await guestWith(28799);
  assert.deepEqual(await short.s.ask('buyItem', { item: 'super-click' }), { error: 'Not enough squares', need: 1 });
  const list = (await g.s.ask('items')).list;
  assert.equal(list.find(i => i.id === 'super-click').owned, true);
});

test('Super Click: x10 for 5 seconds, then normal; once an hour, even from two devices at once', async () => {
  const g = await guestWith(28800);
  await g.s.ask('buyItem', { item: 'super-click' });
  const other = player({ token: g.token });
  await other.welcome;
  const answers = await Promise.all([g.s.ask('useItem', { item: 'super-click' }), other.ask('useItem', { item: 'super-click' })]);
  assert.equal(answers.filter(a => a.ok).length, 1, JSON.stringify(answers));
  assert.match(answers.find(a => !a.ok).error, /No uses left/);
  g.s.emit('hit', { x: 1, y: g.y });                     // one tap is 10 hits now: the block is taken
  await g.s.next('claim', at(1, g.y));
  await new Promise(r => setTimeout(r, SUPER.seconds * 1000 + 300));
  g.s.emit('hit', { x: 2, y: g.y });                     // after 5 seconds, a tap is one hit again
  const h = await g.s.next('hit', at(2, g.y));
  assert.equal(h.p, 1 / rules.HITS_PER_BLOCK);
  const again = await g.s.ask('useItem', { item: 'super-click' });
  assert.equal(again.error, 'No uses left yet');
  assert.ok(again.nextAt > Date.now() + 59 * 60000, 'free again in an hour');
});

test('Terraformer: own blocks and empty ones next to them; never gold; 5 an hour; everyone sees it', async () => {
  const seed = 'terraform test';
  const id = await store.createMap(pool, { name: 'Terra', seed, blocks: 3000 });
  const world = require('../public/terrain').makeWorld(seed, rules.TERRAIN);
  const cells = (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1', [id])).rows;
  const gold = cells.find(c => world.at(c.x, c.y) === 'gold');
  const g = await guestWith(28800);
  await g.s.ask('buyItem', { item: 'terraformer' });
  await g.s.ask('switchMap', id); await g.s.next('welcome');
  const watcher = player(); await watcher.welcome; await watcher.ask('switchMap', id); await watcher.next('welcome');
  // Claim the gold block as the first block there (anywhere is allowed for a first block).
  for (let i = 0; i < 10; i++) g.s.emit('hit', { x: gold.x, y: gold.y });
  await g.s.next('claim', at(gold.x, gold.y));
  const use = (x, y, terrain) => g.s.ask('useItem', { item: 'terraformer', x, y, terrain });
  assert.equal((await use(gold.x, gold.y, 'sand')).error, "Gold can't be changed");
  const next = [gold.x + 1, gold.y], far = [gold.x + 9, gold.y + 9];
  assert.equal((await use(...next, 'gold')).error, 'Pick a block and grass, sand, forest, stone or water', 'never makes gold');
  assert.equal((await use(...far, 'grass')).error, 'Only your own blocks, or empty ones touching your land');
  const terrain = world.at(...next) === 'stone' ? 'sand' : 'stone';
  const r = await use(...next, terrain);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.usesLeft, 4);
  assert.deepEqual(await watcher.next('terrain', at(...next)), { x: next[0], y: next[1], terrain }, 'everyone sees it');
  for (const t of ['grass', 'forest', 'sand', 'stone']) await use(...next, world.at(...next) === t ? 'water' : t);   // 4 more
  const sixth = await use(...next, 'grass');
  assert.equal(sixth.error, 'No uses left yet');
  const fresh = player({ token: g.token });
  const w = await fresh.welcome;
  assert.ok(w.terrain.some(([x, y]) => x === next[0] && y === next[1]), 'a returning player gets the change with the map');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM terrain_overrides WHERE map_id = $1', [id])).rows[0].n, 1, 'one block changed, kept for good');
});
