// Loop 16 Phase 9: admin economy-reset on a throwaway schema in the dev database (never production).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGame } = require('../app');
const store = require('../store');
const { main } = require('../scripts/admin');
const { testDb, newGuest, claim } = require('./helpers');

const KEY = 'test-admin-key-' + crypto.randomUUID();
let db, pool, game, url, backupsDir;
before(async () => {
  db = await testDb('reset');
  pool = db.pool;
  game = createGame(pool, { adminKey: KEY, achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
  backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-backups-'));
});
after(async () => { game.io.close(); await db.drop(); });
async function admin(line, answers = []) {
  const out = [], argv = line.match(/"[^"]*"|\S+/g).map(w => w.replace(/^"(.*)"$/, '$1'));
  const code = await main(argv, { env: { ADMIN_KEY: KEY, ADMIN_DEV_URL: url }, backupsDir, print: l => out.push(l), ask: async () => answers.shift() ?? '' });
  return { code, out: out.join('\n') };
}

test('economy-reset: clears owners, levels, squares, tiers, items, factories, walls and listings; keeps accounts, names, skins, stars and achievements; remakes maps from seed and E', async () => {
  const id = await store.createMap(pool, { name: 'Resettable', seed: 'reset me', blocks: 60 });
  const { rows: [c0] } = await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 ORDER BY x, y LIMIT 1', [id]);
  const g = await newGuest(pool, id, c0.x, c0.y);
  const { rows: more } = await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1 AND owner_id IS NULL ORDER BY x, y LIMIT 5', [id]);
  for (const c of more) await claim(pool, id, g.playerId, c.x, c.y);
  const auth = crypto.randomUUID();
  await pool.query(`UPDATE players SET auth_user_id = $2, squares = 12345, tiers = '{"clickPower": 3}', highest_level = 3, star_pattern = 'checker' WHERE id = $1`, [g.playerId, auth]);
  await pool.query("INSERT INTO skins (id, name, image, is_free, price_squares) VALUES ('checker', 'Checker', 'checker.png', false, 100) ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO player_skins (player_id, skin_id, source) VALUES ($1, 'checker', 'squares')", [g.playerId]);
  await pool.query("INSERT INTO player_achievements (player_id, achievement_id) VALUES ($1, 'first-block')", [g.playerId]);
  await pool.query("INSERT INTO player_items (player_id, item_id) VALUES ($1, 'superClick')", [g.playerId]);
  await pool.query("INSERT INTO player_inventory (player_id, item_id, count) VALUES ($1, 'demolition', 2)", [g.playerId]);
  await pool.query(`UPDATE map_cells SET walls = '[{"side":"n","hits":20}]' WHERE map_id = $1 AND x = $2 AND y = $3`, [id, c0.x, c0.y]);
  const { rows: [f] } = await pool.query('INSERT INTO factories (map_id, owner_id, x, y, awake_until, processed_at) VALUES ($1, $2, $3, $4, now(), now()) RETURNING id', [id, g.playerId, c0.x, c0.y]);
  await pool.query('UPDATE map_cells SET factory_id = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [id, c0.x, c0.y, f.id]);
  const l = await store.createListing(pool, { mapId: id, sellerId: g.playerId, blocks: [[more[0].x, more[0].y]], price: 50, minDays: 0 });
  assert.ok(l.id);
  await pool.query('UPDATE maps SET mined = 500 WHERE id = $1', [id]);   // a high level
  const before = (await pool.query('SELECT x, y FROM map_cells WHERE map_id = $1', [id])).rows.length;
  assert.ok(before > 60, 'the map has grown');

  const refused = await admin('economy-reset', ['nope']);
  assert.match(refused.out, /Stopped\. Nothing was changed\./);
  const r = await admin('economy-reset', ['CONFIRM']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Resettable: made again from seed "reset me", E = 60 blocks/);
  assert.match(r.out, /Backup saved/);

  const q = async (sql, p = [g.playerId]) => (await pool.query(sql, p)).rows;
  assert.deepEqual((await q('SELECT name, auth_user_id, squares::int AS s, tiers, highest_level AS h, star_pattern FROM players WHERE id = $1'))[0],
    { name: g.name, auth_user_id: auth, s: 0, tiers: {}, h: 1, star_pattern: 'checker' }, 'account and name kept; squares and tiers gone; stars kept');
  assert.equal((await q('SELECT count(*)::int AS n FROM player_skins WHERE player_id = $1'))[0].n, 1, 'owned skins kept');
  assert.equal((await q('SELECT count(*)::int AS n FROM player_achievements WHERE player_id = $1'))[0].n, 1, 'achievements kept');
  for (const t of ['player_items', 'player_inventory', 'factories', 'listings']) assert.equal(await db.count(`SELECT count(*) FROM ${t}`), 0, t);
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE owner_id IS NOT NULL OR walls <> \'[]\' OR factory_id IS NOT NULL OR listing_id IS NOT NULL'), 0);
  const { rows: [m] } = await pool.query('SELECT mined::int, base_blocks::int AS base, grown FROM maps WHERE id = $1', [id]);
  assert.deepEqual(m, { mined: 0, base: 60, grown: 0 }, 'level 1 again, E kept');
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [id]), 60, 'made again: exactly E blocks');
  assert.equal(await db.count("SELECT count(*) FROM square_ledger WHERE player_id = $1 AND reason = 'economy reset'", [g.playerId]), 1);
});
