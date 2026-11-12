// Measuring (loop 19): runs the game on a throwaway schema of the dev database (never production), with every
// database round trip, every Socket.IO packet, and the process's memory and CPU counted. Started by
// scripts/perf/measure.js and scripts/perf/shots.js, which talk to it over IPC. No game code is changed to measure.
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { testDb, newGuest, claim } = require(ROOT + '/test/helpers');
const store = require(ROOT + '/store');
const rules = require(ROOT + '/rules');
const terrain = require(ROOT + '/public/terrain');
const { createGame } = require(ROOT + '/app');

const PORT = Number(process.env.PERF_PORT || 3099);
const counts = { queries: 0, tx: 0, pin: 0, pout: 0, bin: 0, bout: 0 };
const size = d => (typeof d === 'string' ? Buffer.byteLength(d) : d?.byteLength ?? d?.length ?? 0);

// Counts every round trip, whether it comes through pool.query or a transaction's client.
function countQueries(pool) {
  const wrap = c => {
    if (c.__counted) return c;
    const q = c.query.bind(c);
    c.query = (...a) => { counts.queries++; if (/^\s*BEGIN/i.test(typeof a[0] === 'string' ? a[0] : a[0]?.text ?? '')) counts.tx++; return q(...a); };
    c.__counted = true;
    return c;
  };
  const connect = pool.connect.bind(pool);
  pool.connect = cb => (cb ? connect((err, c, done) => cb(err, c && wrap(c), done)) : connect().then(wrap));
}

(async () => {
  const db = await testDb();
  const pool = db.pool;
  // The measured map is the one a new visitor lands on: the migrations' "Grass" map steps aside.
  await pool.query("UPDATE maps SET type = 'vip' WHERE name = 'Grass'");
  const perf = await store.createMap(pool, { name: 'Perf', seed: 'perf baseline', blocks: 10000 });
  // The welcome-size maps are only for measure.js (PERF_SHOTS skips them: screenshots don't need them).
  const small = process.env.PERF_SHOTS ? null : await store.createMap(pool, { name: 'Perf small', seed: 'perf small', blocks: 400 });
  const big = process.env.PERF_SHOTS ? null : await store.createMap(pool, { name: 'Perf big', seed: 'perf big', blocks: 50000 });

  // "Baseline": 30 grass blocks near the middle, plenty of squares, Factory Speed tier 1 done, one awake factory.
  const { rows: cells } = await pool.query('SELECT x, y, terrain FROM map_cells WHERE map_id = $1', [perf]);
  const world = terrain.makeWorld('perf baseline', rules.TERRAIN);
  const at = new Map(cells.map(c => [c.x + ',' + c.y, c.terrain ?? world.at(c.x, c.y)]));
  const cx = Math.round(cells.reduce((s, c) => s + c.x, 0) / cells.length), cy = Math.round(cells.reduce((s, c) => s + c.y, 0) / cells.length);
  const grass = cells.filter(c => at.get(c.x + ',' + c.y) === 'grass').sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || a.x - b.x || a.y - b.y);
  // Connected: grow from the first block, always to a grass neighbour of land already owned.
  const land = [grass[0]], owned = new Set([grass[0].x + ',' + grass[0].y]), isGrass = new Set(grass.map(c => c.x + ',' + c.y));
  while (land.length < 30) {
    const next = grass.find(c => !owned.has(c.x + ',' + c.y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => owned.has((c.x + dx) + ',' + (c.y + dy))));
    land.push(next);
    owned.add(next.x + ',' + next.y);
  }
  const g = await newGuest(pool, perf, land[0].x, land[0].y, 'Baseline');
  for (const c of land.slice(1)) await claim(pool, perf, g.playerId, c.x, c.y);
  await pool.query(`UPDATE players SET squares = 50000000, upgrade_steps = '{"factorySpeed": 90}', tutorial = '{"step":null,"done":true,"tips":["square"]}' WHERE id = $1`, [g.playerId]);
  const edge = land.filter(c => !owned.has(c.x + ',' + (c.y - 1)) && isGrass.has(c.x + ',' + (c.y - 1)));
  const fb = land.find(c => !owned.has(c.x + ',' + (c.y + 1)) && isGrass.has(c.x + ',' + (c.y + 1)));
  const now = Math.floor(Date.now() / 1000) * 1000;
  const { rows: [f] } = await pool.query(`INSERT INTO factories (map_id, owner_id, x, y, built_at, awake_until, processed_at)
    VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), to_timestamp($5 / 1000.0)) RETURNING id`, [perf, g.playerId, fb.x, fb.y, now, now + 8 * 3600000]);
  await pool.query('UPDATE map_cells SET factory_id = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [perf, fb.x, fb.y, f.id]);

  countQueries(pool);
  const game = createGame(pool, { startTicker: true, guestsPerIp: 100000 });
  game.io.engine.on('connection', sock => {
    sock.on('packet', p => { counts.pin++; counts.bin += size(p.data); });
    sock.on('packetCreate', p => { counts.pout++; counts.bout += size(p.data); });
  });
  await new Promise(r => game.server.listen(PORT, r));
  const sample = () => {
    const m = process.memoryUsage(), c = process.cpuUsage();
    return { t: Date.now(), ...counts, rss: m.rss, heap: m.heapUsed, cpu: c.user + c.system };
  };
  process.send({ ready: true, url: `http://localhost:${PORT}`, maps: { perf, small, big }, token: g.token, land, edge, factory: fb, sample: sample() });
  process.on('message', async m => {
    if (m === 'sample') return process.send({ sample: sample() });
    if (m === 'stop') {
      game.ticker.stop();
      game.io.close();
      await new Promise(r => setTimeout(r, 500));
      await db.drop().catch(() => {});
      process.exit(0);
    }
  });
})().catch(err => { console.error(err); process.exit(1); });
