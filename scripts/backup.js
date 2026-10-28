// Saves every table to backups/<branch>-<time>.json, read in one consistent snapshot.
//   npm run backup                          the branch in .env.local (dev, when working locally)
//   npm run backup -- --branch production   any Neon branch, using the signed-in Neon CLI
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createPool, dumpTables } = require('../db');

const root = path.join(__dirname, '..');
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(path.join(root, f)); } catch {}
}

async function main() {
  const i = process.argv.indexOf('--branch');
  const branch = i >= 0 ? process.argv[i + 1] : process.env.NEON_BRANCH || 'local';
  if (!/^[\w.-]+$/.test(branch || '')) throw new Error(`"${branch}" is not a branch name`);
  const url = i >= 0
    ? execFileSync('neon', ['connection-string', branch], { encoding: 'utf8', shell: process.platform === 'win32' }).trim()
    : process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('no database to back up: DATABASE_URL is not set and no --branch was given');

  const pool = createPool(url, { max: 1 });
  try {
    const tables = await dumpTables(pool);
    const dir = path.join(root, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${branch}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ branch, takenAt: new Date().toISOString(), tables }));
    const summary = Object.entries(tables).map(([t, rows]) => `${t} ${rows.length}`).join(', ');
    console.log(`Backed up ${branch} to ${file}\n  ${summary}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
});
