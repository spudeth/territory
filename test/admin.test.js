// Admin commands (npm run admin) end to end: the command line talks to a real game server on a throwaway
// schema in the dev database. Typing at the confirm prompt is simulated.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGame } = require('../app');
const rules = require('../rules');
const store = require('../store');
const { main } = require('../scripts/admin');
const { testDb, connectPlayer } = require('./helpers');

const KEY = 'test-admin-key-' + crypto.randomUUID();
let db, pool, game, url, backupsDir;
const sockets = [];
before(async () => {
  db = await testDb('admin');
  pool = db.pool;
  // Achievements pay nothing here, so balances stay exact (rewards: achievements-live.test.js).
  game = createGame(pool, { adminKey: KEY, tapsPerSecond: 1000, achievementList: rules.ACHIEVEMENTS.map(d => ({ ...d, reward: 0 })) });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
  backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-backups-'));
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db.drop();
});
const player = (auth, at = url) => { const s = connectPlayer(at, auth); sockets.push(s); return s; };
const at = (x, y) => d => d.x === x && d.y === y;

// Runs a command as Xoren would type it. answers: what he types at each question. Resolves { code, out }.
async function admin(line, { answers = [], key = KEY, env = {} } = {}) {
  const out = [], argv = line.match(/"[^"]*"|\S+/g).map(w => w.replace(/^"(.*)"$/, '$1'));
  const code = await main(argv, { env: { ADMIN_KEY: key, ADMIN_DEV_URL: url, ...env }, backupsDir,
    print: l => out.push(l), ask: async () => answers.shift() ?? '' });
  return { code, out: out.join('\n') };
}
const backupsNow = () => fs.readdirSync(backupsDir).length;
const lastLog = async () => (await pool.query('SELECT command, target, ok, result FROM admin_log ORDER BY id DESC LIMIT 1')).rows[0];

// A guest with blocks on the default map, in row y. Resolves { s, pid, token, name }.
let nextRow = 0;
async function guest(blocks = 1) {
  const s = player(), y = nextRow++;
  await s.welcome;
  s.take(0, y);
  const you = await s.next('you');
  await s.next('claim', at(0, y));
  for (let x = 1; x < blocks; x++) { s.take(x, y); await s.next('claim', at(x, y)); }
  return { s, pid: you.pid, token: you.token, name: you.name, y };
}

test('a wrong or missing key is refused and logged; the right one works', async () => {
  const wrong = await admin('map Grass', { key: 'nope' });
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /Refused: Wrong admin key/);
  assert.deepEqual(await lastLog(), { command: 'map', target: null, ok: false, result: 'refused: wrong or missing key' });
  assert.match((await admin('map Grass', { key: '' })).out, /No ADMIN_KEY/);
  const ok = await admin('map Grass');
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Grass \(#\d+\), grass, official/);
  // A server without ADMIN_KEY refuses everything.
  const off = createGame(pool);
  await new Promise(r => off.server.listen(0, r));
  const r = await admin('map Grass', { env: { ADMIN_DEV_URL: `http://localhost:${off.server.address().port}` } });
  off.io.close();
  assert.match(r.out, /Admin commands are off on this server/);
});

test('commands go to dev unless --prod, and production refuses them without --prod', async () => {
  const prod = createGame(pool, { adminKey: KEY, publicUrl: 'https://territory.sarl' });
  await new Promise(r => prod.server.listen(0, r));
  const prodUrl = `http://localhost:${prod.server.address().port}`;
  try {
    // Pointed at production by mistake, without --prod: refused.
    const r = await admin('map Grass', { env: { ADMIN_DEV_URL: prodUrl } });
    assert.match(r.out, /This is the production server: add --prod/);
    const p = await admin('map Grass --prod', { env: { ADMIN_PROD_URL: prodUrl } });
    assert.equal(p.code, 0, p.out);
    assert.match(p.out, /PRODUCTION: the live game/);
    // --prod at a server that isn't production: refused too.
    assert.match((await admin('map Grass --prod', { env: { ADMIN_PROD_URL: url } })).out, /not the production server/);
  } finally {
    prod.io.close();
  }
});

test('destructive commands need the name typed, take a backup first, and are logged; --yes skips only the typing', async () => {
  const g = await guest(2);
  const before = backupsNow();
  const stopped = await admin(`wipe-player "${g.name}" Grass`, { answers: ['grass'] });
  assert.equal(stopped.code, 1);
  assert.match(stopped.out, /Stopped\. Nothing was changed/);
  assert.equal(backupsNow(), before, 'no backup when stopped');
  assert.equal(await store.cellOwner(pool, 1, 0, g.y), g.pid);

  const watch = g.s.next('wipe');
  const done = await admin(`wipe-player "${g.name}" Grass`, { answers: [g.name] });
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /Clear all 2 blocks/);
  assert.match(done.out, /Backup saved: .*dev-.*-before-wipe-player\.json/);
  assert.equal(backupsNow(), before + 1, 'a backup first');
  assert.equal((await watch).cells.length, 2, 'the player saw it at once');
  assert.equal((await lastLog()).ok, true);
  assert.equal((await lastLog()).target, `player ${g.name} on map Grass`);

  // The server itself refuses a destructive command without a fresh backup.
  const res = await fetch(`${url}/admin/run`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, 'x-admin-target': 'dev' },
    body: JSON.stringify({ command: 'take-squares', args: [g.name, '0.5'] }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /No backup was taken first/);

  // --yes: no typing, still a backup and a log line.
  await pool.query('UPDATE players SET squares = 5 WHERE id = $1', [g.pid]);
  const yes = await admin(`take-squares "${g.name}" 2 --reason oops --yes`);
  assert.equal(yes.code, 0, yes.out);
  assert.equal(backupsNow(), before + 2);
  assert.match((await lastLog()).result, /now has 3 squares/);
});

test('wipe-map empties a map for everyone, resets floors and unlocks looks; --reset-size makes it fresh', async () => {
  const id = await store.createMap(pool, { name: 'Wipe Me', style: 'white', width: 4, height: 4 });
  const a = player();
  await a.welcome;
  await a.ask('switchMap', id);
  await a.next('welcome', d => d.map.id === id);
  a.take(1, 1);
  const you = await a.next('you');
  await a.next('claim', at(1, 1));
  await pool.query('UPDATE player_map_settings SET wipe_floor = 3 WHERE player_id = $1 AND map_id = $2', [you.pid, id]);
  const fresh = a.next('welcome', d => d.map.id === id && d.cells.every(c => c[2] === null));
  const r = await admin('wipe-map "wipe me"', { answers: ['Wipe Me'] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Empty all 1 claimed blocks on Wipe Me/);
  const w = await fresh;
  assert.equal(w.me.locked, false, 'their look is unlocked');
  const { rows: [s] } = await pool.query('SELECT wipe_floor, unlocked FROM player_map_settings WHERE player_id = $1 AND map_id = $2', [you.pid, id]);
  assert.deepEqual(s, { wipe_floor: 0, unlocked: true });
  assert.equal(Number((await pool.query('SELECT squares FROM players WHERE id = $1', [you.pid])).rows[0].squares) >= 1, true, 'squares stay');

  const sized = await admin('wipe-map "Wipe Me" --reset-size --yes');
  assert.match(sized.out, new RegExp(`fresh ${rules.NEW_MAP_WIDTH} x ${rules.NEW_MAP_HEIGHT} map`));
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [id]), rules.NEW_MAP_WIDTH * rules.NEW_MAP_HEIGHT);
  assert.equal(await db.count('SELECT count(*) FROM map_edges WHERE map_id = $1', [id]),
    2 * (rules.NEW_MAP_WIDTH + rules.NEW_MAP_HEIGHT), 'growth spots rebuilt around the new rectangle');

  const all = await admin('wipe-all-maps', { answers: ['ALL MAPS'] });
  assert.equal(all.code, 0, all.out);
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE owner_id IS NOT NULL'), 0);
});

test('ban: the player and their linked guests are disconnected and cannot come back; unban lets them', async () => {
  const account = await guest(), linked = await guest(), other = await guest();
  await store.linkPlayers(pool, account.pid, linked.pid);   // seen on one device
  const notice = account.s.next('notice');
  const r = await admin(`ban "${account.name}" --reason "using a bot" --days 7 --wipe-blocks`, { answers: [account.name] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`Also banned, as linked profiles: ${linked.name}`));
  assert.match((await notice).message, /^You've been banned until .* Reason: using a bot$/);
  assert.equal(await store.cellOwner(pool, 1, 0, account.y), null, '--wipe-blocks cleared them');

  for (const token of [account.token, linked.token]) {
    const again = player({ token });
    again.welcome.catch(() => {});   // a banned connection never gets one
    const n = await again.next('notice');
    assert.equal(n.kind, 'banned');
    assert.ok(!again.events.some(([e]) => e === 'welcome'), 'no game for them');
  }
  assert.equal((await player({ token: other.token }).welcome).me.pid, other.pid, 'everyone else plays on');
  assert.match((await admin(`player "${linked.name}"`)).out, /Ban: BANNED until .*\(using a bot\)/);

  assert.equal((await admin(`unban "${account.name}"`, { answers: ['y'] })).code, 0);
  assert.equal((await player({ token: linked.token }).welcome).me.pid, linked.pid);
});

test('kick disconnects without banning', async () => {
  const g = await guest();
  const notice = g.s.next('notice');
  const r = await admin(`kick "${g.name}" --yes`);
  assert.match(r.out, /1 connection closed/);
  assert.equal((await notice).kind, 'kicked');
  assert.equal((await player({ token: g.token }).welcome).me.pid, g.pid, 'they can come straight back');
});

test('give-squares and take-squares go through the ledger and show at once; never below 0', async () => {
  const g = await guest();
  const shown = g.s.next('squares', n => n === 51);
  assert.equal((await admin(`give-squares "${g.name}" 50 --reason prize --yes`)).code, 0);
  assert.equal(await shown, 51);
  assert.match((await admin(`take-squares "${g.name}" 1000 --yes`)).out, /has only 51 squares/);
  const { rows } = await pool.query("SELECT delta, reason FROM square_ledger WHERE player_id = $1 AND reason LIKE 'admin%'", [g.pid]);
  assert.deepEqual(rows.map(r => [Number(r.delta), r.reason]), [[50, 'admin give: prize']]);
});

test('player and map show the details; unknown names are refused plainly', async () => {
  const g = await guest(3);
  await g.s.next('achievement', d => d.id === 'first-block');
  const p = await admin(`player "${g.name.toUpperCase()}"`);
  assert.match(p.out, /Guest \(no account\)/);
  assert.match(p.out, /Blocks: Grass 3/);
  assert.match(p.out, /Achievements: .*first-block/);
  assert.match(p.out, /Ban: not banned/);
  assert.match((await admin(`player #${g.pid}`)).out, new RegExp(g.name));
  const m = await admin('map grass');
  assert.match(m.out, /Claimed: \d+ blocks by \d+ players/);
  assert.match((await admin('player "Nobody Here"')).out, /No player called "Nobody Here"/);
  assert.match((await admin('map Atlantis')).out, /No map called "Atlantis"/);
});

test('delete-account erases the login, email and personal data, frees the name, and keeps an anonymous ledger', async () => {
  const g = await guest(2);
  await pool.query('UPDATE players SET squares = 7 WHERE id = $1', [g.pid]);
  // A Neon Auth user for this player, in the dev database's real neon_auth tables.
  const authId = crypto.randomUUID(), email = `${crypto.randomUUID()}@example.com`;
  await pool.query(`INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Test', $2, true, now(), now())`, [authId, email]);
  await pool.query(`INSERT INTO neon_auth.session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ($1, now() + interval '1 day', $2, now(), now(), $3)`,
    [crypto.randomUUID(), crypto.randomUUID(), authId]).catch(() => {});   // a session, if the table takes this shape
  await pool.query('UPDATE players SET auth_user_id = $2 WHERE id = $1', [g.pid, authId]);
  assert.match((await admin(`player "${g.name}"`)).out, new RegExp(`Account: ${email}`));

  const notice = g.s.next('notice');
  const r = await admin(`delete-account "${g.name}"`, { answers: [g.name] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /their login was erased from Neon Auth/);
  assert.equal((await notice).kind, 'deleted');

  assert.equal(await db.count('SELECT count(*) FROM neon_auth."user" WHERE id = $1', [authId]), 0);
  assert.equal(await db.count('SELECT count(*) FROM neon_auth.session WHERE "userId" = $1', [authId]), 0);
  const { rows: [p] } = await pool.query('SELECT name, auth_user_id, squares, deleted_at, click_power FROM players WHERE id = $1', [g.pid]);
  assert.equal(p.name, 'deleted' + g.pid);
  assert.equal(p.auth_user_id, null);
  assert.equal(Number(p.squares), 0);
  assert.ok(p.deleted_at);
  for (const t of ['player_tokens', 'player_map_settings', 'player_map_stats', 'player_achievements']) {
    assert.equal(await db.count(`SELECT count(*) FROM ${t} WHERE player_id = $1`, [g.pid]), 0, t);
  }
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE owner_id = $1', [g.pid]), 0, 'blocks empty');
  assert.equal(await db.count("SELECT count(*) FROM square_ledger WHERE player_id = $1 AND reason = 'account deleted'", [g.pid]), 1);
  assert.equal((await player({ token: g.token }).welcome).me.pid, null, 'their old device is just a visitor now');
  assert.equal(await store.findPlayer(pool, g.name), null, 'the name is free');
});

test('create-map makes a map players can switch to; backup and restore put the game back', async () => {
  const c = await admin('create-map --name Snowfield --style white --width 5 --height 4 --yes');
  assert.equal(c.code, 0, c.out);
  assert.equal(await db.count("SELECT count(*) FROM map_cells c JOIN maps m ON m.id = c.map_id WHERE m.name = 'Snowfield'"), 20);
  assert.match((await admin('create-map --name Snowfield --yes')).out, /already a map called "Snowfield"/);

  const g = await guest();
  const b = await admin('backup');
  assert.equal(b.code, 0, b.out);
  const file = path.join(backupsDir, fs.readdirSync(backupsDir).filter(f => !f.includes('before')).sort().at(-1));
  await admin(`give-squares "${g.name}" 1000 --yes`);
  const notice = g.s.next('notice');
  const r = await admin(`restore "${file}"`, { answers: ['RESTORE'] });
  assert.equal(r.code, 0, r.out);
  assert.equal((await notice).kind, 'restored');
  assert.equal(Number((await pool.query('SELECT squares FROM players WHERE id = $1', [g.pid])).rows[0].squares), 1, 'back to before the gift');
  assert.equal((await player({ token: g.token }).welcome).me.pid, g.pid, 'tokens restored too');
  // New rows carry on after the restored ids.
  const again = await guest();
  assert.ok(Number(again.pid) > Number(g.pid));
});

test('bad-names lists names the filter blocks now, and changes nothing', async () => {
  const g = await guest();
  await pool.query("UPDATE players SET name = 'Nibba' WHERE id = $1", [g.pid]);   // a name from before the stricter filter
  const r = await admin('bad-names');
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(`Nibba (#${g.pid}, guest)`), r.out);
  assert.equal((await pool.query('SELECT name FROM players WHERE id = $1', [g.pid])).rows[0].name, 'Nibba', 'not renamed');
});
