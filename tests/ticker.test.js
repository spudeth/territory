// Loop 19 Phase 8: the tick spares the database (in memory, a fake pool that counts queries).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTicker } = require('../server/ticker');

function fakePool() {
  let last = 0;
  const pool = { queries: 0, async query(sql, [, now]) { pool.queries++; if (/^INSERT/.test(sql.trim())) return { rows: [{ last: last || now }] }; last = now; return { rows: [] }; } };
  return pool;
}

test('no queries while nobody is connected or every handler is idle; wake() catches up at once, covering the skipped time', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pool = fakePool();
  let connected = 0, work = true;
  const spans = [];
  const ticker = createTicker(pool, { seconds: 60, skip: () => connected === 0 });
  ticker.on((from, to) => { spans.push(to - from); return work ? null : 'idle'; });
  connected = 1;
  ticker.start();
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 2, 'the first tick at start: 2 queries');
  connected = 0;
  t.mock.timers.tick(60000 * 5);
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 2, 'nobody connected: five ticks skipped, no queries');
  connected = 1;
  ticker.wake();
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 4, 'someone connects: one catch-up tick');
  work = false;
  t.mock.timers.tick(60000);
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 6, 'a tick that finds nothing to do');
  t.mock.timers.tick(60000 * 3);
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 6, 'idle: no more queries');
  work = true;
  ticker.wake();
  await new Promise(r => setImmediate(r));
  assert.equal(pool.queries, 8, 'work again (a factory built or woken): it ticks at once');
  ticker.stop();
});
