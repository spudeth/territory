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

// Every table in the current schema, read in one consistent snapshot: { table: [rows] }. Used by npm run backup
// and the admin backup taken before every destructive admin command.
function dumpTables(pool) {
  return tx(pool, async c => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const { rows } = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name");
    const out = {};
    for (const { table_name: t } of rows) out[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
    return out;
  });
}

// Puts every table back exactly as in `tables` (from dumpTables), in one transaction: all rows are replaced,
// ids included, and id counters continue after the restored rows. Refuses a backup taken with a different set
// of migrations, since its tables wouldn't fit. Returns { table: rows restored }.
function restoreTables(pool, tables) {
  return tx(pool, async c => {
    const have = (await c.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    const had = (tables.schema_migrations ?? []).map(r => r.name).sort();
    if (have.join() !== had.join()) throw new Error(`the backup is from a different version of the game (its last database change: ${had.at(-1) ?? 'none'}; now: ${have.at(-1)})`);
    const { rows: names } = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'");
    const all = names.map(r => r.table_name).filter(t => t !== 'schema_migrations');
    // Parents before children, from the foreign keys.
    const { rows: fks } = await c.query(`SELECT cl.relname AS child, pa.relname AS parent FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_class pa ON pa.oid = k.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE k.contype = 'f' AND n.nspname = current_schema()`);
    const order = [], seen = new Set();
    const visit = t => {
      if (seen.has(t)) return;
      seen.add(t);
      for (const f of fks) if (f.child === t && f.parent !== t) visit(f.parent);
      order.push(t);
    };
    all.forEach(visit);
    await c.query(`TRUNCATE ${all.map(t => `"${t}"`).join(', ')} RESTART IDENTITY`);
    const counts = {};
    for (const t of order) {
      // Binary columns (token hashes) come back from JSON as { type: 'Buffer', data }; Postgres reads '\x…'.
      const rows = (tables[t] ?? []).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) =>
        [k, v && v.type === 'Buffer' && Array.isArray(v.data) ? '\\x' + Buffer.from(v.data).toString('hex') : v])));
      if (rows.length) {
        await c.query(`INSERT INTO "${t}" OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::"${t}", $1::jsonb)`,
          [JSON.stringify(rows)]);
      }
      counts[t] = rows.length;
    }
    // Identity columns carry on after the highest restored id.
    const { rows: ids } = await c.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND is_identity = 'YES'`);
    for (const { table_name: t, column_name: col } of ids) {
      await c.query(`SELECT setval(pg_get_serial_sequence('"${t}"', '${col}'), GREATEST(1, (SELECT COALESCE(max("${col}"), 0) FROM "${t}")),
        (SELECT count(*) > 0 FROM "${t}"))`);
    }
    return counts;
  });
}

module.exports = { createPool, waitForDb, tx, migrate, dumpTables, restoreTables };
