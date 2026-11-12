// Loop 16 Phase 6: walls. The rules in memory, then building, breaking, the outward block and Demolition on a
// throwaway schema in the dev database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../../../app');
const catalog = require('../../../catalog');
const rules = require('../../../rules');
const store = require('../../../store');
const { testDb, newGuest, claim, connectPlayer } = require('../../../test/helpers');
const D = require('../data.json');
const W = require('../rules').wallRules(rules, D.maxWallsPerBlock);
// The core's hit check, then the walls plug-in's (as app.js asks it).
const hitError = (m, pid, x, y) => rules.hitError(m, pid, x, y) ?? W.hitRefusal(m, pid, x, y);

const k = (x, y) => x + ',' + y;
// A row of blocks: 'a' owns x 0-1, 'b' owns x 3, x 2 is empty; walls as given.
function row(walls = {}) {
  const cells = new Map([[k(0, 0), 'a'], [k(1, 0), 'a'], [k(2, 0), null], [k(3, 0), 'b'], [k(1, 1), null]]);
  return { cells, counts: new Map([['a', 2], ['b', 1]]), walls: new Map(Object.entries(walls)), terrainAt: () => 'grass' };
}

test('placing: only on an outer side of your own block, at most maxWallsPerBlock per block, on different sides', () => {
  const m = row();
  assert.equal(W.refusal(m, 'a', 1, 0, 'e'), null, 'facing an empty block');
  assert.equal(W.refusal(m, 'a', 1, 0, 's'), null, 'facing an empty block below');
  assert.equal(W.refusal(m, 'a', 1, 0, 'n'), null, 'facing no block at all is outer too');
  assert.equal(W.refusal(m, 'a', 1, 0, 'w'), 'Walls go on the edge of your land', 'facing their own block');
  assert.equal(W.refusal(m, 'a', 2, 0, 'e'), 'Only on your own land');
  assert.equal(W.refusal(m, 'a', 1, 0, 'x'), 'Pick a side');
  const two = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }, { side: 's', hits: 20 }] });
  assert.equal(W.refusal(two, 'a', 1, 0, 'e'), 'There is a wall there already');
  assert.equal(W.refusal(two, 'a', 1, 0, 'n'), `At most ${D.maxWallsPerBlock} walls on one block`);
});

test('attacking: through walls only, the wall is hit first; your own wall blocks you claiming across it', () => {
  // b attacks a's block (1, 0)? b owns (3, 0), not touching. Put b at (2, 0) for this.
  const m = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }] });
  m.cells.set(k(2, 0), 'b');
  assert.equal(W.wallFirst(m, 'b', 1, 0), 'e', 'b touches (1, 0) only from the east, which is walled');
  assert.equal(hitError(m, 'b', 1, 0), null, 'the hit is allowed (it goes to the wall)');
  m.cells.set(k(1, 1), 'b');
  assert.equal(W.wallFirst(m, 'b', 1, 0), null, 'b also touches it from below, unwalled: no wall first');
  // a's own wall on (1, 0) facing east stops a claiming (2, 0) through it.
  const own = row({ [k(1, 0)]: [{ side: 'e', hits: 20 }] });
  assert.equal(hitError(own, 'a', 2, 0), 'Your wall is in the way');
  own.cells.set(k(1, 1), 'a');
  own.cells.set(k(2, 1), null);
  assert.equal(hitError(own, 'a', 2, 1), null, 'another way round is fine');
});

test('the Walls tab and the price: wallPriceWh x W(L) x max(1, sqrt(walls owned) / 2)', () => {
  const economy = require('../../../economy'), data = require('../data');
  const csv = require('fs').readFileSync(require('path').join(__dirname, 'Walls.csv'), 'utf8');
  const errors = [], out = data.validate({ Walls: csv }, economy.sheetKit({ Walls: csv }, errors), errors);
  assert.deepEqual([errors, out], [[], D], 'the saved tab is data.json');
  const bad = '"Key","Value","Unit","What it means"\n"wallStrength","x","",""', e2 = [];
  data.validate({ Walls: bad }, economy.sheetKit({ Walls: bad }, e2), e2);
  assert.ok(e2.includes('Walls, cell B2 ("Value"): "x" is not a number (wallStrength)') && e2.includes('Walls: no row for "maxWallsPerBlock"'), e2.join(' | '));
  const price = (L, owned) => require('../rules').priceTenths(catalog, D, L, owned);
  assert.equal(price(1, 0), 120, '0.01 x 1200 = 12 squares');
  assert.equal(price(1, 4), 120, 'up to 4 walls owned: no extra');
  assert.equal(price(1, 16), 240, '16 owned: x2');
  assert.equal(price(3, 100), catalog.toTenths(0.01 * 4800 * 5), 'level 3, 100 owned: x5');
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

test('a wall: priced wallPriceWh x W(L), w x H hits to break, broken for good; Demolition removes one', async () => {
  const id = await store.createMap(pool, { name: 'Walled', width: 6, height: 1 });
  const a = await newGuest(pool, id, 0, 0);
  await claim(pool, id, a.playerId, 1, 0);
  const H = rules.HITS_PER_BLOCK, price = catalog.toTenths(D.wallPriceWh * catalog.W(1));
  assert.equal(price, 120, '0.01 x 1,200 = 12 squares, with fewer than 5 walls owned');
  const demo = catalog.priceTenths(require('../../items/data.json').items.find(i => i.id === 'demolition'), { L: 1 });
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [a.playerId, price * 2 + demo]);
  const sa = player({ token: a.token });
  await onMap(sa, id);
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 1, y: 0, side: 'w' }), { error: 'Walls go on the edge of your land', at: { x: 1, y: 0, side: 'w' } });
  const built = sa.next('walls:changed');
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 1, y: 0, side: 'e' }), { ok: true, built: 1, price: price / 10, squares: (price + demo) / 10 });
  assert.deepEqual((await built).walls, [{ side: 'e', hits: D.wallStrength * H }]);
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
  const broken = sb.next('walls:changed', d => d.broken === 'e');
  for (let i = 0; i < D.wallStrength * H - 1; i++) sb.emit('hit', { x: 1, y: 0 });
  await sb.next('hit', d => d.x === 1 && d.y === 0 && d.side === 'e' && d.p > 0.9);
  assert.equal((await sb.ask('inspect', { x: 1, y: 0 })).owner.pid, a.playerId, 'the block is untouched so far');
  sb.emit('hit', { x: 1, y: 0 });
  await broken;
  assert.deepEqual((await pool.query('SELECT walls FROM map_cells WHERE map_id = $1 AND x = 1 AND y = 0', [id])).rows[0].walls, [], 'gone for good');
  // Now the block itself.
  sb.take(1, 0);
  await sb.next('claim', d => d.x === 1 && d.y === 0);

  // Demolition clears the block's walls, no refund; one Demolition for the block, however many walls.
  assert.deepEqual(await sa.ask('build', { kind: 'wall', x: 0, y: 0, side: 'n' }), { ok: true, built: 1, price: price / 10, squares: demo / 10 });
  await pool.query(`UPDATE map_cells SET walls = walls || '[{"side":"s","hits":20}]' WHERE map_id = $1 AND x = 0 AND y = 0`, [id]);   // a second wall
  await sa.ask('items:buy', { item: 'demolition' });
  assert.equal((await sa.ask('items:use', { item: 'demolition', blocks: [[0, 0]] })).ok, true);
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
  const cleared = sb.next('walls:changed', d => d.x === 0 && d.y === 0 && d.walls.length === 0);
  sb.take(0, 0);   // from the east: not walled
  await sb.next('claim', d => d.x === 0 && d.y === 0);
  await cleared;
  assert.deepEqual((await pool.query('SELECT walls FROM map_cells WHERE map_id = $1 AND x = 0 AND y = 0', [id])).rows[0].walls, []);
});

test('walls in a batch (loop 18): all or nothing; one price multiplier from the walls owned before; the preview\'s prices', async () => {
  const id = await store.createMap(pool, { name: 'Batch Walls', width: 8, height: 8 });
  const a = await newGuest(pool, id, 3, 3);
  for (const [x, y] of [[4, 3], [3, 4], [4, 4]]) await claim(pool, id, a.playerId, x, y);
  // 16 walls owned already (made up on blocks of a far corner): the multiplier is sqrt(16) / 2 = 2.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [7, 7], [6, 7], [7, 6], [6, 6]]) {
    await claim(pool, id, a.playerId, x, y);
    await pool.query(`UPDATE map_cells SET walls = '[{"side":"n","hits":20},{"side":"w","hits":20}]' WHERE map_id = $1 AND x = $2 AND y = $3`, [id, x, y]);
  }
  const one = catalog.toTenths(D.wallPriceWh * catalog.W(1) * 2);
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [a.playerId, one * 3]);
  const sa = player({ token: a.token });
  await onMap(sa, id);
  const info = await sa.ask('buildInfo');
  assert.deepEqual([info.walls.owned, info.walls.factor, info.walls.byLevel[1]], [16, 2, one / 10], 'the preview\'s numbers');
  // One bad wall in the batch: nothing is built.
  const bad = await sa.ask('build', { kind: 'wall', walls: [{ x: 3, y: 3, side: 'n' }, { x: 3, y: 3, side: 'e' }] });
  assert.deepEqual(bad, { error: 'Walls go on the edge of your land', at: { x: 3, y: 3, side: 'e' } });
  assert.deepEqual(await sa.ask('build', { kind: 'wall', walls: [{ x: 3, y: 3, side: 'n' }, { x: 3, y: 3, side: 'n' }] }),
    { error: 'That wall is in the batch twice', at: { x: 3, y: 3, side: 'n' } });
  assert.deepEqual(await sa.ask('build', { kind: 'wall', walls: [{ x: 3, y: 3, side: 'n' }, { x: 3, y: 3, side: 'w' }, { x: 4, y: 3, side: 'n' }, { x: 4, y: 3, side: 'e' }] }),
    { error: 'Not enough squares', need: one / 10 }, 'four walls cost four times the multiplied price');
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1 AND x IN (3, 4) AND y = 3 AND walls <> \'[]\'', [id]), 0, 'nothing built');
  // Three walls: all built, each at the same multiplier (16 owned before the batch, not 17, 18).
  const got = [];
  sa.on('walls:changed', d => got.push(d));
  assert.deepEqual(await sa.ask('build', { kind: 'wall', walls: [{ x: 3, y: 3, side: 'n' }, { x: 3, y: 3, side: 'w' }, { x: 4, y: 3, side: 'n' }] }),
    { ok: true, built: 3, price: one * 3 / 10, squares: 0 });
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(got.map(d => [d.x, d.y, d.walls.map(w => w.side).join('')]).sort(), [[3, 3, 'nw'], [4, 3, 'n']]);
});

test('repair (loop 18): a tap on your own cracked block takes off your Click Power in hits, free; an undamaged one stays silent', async () => {
  const id = await store.createMap(pool, { name: 'Repairs', width: 4, height: 1 });
  await pool.query("UPDATE map_cells SET terrain = 'grass' WHERE map_id = $1", [id]);
  const a = await newGuest(pool, id, 0, 0), b = await newGuest(pool, id, 1, 0);
  await pool.query('UPDATE players SET squares = 1000 WHERE id = $1', [a.playerId]);
  const sa = player({ token: a.token }), sb = player({ token: b.token });
  await onMap(sa, id);
  await onMap(sb, id);
  const H = rules.HITS_PER_BLOCK;
  for (let i = 0; i < 3; i++) sb.emit('hit', { x: 0, y: 0 });
  await sa.next('hit', d => d.x === 0 && d.y === 0 && Math.abs(d.p - 3 / H) < 1e-9);
  sa.emit('hit', { x: 0, y: 0 });
  await sa.next('hit', d => d.x === 0 && d.y === 0 && Math.abs(d.p - 2 / H) < 1e-9);
  sa.emit('hit', { x: 0, y: 0 });
  sa.emit('hit', { x: 0, y: 0 });
  await sa.next('hit', d => d.x === 0 && d.y === 0 && d.p === 0);
  // Undamaged now: a tap does nothing at all, and repairs never cost anything.
  const seen = [];
  sa.on('hit', d => seen.push(d));
  sa.on('denied', d => seen.push(d));
  sa.emit('hit', { x: 0, y: 0 });
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(seen, []);
  assert.equal(Number((await pool.query('SELECT squares FROM players WHERE id = $1', [a.playerId])).rows[0].squares), 1000);
  // The attacker carries on from the repaired crack, not from where they were.
  sb.emit('hit', { x: 0, y: 0 });
  await sb.next('hit', d => d.x === 0 && d.y === 0 && Math.abs(d.p - 1 / H) < 1e-9);
});

test('repair (item 5, loop 19): your own block with no crack: a tap repairs its most cracked wall; the block first when it has one', async () => {
  const id = await store.createMap(pool, { name: 'Wall Repairs', width: 4, height: 2 });
  await pool.query("UPDATE map_cells SET terrain = 'grass' WHERE map_id = $1", [id]);
  const a = await newGuest(pool, id, 1, 0), b = await newGuest(pool, id, 2, 0);
  // a's block (1, 0) has walls on its east (facing b) and north.
  await pool.query(`UPDATE map_cells SET walls = '[{"side":"e","hits":20},{"side":"n","hits":20}]' WHERE map_id = $1 AND x = 1 AND y = 0`, [id]);
  const sa = player({ token: a.token }), sb = player({ token: b.token });
  await onMap(sa, id);
  await onMap(sb, id);
  // b can only reach (1, 0) from the east: b's hits go to the east wall (20 hits).
  for (let i = 0; i < 4; i++) sb.emit('hit', { x: 1, y: 0 });
  await sa.next('hit', d => d.x === 1 && d.y === 0 && d.side === 'e' && Math.abs(d.p - 4 / 20) < 1e-9);
  // a taps their own block (no crack on the block itself): the cracked wall loses a's Click Power (1).
  sa.emit('hit', { x: 1, y: 0 });
  await sa.next('hit', d => d.x === 1 && d.y === 0 && d.side === 'e' && Math.abs(d.p - 3 / 20) < 1e-9);
  for (let i = 0; i < 3; i++) sa.emit('hit', { x: 1, y: 0 });
  await sa.next('hit', d => d.x === 1 && d.y === 0 && d.side === 'e' && d.p === 0);
  // Nothing cracked now: a tap does nothing at all.
  const seen = [];
  sa.on('hit', d => seen.push(d));
  sa.emit('hit', { x: 1, y: 0 });
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(seen, []);
});
