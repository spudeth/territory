// Buying upgrade steps with squares, guest-to-account carry-over and the tap-rate limit (the dev database, a
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
const stepsOf = async pid => (await pool.query('SELECT upgrade_steps FROM players WHERE id = $1', [pid])).rows[0].upgrade_steps;
const balanceOf = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares) / 10;   // tenths -> squares
const ledgerOf = async pid => (await pool.query(
  "SELECT delta, balance_after, reason FROM square_ledger WHERE player_id = $1 AND reason LIKE 'upgrade:%' ORDER BY id", [pid]))
  .rows.map(r => [Number(r.delta) / 10, Number(r.balance_after) / 10, r.reason]);
const S = catalog.STEPS('clickPower');
const STEP1 = catalog.stepCostTenths('clickPower', 1) / 10;   // the first step's price, squares
const sumSteps = (key, from, to) => { let t = 0; for (let s = from; s <= to; s++) t += catalog.stepCostTenths(key, s); return t / 10; };

test('steps: tier 1 is open from the start; exactly a step\'s price buys it; a tenth short is refused; the screen shows tier and step', async () => {
  const short = await guestWith(STEP1 - 0.1);
  assert.deepEqual(await short.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 }), { error: 'Not enough squares', need: 0.1 });
  assert.equal(await balanceOf(short.pid), STEP1 - 0.1, 'nothing taken');
  const g = await guestWith(STEP1 + 0.5);
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 }), { steps: { clickPower: 1 }, bought: 1, squares: 0.5, balance: 0.5 });
  assert.deepEqual(await stepsOf(g.pid), { clickPower: 1 });
  assert.deepEqual(await ledgerOf(g.pid), [[-STEP1, 0.5, 'upgrade:clickPower:1-1']]);
  const screen = await g.s.ask('upgrades');
  assert.deepEqual([screen.steps, screen.highest, screen.mapLevel], [{ clickPower: 1 }, 1, 1]);
  const cp = screen.list.find(u => u.key === 'clickPower');
  assert.deepEqual([cp.start, cp.max1, cp.mult, cp.gain, cp.steps, cp.tiers.length], [1, 10, 2, 9, 90, 10], 'what the screen needs for any step\'s value');
  assert.deepEqual(cp.tiers[1], { tier: 2, from: 10, to: 20, cost: 28800 });
  assert.deepEqual(screen.prices.clickPower, { value: catalog.stepValue('clickPower', 2), price: catalog.stepCostTenths('clickPower', 2) / 10, tier: 1 });
  assert.equal(screen.list.length, 7, 'all seven upgrades from the Upgrades tab');
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 }), { error: 'Already bought' }, 'a repeated tap is refused');
});

test('Buy max: as many steps as you can afford, in one purchase, never past what is unlocked', async () => {
  const want = sumSteps('earnings', 1, 10);
  const g = await guestWith(want + 1);   // ten steps and a bit
  const r = await g.s.ask('buyUpgrade', { upgrade: 'earnings', from: 0, count: 'max' });
  assert.deepEqual([r.bought, r.steps.earnings], [10, 10]);
  assert.equal(await balanceOf(g.pid), 1, 'the rest stays');
  assert.equal((await ledgerOf(g.pid)).length, 1, 'one purchase');
  // With plenty of squares but only level-1 blocks mined, it stops at the end of tier 1.
  const rich = await guestWith(sumSteps('growth', 1, 2 * S) + 100);
  const m = await rich.s.ask('buyUpgrade', { upgrade: 'growth', from: 0, count: 'max' });
  assert.equal(m.steps.growth, S, 'the end of tier 1');
  assert.deepEqual(await rich.s.ask('buyUpgrade', { upgrade: 'growth', from: S, count: 1 }), { error: 'Mine a level-2 block to unlock' });
  await pool.query('UPDATE players SET highest_level = 2 WHERE id = $1', [rich.pid]);
  assert.equal((await rich.s.ask('buyUpgrade', { upgrade: 'growth', from: S, count: 1 })).steps.growth, S + 1, 'tier 2 opens with a level-2 block');
});

test('two purchases at the same moment: only one is paid for, from two devices or a double tap', async () => {
  const g = await guestWith(STEP1 * 3);
  const other = player({ token: g.token });
  await other.welcome;
  const answers = await Promise.all([g.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 }), other.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 }),
    g.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 'max' })]);
  assert.equal(answers.filter(a => a.steps).length, 1, 'one bought');
  assert.equal((await ledgerOf(g.pid)).length, 1);
});

test('an upgrade works by the block (loop 18): on a level-2 block up to the end of tier 2, on a level-1 block only tier 1, same map', async () => {
  const id = await store.createMap(pool, { name: 'Level Two', width: 6, height: 6 });   // E = 36
  await pool.query('UPDATE maps SET mined = 36 WHERE id = $1', [id]);   // level 2 before anyone loads it
  const y = row;   // the row guestWith uses next
  // Before the map loads: (1, y) a level-2 grass block (20 hits); (2, y) a level-1 stone block.
  await pool.query('UPDATE map_cells SET birth_level = 2 WHERE map_id = $1 AND x = 1 AND y = $2', [id, y]);
  await pool.query("UPDATE map_cells SET terrain = 'stone' WHERE map_id = $1 AND x = 2 AND y = $2", [id, y]);
  const g = await guestWith(0, { highest: 2, mapId: id });
  assert.equal(g.y, y);
  await pool.query(`UPDATE players SET upgrade_steps = '{"clickPower": ${2 * S}}' WHERE id = $1`, [g.pid]);   // the end of tier 2: x20
  const fresh = player({ token: g.token });
  const w = await fresh.welcome;
  assert.equal(w.map.id, id);
  // The level-2 block: Click Power works at hi_2 = 20, so 1 tap takes its 20 hits.
  fresh.emit('hit', { x: 1, y });
  await fresh.next('claim', d => d.x === 1 && d.y === y && d.pid === g.pid);
  // The level-1 stone block, same map: it works at hi_1 = 10 there, so 1 tap is 10 of its hits.
  const need = rules.hardness('stone', 1);
  fresh.emit('hit', { x: 2, y });
  const crack = await fresh.next('hit', d => d.x === 2 && d.y === y);
  assert.ok(Math.abs(crack.p - 10 / need) < 0.02, `capped at hi_1 = 10 a tap on a level-1 block: ${crack.p} vs ${10 / need}`);
});

test("a guest's steps come with them when they make an account from their guest profile", async () => {
  const g = await guestWith(STEP1);
  await g.s.ask('buyUpgrade', { upgrade: 'clickPower', from: 0, count: 1 });
  const { player: account, upgraded } = await store.accountPlayer(pool, 'test-' + crypto.randomUUID(), g.pid);
  assert.equal(upgraded, true);
  assert.equal(account.id, g.pid, 'the guest row becomes the account');
  assert.deepEqual(account.upgrade_steps, { clickPower: 1 });
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
  await pool.query("UPDATE players SET upgrade_steps = '{\"clickPower\": 120, \"defense\": 200}', highest_level = 3 WHERE id = $1", [g.pid]);
  const other = player({ token: g.token });   // a second device
  await other.welcome;
  const reloaded = other.next('notice', n => n.kind === 'reset');
  assert.deepEqual(await g.s.ask('resetProgress'), { ok: true });
  await reloaded;
  const q = async sql => (await pool.query(sql, [g.pid])).rows[0];
  assert.deepEqual(await q('SELECT squares::float AS s, upgrade_steps AS t, highest_level AS h, name IS NOT NULL AS named FROM players WHERE id = $1'),
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
