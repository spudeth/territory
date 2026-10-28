const os = require('os');
const { createPool, waitForDb, migrate } = require('./db');
const { createGame } = require('./app');
const { createAuth } = require('./auth');
const store = require('./store');
const rules = require('./rules');

// Locally, Neon writes DATABASE_URL to .env.local (or .env). Real environment variables win.
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(__dirname + '/' + f); } catch {}
}

const PORT = process.env.PORT || 3030;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Locally, run `neon checkout dev` to write it to .env.local. On Render, add it under Environment.');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_URL);

// The game never runs without its database: if it can't be reached at startup, stop.
(async () => {
  await waitForDb(pool);
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema is up to date.');
  // Upgrade tables from a new sync: move stored levels so nobody gets weaker (store.applyEconomy).
  const moves = await store.applyEconomy(pool, rules.UPGRADES);
  for (const m of moves) console.log(`Upgrade levels moved: ${m.upgrade} ${m.from} -> ${m.to} (${m.players} player${m.players === 1 ? '' : 's'})`);

  // Accounts need NEON_AUTH_BASE_URL (written by Neon) and NEON_AUTH_COOKIE_SECRET. Without them, guests only.
  const auth = createAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL, cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET });
  console.log(auth ? 'Accounts are on.' : 'NEON_AUTH_BASE_URL is not set, so accounts are off and everyone plays as a guest.');

  const { server } = createGame(pool, { auth, publicUrl: process.env.PUBLIC_URL || null });
  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`Port ${PORT} is already in use by another program. Try another port, e.g.:  $env:PORT=3031; npm start`);
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`Territory running on http://localhost:${PORT}`);
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const n of nets) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  on your network: http://${n.address}:${PORT}`);
      }
    }
  });
})().catch(async err => {
  console.error(`Startup failed: ${err.message}`);
  // Close the database pool first, then stop: exiting with connection attempts still open can crash Node
  // itself on Windows (seen once in tests as exit code 0xC0000409 instead of 1).
  process.exitCode = 1;
  await pool.end().catch(() => {});
  setTimeout(() => process.exit(1), 2000).unref();   // in case something else keeps it running
});
