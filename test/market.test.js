// Loop 16 Phase 7: the land market on a throwaway schema in the dev database: listing connected blocks, buying
// (fee destroyed, factories and walls move with the land), cancelling, attacks ending a listing, account age.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const catalog = require('../catalog');
const rules = require('../rules');
const store = require('../store');
const { testDb, newGuest, claim, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('market');
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
// Makes a player an account, `days` old.
const account = (pid, days) => pool.query('UPDATE players SET auth_user_id = $2, created_at = now() - make_interval(days => $3) WHERE id = $1', [pid, crypto.randomUUID(), days]);
const squaresOf = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares);

test('connected blocks only; accounts at least marketMinAccountDays old; a sale moves blocks, factories and walls; the fee is destroyed', async () => {
  assert.equal(rules.connected([[0, 0], [1, 0], [1, 1]]), true);
  assert.equal(rules.connected([[0, 0], [2, 0]]), false);
  assert.equal(rules.connected([[0, 0], [1, 1]]), false, 'corners don\'t connect');

  const id = await store.createMap(pool, { name: 'Market', width: 8, height: 2 });
  const sell = await newGuest(pool, id, 0, 0);
  for (const x of [1, 2, 3]) await claim(pool, id, sell.playerId, x, 0);
  await pool.query(`UPDATE map_cells SET walls = '[{"side":"s","hits":20}]' WHERE map_id = $1 AND x = 2 AND y = 0`, [id]);
  const ss = player({ token: sell.token });
  await onMap(ss, id);
  assert.deepEqual(await ss.ask('listLand', { blocks: [[2, 0], [3, 0]], price: 100 }), { error: 'Only accounts can buy and sell land' });
  await account(sell.playerId, catalog.E.marketMinAccountDays - 1);
  assert.deepEqual(await ss.ask('listLand', { blocks: [[2, 0], [3, 0]], price: 100 }), { error: `Accounts can trade land once they are ${catalog.E.marketMinAccountDays} days old` });
  await account(sell.playerId, catalog.E.marketMinAccountDays + 1);
  assert.deepEqual(await ss.ask('listLand', { blocks: [[1, 0], [3, 0]], price: 100 }), { error: 'The blocks must be connected side to side' });
  assert.deepEqual(await ss.ask('listLand', { blocks: [[3, 0], [4, 0]], price: 100 }), { error: 'Only your own blocks' });
  const listed = ss.next('listing');
  const r = await ss.ask('listLand', { blocks: [[2, 0], [3, 0]], price: 100 });
  assert.equal(r.ok, true);
  const l = await listed;
  assert.deepEqual([l.size, l.price, l.levels, l.seller.pid], [2, 100, [1, 1], sell.playerId]);
  assert.deepEqual(await ss.ask('build', { kind: 'factory', x: 2, y: 0 }), { error: 'Not on land for sale' }, 'no new buildings on listed land');
  assert.deepEqual(await ss.ask('build', { kind: 'wall', x: 3, y: 0, side: 'n' }), { error: 'Not on land for sale', at: { x: 3, y: 0, side: 'n' } }, 'nor walls');
  // A factory on it already moves with it.
  const { rows: [f] } = await pool.query(`INSERT INTO factories (map_id, owner_id, x, y, awake_until, processed_at) VALUES ($1, $2, 3, 0, now(), now()) RETURNING id`, [id, sell.playerId]);
  await pool.query('UPDATE map_cells SET factory_id = $2 WHERE map_id = $1 AND x = 3 AND y = 0', [id, f.id]);

  // The buyer: an account old enough, anywhere on the map (the land needn't touch theirs).
  const buyer = player();
  await onMap(buyer, id);
  buyer.take(7, 1);
  const you = await buyer.next('you');
  await account(you.pid, catalog.E.marketMinAccountDays + 1);
  await pool.query('UPDATE players SET squares = 999 WHERE id = $1', [you.pid]);   // 99.9 squares: short
  const sellerBefore = await squaresOf(sell.playerId);
  const b2 = player({ token: you.token });
  await onMap(b2, id);
  const card = await b2.ask('inspect', { x: 3, y: 0 });
  assert.deepEqual([card.listing.id, card.listing.size, card.listing.mine], [r.id, 2, false]);
  assert.deepEqual(await b2.ask('buyLand', { id: r.id }), { error: 'Not enough squares', need: 0.1 });
  await pool.query('UPDATE players SET squares = 1000 WHERE id = $1', [you.pid]);
  const answers = await Promise.all([b2.ask('buyLand', { id: r.id }), b2.ask('buyLand', { id: r.id })]);
  assert.equal(answers.filter(a => a.ok).length, 1, 'bought once');
  assert.equal(await squaresOf(you.pid), 0, 'the buyer paid the full price');
  const fee = Math.floor(1000 * catalog.E.marketFee);
  assert.equal(await squaresOf(sell.playerId) - sellerBefore, 1000 - fee, 'the seller got it less the fee (destroyed)');
  const { rows: cells } = await pool.query('SELECT x, owner_id, walls, factory_id, listing_id FROM map_cells WHERE map_id = $1 AND y = 0 AND x IN (2, 3) ORDER BY x', [id]);
  assert.deepEqual(cells.map(c => [c.x, c.owner_id, c.listing_id]), [[2, you.pid, null], [3, you.pid, null]]);
  assert.deepEqual(cells[0].walls, [{ side: 's', hits: 20 }], 'walls move with the land');
  assert.equal((await pool.query('SELECT owner_id FROM factories WHERE id = $1', [f.id])).rows[0].owner_id, you.pid, 'so do factories');
  assert.equal(await db.count('SELECT count(*) FROM listings WHERE id = $1', [r.id]), 0);
  assert.deepEqual(await b2.ask('buyLand', { id: r.id }), { error: 'That land is no longer for sale' });
});

test('the seller can cancel; any attack on a listed block ends the listing; the Land tab lists them', async () => {
  const id = await store.createMap(pool, { name: 'Bazaar', width: 6, height: 1 });
  const sell = await newGuest(pool, id, 0, 0);
  await claim(pool, id, sell.playerId, 1, 0);
  await account(sell.playerId, 30);
  const ss = player({ token: sell.token });
  await onMap(ss, id);
  const a = await ss.ask('listLand', { blocks: [[0, 0]], price: 5 });
  assert.deepEqual((await ss.ask('landList')).list.map(l => [l.id, l.size, l.price, l.mine]), [[a.id, 1, 5, true]]);
  assert.deepEqual(await ss.ask('cancelListing', { id: a.id }), { ok: true });
  assert.deepEqual((await ss.ask('landList')).list, []);
  const b = await ss.ask('listLand', { blocks: [[1, 0]], price: 5 });
  const other = player();
  await onMap(other, id);
  other.take(2, 0);
  await other.next('you');
  const gone = ss.next('listing', d => d.id === b.id && d.gone);
  other.emit('hit', { x: 1, y: 0 });   // one hit is an attack
  await gone;
  assert.equal(await db.count('SELECT count(*) FROM listings WHERE id = $1', [b.id]), 0);
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE listing_id IS NOT NULL AND map_id = $1', [id]), 0);
  assert.deepEqual(await other.ask('cancelListing', { id: b.id }), { error: 'Not your listing' });
});
