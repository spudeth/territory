// Test helpers. Each test file gets its own throwaway schema on the dev branch, so tests never touch real data.
const crypto = require('crypto');
const path = require('path');
const { createPool, migrate } = require('../db');
const store = require('../store');
const { guestName, guestNames } = require('../names');

for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(path.join(__dirname, '..', f)); } catch {}
}

async function testDb() {
  if (process.env.NEON_BRANCH === 'production') throw new Error('refusing to run tests against the production branch');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; run `neon checkout dev` first');
  const schema = 'test_' + crypto.randomBytes(6).toString('hex');
  const admin = createPool(url, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(url, { max: 8, options: `-c search_path=${schema}` });
  await migrate(pool);
  const mapId = await store.defaultMapId(pool);
  return {
    pool, mapId,
    count: async (sql, params) => Number((await pool.query(sql, params)).rows[0].count),
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

// Creates a guest by having them first-claim the empty block (x, y). Returns the claim result plus the token.
async function newGuest(pool, mapId, x, y, name = guestName()) {
  const token = crypto.randomUUID();
  const r = await store.claimBlock(pool, { mapId, x, y, from: null, playerId: null,
    newGuest: { names: guestNames(name), tokenHash: store.hashToken(token) }, color: 'hsl(200, 75%, 55%)' });
  return { ...r, token };
}

const claim = (pool, mapId, playerId, x, y, from = null) =>
  store.claimBlock(pool, { mapId, x, y, from, playerId, newGuest: null, color: null });

module.exports = { testDb, newGuest, claim };
