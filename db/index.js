const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS = path.join(__dirname, 'migrations');
const MIGRATION_LOCK = 727274;   // any fixed number; makes two servers starting at once take turns migrating

// Neon's URLs say sslmode=require, which pg already treats as verify-full. Saying so explicitly silences its warning.
function connectionString(url) {
  const u = new URL(url);
  if (['prefer', 'require', 'verify-ca'].includes(u.searchParams.get('sslmode'))) u.searchParams.set('sslmode', 'verify-full');
  return u.toString();
}

function createPool(url, options = {}) {
  const pool = new Pool({ connectionString: connectionString(url), max: 4, connectionTimeoutMillis: 10000, ...options });
  // Neon closes idle connections when its compute sleeps. Without this listener that would crash the server.
  pool.on('error', err => console.error(`Database connection dropped (the pool reconnects on next use): ${err.message}`));
  return pool;
}

// Neon's compute may be waking up, so try a few times before giving up.
async function waitForDb(pool, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw new Error(`database unreachable after ${attempts} attempts: ${err.message}`);
      console.warn(`Database not reachable yet (${err.message}); retrying…`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// Runs a function inside a transaction on one connection. Any error rolls everything back.
async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Applies every .sql file in db/migrations that hasn't run yet, in name order, all in one transaction.
// Returns the names of the files it applied.
function migrate(pool) {
  return tx(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const applied = [];
    for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }
    return applied;
  });
}

module.exports = { createPool, waitForDb, tx, migrate };
