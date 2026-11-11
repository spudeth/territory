// Buying upgrade tiers with squares, guest-to-account carry-over and the tap-rate limit (the dev database, a
// throwaway schema).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
const catalog = require('../catalog');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('shop');
  pool = db.pool;
  // These tests tap like bots, except the limit test; no achievements, so reward squares don't change balances.
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db.drop();
});
const player = (auth, at = url) => { const s = connectPlayer(at, auth); sockets.push(s); return s; };
const at = (x, y) => d => d.x === x && d.y === y;

// A guest with a block, holding `balance` squares exactly (tenths allowed). Resolves with { s, pid, token, y }.
let row = 0;
async function guestWith(balance, { highest = 1, mapId = null } = {}) {
  const s = player(), y = row++;
  await s.welcome;
  if (mapId) { await s.ask('switchMap', mapId); await s.next('welcome', d => d.map.id === mapId); }
  s.take(0, y);
  const { pid, token } = await s.next('you');
  await s.next('claim', at(0, y));
  await pool.query('UPDATE players SET squares = $2, highest_level = $3 WHERE id = $1', [pid, Math.round(balance * 10), highest]);   // squares -> tenths
  const fresh = player({ token });   // a new connection sees the new balance
  const w = await fresh.welcome;
  if (mapId && w.map.id !== mapId) { await fresh.ask('switchMap', mapId); await fresh.next('welcome', d => d.map.id === mapId); }
  return { s: fresh, pid, token, y };
}
const tiersOf = async pid => (await pool.query('SELECT tiers FROM players WHERE id = $1', [pid])).rows[0].tiers;
const balanceOf = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares) / 10;   // tenths -> squares
const ledgerOf = async pid => (await pool.query(
  "SELECT delta, balance_after, reason FROM square_ledger WHERE player_id = $1 AND reason LIKE 'upgrade:%' ORDER BY id", [pid]))
  .rows.map(r => [Number(r.delta) / 10, Number(r.balance_after) / 10, r.reason]);
const COST2 = catalog.tierCostTenths('clickPower', 2) / 10;   // c_u x 1200 x 2 = 9,600 squares

test('a tier is locked until a block of its level is first-claimed; then exactly the cost works; a tenth short is refused', async () => {
  const locked = await guestWith(COST2);
  assert.deepEqual(await locked.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 }), { error: 'Mine a level-2 block to unlock' });
  const short = await guestWith(COST2 - 0.1, { highest: 2 });
  assert.deepEqual(await short.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 }), { error: 'Not enough squares', need: 0.1 });
  assert.equal(await balanceOf(short.pid), COST2 - 0.1, 'nothing taken');
  const g = await guestWith(COST2 + 0.5, { highest: 2 });
  const r = await g.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 });
  assert.deepEqual(r, { tiers: { clickPower: 2 }, squares: 0.5, balance: 0.5 });
  assert.deepEqual(await tiersOf(g.pid), { clickPower: 2 });
  assert.deepEqual(await ledgerOf(g.pid), [[-COST2, 0.5, 'upgrade:clickPower:2']]);
  const screen = await g.s.ask('upgrades');
  assert.deepEqual([screen.tiers, screen.highest, screen.mapLevel], [{ clickPower: 2 }, 2, 1]);
  const cp = screen.list.find(u => u.key === 'clickPower');
  assert.equal(cp.tiers.length, 10);
  assert.deepEqual(cp.tiers[0], { tier: 1, value: 1, cost: 0 });
  assert.equal(cp.tiers[1].cost, COST2);
  assert.equal(screen.list.length, 7, 'all seven upgrades from the Upgrades tab');
});

test('two purchases at the same moment: only one is paid for, from two devices or a double tap', async () => {
  const g = await guestWith(COST2 * 3, { highest: 3 });
  const other = player({ token: g.token });
  await other.welcome;
  const answers = await Promise.all([g.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 }), other.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 }),
    g.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 })]);
  assert.equal(answers.filter(a => a.tiers).length, 1, 'one bought');
  assert.deepEqual(await tiersOf(g.pid), { clickPower: 2 });
  assert.equal((await ledgerOf(g.pid)).length, 1);
});

test('tiers are bought in order, up to tier 10; costs are c_u x 1200 x 2^(N-1) and never change', async () => {
  const total = Array.from({ length: 9 }, (_, i) => catalog.tierCostTenths('growth', i + 2)).reduce((a, b) => a + b, 0) / 10;
  const g = await guestWith(total, { highest: 10 });
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'growth', tier: 3 }), { error: 'Buy the tiers in order' });
  for (let N = 2; N <= 10; N++) assert.deepEqual((await g.s.ask('buyUpgrade', { upgrade: 'growth', tier: N })).tiers, { growth: N }, `tier ${N}`);
  assert.equal(await balanceOf(g.pid), 0);
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'growth', tier: 11 }), { error: 'This upgrade is at its top tier' });
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'nope', tier: 2 }), { error: 'Unknown upgrade' });
});

test('an upgrade works at min(tier owned, map level): capped on a level-1 map, full on a level-2 one, from the very next tap', async () => {
  const id = await store.createMap(pool, { name: 'Level Two', width: 6, height: 6 });   // E = 36
  await pool.query('UPDATE maps SET mined = 36 WHERE id = $1', [id]);   // level 2 before anyone loads it
  const g = await guestWith(COST2, { highest: 2, mapId: id });
  await g.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 });
  assert.equal((await g.s.ask('upgrades')).mapLevel, 2);
  // Click Power x2: 5 taps take a 10-hit block here.
  for (let i = 0; i < 5; i++) g.s.emit('hit', { x: 1, y: g.y });
  await g.s.next('claim', d => d.x === 1 && d.y === g.y && d.pid === g.pid);
  // On the level-1 map it works at tier 1: 5 taps are not enough.
  await g.s.ask('switchMap', db.mapId);
  await g.s.next('welcome', d => d.map.id === db.mapId);
  g.s.take(30, 30);
  const you = await g.s.next('claim', d => d.x === 30 && d.y === 30);
  assert.equal(you.pid, g.pid, 'a first block on the other map (10 taps)');
  for (let i = 0; i < 5; i++) g.s.emit('hit', { x: 31, y: 30 });
  const crack = await g.s.next('hit', d => d.x === 31 && d.y === 30 && d.p > 0.4);
  assert.equal(crack.p, 0.5, 'five taps of x1 are half of ten hits');
});

test("a guest's tiers come with them when they make an account from their guest profile", async () => {
  const g = await guestWith(COST2, { highest: 2 });
  await g.s.ask('buyUpgrade', { upgrade: 'clickPower', tier: 2 });
  const { player: account, upgraded } = await store.accountPlayer(pool, 'test-' + crypto.randomUUID(), g.pid);
  assert.equal(upgraded, true);
  assert.equal(account.id, g.pid, 'the guest row becomes the account');
  assert.deepEqual(account.tiers, { clickPower: 2 });
});

test('taps over the rate limit are ignored, and players who hit it are logged', async t => {
  const saved = rules.MAX_TAPS_PER_SECOND;
  t.after(() => { rules.MAX_TAPS_PER_SECOND = saved; });
  const limited = createGame(pool, { tapLogMs: 200 });   // the real limit, from the rules
  await new Promise(r => limited.server.listen(0, r));
  t.after(() => limited.io.close());
  const there = `http://localhost:${limited.server.address().port}`;
  rules.MAX_TAPS_PER_SECOND = 1000;
  const p = player({}, there);
  await p.welcome;
  const y = row++;   // a row no other test here uses
  p.take(10, y);
  const { pid } = await p.next('you');
  await p.next('claim', at(10, y));

  rules.MAX_TAPS_PER_SECOND = 5;
  for (let i = 0; i < rules.HITS_PER_BLOCK; i++) p.emit('hit', { x: 11, y });   // 10 taps at once
  await p.next('hit', d => d.x === 11 && d.p === 0.5);
  await new Promise(r => setTimeout(r, 500));
  assert.ok(!p.events.some(([n, d]) => n === 'claim' && d.x === 11), 'only 5 of the 10 counted');
  assert.ok(!p.events.some(([n, d]) => n === 'hit' && d.x === 11 && d.p > 0.5));
  const { rows } = await pool.query('SELECT ignored FROM tap_limit_log WHERE player_id = $1', [pid]);
  assert.deepEqual(rows.map(r => r.ignored), [5], 'logged once, with the 5 ignored taps');

  await new Promise(r => setTimeout(r, 600));   // a second later the bucket has refilled
  for (let i = 0; i < 5; i++) p.emit('hit', { x: 11, y });
  await p.next('claim', at(11, y));
});

test('reset all progress: blocks, squares, upgrades, stats and achievements go, everywhere; other devices reload', async () => {
  const g = await guestWith(50);
  await pool.query("UPDATE players SET tiers = '{\"clickPower\": 2, \"defense\": 3}', highest_level = 3 WHERE id = $1", [g.pid]);
  const other = player({ token: g.token });   // a second device
  await other.welcome;
  const reloaded = other.next('notice', n => n.kind === 'reset');
  assert.deepEqual(await g.s.ask('resetProgress'), { ok: true });
  await reloaded;
  const q = async sql => (await pool.query(sql, [g.pid])).rows[0];
  assert.deepEqual(await q('SELECT squares::float AS s, tiers AS t, highest_level AS h, name IS NOT NULL AS named FROM players WHERE id = $1'),
    { s: 0, t: {}, h: 1, named: true });
  assert.equal((await q('SELECT count(*)::int AS n FROM map_cells WHERE owner_id = $1')).n, 0);
  for (const t of ['player_map_settings', 'player_map_stats', 'player_achievements']) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM ${t} WHERE player_id = $1`)).n, 0, t);
  }
  assert.deepEqual(await q("SELECT delta::float / 10 AS d, reason FROM square_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT 1"),
    { d: -50, reason: 'progress reset' });
  const back = player({ token: g.token });   // they come back as a fresh player with the same name
  const w = await back.welcome;
  assert.equal(w.you?.squares ?? 0, 0);
  const viewer = player();
  await viewer.welcome;
  assert.ok(!viewer.events.some(e => e[0] === 'claim' && e[1]?.y === g.y), 'their block is empty for others');
});

test('after a reset, a player earns squares again, also on a map where they had lost all their blocks', async () => {
  const g = await guestWith(0);
  const thief = player();   // takes their only block, so they have none on this map when they reset
  await thief.welcome;
  thief.take(1, g.y);   // next to theirs first: blocks can only be taken from next door
  await thief.next('claim', at(1, g.y));
  thief.take(0, g.y);
  await g.s.next('claim', d => d.x === 0 && d.y === g.y && String(d.pid) !== String(g.pid));
  assert.deepEqual(await g.s.ask('resetProgress'), { ok: true });
  const back = player({ token: g.token });
  await back.welcome;
  const y = row++;
  back.take(0, y);
  await back.next('claim', at(0, y));
  assert.equal(await back.next('squares'), 1, 'the first block after a reset earns a square');
  assert.ok((await pool.query("SELECT 1 FROM player_map_settings WHERE player_id = $1 AND wipe_floor = 0", [g.pid])).rowCount);
});
