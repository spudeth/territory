// Buying upgrades with squares, guest-to-account carry-over and the tap-rate limit (the dev database, a
// throwaway schema).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('shop');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000 });   // these tests tap like bots, except the limit test
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

// Upgrade tables for a test: the costs (rules.UPGRADES) and the effects (the *_MULTIPLIER tables) together,
// as one sync would set them. Restored afterwards.
const lv = (values, costs) => [{ level: 0, value: 1, cost: 0 }, ...values.map((value, i) => ({ level: i + 1, value, cost: costs[i] }))];
const EFFECT = { clickPower: 'CLICK_POWER_MULTIPLIER', defense: 'DEFENSE_MULTIPLIER', earnings: 'EARNINGS_MULTIPLIER', growth: 'GROWTH_BLOCKS' };
function useTable(t, upgrade, levels) {
  const saved = [rules.UPGRADES, rules[EFFECT[upgrade]]];
  t.after(() => { [rules.UPGRADES, rules[EFFECT[upgrade]]] = saved; });
  rules.UPGRADES = { ...rules.UPGRADES, [upgrade]: levels };
  rules[EFFECT[upgrade]] = levels.map(l => l.value);
}

// A guest with a block, holding `balance` squares exactly. Resolves with { s, pid, token }.
let row = 0;
async function guestWith(balance) {
  const s = player(), y = row++;
  await s.welcome;
  s.take(0, y);
  const { pid, token } = await s.next('you');
  await s.next('claim', at(0, y));
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, balance]);
  const fresh = player({ token });   // a new connection sees the new balance
  await fresh.welcome;
  return { s: fresh, pid, token, y };
}
const levelOf = async (pid, column = 'click_power') => (await pool.query(`SELECT ${column} AS l FROM players WHERE id = $1`, [pid])).rows[0].l;
const balanceOf = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares);
const ledgerOf = async pid => (await pool.query(
  "SELECT delta, balance_after, reason FROM square_ledger WHERE player_id = $1 AND reason LIKE 'upgrade:%' ORDER BY id", [pid]))
  .rows.map(r => [Number(r.delta), Number(r.balance_after), r.reason]);

test('buying at exactly the cost works; one square short is refused; fractions count exactly', async t => {
  useTable(t, 'clickPower', lv([1.5, 2], [22, 40]));
  const exact = await guestWith(22);
  assert.deepEqual(await exact.s.ask('buyUpgrade', { upgrade: 'clickPower', level: 0 }),
    { levels: { ...rules.NO_UPGRADES, clickPower: 1 }, squares: 0, balance: 0 });
  assert.equal(await levelOf(exact.pid), 1);
  assert.deepEqual(await ledgerOf(exact.pid), [[-22, 0, 'upgrade:clickPower:1']]);

  const short = await guestWith(21);
  assert.deepEqual(await short.s.ask('buyUpgrade', { upgrade: 'clickPower', level: 0 }), { error: 'Not enough squares', need: 1 });
  assert.equal(await levelOf(short.pid), 0);
  assert.equal(await balanceOf(short.pid), 21, 'nothing taken');

  const half = await guestWith(21.5);
  assert.deepEqual(await half.s.ask('buyUpgrade', { upgrade: 'clickPower', level: 0 }), { error: 'Not enough squares', need: 0.5 });
  const over = await guestWith(22.25);
  const r = await over.s.ask('buyUpgrade', { upgrade: 'clickPower', level: 0 });
  assert.deepEqual([r.squares, r.balance], [0, 0.25], 'shows 0, keeps the quarter');
  assert.equal(await balanceOf(over.pid), 0.25);
  assert.deepEqual(await over.s.ask('upgrades').then(u => u.balance), 0.25, 'the Upgrades screen gets the exact balance');
});

test('two purchases at the same moment: only one is paid for, from two devices or a double tap', async t => {
  useTable(t, 'defense', lv([1.5, 2], [30, 30]));
  const g = await guestWith(45);   // enough for one level, not two
  const other = player({ token: g.token });
  await other.welcome;
  const both = await Promise.all([
    g.s.ask('buyUpgrade', { upgrade: 'defense', level: 0 }),
    other.ask('buyUpgrade', { upgrade: 'defense', level: 0 }),
    g.s.ask('buyUpgrade', { upgrade: 'defense', level: 0 }),   // a double tap on the first device
  ]);
  assert.equal(both.filter(r => !r.error).length, 1, JSON.stringify(both));
  assert.equal(await levelOf(g.pid, 'defense'), 1);
  assert.equal(await balanceOf(g.pid), 15);
  assert.equal((await ledgerOf(g.pid)).length, 1);
  // Asking for the level already bought (a tap on a screen that hadn't refreshed) never buys the next one.
  const later = await guestWith(100);
  await later.s.ask('buyUpgrade', { upgrade: 'defense', level: 0 });
  assert.equal((await later.s.ask('buyUpgrade', { upgrade: 'defense', level: 0 })).error, 'Already bought');
  assert.equal(await levelOf(later.pid, 'defense'), 1);
});

test('every level can be bought up to the top, then MAX', async t => {
  const costs = [1, 2, 3, 4, 5];
  useTable(t, 'growth', lv([2, 3, 4, 5, 6], costs));
  const g = await guestWith(15);
  for (let level = 0; level < 5; level++) {
    const r = await g.s.ask('buyUpgrade', { upgrade: 'growth', level });
    assert.equal(r.levels.growth, level + 1, JSON.stringify(r));
  }
  assert.deepEqual(await g.s.ask('buyUpgrade', { upgrade: 'growth', level: 5 }), { error: 'This upgrade is at its maximum' });
  assert.equal(await levelOf(g.pid, 'growth'), 5);
  assert.equal(await balanceOf(g.pid), 0);
  assert.deepEqual((await ledgerOf(g.pid)).map(l => l[0]), costs.map(c => -c));
});

test('a new level works on the very next tap, on every device of the player', async t => {
  useTable(t, 'clickPower', lv([10], [5]));
  const g = await guestWith(5);
  const second = player({ token: g.token });
  await second.welcome;
  const squares = second.next('squares');
  await g.s.ask('buyUpgrade', { upgrade: 'clickPower', level: 0 });
  assert.equal(await squares, 0, 'every device hears the new balance');
  second.emit('hit', { x: 1, y: g.y });   // one click of 10 hits takes a block, from the other device
  await second.next('claim', d => d.x === 1 && d.y === g.y && d.pid === g.pid);
});

test("a guest's upgrades come with them when they make an account from their guest profile", async t => {
  useTable(t, 'earnings', lv([1.5], [3]));
  const g = await guestWith(3);
  await g.s.ask('buyUpgrade', { upgrade: 'earnings', level: 0 });
  const { player: account, upgraded } = await store.accountPlayer(pool, 'test-' + crypto.randomUUID(), g.pid);
  assert.equal(upgraded, true);
  assert.equal(account.id, g.pid, 'the guest row becomes the account');
  assert.equal(account.earnings, 1);
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
  await pool.query('UPDATE players SET click_power = 2, defense = 1 WHERE id = $1', [g.pid]);
  const other = player({ token: g.token });   // a second device
  await other.welcome;
  const reloaded = other.next('notice', n => n.kind === 'reset');
  assert.deepEqual(await g.s.ask('resetProgress'), { ok: true });
  await reloaded;
  const q = async sql => (await pool.query(sql, [g.pid])).rows[0];
  assert.deepEqual(await q('SELECT squares::float AS s, click_power AS c, defense AS d, name IS NOT NULL AS named FROM players WHERE id = $1'),
    { s: 0, c: 0, d: 0, named: true });
  assert.equal((await q('SELECT count(*)::int AS n FROM map_cells WHERE owner_id = $1')).n, 0);
  for (const t of ['player_map_settings', 'player_map_stats', 'player_achievements']) {
    assert.equal((await q(`SELECT count(*)::int AS n FROM ${t} WHERE player_id = $1`)).n, 0, t);
  }
  assert.deepEqual(await q("SELECT delta::float AS d, reason FROM square_ledger WHERE player_id = $1 ORDER BY id DESC LIMIT 1"),
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
