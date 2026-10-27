const os = require('os');
const { createPool, waitForDb, migrate } = require('./db');
const { createGame } = require('./app');

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

  const { server } = createGame(pool);
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
})().catch(err => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
