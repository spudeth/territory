// Items (loop 14): buying, limits (too early, two devices), Super Click timing, the Terraformer's rules, and
// everyone seeing terrain changes. The dev database, a throwaway schema.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../../../app');
const rules = require('../../../rules');
const catalog = require('../../../catalog');
const store = require('../../../store');
const { testDb, connectPlayer } = require('../../../test/helpers');

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
const ITEMS = require('../data.json').items;
const SUPER = ITEMS.find(i => i.id === 'superClick'), TERRA = ITEMS.find(i => i.id === 'terraformer');
let row = 0;
// A guest with a block at (0, y) and `balance` squares, on a fresh connection.
async function guestWith(balance) {
  const s = player(), y = row++ * 3;
  await s.welcome;
  s.take(0, y);
  const { pid, token } = await s.next('you');
  await s.next('claim', at(0, y));
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, Math.round(balance * 10)]);   // squares -> tenths
  const fresh = player({ token });
  await fresh.welcome;
  return { s: fresh, pid, token, y };
}

test('the items: Super Click and Terraformer, 750 squares each at level 1 (P x V x W(L)), from the data', () => {
  const price = i => catalog.priceTenths(i, { L: 1 });
  assert.deepEqual([price(SUPER), SUPER.uses, SUPER.perMinutes, SUPER.value, SUPER.seconds], [7500, 1, 60, 10, 5]);
  assert.deepEqual([price(TERRA), TERRA.uses, TERRA.perMinutes, TERRA.effect], [7500, 5, 60, 'terraform']);
});

test('buying: exactly the price works once; one short is refused', async () => {
  const g = await guestWith(750);
  assert.deepEqual(await g.s.ask('items:buy', { item: 'superClick' }), { squares: 0, balance: 0 });
  assert.deepEqual(await g.s.ask('items:buy', { item: 'superClick' }), { error: 'You already own this item' });
  const short = await guestWith(749);
  assert.deepEqual(await short.s.ask('items:buy', { item: 'superClick' }), { error: 'Not enough squares', need: 1 });
  const list = (await g.s.ask('items:list')).list;
  assert.equal(list.find(i => i.id === 'superClick').owned, true);
});

test('Super Click: x10 for 5 seconds, then normal; once an hour, even from two devices at once', async () => {
  const g = await guestWith(750);
  await g.s.ask('items:buy', { item: 'superClick' });
  const other = player({ token: g.token });
  await other.welcome;
  const answers = await Promise.all([g.s.ask('items:use', { item: 'superClick' }), other.ask('items:use', { item: 'superClick' })]);
  assert.equal(answers.filter(a => a.ok).length, 1, JSON.stringify(answers));
  assert.match(answers.find(a => !a.ok).error, /No uses left/);
  g.s.emit('hit', { x: 1, y: g.y });                     // one tap is 10 hits now: the block is taken
  await g.s.next('claim', at(1, g.y));
  await new Promise(r => setTimeout(r, SUPER.seconds * 1000 + 300));
  g.s.emit('hit', { x: 2, y: g.y });                     // after 5 seconds, a tap is one hit again
  const h = await g.s.next('hit', at(2, g.y));
  assert.equal(h.p, 1 / rules.HITS_PER_BLOCK);
  const again = await g.s.ask('items:use', { item: 'superClick' });
  assert.equal(again.error, 'No uses left yet');
  assert.ok(again.nextAt > Date.now() + 59 * 60000, 'free again in an hour');
});

test('Terraformer: own blocks and empty ones next to them; never gold; 5 an hour; everyone sees it', async () => {
  const seed = 'terraform test';
  const id = await store.createMap(pool, { name: 'Terra', seed, blocks: 3000 });
  const world = require('../../../public/terrain').makeWorld(seed, rules.TERRAIN);
  const cells = (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1', [id])).rows;
  const gold = cells.find(c => world.at(c.x, c.y) === 'gold');
  const g = await guestWith(750);
  await g.s.ask('items:buy', { item: 'terraformer' });
  await g.s.ask('switchMap', id); await g.s.next('welcome');
  const watcher = player(); await watcher.welcome; await watcher.ask('switchMap', id); await watcher.next('welcome');
  // Claim the gold block as the first block there (anywhere is allowed for a first block).
  for (let i = 0; i < 10; i++) g.s.emit('hit', { x: gold.x, y: gold.y });
  await g.s.next('claim', at(gold.x, gold.y));
  const use = (x, y, terrain) => g.s.ask('items:use', { item: 'terraformer', x, y, terrain });
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
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM map_cells WHERE map_id = $1 AND terrain IS NOT NULL', [id])).rows[0].n, 1, 'one block changed, kept for good');
});

test('Demolition is used up: bought singly or in batches at its Hours price each; a block with nothing built uses none', async () => {
  const DEMO = ITEMS.find(i => i.id === 'demolition');
  const price = catalog.priceTenths(DEMO, { L: 1 }) / 10;
  assert.equal(price, 600, '0.5 work-hours at level 1');
  const g = await guestWith(price * 4);
  assert.equal((await g.s.ask('items:buy', { item: 'demolition' })).count, 1);
  assert.deepEqual(await g.s.ask('items:buy', { item: 'demolition', qty: 4 }), { error: 'Not enough squares', need: price }, 'four at once: four times the price');
  assert.deepEqual(await g.s.ask('items:buy', { item: 'demolition', qty: 3 }), { squares: 0, balance: 0, count: 4 }, 'three at once: four in all');
  assert.deepEqual(await g.s.ask('items:buy', { item: 'superClick', qty: 2 }), { error: 'Pick how many, 1 to 100' }, 'batches are for used-up items only');
  assert.deepEqual(await g.s.ask('items:buy', { item: 'demolition', qty: 0 }), { error: 'Pick how many, 1 to 100' });
  const list = (await g.s.ask('items:list')).list;
  assert.deepEqual(['count', 'owned', 'consumable'].map(k => list.find(i => i.id === 'demolition')[k]), [4, true, true]);
  assert.equal(DEMO.consumable, true);
  // Nothing built on the block: nothing to clear, none used.
  assert.deepEqual(await g.s.ask('items:use', { item: 'demolition', blocks: [[0, g.y]] }), { error: 'Nothing is built on those blocks' });
  assert.deepEqual(await g.s.ask('items:use', { item: 'demolition', blocks: [[5, g.y]] }), { error: 'Only your own blocks' });
  assert.equal((await pool.query("SELECT count FROM player_inventory WHERE player_id = $1 AND item_id = 'demolition'", [g.pid])).rows[0].count, 4, 'none used');
});

test('as a plug-in (loop 19): its browser files are served, the welcome lists them, and its Game Guide section shows', async () => {
  const s = player();
  const w = await s.welcome;
  assert.deepEqual(w.plugins.find(p => p.name === 'items').files.map(f => f.replace(/[?]v=[0-9a-f]+$/, '')), ['/plugins/items/text.js', '/plugins/items/style.css', '/plugins/items/client.js']);
  for (const f of ['text.js', 'style.css', 'client.js', 'look/demolition.png']) assert.equal((await fetch(`${url}/plugins/items/${f}`)).status, 200, f);
  assert.equal((await fetch(`${url}/plugins/items/server.js`)).status, 404, 'never its server code');
  const html = await (await fetch(url + '/guide')).text();
  assert.ok(html.includes('<h2 id="items">Items</h2>') && html.includes('href="#items"') && html.includes('Super Click'), 'its Guide section and link');
});
