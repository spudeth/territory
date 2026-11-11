// The email updates list (loop 15): consent saved properly, the one-click unsubscribe link, the Resend Audience sync,
// and nothing sent without the mailing address. The dev database, a throwaway schema; Resend is faked.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const { createEmail } = require('../email');
const rules = require('../rules');
const store = require('../store');
const { testDb, connectPlayer } = require('./helpers');

let db, pool, game, url;
const calls = [], sockets = [];
const fakeFetch = async (u, o) => { calls.push({ url: u, method: o.method, body: o.body && JSON.parse(o.body) }); return { ok: true, json: async () => ({}) }; };
before(async () => {
  db = await testDb('email');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [], email: createEmail({ key: 'k', audience: 'aud', from: 'T <t@x>', fetchFn: fakeFetch }) });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => { for (const s of sockets) s.disconnect(); game.io.close(); await db.drop(); });
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };

test('email updates: accounts only; joining and leaving are saved with when and where; the unsubscribe link works without logging in', async () => {
  const s = player();
  await s.welcome;
  s.take(0, 0);
  const you = await s.next('you');
  assert.deepEqual(await s.ask('emailUpdates', { on: true, source: 'settings' }), { error: 'Only accounts can get emails' });
  await pool.query('UPDATE players SET auth_user_id = $2 WHERE id = $1', [you.pid, crypto.randomUUID()]);   // now an account
  assert.deepEqual(await s.ask('emailUpdates', { on: true, source: 'settings' }), { on: true });
  const { rows: [p] } = await pool.query('SELECT email_updates, email_updates_at, email_updates_source, unsubscribe_token FROM players WHERE id = $1', [you.pid]);
  assert.equal(p.email_updates, true);
  assert.equal(p.email_updates_source, 'settings');
  assert.ok(p.email_updates_at && p.unsubscribe_token.length >= 32, 'when, and a secure link');
  assert.equal((await store.emailList(pool)).length, 1);
  const page = await fetch(`${url}/unsubscribe?t=${p.unsubscribe_token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /YOU'RE UNSUBSCRIBED/);
  const after = (await pool.query('SELECT email_updates, email_updates_source FROM players WHERE id = $1', [you.pid])).rows[0];
  assert.deepEqual(after, { email_updates: false, email_updates_source: 'unsubscribe-link' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_consent_log WHERE player_id = $1', [you.pid])).rows[0].n, 2, 'both changes logged');
  assert.equal((await fetch(`${url}/unsubscribe?t=nope`)).status, 404);
});

test('sending: never without the mailing address; every email has the address and an unsubscribe link; the Audience follows joins and leaves', async () => {
  const email = createEmail({ key: 'k', audience: 'aud', from: 'T <t@x>', fetchFn: fakeFetch });
  const saved = rules.MAILING_ADDRESS;
  rules.MAILING_ADDRESS = '';
  await assert.rejects(email.send('a@b.c', 'Hi', 'Body', 'tok'), /mailingAddress/);
  rules.MAILING_ADDRESS = saved;
  calls.length = 0;
  await email.send('a@b.c', 'Hi', 'Body', 'tok');
  assert.match(calls[0].body.text, /2212 W 5th Ave, Gary, IN 46404/);
  assert.match(calls[0].body.text, /\/unsubscribe\?t=tok/);
  assert.match(calls[0].body.headers['List-Unsubscribe'], /unsubscribe\?t=tok/);
  calls.length = 0;
  await email.sync('a@b.c', true);
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].body], ['POST', 'https://api.resend.com/audiences/aud/contacts', { email: 'a@b.c', unsubscribed: false }]);
  assert.equal(await createEmail({ key: '', audience: '', fetchFn: fakeFetch }).sync('a@b.c', true), false, 'no keys: nothing synced');
});
