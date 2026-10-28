// Makes a new official map of empty blocks. Players can switch to it straight away.
//   npm run create-map -- --name "Snowfield" --style white --width 32 --height 32
// Uses the database in .env.local (or DATABASE_URL). On the production branch it also needs --production.
const rules = require('../rules');
const path = require('path');
const { createPool } = require('../db');
const store = require('../store');

for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(path.join(__dirname, '..', f)); } catch {}
}

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  if (process.env.NEON_BRANCH === 'production' && !process.argv.includes('--production')) {
    throw new Error('this is the production branch: add --production if you really mean it');
  }
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = createPool(url, { max: 1 });
  try {
    const id = await store.createMap(pool, {
      name: arg('name'), style: arg('style'), width: Number(arg('width') ?? rules.NEW_MAP_WIDTH), height: Number(arg('height') ?? rules.NEW_MAP_HEIGHT),
    });
    console.log(`Created map ${id}. Players can switch to it now; no restart needed.`);
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
