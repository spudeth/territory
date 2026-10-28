const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { migrate, tx } = require('../db');
const store = require('../store');
const { testDb, newGuest, claim } = require('./helpers');

let db, pool, mapId;
before(async () => ({ pool, mapId } = db = await testDb()));
after(() => db?.drop());

const cellCount = () => db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [mapId]);
const squaresOf = async id => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [id])).rows[0].squares);
const touchesMap = async (x, y) => db.count(
  'SELECT count(*) FROM map_cells WHERE map_id = $1 AND ((x = $2 + 1 OR x = $2 - 1) AND y = $3 OR x = $2 AND (y = $3 + 1 OR y = $3 - 1))',
  [mapId, x, y]);

// Each test uses its own row of blocks far from the others, so the order of tests doesn't matter.
let nextRow = 0;
const row = () => nextRow++;

test('migrations create one 32x32 grass map, and running them again changes nothing', async () => {
  assert.deepEqual(await migrate(pool), []);
  const { rows } = await pool.query('SELECT name, style, type FROM maps');
  assert.deepEqual(rows, [{ name: 'Grass', style: 'grass', type: 'official' }]);
  const { rows: [b] } = await pool.query('SELECT count(*)::int AS n, min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM map_cells');
  assert.deepEqual(b, { n: 1024, x0: 0, x1: 31, y0: 0, y1: 31 });
  assert.equal(await db.count("SELECT count(*) FROM skins WHERE id = 'default' AND is_free"), 1);
});

test('a first claim adds one block on the perimeter and earns one square', async () => {
  const y = row();
  const before = await cellCount();
  const r = await newGuest(pool, mapId, 0, y);
  assert.equal(r.conflict, undefined);
  assert.ok(r.grown, 'the map grew');
  assert.equal(await cellCount(), before + 1);
  assert.ok(await touchesMap(r.grown.x, r.grown.y) >= 1, 'the new block touches the map');
  assert.equal(r.squares, 1);
  assert.equal(await squaresOf(r.playerId), 1);
  const { rows: ledger } = await pool.query('SELECT delta, balance_after, reason, x, y FROM square_ledger WHERE player_id = $1', [r.playerId]);
  assert.deepEqual(ledger.map(l => ({ ...l, delta: Number(l.delta), balance_after: Number(l.balance_after) })),
    [{ delta: 1, balance_after: 1, reason: 'first_claim', x: 0, y }]);
});

test('a retake adds no block and earns no square', async () => {
  const y = row();
  const a = await newGuest(pool, mapId, 0, y);
  const b = await newGuest(pool, mapId, 1, y);
  const before = await cellCount();
  const r = await claim(pool, mapId, b.playerId, 0, y, a.playerId);
  assert.equal(r.grown, null);
  assert.equal(r.squares, null);
  assert.equal(await cellCount(), before);
  assert.equal(await squaresOf(b.playerId), 1);
  assert.equal(await store.cellOwner(pool, mapId, 0, y), b.playerId);
});

test('a claim based on a stale owner is refused and changes nothing, not even a new guest row', async () => {
  const y = row();
  const a = await newGuest(pool, mapId, 0, y);
  const players = await db.count('SELECT count(*) FROM players');
  const cells = await cellCount();
  const r = await newGuest(pool, mapId, 0, y);   // thinks the block is still empty
  assert.deepEqual({ conflict: r.conflict }, { conflict: true });
  assert.equal(await db.count('SELECT count(*) FROM players'), players);
  assert.equal(await cellCount(), cells);
  assert.equal(await store.cellOwner(pool, mapId, 0, y), a.playerId);
});

test('growth picks any empty spot touching the map on one of four sides, holes included, each equally likely', async () => {
  // A ring of 8 blocks around an empty centre. Its candidates are the hole plus the 12 spots outside it.
  const { rows: [m] } = await pool.query("INSERT INTO maps (name, style, type) VALUES ('ring', 'white', 'official') RETURNING id");
  await pool.query(`INSERT INTO map_cells (map_id, x, y) SELECT $1, x, y FROM generate_series(0, 2) x, generate_series(0, 2) y
                    WHERE NOT (x = 1 AND y = 1)`, [m.id]);
  await store.rebuildEdges(pool, m.id);
  const expected = new Set(['1,1', '-1,0', '-1,1', '-1,2', '3,0', '3,1', '3,2', '0,-1', '1,-1', '2,-1', '0,3', '1,3', '2,3']);
  // Each draw grows the ring in a transaction that is then rolled back, so every draw starts from the same shape.
  const draw = () => tx(pool, async c => {
    const g = await store.growMap(c, m.id);
    throw Object.assign(new Error('roll back'), { g });
  }).catch(e => e.g);
  const seen = new Map();
  for (let i = 0; i < 260; i += 8) {
    for (const g of await Promise.all(Array.from({ length: 8 }, draw))) {
      const k = g.x + ',' + g.y;
      assert.ok(expected.has(k), `${k} is a valid spot`);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  assert.equal(seen.size, 13, 'every spot came up, including the hole');
  // 260 draws over 13 spots is 20 each on average; a spot weighted by its neighbour count would skew this.
  for (const [k, n] of seen) assert.ok(n >= 5 && n <= 45, `${k} came up ${n} times`);
  await pool.query('DELETE FROM map_cells WHERE map_id = $1', [m.id]);
  await pool.query('DELETE FROM map_edges WHERE map_id = $1', [m.id]);
  await pool.query('DELETE FROM maps WHERE id = $1', [m.id]);
});

test('edge spots stay exactly the empty spots touching the map as it grows', async () => {
  const id = await store.createMap(pool, { name: 'Edges', style: 'grass', width: 3, height: 2 });
  for (let i = 0; i < 25; i++) await tx(pool, c => store.growMap(c, id));
  const kept = await pool.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [id]);
  await store.rebuildEdges(pool, id);
  const fresh = await pool.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [id]);
  assert.deepEqual(kept.rows, fresh.rows);
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE map_id = $1', [id]), 31);
});

test('wipe rule: squares only for blocks beyond the most owned at any wipe; growth still happens', async () => {
  const y = row();
  const p = await newGuest(pool, mapId, 0, y);
  const id = p.playerId;
  await claim(pool, mapId, id, 1, y);
  await claim(pool, mapId, id, 2, y);
  assert.equal(await squaresOf(id), 3);

  // Wipe with 3 blocks: N = 3.
  const w1 = await store.wipeTerritory(pool, mapId, id);
  assert.equal(w1.cells.length, 3);
  assert.equal(w1.floor, 3);
  assert.equal(await db.count('SELECT count(*) FROM map_cells WHERE owner_id = $1', [id]), 0);
  assert.equal(await db.count('SELECT count(*) FROM map_wipes WHERE player_id = $1 AND blocks_owned = 3', [id]), 1);

  // Freed land is empty again, so retaking it is a first claim: the map grows every time,
  // but squares only come once the player owns more than 3.
  let cells = await cellCount();
  const earned = [];
  for (let x = 0; x < 5; x++) {
    const r = await claim(pool, mapId, id, x, y);
    assert.ok(r.grown, `claim ${x + 1} grew the map`);
    earned.push(r.squares);
  }
  assert.equal(await cellCount(), cells + 5);
  assert.deepEqual(earned, [null, null, null, 4, 5]);

  // Wiping again with 5 raises N to 5. Then wiping with only 2 must not lower it.
  assert.equal((await store.wipeTerritory(pool, mapId, id)).floor, 5);
  await claim(pool, mapId, id, 0, y);
  await claim(pool, mapId, id, 1, y);
  const w3 = await store.wipeTerritory(pool, mapId, id);
  assert.equal(w3.cells.length, 2);
  assert.equal(w3.floor, 5, 'a smaller wipe keeps the higher N');
  const after = [];
  for (let x = 0; x < 6; x++) after.push((await claim(pool, mapId, id, x, y)).squares);
  assert.deepEqual(after, [null, null, null, null, null, 6]);

  // Ledger and balance agree.
  const { rows: [s] } = await pool.query('SELECT sum(delta)::int AS total, max(balance_after)::int AS last FROM square_ledger WHERE player_id = $1', [id]);
  assert.deepEqual(s, { total: 6, last: 6 });
  assert.equal(await squaresOf(id), 6);
});

test('wiping with no blocks does nothing and records nothing', async () => {
  const y = row();
  const p = await newGuest(pool, mapId, 0, y);
  await store.wipeTerritory(pool, mapId, p.playerId);
  const wipes = await db.count('SELECT count(*) FROM map_wipes WHERE player_id = $1', [p.playerId]);
  assert.equal(await store.wipeTerritory(pool, mapId, p.playerId), null);
  assert.equal(await db.count('SELECT count(*) FROM map_wipes WHERE player_id = $1', [p.playerId]), wipes);
});

test('two players first-claiming the same empty block at the same time: exactly one wins', async () => {
  for (let i = 0; i < 5; i++) {
    const y = row();
    const a = await newGuest(pool, mapId, 0, y);
    const b = await newGuest(pool, mapId, 2, y);
    const cells = await cellCount();
    const ledger = await db.count('SELECT count(*) FROM square_ledger');
    const [ra, rb] = await Promise.all([claim(pool, mapId, a.playerId, 1, y), claim(pool, mapId, b.playerId, 1, y)]);
    const winners = [ra, rb].filter(r => !r.conflict);
    assert.equal(winners.length, 1, 'one claim succeeded');
    assert.equal(await store.cellOwner(pool, mapId, 1, y), winners[0].playerId);
    assert.equal(await cellCount(), cells + 1, 'the map grew once');
    assert.equal(await db.count('SELECT count(*) FROM square_ledger'), ledger + 1, 'one square was earned');
  }
});

test('two players first-claiming different blocks at the same time: both win, with two different growth blocks', async () => {
  for (let i = 0; i < 5; i++) {
    const y = row();
    const a = await newGuest(pool, mapId, 0, y);
    const b = await newGuest(pool, mapId, 3, y);
    const cells = await cellCount();
    const [ra, rb] = await Promise.all([claim(pool, mapId, a.playerId, 1, y), claim(pool, mapId, b.playerId, 2, y)]);
    assert.ok(!ra.conflict && !rb.conflict);
    assert.notDeepEqual(ra.grown, rb.grown);
    assert.equal(await cellCount(), cells + 2);
  }
});

test('ten new guests first-claiming at once all succeed, each growing the map', async () => {
  const y = row();
  const cells = await cellCount();
  const rs = await Promise.all(Array.from({ length: 10 }, (_, x) => newGuest(pool, mapId, x * 2, y, 'Same Name')));
  assert.ok(rs.every(r => !r.conflict));
  assert.equal(new Set(rs.map(r => r.grown.x + ',' + r.grown.y)).size, 10);
  assert.equal(await cellCount(), cells + 10);
  assert.equal(new Set(rs.map(r => r.name.toLowerCase())).size, 10, 'everyone got a different name');
});

test('names are unique regardless of case', async () => {
  const y = row();
  // Not a name the guest name generator can produce, so no earlier test can have taken it.
  const a = await newGuest(pool, mapId, 0, y, 'Unique Test');
  const b = await newGuest(pool, mapId, 2, y, 'unique test');
  assert.equal(a.name, 'Unique Test');
  assert.notEqual(b.name.toLowerCase(), 'unique test');
  assert.ok(b.name.length <= 15);
});

test('tokens are stored only as hashes and only real tokens find a player', async () => {
  const y = row();
  const p = await newGuest(pool, mapId, 0, y);
  const { rows } = await pool.query('SELECT token_hash FROM player_tokens WHERE player_id = $1', [p.playerId]);
  assert.deepEqual(rows[0].token_hash, crypto.createHash('sha256').update(p.token).digest());
  assert.equal(await db.count("SELECT count(*) FROM player_tokens WHERE position(convert_to($1, 'UTF8') in token_hash) > 0", [p.token]), 0);

  assert.equal((await store.findPlayerByToken(pool, p.token)).id, p.playerId);
  for (const bad of ['__proto__', 'constructor', 'hasOwnProperty', {}, [], 42, null, undefined, '', 'x'.repeat(1000), crypto.randomUUID()]) {
    assert.equal(await store.findPlayerByToken(pool, bad), null, `token ${JSON.stringify(bad)}`);
  }
});

test('the database pays squares exactly as rules.earnsSquares says, over random claims and wipes', async () => {
  const rules = require('../rules');
  const id = await store.createMap(pool, { name: 'Wipes', style: 'grass', width: 12, height: 12 });
  const free = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) free.push([x, y]);
  let seed = 11;
  const rand = n => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const take = () => free.splice(rand(free.length), 1)[0];

  const first = take();
  const g = await newGuest(pool, id, ...first);
  let owned = 1, floor = 0, expected = 1, mine = [first];
  for (let step = 0; step < 24; step++) {
    if (rand(5) === 0) {
      await store.wipeTerritory(pool, id, g.playerId);
      floor = rules.wipeFloorAfterWipe(floor, owned);
      free.push(...mine);
      mine = []; owned = 0;
      continue;
    }
    const spot = take();
    const r = await claim(pool, id, g.playerId, ...spot);
    mine.push(spot); owned++;
    if (rules.earnsSquares(owned, floor)) expected += rules.squaresForFirstClaim(rules.NO_UPGRADES);
    assert.equal(r.squares === null, !rules.earnsSquares(owned, floor), `step ${step}`);
  }
  const { rows: [p] } = await pool.query('SELECT squares FROM players WHERE id = $1', [g.playerId]);
  assert.equal(Number(p.squares), expected);
  assert.ok(await db.count('SELECT count(*) FROM map_wipes WHERE map_id = $1', [id]) >= 2, 'the run included wipes');
});
