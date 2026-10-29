// Achievements in play (the dev database, a throwaway schema): they fire once and pay once, secrets stay
// hidden until earned, and progress from before is caught up on connecting.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../app');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('achlive');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000 });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  await game.totals.stop();
  game.io.close();
  await db.drop();
});
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
const at = (x, y) => d => d.x === x && d.y === y;
const ledger = async (pid, reason) => (await pool.query('SELECT count(*)::int AS n FROM square_ledger WHERE player_id = $1 AND reason = $2', [pid, reason])).rows[0].n;
let row = 2;

test('an achievement fires once and pays its reward once, even after reconnecting', async () => {
  const s = player();
  await s.welcome;
  const y = row++;
  s.take(0, y);
  const { pid, token } = await s.next('you');
  const a = await s.next('achievement', d => d.id === 'first-block');
  assert.deepEqual([a.name, a.reward, a.category], ['First Block', 1, 'Claiming']);
  await s.next('squares', n => n >= 2);   // 1 for the block, 1 for the achievement
  assert.equal(await ledger(pid, 'achievement:first-block'), 1);

  const again = player({ token });   // connecting checks everything again
  await again.welcome;
  again.take(1, y);
  await again.next('claim', at(1, y));
  await new Promise(r => setTimeout(r, 800));
  assert.equal(await ledger(pid, 'achievement:first-block'), 1, 'paid once');
  assert.equal(again.events.filter(([n, d]) => n === 'achievement' && d.id === 'first-block').length, 0, 'not announced again');
});

test('secret achievements show as ??? until earned; then their name and reward show', async () => {
  const s = player();
  await s.welcome;
  s.take(0, row++);
  const { pid } = await s.next('you');
  const hidden = (await s.ask('achievements')).list.find(d => d.id === 'secret-helloworld');
  assert.deepEqual([hidden.name, hidden.stat, hidden.reward, hidden.secret], ['???', null, null, true]);
  assert.ok(!JSON.stringify(await s.ask('achievements')).includes('hello world'), 'the secret condition is not sent');
  await new Promise(r => setTimeout(r, 2100));   // the chat limit
  assert.deepEqual(await s.ask('chat', 'Hello, World!'), {});
  const a = await s.next('achievement', d => d.id === 'secret-helloworld');
  assert.equal(a.secret, true);
  await s.next('achievement', d => d.id === 'secrets-1');   // finding a secret counts for Snoop
  const shown = (await s.ask('achievements')).list.find(d => d.id === 'secret-helloworld');
  assert.equal(shown.name, 'Hello World');
  assert.equal(await ledger(pid, 'achievement:secret-helloworld'), 1);
});

test('progress from before (lifetime totals) is caught up on connecting, with its rewards', async () => {
  const s = player();
  await s.welcome;
  s.take(0, row++);
  const { pid, token } = await s.next('you');
  await s.next('achievement', d => d.id === 'first-block');
  await pool.query("INSERT INTO player_totals (player_id, stat, value) VALUES ($1, 'claims', 1000) ON CONFLICT (player_id, stat) DO UPDATE SET value = 1000", [pid]);
  game.totals.forget(pid);   // as after a restart: the server reads the totals again
  const back = player({ token });
  await back.welcome;
  await back.next('achievement', d => d.id === 'claims-500');   // now the 1,000-block tier
  for (const id of ['claims-5', 'claims-100', 'claims-500']) assert.equal(await ledger(pid, 'achievement:' + id), 1, id);
  const v = (await back.ask('achievements')).values;
  assert.ok(v.claims >= 1000 && v.achievements >= 9, JSON.stringify(v).slice(0, 200));
});

test('taps and squares earned are counted and saved', async () => {
  const s = player();
  await s.welcome;
  const y = row++;
  s.take(0, y);
  const { pid } = await s.next('you');
  await s.next('claim', at(0, y));
  await new Promise(r => setTimeout(r, 300));
  await game.totals.save(pid);
  const t = Object.fromEntries((await pool.query('SELECT stat, value FROM player_totals WHERE player_id = $1', [pid])).rows.map(r => [r.stat, r.value]));
  assert.equal(t.taps, 10);
  assert.equal(t.claims, 1);
  assert.equal(t.squaresEarned, 1, 'the claim, not the achievement reward');
  assert.equal(t.daysPlayed, 1);
  assert.ok(t.hoursPlayed > 0);
});
