// Loop 16 Phase 6: walls. The rules in memory, then building, breaking, the outward block and Demolition on a
// throwaway schema in the dev database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../app');
const catalog = require('../catalog');
const rules = require('../rules');
const store = require('../store');
const { testDb, newGuest, claim, connectPlayer } = require('./helpers');

const k = (x, y) => x + ',' + y;
// A row of blocks: 'a' owns x 0-1, 'b' owns x 3, x 2 is empty; walls as given.
function row(walls = {}) {
  const cells = new Map([[k(0, 0), 'a'], [k(1, 0), 'a'], [k(2, 0), null], [k(3, 0), 'b'], [k(1, 1), null]]);
  return { cells, counts: new Map([['a', 2], ['b', 1]]), walls: new Map(Object.entries(walls)), terrainAt: () => 'grass' };
}

test('placing: only on an outer side of your own block, at most maxWallsPerBlock per block, on different sides', () => {
  const m = row();
  assert.equal(rules.wallRefusal(m, 'a', 1, 0, 'e'), null, 'facing an empty block');
  assert.equal(rules.wallRefusal(m, 'a', 1, 0, 's'), null, 'facing an empty block below');
  assert.equal(rules.wallRefusal(m, 'a', 1, 0, 'n'), null, 'facing no block at all is outer too');
  assert.equal(rules.wallRefusal(m, 'a', 1, 0, 'w'), 'Walls go on the edge of your land', 'facing their own block');
  assert.equal(rules.wallRefusal(m, 'a', 2, 0, 'e'), 'Only on your own land');
  assert.equal(rules.wallRefusal(m, 'a', 1, 0, 'x'), 'Pick a side');
  const two = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }, { side: 's', hits: 20 }] });
  assert.equal(rules.wallRefusal(two, 'a', 1, 0, 'e'), 'There is a wall there already');
  assert.equal(rules.wallRefusal(two, 'a', 1, 0, 'n'), `At most ${rules.MAX_WALLS} walls on one block`);
});

test('attacking: through walls only, the wall is hit first; your own wall blocks you claiming across it', () => {
  // b attacks a's block (1, 0)? b owns (3, 0), not touching. Put b at (2, 0) for this.
  const m = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }] });
  m.cells.set(k(2, 0), 'b');
  assert.equal(rules.wallFirst(m, 'b', 1, 0), 'e', 'b touches (1, 0) only from the east, which is walled');
  assert.equal(rules.hitError(m, 'b', 1, 0), null, 'the hit is allowed (it goes to the wall)');
  m.cells.set(k(1, 1), 'b');
  assert.equal(rules.wallFirst(m, 'b', 1, 0), null, 'b also touches it from below, unwalled: no wall first');
  // a's own wall on (1, 0) facing east stops a claiming (2, 0) through it.
  const own = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }] });
  assert.equal(rules.hitError(own, 'a', 2, 0), 'Your wall is in the way');
  own.cells.set(k(1, 1), 'a');
  own.cells.set(k(2, 1), null);
  assert.equal(rules.hitError(own, 'a', 2, 1), null, 'another way round is fine');
});

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('walls');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
async function onMap(s, id) {
  const w = await s.welcome;
  if (w.map.id !== id) { await s.ask('switchMap', id); await s.next('welcome', d => d.map.id === id); }
}

test('a wall: priced P_a x w x H / hitsPerSquare, w x H hits to break, broken for good; Demolition removes one', async () => {
  const id = await store.createMap(pool, { name: 'Walled', width: 6, height: 1 });
  const a = await newGuest(pool, id, 0, 0);
  await claim(pool, id, a.playerId, 1, 0);
  const H = rules.HITS_PER_BLOCK, price = catalog.priceTenths(catalog.CATALOG.get('building:wall'), { H });
  assert.equal(price, catalog.toTenths(catalog.E.wallPaybackHours * catalog.E.wallStrength * H / catalog.E.hitsPerSquare));
  const demo = catalog.priceTenths(catalog.CATALOG.get('item:demolition'), { L: 1 });
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [a.playerId, price * 2 + demo]);
  const sa = player({ token: a.token });
  await onMap(sa, id);
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 1, y: 0, side: 'w' }), { error: 'Walls go on the edge of your land' });
  const built = sa.next('walls');
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 1, y: 0, side: 'e' }), { ok: true, squares: (price + demo) / 10 });
  assert.deepEqual((await built).walls, [{ side: 'e', hits: catalog.E.wallStrength * H }]);
  // Its owner can't claim across it.
  sa.emit('hit', { x: 2, y: 0 });
  assert.equal(await sa.next('denied'), 'Your wall is in the way');

  // Another player next to it on the other side hits the wall first: w x H hits, then it breaks.
  const sb = player();
  await onMap(sb, id);
  sb.take(3, 0);
  await sb.next('you');
  sb.take(2, 0);
  await sb.next('claim', d => d.x === 2 && d.y === 0);
  const broken = sb.next('walls', d => d.broken === 'e');
  for (let i = 0; i < catalog.E.wallStrength * H - 1; i++) sb.emit('hit', { x: 1, y: 0 });
  await sb.next('hit', d => d.x === 1 && d.y === 0 && d.side === 'e' && d.p > 0.9);
  assert.equal((await sb.ask('inspect', { x: 1, y: 0 })).owner.pid, a.playerId, 'the block is untouched so far');
  sb.emit('hit', { x: 1, y: 0 });
  await broken;
  assert.deepEqual((await pool.query('SELECT walls FROM map_cells WHERE map_id = $1 AND x = 1 AND y = 0', [id])).rows[0].walls, [], 'gone for good');
  // Now the block itself.
  sb.take(1, 0);
  await sb.next('claim', d => d.x === 1 && d.y === 0);

  // Demolition removes one of your walls, no refund.
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 0, y: 0, side: 'n' }), { ok: true, squares: demo / 10 });
  await sa.ask('buyItem', { item: 'demolition' });
  assert.deepEqual(await sa.ask('useItem', { item: 'demolition', x: 0, y: 0, target: 'wall', side: 's' }), { error: 'There is no wall there' });
  assert.equal((await sa.ask('useItem', { item: 'demolition', x: 0, y: 0, target: 'wall', side: 'n' })).ok, true);
  assert.deepEqual((await pool.query('SELECT walls FROM map_cells WHERE map_id = $1 AND x = 0 AND y = 0', [id])).rows[0].walls, []);
});

test('walls go with their block when it is taken', async () => {
  const id = await store.createMap(pool, { name: 'Lost Walls', width: 3, height: 1 });
  await newGuest(pool, id, 0, 0);
  await pool.query(`UPDATE map_cells SET walls = '[{"side":"n","hits":20},{"side":"s","hits":20}]' WHERE map_id = $1 AND x = 0 AND y = 0`, [id]);
  const sb = player();
  await onMap(sb, id);
  sb.take(1, 0);
  await sb.next('you');
  const cleared = sb.next('walls', d => d.x === 0 && d.y === 0 && d.walls.length === 0);
  sb.take(0, 0);   // from the east: not walled
  await sb.next('claim', d => d.x === 0 && d.y === 0);
  await cleared;
  assert.deepEqual((await pool.query('SELECT walls FROM map_cells WHERE map_id = $1 AND x = 0 AND y = 0', [id])).rows[0].walls, []);
});
