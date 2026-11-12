// Every database read and write the game makes. Ids come back from Postgres as strings.
const crypto = require('crypto');
const { tx } = require('./db');
const rules = require('./rules');
const terrain = require('./public/terrain');
const { accountNames } = require('./names');
const catalog = require('./catalog');
const upgrades = require('./upgrades');

// The one purchase step every purchase uses: takes `price` tenths from the player (their row must already be
// locked by the caller's transaction) and writes the ledger. Returns { squares: new balance in tenths } or
// { error, need: tenths short }.
async function spend(c, playerId, price, reason) {
  const { rows: [after] } = await c.query('UPDATE players SET squares = squares - $2 WHERE id = $1 AND squares >= $2 RETURNING squares', [playerId, price]);
  if (!after) {
    const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1', [playerId]);
    return { error: 'Not enough squares', need: price - Number(p?.squares ?? 0) };
  }
  await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)', [playerId, -price, after.squares, reason]);
  return { squares: Number(after.squares) };
}

// A block that loses its owner loses what was built on it too: walls, its factory and its land listing.
const FREED = "owner_id = NULL, claimed_at = NULL, walls = '[]', factory_id = NULL, listing_id = NULL";
const DROP_ORPHAN_FACTORIES = 'DELETE FROM factories f WHERE NOT EXISTS (SELECT 1 FROM map_cells c WHERE c.factory_id = f.id)';
// A listing loses all its blocks when any of them is freed or taken (its other blocks are unlisted too).
const DROP_BROKEN_LISTINGS = `WITH broken AS (SELECT l.id FROM listings l WHERE EXISTS (SELECT 1 FROM map_cells c WHERE c.listing_id = l.id AND c.owner_id IS DISTINCT FROM l.seller_id)
    OR NOT EXISTS (SELECT 1 FROM map_cells c WHERE c.listing_id = l.id)),
  unlisted AS (UPDATE map_cells SET listing_id = NULL WHERE listing_id IN (SELECT id FROM broken))
  DELETE FROM listings WHERE id IN (SELECT id FROM broken)`;

const hashToken = token => crypto.createHash('sha256').update(token).digest();
const PLAYER = 'p.id, p.name, p.last_map_id, p.auth_user_id, p.name_changed_at, p.upgrade_steps, p.highest_level, p.squares, p.tutorial, p.show_tenths';

// Only a real string can be a token, so values like {} or "__proto__" never match a player.
async function findPlayerByToken(pool, token) {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT ${PLAYER} FROM player_tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = $1`,
    [hashToken(token)]);
  return rows[0] ?? null;
}

// The player for a logged-in account, created the first time that account plays. Returns { player, upgraded }.
// Every new account is named "NewUser" and a number, and may rename straight away.
// A brand-new account takes over the guest `guestId` (their own guest profile: the caller checks that) if
// given, keeping its blocks, squares and settings but not its guest name; the guest's token is deleted, so
// after logging out that browser starts afresh. An account that already has a player never takes over
// anything, so logging in never merges.
function accountPlayer(pool, authUserId, guestId = null) {
  return tx(pool, async c => {
    // Two tabs logging in to a new account at once must not create two players.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [authUserId]);
    const find = async () => (await c.query(`SELECT ${PLAYER} FROM players p WHERE p.auth_user_id = $1`, [authUserId])).rows[0];
    const existing = await find();
    if (existing) return { player: existing, upgraded: false };

    for (const name of accountNames()) {
      // A name another player took a moment ago fails the unique index; the savepoint lets us try the next one.
      await c.query('SAVEPOINT pick_name');
      try {
        const upgraded = guestId !== null && (await c.query(
          'UPDATE players SET auth_user_id = $1, name = $3, name_changed_at = NULL WHERE id = $2 AND auth_user_id IS NULL',
          [authUserId, guestId, name])).rowCount === 1;
        if (upgraded) {
          await c.query('DELETE FROM player_tokens WHERE player_id = $1', [guestId]);
        } else {
          guestId = null;   // that guest is already an account: make a fresh player instead
          await c.query('INSERT INTO players (name, auth_user_id) VALUES ($1, $2)', [name, authUserId]);
        }
        await c.query('RELEASE SAVEPOINT pick_name');
        return { player: await find(), upgraded };
      } catch (err) {
        if (err.code !== '23505' || err.constraint !== 'players_name_unique') throw err;
        await c.query('ROLLBACK TO SAVEPOINT pick_name');
      }
    }
    throw new Error('could not find a free NewUser name');
  });
}

// Renames an account's player. Returns { name, changedAt } or { error } to show them.
async function renamePlayer(pool, playerId, name) {
  try {
    const { rows } = await pool.query(
      `UPDATE players SET name = $2, name_changed_at = now()
       WHERE id = $1 AND auth_user_id IS NOT NULL AND name IS DISTINCT FROM $2
         AND (name_changed_at IS NULL OR name_changed_at <= now() - make_interval(mins => $3))
       RETURNING name, name_changed_at`, [playerId, name, rules.RENAME_COOLDOWN_MINUTES]);
    if (rows[0]) return { name: rows[0].name, changedAt: rows[0].name_changed_at };
  } catch (err) {
    if (err.code === '23505') return { error: 'That name is taken' };
    throw err;
  }
  // Nothing changed: work out why.
  const { rows: [p] } = await pool.query(
    `SELECT auth_user_id, name, ceil(extract(epoch FROM name_changed_at + make_interval(mins => $2) - now()) / 60) AS wait
     FROM players WHERE id = $1`, [playerId, rules.RENAME_COOLDOWN_MINUTES]);
  if (!p?.auth_user_id) return { error: 'Create an account to change your name' };
  if (p.name === name) return { error: 'That is already your name' };
  return { error: `You can change your name again in ${p.wait} minute${p.wait == 1 ? '' : 's'}` };
}

async function defaultMapId(pool) {
  const { rows } = await pool.query("SELECT id FROM maps WHERE type = 'official' ORDER BY id LIMIT 1");
  if (!rows[0]) throw new Error('there is no official map; have the migrations run?');
  return rows[0].id;
}

// One map with its blocks and the players who have joined it. Null if there is no such map.
async function loadMap(pool, mapId) {
  const { rows: [map] } = await pool.query('SELECT id, name, style, seed, base_blocks::float AS base, mined::float AS mined FROM maps WHERE id = $1', [mapId]);
  if (!map) return null;
  const [cells, players, stats] = await Promise.all([
    pool.query('SELECT x, y, owner_id, birth_level, terrain, walls, factory_id, listing_id FROM map_cells WHERE map_id = $1', [mapId]),
    pool.query('SELECT s.player_id, p.name, s.color, s.skin_id, s.coverage, s.unlocked, s.wipe_floor, p.upgrade_steps FROM player_map_settings s JOIN players p ON p.id = s.player_id WHERE s.map_id = $1', [mapId]),
    pool.query('SELECT * FROM player_map_stats WHERE map_id = $1', [mapId]),
  ]);
  const overrides = cells.rows.filter(c => c.terrain !== null).map(({ x, y, terrain }) => ({ x, y, terrain }));
  const factories = (await pool.query(`SELECT id, owner_id, x, y, extract(epoch FROM built_at) * 1000 AS built, extract(epoch FROM awake_until) * 1000 AS awake,
    extract(epoch FROM processed_at) * 1000 AS processed, target_x, target_y, progress FROM factories WHERE map_id = $1`, [mapId])).rows;
  const listings = (await pool.query(`SELECT l.id, l.seller_id, l.price, extract(epoch FROM l.created_at) * 1000 AS created,
    array_agg(c.x ORDER BY c.x, c.y) AS xs, array_agg(c.y ORDER BY c.x, c.y) AS ys FROM listings l JOIN map_cells c ON c.listing_id = l.id
    WHERE l.map_id = $1 GROUP BY l.id`, [mapId])).rows;
  return { ...map, cells: cells.rows, players: players.rows, stats: stats.rows, overrides, factories, listings };
}

async function cellOwner(pool, mapId, x, y) {
  const { rows } = await pool.query('SELECT owner_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
  return rows[0]?.owner_id ?? null;
}

const setLastMap = (pool, playerId, mapId) =>
  pool.query('UPDATE players SET last_map_id = $2 WHERE id = $1 AND last_map_id IS DISTINCT FROM $2', [playerId, mapId]);

// Adds one block at a random empty spot touching the map on one of its four sides. Each spot is equally likely.
// Growth: a random spot from map_edges (each equally likely) becomes a block, and its empty neighbours become
// edge spots. growMap holds the map's lock, so two growths never pick the same spot.
const GROW = `
  WITH spot AS (
    DELETE FROM map_edges WHERE (map_id, x, y) =
      (SELECT map_id, x, y FROM map_edges WHERE map_id = $1 ORDER BY random() LIMIT 1)
    RETURNING x, y
  ), cell AS (
    INSERT INTO map_cells (map_id, x, y, birth_level) SELECT $1, x, y, $2 FROM spot RETURNING x, y
  ), edges AS (
    INSERT INTO map_edges (map_id, x, y)
    SELECT $1, n.x, n.y FROM cell
    CROSS JOIN LATERAL (VALUES (cell.x + 1, cell.y), (cell.x - 1, cell.y), (cell.x, cell.y + 1), (cell.x, cell.y - 1)) AS n (x, y)
    WHERE NOT EXISTS (SELECT 1 FROM map_cells e WHERE e.map_id = $1 AND e.x = n.x AND e.y = n.y)
    ON CONFLICT DO NOTHING
  )
  SELECT x, y FROM cell`;
// Recomputes a map's edge spots from its blocks. For new maps, or after changing blocks by hand.
async function rebuildEdges(client, mapId) {
  await client.query('DELETE FROM map_edges WHERE map_id = $1', [mapId]);
  await client.query(`
    INSERT INTO map_edges (map_id, x, y)
    SELECT DISTINCT $1::bigint, n.x, n.y FROM map_cells c
    CROSS JOIN LATERAL (VALUES (c.x + 1, c.y), (c.x - 1, c.y), (c.x, c.y + 1), (c.x, c.y - 1)) AS n (x, y)
    WHERE c.map_id = $1 AND NOT EXISTS (SELECT 1 FROM map_cells e WHERE e.map_id = $1 AND e.x = n.x AND e.y = n.y)`, [mapId]);
}

// A seeded map's n-th growth takes the spot terrain.growthPick chooses from its open spots, sorted, so the
// same seed and the same claims always grow the same map.
const GROW_AT = GROW.replace(
  '(SELECT map_id, x, y FROM map_edges WHERE map_id = $1 ORDER BY random() LIMIT 1)', '($1::bigint, $3::integer, $4::integer)');

// `birth`: the new block's level (the map's level now).
async function growMap(client, mapId, birth = 1) {
  // One growth at a time per map.
  const { rows: [m] } = await client.query('SELECT seed, grown FROM maps WHERE id = $1 FOR UPDATE', [mapId]);
  let grown;
  if (m.seed === null) grown = (await client.query(GROW, [mapId, birth])).rows[0];
  else {
    const { rows: spots } = await client.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [mapId]);
    const spot = spots[terrain.growthPick(m.seed, m.grown, spots.length)];
    grown = spot && (await client.query(GROW_AT, [mapId, birth, spot.x, spot.y])).rows[0];
    await client.query('UPDATE maps SET grown = grown + 1 WHERE id = $1', [mapId]);
  }
  if (!grown) throw new Error('map growth found no free spot');
  return grown;
}

// Gives $5 tenths for a first claim, but only if the player now owns more blocks here than at any wipe (wipe_floor).
// Returns the new balance, or nothing if no square was earned.
const EARN = `
  WITH p AS (
    UPDATE players SET squares = squares + $5
    WHERE id = $2
      AND (SELECT count(*) FROM map_cells WHERE map_id = $1 AND owner_id = $2)
        > (SELECT wipe_floor FROM player_map_settings WHERE map_id = $1 AND player_id = $2)
    RETURNING squares
  )
  INSERT INTO square_ledger (player_id, delta, balance_after, reason, map_id, x, y)
  SELECT $2, $5, squares, 'first_claim', $1, $3, $4 FROM p
  RETURNING balance_after`;

class Conflict extends Error {}

// Claims block (x, y) for a player, if it still has the owner the caller expects (`from`, null for empty).
// A first claim (from = null) also grows the map and may earn a square, all in the same transaction.
//   playerId: an existing player, or null to create a guest from `newGuest` = { names, tokenHash }
//   color:    stored if this is the player's first claim on this map (or since a wipe); null if their choices are locked
//   earn:     tenths for a first claim (whole tenths)
//   coverage, skin: stored with the color; locked with it until the player wipes this map
//   stats:    the claimer's stats after this claim (stats.afterClaim); `from` loses a block
// Returns { conflict: true } if the block changed hands first, otherwise
//   { playerId, name, joinedMap, grown: [{x, y}, …] (empty unless a first claim), squares: new exact balance | null }.
//   grow:     blocks a first claim adds to the map (rules.growthBlocks: 1, or more with the Growth upgrade)
//   birth:    the level those new blocks are born at (the map's level after this claim)
//   level:    the claimed block's own level (a first claim can raise the player's highest level, for tier unlocks)
async function claimBlock(pool, { mapId, x, y, from, playerId, newGuest, color, coverage = 'tile', skin = 'default', grow = 1, birth = 1, level = 1, earn = 10,
  stats = null }) {
  try {
    return await tx(pool, async c => {
      // First claims on a map take turns, so two of them can never pick the same growth spot.
      if (from === null) await c.query('SELECT 1 FROM maps WHERE id = $1 FOR UPDATE', [mapId]);

      let name = null;
      if (!playerId) {
        for (const candidate of newGuest.names) {
          const { rows } = await c.query(
            'INSERT INTO players (name, last_map_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id', [candidate, mapId]);
          if (rows[0]) { playerId = rows[0].id; name = candidate; break; }
        }
        if (!playerId) throw new Error('could not find a free guest name');
        await c.query('INSERT INTO player_tokens (token_hash, player_id) VALUES ($1, $2)', [newGuest.tokenHash, playerId]);
      }

      const taken = from === null
        ? await c.query('UPDATE map_cells SET owner_id = $4, claimed_at = now() WHERE map_id = $1 AND x = $2 AND y = $3 AND owner_id IS NULL', [mapId, x, y, playerId])
        : await c.query(`UPDATE map_cells SET owner_id = $4, claimed_at = now(), walls = '[]', factory_id = NULL, listing_id = NULL
            WHERE map_id = $1 AND x = $2 AND y = $3 AND owner_id = $5`, [mapId, x, y, playerId, from]);
      if (!taken.rowCount) throw new Conflict();
      if (from !== null) {
        await c.query('DELETE FROM factories WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
        await c.query(DROP_BROKEN_LISTINGS);
      }

      // First claim on this map, or the first since a wipe unlocked the choices: store them, locked.
      let joinedMap = false;
      if (color !== null) {
        const r = await c.query(
          `INSERT INTO player_map_settings (player_id, map_id, color, skin_id, coverage) VALUES ($1, $2, $3, $5, $4)
           ON CONFLICT (player_id, map_id) DO UPDATE SET color = EXCLUDED.color, skin_id = EXCLUDED.skin_id,
             coverage = EXCLUDED.coverage, unlocked = false
           WHERE player_map_settings.unlocked`,
          [playerId, mapId, color, coverage, skin]);
        joinedMap = r.rowCount === 1;
      }

      if (stats) await saveStats(c, mapId, playerId, stats);
      if (from !== null) {
        await c.query(`INSERT INTO player_map_stats (map_id, player_id, blocks_lost) VALUES ($1, $2, 1)
          ON CONFLICT (map_id, player_id) DO UPDATE SET blocks_lost = player_map_stats.blocks_lost + 1`, [mapId, from]);
      }

      const grown = [];
      let squares = null;
      if (from === null) {
        await c.query('UPDATE maps SET mined = mined + 1 WHERE id = $1', [mapId]);
        if (level > 1) await c.query('UPDATE players SET highest_level = GREATEST(highest_level, $2) WHERE id = $1', [playerId, level]);
        for (let i = 0; i < grow; i++) { const g = await growMap(c, mapId, birth); if (g) grown.push({ ...g, l: birth }); }
        if (earn > 0) squares = (await c.query(EARN, [mapId, playerId, x, y, earn])).rows[0]?.balance_after ?? null;
      }
      return { playerId, name, joinedMap, grown, squares: squares === null ? null : Number(squares) };
    });
  } catch (err) {
    if (err instanceof Conflict) return { conflict: true };
    throw err;
  }
}

// Stores a player's stats on a map. Records only ever go up, so a stale write can't lower them.
function saveStats(c, mapId, playerId, s) {
  return c.query(
    `INSERT INTO player_map_stats AS t (map_id, player_id, owned_max, first_claims, retakes, best_square, best_line)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (map_id, player_id) DO UPDATE SET
       owned_max = GREATEST(t.owned_max, EXCLUDED.owned_max), first_claims = GREATEST(t.first_claims, EXCLUDED.first_claims),
       retakes = GREATEST(t.retakes, EXCLUDED.retakes), best_square = GREATEST(t.best_square, EXCLUDED.best_square),
       best_line = GREATEST(t.best_line, EXCLUDED.best_line)`,
    [mapId, playerId, s.ownedMax, s.firstClaims, s.retakes, s.bestSquare, s.bestLine]);
}

// Clears all of a player's blocks on one map and records the wipe. Their wipe_floor becomes the higher of
// its old value and the number of blocks just cleared, so wiping again can never lower it. Their color, skin
// and coverage on this map are unlocked until their next claim here.
// Returns { cells: [[x, y], …], floor }, or null if they had no blocks there.
function wipeTerritory(pool, mapId, playerId) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM maps WHERE id = $1 FOR UPDATE', [mapId]);
    const { rows } = await c.query(
      'UPDATE map_cells SET ' + FREED + ' WHERE map_id = $1 AND owner_id = $2 RETURNING x, y', [mapId, playerId]);
    if (!rows.length) return null;
    await c.query(DROP_ORPHAN_FACTORIES);
    await c.query(DROP_BROKEN_LISTINGS);
    await c.query('INSERT INTO map_wipes (map_id, player_id, blocks_owned) VALUES ($1, $2, $3)', [mapId, playerId, rows.length]);
    const { rows: [s] } = await c.query(
      'UPDATE player_map_settings SET wipe_floor = GREATEST(wipe_floor, $3), unlocked = true WHERE map_id = $1 AND player_id = $2 RETURNING wipe_floor',
      [mapId, playerId, rows.length]);
    return { cells: rows.map(r => [r.x, r.y]), floor: s.wipe_floor };
  });
}

module.exports = { hashToken, findPlayerByToken, accountPlayer, renamePlayer, defaultMapId, loadMap, cellOwner, setLastMap,
  growMap, rebuildEdges, claimBlock, wipeTerritory };

// Achievement ids a player has earned.
async function earnedAchievements(pool, playerId) {
  const { rows } = await pool.query('SELECT achievement_id FROM player_achievements WHERE player_id = $1', [playerId]);
  return rows.map(r => r.achievement_id);
}

// Records achievements; returns the ids that were new (not already earned).
// rewards: { id: squares } for the ids given. Each newly earned one pays its reward (ledger 'achievement:<id>').
// Returns { fresh: the ids that were new, squares: the new exact balance, or null if nothing was paid }.
function earnAchievements(pool, playerId, mapId, ids, rewards = {}) {
  return tx(pool, async c => {
    // Locks: only a key-share lock on the player (it waits for an account being deleted, so a deleted account
    // earns nothing more, but never for a claim), and no map: a claim holds its map while it updates the player,
    // so touching the map here could deadlock. mapId is not stored for that reason.
    void mapId;
    const { rows: [who] } = await c.query('SELECT deleted_at FROM players WHERE id = $1 FOR KEY SHARE', [playerId]);
    if (!who || who.deleted_at) return { fresh: [], squares: null };
    const { rows } = await c.query(
      `INSERT INTO player_achievements (player_id, achievement_id) SELECT $1, unnest($2::text[])
       ON CONFLICT DO NOTHING RETURNING achievement_id`, [playerId, ids]);
    const fresh = rows.map(r => r.achievement_id);
    let squares = null;
    for (const id of fresh) {
      const pay = catalog.toTenths(Number(rewards[id]) || 0);
      if (!pay) continue;
      const { rows: [p] } = await c.query('UPDATE players SET squares = squares + $2 WHERE id = $1 AND deleted_at IS NULL RETURNING squares', [playerId, pay]);
      if (!p) continue;
      await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)',
        [playerId, pay, p.squares, 'achievement:' + id]);
      squares = Number(p.squares);
    }
    return { fresh, squares };
  });
}

// A player's lifetime totals (totals.js): { stat: value }.
async function loadTotals(pool, playerId) {
  const { rows } = await pool.query('SELECT stat, value FROM player_totals WHERE player_id = $1', [playerId]);
  return Object.fromEntries(rows.map(r => [r.stat, Number(r.value)]));
}
// Saves totals that changed: { stat: value }.
async function saveTotals(pool, playerId, changes) {
  const stats = Object.keys(changes);
  if (!stats.length) return;
  await pool.query(`INSERT INTO player_totals (player_id, stat, value) SELECT $1, * FROM unnest($2::text[], $3::float8[])
    ON CONFLICT (player_id, stat) DO UPDATE SET value = EXCLUDED.value`, [playerId, stats, stats.map(k => changes[k])]);
}
// How many maps a player has played (has a look on).
async function mapsPlayed(pool, playerId) {
  const { rows: [r] } = await pool.query('SELECT count(*)::int AS n FROM player_map_settings WHERE player_id = $1', [playerId]);
  return r.n;
}

Object.assign(module.exports, { earnedAchievements, earnAchievements, loadTotals, saveTotals, mapsPlayed });

// The maps players can go to (official ones; purchased and VIP maps come later), oldest first.
async function listMaps(pool) {
  const { rows } = await pool.query("SELECT id, name, style FROM maps WHERE type = 'official' ORDER BY id");
  return rows;
}

// Makes a new official map: a width-by-height rectangle of empty blocks. Admin script only (scripts/create-map.js).
const STYLES = ['grass', 'white'];
// A random seed for a map made without one: 8 letters and digits.
const randomSeed = () => Array.from({ length: 8 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[crypto.randomInt(32)]).join('');

// Makes a new official map and returns its id. Its seed decides its terrain and growth (see the migration
// 013_seeds.sql); its starting shape is the seed's island of `blocks` blocks (E; default the Economy tab's
// defaultBaseBlocks), or a
// width-by-height rectangle when those are given. seed '' means a random one. A rectangle without a seed is
// all grass and grows at random, like the maps from before seeds (tests use these).
async function createMap(pool, { name, style = 'grass', seed, blocks = catalog.E.defaultBaseBlocks, width = null, height = null }) {
  if (!name || typeof name !== 'string') throw new Error('a map needs a name');
  if (!STYLES.includes(style)) throw new Error(`style must be one of: ${STYLES.join(', ')}`);
  const rectangle = width !== null || height !== null;
  if (seed === undefined || seed === null) seed = rectangle ? null : '';
  if (style === 'white') seed = null;   // a white plain: no terrain, ever
  if (seed !== null) seed = String(seed).trim() || randomSeed();
  if (seed?.length > 100) throw new Error('the seed must be at most 100 characters');
  if (rectangle) {
    for (const n of [width, height]) if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('width and height must be 1-1000');
  } else if (!Number.isInteger(blocks) || blocks < 1 || blocks > 50000000) throw new Error('blocks must be 1-50,000,000');
  return tx(pool, async c => {
    // E (base blocks) is its starting size, fixed forever; shape is kept so the map can be made again the same.
    const shape = rectangle ? { width, height } : { blocks };
    const { rows: [m] } = await c.query("INSERT INTO maps (name, style, type, seed, base_blocks, shape) VALUES ($1, $2, 'official', $3, $4, $5) RETURNING id",
      [name, style, seed, rectangle ? width * height : blocks, shape]);
    await fillShape(c, m.id, seed, shape);
    return m.id;
  });
}

// Puts a map's starting blocks in place (the map must have none): a width-by-height rectangle, or the seed's
// island of `blocks` blocks. Then its edge spots, for growth.
async function fillShape(c, mapId, seed, { width, height, blocks }) {
  if (width) {
    await c.query(`INSERT INTO map_cells (map_id, x, y)
      SELECT $1, x, y FROM generate_series(0, $2 - 1) AS x, generate_series(0, $3 - 1) AS y`, [mapId, width, height]);
  } else {
    const shape = terrain.startingShape(seed, blocks);
    await c.query('INSERT INTO map_cells (map_id, x, y) SELECT $1, * FROM unnest($2::integer[], $3::integer[])',
      [mapId, shape.map(p => p[0]), shape.map(p => p[1])]);
  }
  await rebuildEdges(c, mapId);
}

// The maps for the welcome screen's picker, with this player's place on each:
// [{ id, name, style, blocks: the map's size, mine: their blocks, rank: 1 = most blocks (null with none), played }].
async function mapsFor(pool, playerId) {
  const { rows } = await pool.query(`
    WITH owned AS (SELECT map_id, owner_id, count(*)::int AS n FROM map_cells WHERE owner_id IS NOT NULL GROUP BY 1, 2)
    SELECT m.id, m.name, m.style,
      (SELECT count(*)::int FROM map_cells c WHERE c.map_id = m.id) AS blocks,
      coalesce(o.n, 0) AS mine,
      CASE WHEN o.n IS NULL THEN NULL ELSE 1 + (SELECT count(*)::int FROM owned b WHERE b.map_id = m.id AND b.n > o.n) END AS rank,
      (o.n IS NOT NULL OR EXISTS (SELECT 1 FROM player_map_settings s WHERE s.map_id = m.id AND s.player_id = $1)) AS played
    FROM maps m LEFT JOIN owned o ON o.map_id = m.id AND o.owner_id = $1
    WHERE m.type = 'official' ORDER BY m.id`, [playerId]);
  return rows;
}

Object.assign(module.exports, { STYLES, listMaps, createMap, mapsFor });

// The skin catalog, with whether this player owns each (free skins count as owned by everyone).
// The skin catalog (rules.SKINS, from the sheet) with what this player owns: [{ id, name, kind, rarity, price,
// collection, owned }], the free plain look first. Skins taken out of the shop still show for their owners.
// Prices are in squares at map level L: the rarity's work-hours x W(L) (flags are Rare).
// Which star slot a skin goes in: a Common pattern, or art that is Rare or better (flags too); null for others.
const starSlot = s => (s.kind === 'pattern' && s.rarity === 'Common' ? 'star_pattern' : s.kind === 'art' && s.rarity !== 'Common' ? 'star_art' : null);
// Stars one owned skin in its slot (replacing the old one), or clears that slot when `on` is false.
async function starSkin(pool, playerId, skin, on) {
  const slot = starSlot(skin);
  if (!slot) return { error: 'Only patterns and Rare or better art skins can be starred' };
  if (on && !(await pool.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [playerId, skin.id])).rowCount) return { error: "You don't own that skin" };
  await pool.query(`UPDATE players SET ${slot} = CASE WHEN $3 THEN $2 END WHERE id = $1 AND ($3 OR ${slot} = $2)`, [playerId, skin.id, on]);
  return { ok: true };
}
async function skinsFor(pool, playerId, L = 1) {
  const stars = playerId ? (await pool.query('SELECT star_pattern, star_art FROM players WHERE id = $1', [playerId])).rows[0] ?? {} : {};
  const owned = new Set(playerId ? (await pool.query('SELECT skin_id FROM player_skins WHERE player_id = $1', [playerId])).rows.map(r => r.skin_id) : []);
  return [{ id: 'default', name: 'Default', kind: 'default', rarity: 'Common', price: 0, collection: 'Basic', owned: true },
    ...rules.SKINS.filter(s => s.enabled || owned.has(s.id)).map(({ enabled, price: sheetPrice, ...s }) => ({ ...s, price: catalog.fromTenths(catalog.skinPriceTenths(s, L)), owned: owned.has(s.id),
      starrable: !!starSlot(s), starred: owned.has(s.id) && (stars.star_pattern === s.id || stars.star_art === s.id) }))
      // Bob (loop 15): flags after every other skin, and within each group by price, then name.
      .sort((a, b) => (a.collection === 'Flags') - (b.collection === 'Flags') || a.price - b.price || a.name.localeCompare(b.name))];
}

// Buys a skin with squares, in one transaction: the player row is locked, so a double tap or two devices can
// never pay twice. skin: a catalog entry { id, name }; price: tenths (catalog.skinPriceTenths at the map's level).
// Returns { squares, price } (tenths), or { error } with `need` (tenths short) when there aren't enough.
function buySkin(pool, playerId, skin, price) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (!p) return { error: 'Claim a block first' };
    if ((await c.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [playerId, skin.id])).rowCount) return { error: 'You already own this skin' };
    await c.query(`INSERT INTO skins (id, name, image, price_squares) VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_squares = EXCLUDED.price_squares`, [skin.id, skin.name, skin.id + '.png', Math.max(1, catalog.wholeSquares(price))]);
    const paid = await spend(c, playerId, price, 'skin:' + skin.id);
    if (paid.error) return paid;
    await c.query("INSERT INTO player_skins (player_id, skin_id, source) VALUES ($1, $2, 'squares')", [playerId, skin.id]);
    return { squares: paid.squares, price };
  });
}

// For the Achievements screen: a player's best value of each stat on any map (the progress shown), and the
// achievements they have earned with the map each was earned on.
async function achievementProgress(pool, playerId) {
  const [best, earned] = await Promise.all([
    pool.query(`SELECT max(owned_max) AS "owned", max(first_claims) AS "firstClaims", max(retakes) AS "retakes",
      max(blocks_lost) AS "blocksLost", max(best_square) AS "bestSquare", max(best_line) AS "bestLine"
      FROM player_map_stats WHERE player_id = $1`, [playerId]),
    pool.query(`SELECT a.achievement_id AS id, m.name AS map FROM player_achievements a LEFT JOIN maps m ON m.id = a.map_id
      WHERE a.player_id = $1`, [playerId]),
  ]);
  return { best: Object.fromEntries(Object.entries(best.rows[0]).map(([k, v]) => [k, v ?? 0])), earned: earned.rows };
}

// Saves a player's tutorial progress ({ step, done, tips }; checked by the caller).
async function saveTutorial(pool, playerId, progress) {
  await pool.query('UPDATE players SET tutorial = $2 WHERE id = $1', [playerId, JSON.stringify(progress)]);
}

// Buys steps of one upgrade, in one transaction with the player row locked, so two taps or two devices never buy
// the same step twice. `from`: the steps the player saw (a repeated tap is refused); `count`: how many to buy, or
// 'max' for as many as they can afford (and have unlocked). Each step's tier must be unlocked (tier N: a level-N
// block first-claimed somewhere). Returns { steps, bought, cost, squares } or { error, need? } (need: tenths short).
async function buySteps(pool, playerId, upgrade, from, count) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT upgrade_steps, highest_level, squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (!p) return { error: 'No such player' };
    const have = p.upgrade_steps[upgrade] ?? 0, top = upgrades.topStep(upgrade), tierOf = s => upgrades.tierOfStep(upgrade, s);
    if (from !== have) return { error: 'Already bought', steps: p.upgrade_steps };
    if (have >= top) return { error: 'This upgrade is at its top' };
    const next = have + 1;
    if (!upgrades.tierUnlocked(tierOf(next), p.highest_level)) return { error: `Mine a level-${tierOf(next)} block to unlock` };
    // How many: up to `count` (or as many as the balance allows), never past what is unlocked or the top.
    const limit = Math.min(top, p.highest_level * upgrades.STEPS(upgrade), count === 'max' ? top : have + count);
    let n = 0, cost = 0;
    const balance = Number(p.squares);
    while (have + n < limit) {
      const c1 = upgrades.stepCostTenths(upgrade, have + n + 1);
      if (count === 'max' && cost + c1 > balance) break;
      cost += c1;
      n++;
    }
    if (!n) return { error: 'Not enough squares', need: upgrades.stepCostTenths(upgrade, next) - balance };
    const paid = await spend(c, playerId, cost, `upgrade:${upgrade}:${have + 1}-${have + n}`);
    if (paid.error) return paid;
    const steps = { ...p.upgrade_steps, [upgrade]: have + n };
    await c.query('UPDATE players SET upgrade_steps = $2 WHERE id = $1', [playerId, steps]);
    return { steps, bought: n, cost, squares: paid.squares };
  });
}

// Records players who went over the tap-rate limit: [[playerId, taps ignored], …].
async function logTapLimits(pool, entries) {
  await pool.query('INSERT INTO tap_limit_log (player_id, ignored) SELECT * FROM unnest($1::bigint[], $2::int[])',
    [entries.map(e => e[0]), entries.map(e => e[1])]);
}

Object.assign(module.exports, { skinsFor, buySkin, starSkin, starSlot, achievementProgress, saveTutorial, buySteps, logTapLimits });

// ---------- Admin (npm run admin; admin.js) ----------

// A player by "#123" (id) or name, ignoring case. Null if none.
async function findPlayer(pool, ref) {
  const id = /^#\d+$/.test(ref) ? ref.slice(1) : null;
  const { rows } = await pool.query(
    `SELECT ${PLAYER}, p.deleted_at, p.created_at FROM players p WHERE ${id ? 'p.id = $1' : 'lower(p.name) = lower($1)'}`, [id ?? ref]);
  return rows[0] ?? null;
}

// A map by "#12" (id) or name, ignoring case. Null if none.
async function findMap(pool, ref) {
  const id = /^#\d+$/.test(ref) ? ref.slice(1) : null;
  const { rows } = await pool.query(
    `SELECT id, name, style, type, seed FROM maps WHERE ${id ? 'id = $1' : 'lower(name) = lower($1)'} ORDER BY id LIMIT 1`, [id ?? ref]);
  return rows[0] ?? null;
}

// Profiles seen together on one device (a logged-in account and the guest token the browser also held).
async function linkPlayers(pool, accountId, guestId) {
  await pool.query('INSERT INTO player_links (account_id, guest_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [accountId, guestId]);
}
async function linkedPlayers(pool, playerId) {
  const { rows } = await pool.query(`SELECT guest_id AS id FROM player_links WHERE account_id = $1
    UNION SELECT account_id FROM player_links WHERE guest_id = $1`, [playerId]);
  return rows.map(r => r.id);
}

// The ban stopping any of these players, if one is in force: { reason, until } or null.
async function activeBan(pool, ids) {
  const { rows } = await pool.query(`SELECT reason, until FROM bans WHERE player_id = ANY($1::bigint[]) AND lifted_at IS NULL
    AND (until IS NULL OR until > now()) ORDER BY until IS NULL DESC, until DESC LIMIT 1`, [ids.filter(Boolean)]);
  return rows[0] ?? null;
}
async function banPlayers(pool, ids, reason, until) {
  await pool.query('INSERT INTO bans (player_id, reason, until) SELECT unnest($1::bigint[]), $2, $3', [ids, reason, until]);
}
// Lifts the bans in force on these players. Returns how many were lifted.
async function unbanPlayers(pool, ids) {
  const r = await pool.query(`UPDATE bans SET lifted_at = now() WHERE player_id = ANY($1::bigint[]) AND lifted_at IS NULL
    AND (until IS NULL OR until > now())`, [ids]);
  return r.rowCount;
}

// Adds (or with a negative amount, takes) squares, written to the ledger. Never below 0.
// Returns { squares: new exact balance } or { error }.
function adjustSquares(pool, playerId, delta, reason) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query(
      'UPDATE players SET squares = squares + $2 WHERE id = $1 AND squares + $2 >= 0 RETURNING squares', [playerId, delta]);
    if (!p) return { error: 'They have fewer squares than that' };
    await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)',
      [playerId, delta, p.squares, reason]);
    return { squares: Number(p.squares) };
  });
}

// Empties every block on a map, resets every player's wipe floor there and unlocks their color, skin and
// coverage. With size { width, height } the map also becomes a fresh rectangle of that size.
// Returns { cleared: blocks that had an owner, players: players who had blocks, blocks: the map's size after }.
function wipeMap(pool, mapId, size = null) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM maps WHERE id = $1 FOR UPDATE', [mapId]);
    const { rows: [n] } = await c.query(
      'SELECT count(owner_id)::int AS cleared, count(DISTINCT owner_id)::int AS players FROM map_cells WHERE map_id = $1', [mapId]);
    if (size) {
      // A fresh start: a seeded map gets its seed's starting island again and grows from its first growth again;
      // one without a seed becomes a width-by-height rectangle.
      const { rows: [m] } = await c.query('SELECT seed, base_blocks::float AS base, shape FROM maps WHERE id = $1', [mapId]);
      await c.query('DELETE FROM factories WHERE map_id = $1', [mapId]);
      await c.query('DELETE FROM map_cells WHERE map_id = $1', [mapId]);
      await c.query('DELETE FROM listings WHERE map_id = $1', [mapId]);
      await c.query('UPDATE maps SET grown = 0 WHERE id = $1', [mapId]);
      // Its own starting shape (E is fixed forever); maps from before loop 16 without one use `size`.
      await fillShape(c, mapId, m.seed, m.shape ?? (m.seed ? { blocks: m.base } : size));
    } else {
      await c.query('UPDATE map_cells SET ' + FREED + ' WHERE map_id = $1 AND owner_id IS NOT NULL', [mapId]);
      await c.query(DROP_ORPHAN_FACTORIES);
    await c.query(DROP_BROKEN_LISTINGS);
    }
    await c.query('UPDATE maps SET mined = 0 WHERE id = $1', [mapId]);   // a wiped map starts again at level 1
    await c.query('UPDATE player_map_settings SET wipe_floor = 0, unlocked = true WHERE map_id = $1', [mapId]);
    const { rows: [b] } = await c.query('SELECT count(*)::int AS blocks FROM map_cells WHERE map_id = $1', [mapId]);
    return { ...n, blocks: b.blocks };
  });
}

// Deletes an account for good. Their blocks everywhere go empty; their login, sessions, email codes and
// personal data are erased, in Neon Auth too; their name is freed. The row stays, anonymous, because the
// squares ledger refers to it. Returns { maps: ids of maps where they had blocks, authDeleted }.
// also(c): the plug-ins' part, in the same transaction (loop 19).
function deleteAccount(pool, playerId, also = async () => {}) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT auth_user_id, squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const { rows: maps } = await c.query('SELECT DISTINCT map_id FROM map_cells WHERE owner_id = $1', [playerId]);
    await c.query('UPDATE map_cells SET ' + FREED + ' WHERE owner_id = $1', [playerId]);
    await c.query(DROP_ORPHAN_FACTORIES);
    await c.query(DROP_BROKEN_LISTINGS);
    for (const t of ['player_tokens', 'player_map_settings', 'player_map_stats', 'player_achievements', 'player_skins',
      'tap_limit_log', 'bans', 'player_totals', 'player_lives', 'email_consent_log']) {
      await c.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
    }
    await c.query('DELETE FROM player_links WHERE account_id = $1 OR guest_id = $1', [playerId]);
    await also(c);
    if (Number(p.squares) > 0) {
      await c.query("INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, 0, 'account deleted')",
        [playerId, -Number(p.squares)]);
    }
    await c.query(`UPDATE players SET email_updates = false, unsubscribe_token = NULL, name = 'deleted' || id, auth_user_id = NULL, name_changed_at = NULL, last_map_id = NULL,
      squares = 0, upgrade_steps = '{}', highest_level = 1, tutorial = '{}', deleted_at = now() WHERE id = $1`, [playerId]);
    // Neon Auth keeps its users in this same database; deleting the user removes their sessions and logins too.
    let authDeleted = false;
    if (p.auth_user_id && (await c.query("SELECT to_regclass('neon_auth.user') AS t")).rows[0].t) {
      const { rows: [u] } = await c.query('DELETE FROM neon_auth."user" WHERE id = $1 RETURNING email', [p.auth_user_id]);
      if (u) {
        await c.query('DELETE FROM neon_auth.verification WHERE identifier = $1 OR identifier LIKE $2', [u.email, '%' + u.email]);
        authDeleted = true;
      }
    }
    return { maps: maps.map(r => r.map_id), authDeleted };
  });
}

// A player's own fresh start: their blocks on every map go empty, and their squares, upgrades, stats,
// achievements, skins and look on every map are reset, as for a new player. Kept: name, login, tutorial,
// and skins bought with money. Returns { maps: ids of every map they had played }.
function resetProgress(pool, playerId) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    // Every map they've played, with blocks or not: the game reloads them all, so none keeps their old look,
    // wipe floor or stats in memory (a stale one would stop them earning squares there).
    const { rows: maps } = await c.query(`SELECT map_id FROM map_cells WHERE owner_id = $1
      UNION SELECT map_id FROM player_map_settings WHERE player_id = $1 UNION SELECT map_id FROM player_map_stats WHERE player_id = $1`, [playerId]);
    await c.query('UPDATE map_cells SET ' + FREED + ' WHERE owner_id = $1', [playerId]);
    await c.query(DROP_ORPHAN_FACTORIES);
    await c.query(DROP_BROKEN_LISTINGS);
    for (const t of ['player_map_settings', 'player_map_stats', 'player_achievements', 'player_totals', 'player_lives']) {
      await c.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
    }
    await c.query("DELETE FROM player_skins WHERE player_id = $1 AND source <> 'purchase'", [playerId]);
    if (Number(p.squares) > 0) {
      await c.query("INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, 0, 'progress reset')",
        [playerId, -Number(p.squares)]);
    }
    await c.query("UPDATE players SET squares = 0, upgrade_steps = '{}', highest_level = 1 WHERE id = $1", [playerId]);
    return { maps: maps.map(r => r.map_id) };
  });
}

// Deletes a map for good (admin delete-map): its blocks, edges, and everyone's look, stats and wipes there.
// Squares, the ledger, achievements and accounts stay (their map reference is cleared).
function deleteMap(pool, mapId) {
  return tx(pool, async c => {
    for (const sql of ['UPDATE players SET last_map_id = NULL WHERE last_map_id = $1', 'UPDATE square_ledger SET map_id = NULL WHERE map_id = $1',
      'UPDATE player_achievements SET map_id = NULL WHERE map_id = $1', 'DELETE FROM player_map_settings WHERE map_id = $1',
      'DELETE FROM player_map_stats WHERE map_id = $1', 'DELETE FROM map_wipes WHERE map_id = $1', 'DELETE FROM player_lives WHERE map_id = $1', 'UPDATE item_uses SET map_id = NULL WHERE map_id = $1', 'DELETE FROM factories WHERE map_id = $1', 'DELETE FROM listings WHERE map_id = $1', 'DELETE FROM map_edges WHERE map_id = $1',
      'DELETE FROM map_cells WHERE map_id = $1', 'DELETE FROM maps WHERE id = $1']) await c.query(sql, [mapId]);
  });
}
Object.assign(module.exports, { deleteMap });

// A player's public profile (loop 15). Nothing from the login system: no email, sign-in method or IP.
async function profile(pool, playerId) {
  const { rows: [p] } = await pool.query(`SELECT p.id, p.name, p.auth_user_id IS NOT NULL AS account, (p.squares / 10)::float AS squares,
      p.star_pattern, p.star_art, p.created_at, p.last_map_id, m.name AS map,
      (SELECT color FROM player_map_settings s WHERE s.player_id = p.id AND s.map_id = p.last_map_id) AS color,
      (SELECT count(*)::int FROM map_cells c WHERE c.map_id = p.last_map_id AND c.owner_id = p.id) AS blocks
    FROM players p LEFT JOIN maps m ON m.id = p.last_map_id WHERE p.id = $1 AND p.deleted_at IS NULL`, [playerId]);
  if (!p) return null;
  const [best, recent, rank] = await Promise.all([
    pool.query(`SELECT s.owned_max AS n, m.name AS map FROM player_map_stats s JOIN maps m ON m.id = s.map_id WHERE s.player_id = $1
      ORDER BY s.owned_max DESC LIMIT 1`, [playerId]),
    pool.query('SELECT achievement_id AS id FROM player_achievements WHERE player_id = $1 ORDER BY earned_at DESC', [playerId]),
    pool.query(`SELECT 1 + count(*)::int AS rank FROM (SELECT owner_id, count(*) AS n FROM map_cells WHERE map_id = $1 AND owner_id IS NOT NULL
      GROUP BY owner_id) o WHERE o.n > $2`, [p.last_map_id, p.blocks]),
  ]);
  return { ...p, best: best.rows[0] ?? null, earned: recent.rows.map(r => r.id), rank: p.blocks ? rank.rows[0].rank : null };
}
Object.assign(module.exports, { profile });

// ---------- Email updates list (loop 15) ----------
// Joins or leaves the list (accounts only): the latest choice on the player, when, where from, and a log row.
// Returns { on, email, token } (email from Neon Auth, for the Resend Audience).
async function setEmailUpdates(pool, playerId, on, source) {
  const { rows: [p] } = await pool.query(`UPDATE players SET email_updates = $2, email_updates_at = now(), email_updates_source = $3,
      unsubscribe_token = coalesce(unsubscribe_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    WHERE id = $1 AND auth_user_id IS NOT NULL RETURNING email_updates, unsubscribe_token, auth_user_id`, [playerId, on, source]);
  if (!p) return { error: 'Only accounts can get emails' };
  await pool.query('INSERT INTO email_consent_log (player_id, subscribed, source) VALUES ($1, $2, $3)', [playerId, on, source]);
  return { on: p.email_updates, token: p.unsubscribe_token, email: await accountEmail(pool, p.auth_user_id) };
}
// ---------- Factories (loop 16) ----------
// Builds a factory on the player's own block for `price` tenths, in one transaction with the player row locked,
// so two taps never build two or pay twice; the block must still be theirs, bare and not for sale, and they must
// still be under their limit (`limit`: how many they may have on this map). Returns the factory row or { error }.
function buildFactory(pool, { mapId, playerId, x, y, price, limit, awakeMs, now = Date.now() }) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const { rows: [cell] } = await c.query('SELECT owner_id, factory_id, listing_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3 FOR UPDATE', [mapId, x, y]);
    if (!cell || String(cell.owner_id) !== String(playerId)) return { error: 'Only on your own land' };
    if (cell.factory_id) return { error: 'There is a factory here already' };
    if (cell.listing_id) return { error: 'Not on land for sale' };
    const { rows: [n] } = await c.query('SELECT count(*)::int AS n FROM factories WHERE map_id = $1 AND owner_id = $2', [mapId, playerId]);
    if (n.n >= limit) return { error: 'You have all the factories your land allows' };
    const paid = await spend(c, playerId, price, 'build:factory');
    if (paid.error) return paid;
    const { rows: [f] } = await c.query(`INSERT INTO factories (map_id, owner_id, x, y, built_at, awake_until, processed_at)
      VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0)) RETURNING id`,
      [mapId, playerId, x, y, now, now + awakeMs, factoryStep(now)]);
    await c.query('UPDATE map_cells SET factory_id = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y, f.id]);
    return { id: f.id, squares: paid.squares };
  });
}
// Wakes a factory: it works for `awakeMs` from now; time asleep never counts.
async function wakeFactory(pool, id, playerId, awakeMs, now = Date.now()) {
  const { rows: [f] } = await pool.query(`UPDATE factories SET awake_until = to_timestamp($3 / 1000.0),
    processed_at = GREATEST(processed_at, to_timestamp($4 / 1000.0)) WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, playerId, now + awakeMs, factoryStep(now)]);
  return !!f;
}
// Saves where the tick got to with each factory: [{ id, processed, tx, ty, progress }].
async function saveFactories(pool, list) {
  if (!list.length) return;
  await pool.query(`UPDATE factories f SET processed_at = to_timestamp(v.p / 1000.0), target_x = v.tx, target_y = v.ty, progress = v.g
    FROM unnest($1::bigint[], $2::float8[], $3::int[], $4::int[], $5::float8[]) AS v (id, p, tx, ty, g) WHERE f.id = v.id`,
    [list.map(f => f.id), list.map(f => f.processed), list.map(f => f.tx), list.map(f => f.ty), list.map(f => f.progress)]);
}
// Maps with a factory the tick still has to bring up to `until` (ms).
async function factoryMaps(pool, until) {
  const { rows } = await pool.query('SELECT DISTINCT map_id FROM factories WHERE processed_at < LEAST(awake_until, to_timestamp($1 / 1000.0))', [until]);
  return rows.map(r => r.map_id);
}
// Removes a factory (Demolition), inside the item's transaction.
async function removeFactory(c, mapId, x, y) {
  await c.query('UPDATE map_cells SET factory_id = NULL WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
  await c.query('DELETE FROM factories WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
}
const factoryStep = now => Math.floor(now / 1000) * 1000;   // factories.js steps: one second (loop 18)
Object.assign(module.exports, { buildFactory, wakeFactory, saveFactories, factoryMaps, removeFactory });

// ---------- Walls (loop 16) ----------
// Builds a batch of walls (loop 18) for `price` tenths in all, all or nothing: player row and blocks locked.
// walls: [{ x, y, side, hits }] (hits: what each takes to break, w x H). Returns { cells: [{ x, y, walls }], squares }
// or { error }.
function buildWalls(pool, { mapId, playerId, walls, price, max }) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const byBlock = new Map();
    for (const w of walls) (byBlock.get(w.x + ',' + w.y) ?? byBlock.set(w.x + ',' + w.y, []).get(w.x + ',' + w.y)).push(w);
    const cells = [];
    for (const list of byBlock.values()) {
      const { x, y } = list[0];
      const { rows: [cell] } = await c.query('SELECT owner_id, walls, listing_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3 FOR UPDATE', [mapId, x, y]);
      if (!cell || String(cell.owner_id) !== String(playerId)) return { error: 'Only on your own land' };
      if (cell.listing_id) return { error: 'Not on land for sale' };
      if (list.some(w => cell.walls.some(o => o.side === w.side))) return { error: 'There is a wall there already' };
      if (cell.walls.length + list.length > max) return { error: `At most ${max} walls on one block` };
      cells.push({ x, y, walls: [...cell.walls, ...list.map(w => ({ side: w.side, hits: w.hits }))] });
    }
    const paid = await spend(c, playerId, price, walls.length === 1 ? 'build:wall' : `build:wall x${walls.length}`);
    if (paid.error) return paid;
    for (const cell of cells) await c.query('UPDATE map_cells SET walls = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, cell.x, cell.y, JSON.stringify(cell.walls)]);
    return { cells, squares: paid.squares };
  });
}
// Removes one wall (broken, or Demolition inside its transaction: pass the client).
async function removeWall(c, mapId, x, y, side) {
  await c.query(`UPDATE map_cells SET walls = COALESCE((SELECT jsonb_agg(w) FROM jsonb_array_elements(walls) w WHERE w->>'side' <> $4), '[]')
    WHERE map_id = $1 AND x = $2 AND y = $3`, [mapId, x, y, side]);
}
// Removes every wall on a block (Demolition, inside its transaction).
async function clearWalls(c, mapId, x, y) {
  await c.query("UPDATE map_cells SET walls = '[]' WHERE map_id = $1 AND x = $2 AND y = $3", [mapId, x, y]);
}
Object.assign(module.exports, { buildWalls, removeWall, clearWalls });

// ---------- The land market (loop 16) ----------
// Whether a player may trade land: an account at least `minDays` old.
async function canTrade(c, playerId, minDays) {
  // The age is worked out by the database's clock, so a computer's clock being off can't matter.
  const { rows: [p] } = await c.query('SELECT auth_user_id, created_at > now() - make_interval(secs => $2 * 86400) AS young FROM players WHERE id = $1', [playerId, minDays]);
  if (!p?.auth_user_id) return 'Only accounts can buy and sell land';
  if (p.young) return `Accounts can trade land once they are ${minDays} days old`;
  return null;
}
// Lists blocks ([[x, y]]: the seller's, connected, none listed already) at `price` tenths. Returns { id } or { error }.
function createListing(pool, { mapId, sellerId, blocks, price, minDays }) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [sellerId]);
    const refusal = await canTrade(c, sellerId, minDays);
    if (refusal) return { error: refusal };
    const { rows } = await c.query(`SELECT owner_id, listing_id FROM map_cells WHERE map_id = $1 AND (x, y) IN (SELECT * FROM unnest($2::int[], $3::int[]))
      FOR UPDATE`, [mapId, blocks.map(b => b[0]), blocks.map(b => b[1])]);
    if (rows.length !== blocks.length || rows.some(r => String(r.owner_id) !== String(sellerId))) return { error: 'Only your own blocks' };
    if (rows.some(r => r.listing_id)) return { error: 'Some of those blocks are already for sale' };
    const { rows: [l] } = await c.query('INSERT INTO listings (map_id, seller_id, price) VALUES ($1, $2, $3) RETURNING id', [mapId, sellerId, price]);
    await c.query('UPDATE map_cells SET listing_id = $4 WHERE map_id = $1 AND (x, y) IN (SELECT * FROM unnest($2::int[], $3::int[]))',
      [mapId, blocks.map(b => b[0]), blocks.map(b => b[1]), l.id]);
    return { id: l.id };
  });
}
// Ends a listing (the seller cancelled, or a block was attacked): its blocks are no longer for sale.
async function cancelListing(pool, id) {
  await tx(pool, async c => {
    await c.query('UPDATE map_cells SET listing_id = NULL WHERE listing_id = $1', [id]);
    await c.query('DELETE FROM listings WHERE id = $1', [id]);
  });
}
// Buys a listing, in one transaction (buyer and seller rows locked in id order, so two buyers can't both have it):
// the buyer pays the price, the seller gets it less `fee` (destroyed), and the blocks, their factories and walls
// become the buyer's. `look`: the buyer's color/skin here if they haven't joined this map. Returns
// { blocks: [[x, y]], seller, buyerSquares, sellerSquares, price, joined } or { error, need? }.
function buyListing(pool, { id, buyerId, fee, minDays, look }) {
  return tx(pool, async c => {
    const { rows: [l] } = await c.query('SELECT id, map_id, seller_id, price FROM listings WHERE id = $1 FOR UPDATE', [id]);
    if (!l) return { error: 'That land is no longer for sale' };
    if (String(l.seller_id) === String(buyerId)) return { error: 'This is your own land' };
    await c.query('SELECT 1 FROM players WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[l.seller_id, buyerId]]);
    const refusal = await canTrade(c, buyerId, minDays);
    if (refusal) return { error: refusal };
    const price = Number(l.price), cut = Math.floor(price * fee);
    const paid = await spend(c, buyerId, price, `land:buy:${id}`);
    if (paid.error) return paid;
    const { rows: [s] } = await c.query('UPDATE players SET squares = squares + $2 WHERE id = $1 RETURNING squares', [l.seller_id, price - cut]);
    await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason, map_id) VALUES ($1, $2, $3, $4, $5)',
      [l.seller_id, price - cut, s.squares, `land:sale:${id}`, l.map_id]);
    const { rows: blocks } = await c.query(`UPDATE map_cells SET owner_id = $3, claimed_at = now(), listing_id = NULL
      WHERE map_id = $1 AND listing_id = $2 AND owner_id = $4 RETURNING x, y`, [l.map_id, id, buyerId, l.seller_id]);
    await c.query('UPDATE factories SET owner_id = $3 WHERE map_id = $1 AND (x, y) IN (SELECT * FROM unnest($2::int[], $4::int[]))',
      [l.map_id, blocks.map(b => b.x), buyerId, blocks.map(b => b.y)]);
    await c.query('DELETE FROM listings WHERE id = $1', [id]);
    const joined = (await c.query(`INSERT INTO player_map_settings (player_id, map_id, color, skin_id, coverage) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (player_id, map_id) DO NOTHING`, [buyerId, l.map_id, look.color, look.skin, look.coverage])).rowCount === 1;
    return { blocks: blocks.map(b => [b.x, b.y]), seller: l.seller_id, buyerSquares: paid.squares, sellerSquares: Number(s.squares), price, cut, joined };
  });
}
Object.assign(module.exports, { createListing, cancelListing, buyListing });

// ---------- The economy reset (loop 16) ----------
// A map's starting shape. Maps from before loop 16 have none: a seeded one is its seed's island of E blocks; one
// without a seed is the largest full rectangle from (0, 0) (growth only ever adds blocks around it).
async function startingShape(c, m) {
  if (m.shape) return m.shape;
  if (m.seed !== null) return { blocks: Number(m.base) };
  const { rows } = await c.query('SELECT x, y FROM map_cells WHERE map_id = $1 AND x >= 0 AND y >= 0', [m.id]);
  const has = new Set(rows.map(r => r.x + ',' + r.y));
  let best = { width: 1, height: 1 }, w = Infinity;
  for (let h = 1; has.has('0,' + (h - 1)); h++) {
    let run = 0;
    while (has.has(run + ',' + (h - 1))) run++;
    w = Math.min(w, run);
    if (w * h > best.width * best.height) best = { width: w, height: h };
  }
  return best;
}
// What the reset will do to each official map: [{ id, name, seed, shape, base, blocks now }].
async function resetPlan(pool) {
  const { rows } = await pool.query(`SELECT m.id, m.name, m.seed, m.shape, m.base_blocks AS base, (SELECT count(*)::int FROM map_cells c WHERE c.map_id = m.id) AS blocks
    FROM maps m WHERE m.type = 'official' ORDER BY m.id`);
  return tx(pool, async c => {
    const out = [];
    for (const m of rows) {
      const shape = await startingShape(c, m);
      out.push({ ...m, shape, base: shape.blocks ?? shape.width * shape.height });
    }
    return out;
  });
}
// The economy reset, in one transaction. Clears: every block's owner, every map's mined count (level 1), squares
// (written to the ledger), upgrade tiers and highest level, items and their uses, factories, walls and listings;
// official maps are made again from their seeds and E. Keeps: accounts, names, owned skins, stars and earned
// achievements. Never run on production by Cody; Xoren runs it.
// also(c): the plug-ins' part, in the same transaction (loop 19).
function economyReset(pool, plan, also = async () => {}) {
  return tx(pool, async c => {
    for (const t of ['listings', 'factories']) await c.query(`DELETE FROM ${t}`);
    await also(c);
    await c.query(`INSERT INTO square_ledger (player_id, delta, balance_after, reason) SELECT id, -squares, 0, 'economy reset' FROM players WHERE squares <> 0`);
    await c.query("UPDATE players SET squares = 0, upgrade_steps = '{}', highest_level = 1");
    await c.query('UPDATE player_lives SET ended_at = now() WHERE ended_at IS NULL');
    await c.query('UPDATE player_map_settings SET wipe_floor = 0, unlocked = true');
    for (const m of plan) {
      await c.query('DELETE FROM map_cells WHERE map_id = $1', [m.id]);
      await c.query('UPDATE maps SET grown = 0, mined = 0, base_blocks = $2, shape = $3 WHERE id = $1', [m.id, m.base, m.shape]);
      await fillShape(c, m.id, m.seed, m.shape);
    }
    await c.query("UPDATE map_cells SET owner_id = NULL, claimed_at = NULL, walls = '[]', factory_id = NULL, listing_id = NULL, birth_level = 1 WHERE owner_id IS NOT NULL OR walls <> '[]'");
    await c.query('UPDATE maps SET mined = 0');
    const { rows: [n] } = await c.query('SELECT count(*)::int AS players FROM players WHERE deleted_at IS NULL');
    return n;
  });
}
Object.assign(module.exports, { resetPlan, economyReset });

// Settings > Show tenths (loop 16).
const setShowTenths = (pool, playerId, on) => pool.query('UPDATE players SET show_tenths = $2 WHERE id = $1', [playerId, on]);
Object.assign(module.exports, { setShowTenths, spend, FREED });

async function emailUpdates(pool, playerId) {
  const { rows: [p] } = await pool.query('SELECT email_updates, auth_user_id FROM players WHERE id = $1', [playerId]);
  return { on: !!p?.email_updates, account: !!p?.auth_user_id };
}
// The one-click unsubscribe link: no login needed. Returns { email } (for the Audience) or null for an unknown link.
async function unsubscribeByToken(pool, token) {
  const { rows: [p] } = await pool.query(`UPDATE players SET email_updates = false, email_updates_at = now(), email_updates_source = 'unsubscribe-link'
    WHERE unsubscribe_token = $1 RETURNING id, auth_user_id`, [String(token ?? '')]);
  if (!p) return null;
  await pool.query("INSERT INTO email_consent_log (player_id, subscribed, source) VALUES ($1, false, 'unsubscribe-link')", [p.id]);
  return { email: await accountEmail(pool, p.auth_user_id) };
}
// Everyone on the list (admin email-list): [{ name, email, since, source }].
async function emailList(pool) {
  const { rows } = await pool.query("SELECT id, name, auth_user_id, email_updates_at, email_updates_source FROM players WHERE email_updates ORDER BY email_updates_at");
  return Promise.all(rows.map(async r => ({ name: r.name, email: await accountEmail(pool, r.auth_user_id), since: r.email_updates_at, source: r.email_updates_source })));
}
Object.assign(module.exports, { setEmailUpdates, emailUpdates, unsubscribeByToken, emailList });

// ---------- Lives (death and respawn) ----------
// After a claim: the open life on this map gets the claim, its squares and its peak (one is started if none is open).
async function lifeClaim(pool, playerId, mapId, owned, squares) {
  const r = await pool.query(`UPDATE player_lives SET claims = claims + 1, squares = squares + $3, peak = GREATEST(peak, $4)
    WHERE player_id = $1 AND map_id = $2 AND ended_at IS NULL`, [playerId, mapId, squares, owned]);
  if (!r.rowCount) await pool.query('INSERT INTO player_lives (player_id, map_id, claims, squares, peak) VALUES ($1, $2, 1, $3, $4)', [playerId, mapId, squares, owned]);
}
// Ends the open life on this map: a death (killer set, where the last block was) or a wipe (killer null, seen).
// Returns the ended life (for the death screen), or null if none was open.
async function endLife(pool, playerId, mapId, killerId = null, x = null, y = null) {
  const { rows: [l] } = await pool.query(`UPDATE player_lives SET ended_at = now(), killer_id = $3::bigint, x = $4, y = $5, seen = $3::bigint IS NULL
    WHERE player_id = $1 AND map_id = $2 AND ended_at IS NULL RETURNING id`, [playerId, mapId, killerId, x, y]);
  return l ? lifeShown(pool, l.id) : null;
}
// A life as the death screen shows it.
async function lifeShown(pool, id) {
  const { rows: [l] } = await pool.query(`SELECT l.id, l.map_id AS "mapId", extract(epoch FROM l.ended_at - l.started_at)::float AS seconds, l.peak,
    l.claims, (l.squares / 10.0)::float AS squares, k.name AS killer, k.id AS "killerId", l.x, l.y FROM player_lives l LEFT JOIN players k ON k.id = l.killer_id WHERE l.id = $1`, [id]);
  return l ?? null;
}
// A death on this map the player hasn't seen yet (they were away), or null; marks it seen.
async function unseenDeath(pool, playerId, mapId) {
  const { rows: [l] } = await pool.query(`UPDATE player_lives SET seen = true WHERE id = (SELECT id FROM player_lives WHERE player_id = $1
    AND map_id = $2 AND killer_id IS NOT NULL AND NOT seen ORDER BY id DESC LIMIT 1) RETURNING id`, [playerId, mapId]);
  return l ? lifeShown(pool, l.id) : null;
}
const markLifeSeen = (pool, id) => pool.query('UPDATE player_lives SET seen = true WHERE id = $1', [id]);
Object.assign(module.exports, { lifeClaim, endLife, unseenDeath, markLifeSeen });

// ---------- Terrain (the Terraformer item, plugins/items, uses it through the core) ----------
// Terraformer: a block's terrain for good. Water can't be owned, so a block turned to water is freed.
async function setTerrain(c, mapId, x, y, terrain) {
  await c.query('UPDATE map_cells SET terrain = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y, terrain]);
  if (terrain === 'water') {
    await c.query('UPDATE map_cells SET ' + FREED + ' WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
    await c.query(DROP_ORPHAN_FACTORIES);
    await c.query(DROP_BROKEN_LISTINGS);
  }
}
Object.assign(module.exports, { setTerrain });

// An account's email, from Neon Auth (null for guests, or where Neon Auth isn't in this database).
async function accountEmail(pool, authUserId) {
  if (!authUserId || !(await pool.query("SELECT to_regclass('neon_auth.user') AS t")).rows[0].t) return null;
  return (await pool.query('SELECT email FROM neon_auth."user" WHERE id = $1', [authUserId])).rows[0]?.email ?? null;
}

// What the player command shows.
async function playerInfo(pool, playerId) {
  const [p, blocks, achievements, links, bans] = await Promise.all([
    pool.query(`SELECT ${PLAYER}, p.deleted_at, p.created_at FROM players p WHERE p.id = $1`, [playerId]),
    pool.query(`SELECT m.name, count(*)::int AS blocks FROM map_cells c JOIN maps m ON m.id = c.map_id
      WHERE c.owner_id = $1 GROUP BY m.name ORDER BY m.name`, [playerId]),
    pool.query('SELECT achievement_id FROM player_achievements WHERE player_id = $1 ORDER BY earned_at', [playerId]),
    linkedPlayers(pool, playerId),
    pool.query('SELECT reason, until, lifted_at, created_at FROM bans WHERE player_id = $1 ORDER BY id', [playerId]),
  ]);
  const player = p.rows[0];
  const linked = links.length ? (await pool.query('SELECT id, name FROM players WHERE id = ANY($1::bigint[])', [links])).rows : [];
  return { player, email: await accountEmail(pool, player.auth_user_id), blocks: blocks.rows,
    achievements: achievements.rows.map(r => r.achievement_id), linked, bans: bans.rows };
}

// What the map command shows.
async function mapInfo(pool, mapId) {
  const [size, top] = await Promise.all([
    pool.query(`SELECT count(*)::int AS blocks, count(owner_id)::int AS claimed, count(DISTINCT owner_id)::int AS players,
      min(x) AS x0, max(x) AS x1, min(y) AS y0, max(y) AS y1 FROM map_cells WHERE map_id = $1`, [mapId]),
    pool.query(`SELECT p.name, count(*)::int AS blocks FROM map_cells c JOIN players p ON p.id = c.owner_id
      WHERE c.map_id = $1 GROUP BY p.name ORDER BY 2 DESC, 1 LIMIT 5`, [mapId]),
  ]);
  return { ...size.rows[0], top: top.rows };
}

// One line in admin_log.
async function logAdmin(pool, { command, target = null, args = {}, ok, result, ip = null }) {
  await pool.query('INSERT INTO admin_log (command, target, args, ok, result, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [command, target, JSON.stringify(args), ok, result, ip]);
}

Object.assign(module.exports, { findPlayer, findMap, linkPlayers, linkedPlayers, activeBan, banPlayers, unbanPlayers,
  adjustSquares, wipeMap, deleteAccount, resetProgress, accountEmail, playerInfo, mapInfo, logAdmin });
