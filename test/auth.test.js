// Accounts, end to end: our server in front of the dev branch's real Neon Auth. Test users use @example.com
// addresses (which can't receive mail) and are deleted afterwards. There is no inbox to read, so where a
// player would type the emailed code, the test stores a code of its own in Neon's verification table first.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createGame } = require('../app');
const { createAuth } = require('../auth');
const { createPool } = require('../db');
const { testDb, connectPlayer, browser } = require('./helpers');

let db, pool, game, url, authDb;
const sockets = [];
const run = crypto.randomBytes(4).toString('hex');
let n = 0;
const newEmail = () => `test-${run}-${n++}@example.com`;
const PASSWORD = 'correct-horse-9';

before(async () => {
  ({ pool } = db = await testDb());
  if (!process.env.NEON_AUTH_BASE_URL) throw new Error('NEON_AUTH_BASE_URL is not set; run `neon deploy` on the dev branch');
  const auth = createAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL, cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET });
  game = createGame(pool, { auth });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
  authDb = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, { max: 1 });   // reaches neon_auth
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game?.io.close();
  if (authDb) {
    await authDb.query(`DELETE FROM neon_auth.verification WHERE identifier LIKE $1`, [`%test-${run}-%`]);
    await authDb.query(`DELETE FROM neon_auth."user" WHERE email LIKE $1`, [`test-${run}-%`]);
    await authDb.end();
  }
  await db?.drop();
});

function player(opts) {
  const s = connectPlayer(url, opts);
  sockets.push(s);
  return s;
}

// Stores `code` as the email-verification code Neon sent to `email` (every copy, if it was resent), in the same
// hashed form Neon uses.
async function setCode(email, code) {
  const hash = crypto.createHash('sha256').update(code).digest('base64url');
  const { rowCount } = await authDb.query(
    `UPDATE neon_auth.verification SET value = $2 || ':0' WHERE identifier = $1`, ['email-verification-otp-' + email, hash]);
  assert.ok(rowCount >= 1, 'Neon created a verification code');
}

// Signs up and verifies a new email account in browser b, like a player in the menu. Returns the email.
async function signUp(b) {
  const email = newEmail();
  const r = await b.post('sign-up/email', { email, password: PASSWORD, name: 'Player' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.user.emailVerified, false);
  await setCode(email, '424242');
  const v = await b.post('email-otp/verify-email', { email, otp: '424242' });
  assert.equal(v.status, 200, v.text);
  return email;
}

const ownerOf = async (x, y) => (await pool.query('SELECT owner_id FROM map_cells WHERE x = $1 AND y = $2', [x, y])).rows[0].owner_id;

test('sign up, verify the emailed code, play as a NewUser account, log out, log back in', async () => {
  const b = browser(url);
  const email = newEmail();
  const r = await b.post('sign-up/email', { email, password: PASSWORD, name: 'Player' });
  assert.equal(r.status, 200, r.text);

  // Not verified yet: logging in is refused (and Neon sends the code again).
  const early = await b.post('sign-in/email', { email, password: PASSWORD });
  assert.equal(early.status, 403);
  assert.equal(early.data.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(await b.jwt(), null);

  await setCode(email, '135790');
  assert.equal((await b.post('email-otp/verify-email', { email, otp: '000000' })).status, 400, 'a wrong code is refused');
  assert.equal((await b.post('email-otp/verify-email', { email, otp: '135790' })).status, 200);
  assert.ok([...b.jar.keys()].some(k => k.startsWith('__Secure-neon-auth.session_token')), 'logged in, with the cookie on our site');

  const jwt = await b.jwt();
  assert.ok(jwt);
  const w = await player({ jwt }).welcome;
  assert.equal(w.accounts, true);
  assert.equal(w.me.account, true);
  assert.match(w.me.name, /^NewUser\d+$/);
  assert.ok(w.me.pid);
  assert.equal(w.upgraded, false);

  // The same account always gets the same player.
  assert.equal((await player({ jwt: await b.jwt() }).welcome).me.pid, w.me.pid);

  assert.equal((await b.post('sign-out')).status, 200);
  assert.equal(await b.jwt(), null, 'logged out');
  assert.equal((await player({}).welcome).me.pid, null, 'without a login the browser is a visitor again');

  assert.equal((await b.post('sign-in/email', { email, password: 'wrong-password' })).status, 401);
  assert.equal((await b.post('sign-in/email', { email, password: PASSWORD })).status, 200);
  assert.equal((await player({ jwt: await b.jwt() }).welcome).me.pid, w.me.pid);
});

test('reset a forgotten password with the emailed link', async () => {
  const b = browser(url);
  const email = await signUp(b);
  await b.post('sign-out');

  const r = await b.post('request-password-reset', { email, redirectTo: url + '/?reset=1' });
  assert.equal(r.status, 200, r.text);
  const { rows: [v] } = await authDb.query(
    `SELECT identifier FROM neon_auth.verification WHERE identifier LIKE 'reset-password:%'
       AND value = (SELECT id::text FROM neon_auth."user" WHERE email = $1)`, [email]);
  const token = v.identifier.split(':')[1];

  // The link in the email goes to Neon, which sends the player back to the game with the token.
  const link = `${process.env.NEON_AUTH_BASE_URL}/reset-password/${token}?callbackURL=${encodeURIComponent(url + '/?reset=1')}`;
  const back = await fetch(link, { redirect: 'manual' });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), `${url}/?reset=1&token=${token}`);

  assert.equal((await b.post('reset-password', { newPassword: 'new-horse-77', token })).status, 200);
  assert.equal((await b.post('sign-in/email', { email, password: PASSWORD })).status, 401, 'the old password no longer works');
  assert.equal((await b.post('sign-in/email', { email, password: 'new-horse-77' })).status, 200);
  assert.equal((await b.post('reset-password', { newPassword: 'another-1234', token })).status, 400, 'a reset link works once');
});

test('a guest who signs up from their own profile keeps their blocks, squares and settings, and becomes a NewUser', async () => {
  const guest = player();
  await guest.welcome;
  assert.deepEqual(await guest.ask('coverage', 'stretch'), { coverage: 'stretch' });
  guest.hit3(0, 1);
  const you = await guest.next('you');
  guest.hit3(1, 1);
  await guest.next('claim', d => d.x === 1 && d.y === 1);
  const before = (await pool.query('SELECT squares FROM players WHERE id = $1', [you.pid])).rows[0];
  const settings = 'SELECT color, skin_id, coverage, wipe_floor FROM player_map_settings WHERE player_id = $1';
  const settingsBefore = (await pool.query(settings, [you.pid])).rows;
  guest.disconnect();

  const b = browser(url);
  await signUp(b);
  const watcher = player();
  await watcher.welcome;
  const a = player({ token: you.token, jwt: await b.jwt(), upgrade: true });
  const w = await a.welcome;
  assert.equal(w.upgraded, true);
  assert.equal(w.me.pid, you.pid, 'same player');
  assert.match(w.me.name, /^NewUser\d+$/, 'the guest name is replaced');
  assert.notEqual(w.me.name, you.name);
  assert.equal(w.me.renameAt, null, 'may rename straight away');
  assert.equal(w.me.account, true);
  assert.deepEqual(await watcher.next('rename'), { pid: you.pid, name: w.me.name }, 'everyone sees the new name');
  assert.equal(await ownerOf(0, 1), you.pid);
  assert.equal(await ownerOf(1, 1), you.pid);
  const after = (await pool.query('SELECT name, squares, auth_user_id, name_changed_at FROM players WHERE id = $1', [you.pid])).rows[0];
  assert.equal(after.name, w.me.name);
  assert.equal(after.squares, before.squares);
  assert.ok(after.auth_user_id);
  assert.equal(after.name_changed_at, null);
  assert.deepEqual((await pool.query(settings, [you.pid])).rows, settingsBefore, 'color, skin and coverage unchanged');
  assert.equal(settingsBefore[0].coverage, 'stretch');

  // The first rename is allowed at once; the 10-minute wait starts after it.
  const name = 'Up ' + run.slice(0, 6);
  assert.equal((await a.ask('rename', name)).name, name);
  assert.match((await a.ask('rename', 'Up Again')).error, /^You can change your name again in/);

  // The guest token is gone, so after logging out this browser starts afresh instead of reopening the account.
  assert.equal((await player({ token: you.token }).welcome).me.pid, null);
});

test('logging into an existing account never merges the guest into it', async () => {
  const b = browser(url);
  const email = await signUp(b);
  const account = (await player({ jwt: await b.jwt() }).welcome).me;   // the account has played before
  await b.post('sign-out');

  const guest = player();
  await guest.welcome;
  guest.hit3(0, 3);
  const you = await guest.next('you');
  guest.disconnect();

  // Even if the browser asks to upgrade, an account that already has a player takes nothing over.
  assert.equal((await b.post('sign-in/email', { email, password: PASSWORD })).status, 200);
  const w = await player({ token: you.token, jwt: await b.jwt(), upgrade: true }).welcome;
  assert.equal(w.upgraded, false);
  assert.equal(w.me.pid, account.pid);
  assert.equal(await ownerOf(0, 3), you.pid, "the guest's block stays with the guest");
  assert.equal((await pool.query('SELECT auth_user_id FROM players WHERE id = $1', [you.pid])).rows[0].auth_user_id, null);

  // After logging out, the browser is that guest again.
  await b.post('sign-out');
  assert.equal((await player({ token: you.token, jwt: await b.jwt() }).welcome).me.pid, you.pid);
});

test('a brand-new account without the upgrade request does not take over a guest', async () => {
  const guest = player();
  await guest.welcome;
  guest.hit3(0, 5);
  const you = await guest.next('you');
  const b = browser(url);
  await signUp(b);
  const w = await player({ token: you.token, jwt: await b.jwt() }).welcome;   // e.g. "Log in" rather than "Sign up"
  assert.notEqual(w.me.pid, you.pid);
  assert.match(w.me.name, /^NewUser\d+$/);
  assert.equal(await ownerOf(0, 5), you.pid);
});

test('renaming: accounts only, unique ignoring case, filtered, every 10 minutes, shown to everyone at once', async () => {
  const guest = player();
  await guest.welcome;
  guest.hit3(0, 7);
  const other = await guest.next('you');

  const b = browser(url);
  await signUp(b);
  const a = player({ jwt: await b.jwt() });
  const me = (await a.welcome).me;
  const watcher = player();
  await watcher.welcome;

  assert.deepEqual(await a.ask('rename', other.name.toUpperCase()), { error: 'That name is taken' });
  assert.deepEqual(await a.ask('rename', 'Sh1tLord'), { error: "That name isn't allowed" });
  assert.deepEqual(await a.ask('rename', 'way too long for a name'), { error: 'Names can be at most 15 characters' });
  assert.deepEqual(await a.ask('rename', me.name), { error: 'That name is reserved' }, 'nobody can pick a NewUser name');

  const name = 'Cody ' + run.slice(0, 4);
  const r = await a.ask('rename', '  ' + name + ' ');
  assert.equal(r.name, name);
  // 10 minutes by the database's clock, which may differ a little from this computer's.
  assert.ok(Math.abs(r.renameAt - (Date.now() + 10 * 60 * 1000)) < 60 * 1000, `renameAt ${new Date(r.renameAt).toISOString()}`);
  assert.deepEqual(await watcher.next('rename'), { pid: me.pid, name }, 'everyone hears about it');
  assert.equal((await pool.query('SELECT name FROM players WHERE id = $1', [me.pid])).rows[0].name, name);

  assert.deepEqual(await a.ask('rename', name), { error: 'That is already your name' });
  const again = await a.ask('rename', 'Cody Again');
  assert.match(again.error, /^You can change your name again in (10|9) minutes$/);

  // The new name sticks on reconnect, and the cooldown comes with it.
  const w = (await player({ jwt: await b.jwt() }).welcome).me;
  assert.equal(w.name, name);
  assert.ok(w.renameAt > Date.now());
});

test('a forged or garbage login token logs nobody in', async () => {
  const b = browser(url);
  await signUp(b);
  const jwt = await b.jwt();
  const [head, body] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  const forged = [head, Buffer.from(JSON.stringify({ ...claims, sub: crypto.randomUUID() })).toString('base64url'), jwt.split('.')[2]].join('.');
  for (const bad of [forged, 'garbage', 'a.b.c', { sub: 'x' }]) {
    const w = await player({ jwt: bad }).welcome;
    assert.equal(w.me.pid, null);
    assert.equal(w.loginFailed, true);
  }
});

test('Google sign-in starts through our site, and a stray return code does not break the page', async () => {
  const b = browser(url);
  const r = await b.post('sign-in/social', { provider: 'google', callbackURL: url + '/' });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.url.startsWith(process.env.NEON_AUTH_BASE_URL + '/sign-in/social/init'), 'sends the player on to Google via Neon');
  assert.ok([...b.jar.keys()].some(k => k.startsWith('__Secure-neon-auth.session_challenge')), 'the sign-in challenge cookie is on our site');

  const page = await b.request('/?neon_auth_session_verifier=made-up');
  assert.equal(page.status, 200);
  assert.match(page.text, /<canvas id="map">/);
});
