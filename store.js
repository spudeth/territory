// Every database read and write the game makes. Ids come back from Postgres as strings.
const crypto = require('crypto');
const { tx } = require('./db');

const hashToken = token => crypto.createHash('sha256').update(token).digest();

// Only a real string can be a token, so values like {} or "__proto__" never match a player.
async function findPlayerByToken(pool, token) {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  const { rows } = await pool.query(
    'SELECT p.id, p.name, p.last_map_id FROM player_tokens t JOIN players p ON p.id = t.player_id WHERE t.token_hash = $1',
    [hashToken(token)]);
  return rows[0] ?? null;
}

async function defaultMapId(pool) {
  const { rows } = await pool.query("SELECT id FROM maps WHERE type = 'official' ORDER BY id LIMIT 1");
  if (!rows[0]) throw new Error('there is no official map; have the migrations run?');
  return rows[0].id;
}

// One map with its blocks and the players who have joined it. Null if there is no such map.
async function loadMap(pool, mapId) {
  const { rows: [map] } = await pool.query('SELECT id, name, style FROM maps WHERE id = $1', [mapId]);
  if (!map) return null;
  const [cells, players] = await Promise.all([
    pool.query('SELECT x, y, owner_id FROM map_cells WHERE map_id = $1', [mapId]),
    pool.query('SELECT s.player_id, p.name, s.color FROM player_map_settings s JOIN players p ON p.id = s.player_id WHERE s.map_id = $1', [mapId]),
  ]);
  return { ...map, cells: cells.rows, players: players.rows };
}

async function cellOwner(pool, mapId, x, y) {
  const { rows } = await pool.query('SELECT owner_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
  return rows[0]?.owner_id ?? null;
}

const setLastMap = (pool, playerId, mapId) =>
  pool.query('UPDATE players SET last_map_id = $2 WHERE id = $1 AND last_map_id IS DISTINCT FROM $2', [playerId, mapId]);

// Adds one block at a random empty spot touching the map on one of its four sides. Each spot is equally likely.
const GROW = `
  INSERT INTO map_cells (map_id, x, y)
  SELECT $1, n.x, n.y
  FROM map_cells c
  CROSS JOIN LATERAL (VALUES (c.x + 1, c.y), (c.x - 1, c.y), (c.x, c.y + 1), (c.x, c.y - 1)) AS n (x, y)
  WHERE c.map_id = $1
    AND NOT EXISTS (SELECT 1 FROM map_cells e WHERE e.map_id = $1 AND e.x = n.x AND e.y = n.y)
  GROUP BY n.x, n.y
  ORDER BY random()
  LIMIT 1
  RETURNING x, y`;
async function growMap(client, mapId) {
  const grown = (await client.query(GROW, [mapId])).rows[0];
  if (!grown) throw new Error('map growth found no free spot');
  return grown;
}

// Gives 1 square for a first claim, but only if the player now owns more blocks here than at any wipe (wipe_floor).
// Returns the new balance, or nothing if no square was earned.
const EARN = `
  WITH p AS (
    UPDATE players SET squares = squares + 1
    WHERE id = $2
      AND (SELECT count(*) FROM map_cells WHERE map_id = $1 AND owner_id = $2)
        > (SELECT wipe_floor FROM player_map_settings WHERE map_id = $1 AND player_id = $2)
    RETURNING squares
  )
  INSERT INTO square_ledger (player_id, delta, balance_after, reason, map_id, x, y)
  SELECT $2, 1, squares, 'first_claim', $1, $3, $4 FROM p
  RETURNING balance_after`;

class Conflict extends Error {}

// Claims block (x, y) for a player, if it still has the owner the caller expects (`from`, null for empty).
// A first claim (from = null) also grows the map and may earn a square, all in the same transaction.
//   playerId: an existing player, or null to create a guest from `newGuest` = { names, tokenHash }
//   color:    stored if this is the player's first claim on this map; null if they have already joined it
// Returns { conflict: true } if the block changed hands first, otherwise
//   { playerId, name, joinedMap, grown: {x, y} | null, squares: new balance | null }.
async function claimBlock(pool, { mapId, x, y, from, playerId, newGuest, color }) {
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
        : await c.query('UPDATE map_cells SET owner_id = $4, claimed_at = now() WHERE map_id = $1 AND x = $2 AND y = $3 AND owner_id = $5', [mapId, x, y, playerId, from]);
      if (!taken.rowCount) throw new Conflict();

      let joinedMap = false;
      if (color !== null) {
        const r = await c.query(
          "INSERT INTO player_map_settings (player_id, map_id, color, skin_id) VALUES ($1, $2, $3, 'default') ON CONFLICT DO NOTHING",
          [playerId, mapId, color]);
        joinedMap = r.rowCount === 1;
      }

      let grown = null, squares = null;
      if (from === null) {
        grown = await growMap(c, mapId);
        squares = (await c.query(EARN, [mapId, playerId, x, y])).rows[0]?.balance_after ?? null;
      }
      return { playerId, name, joinedMap, grown, squares: squares === null ? null : Number(squares) };
    });
  } catch (err) {
    if (err instanceof Conflict) return { conflict: true };
    throw err;
  }
}

// Clears all of a player's blocks on one map and records the wipe. Their wipe_floor becomes the higher of
// its old value and the number of blocks just cleared, so wiping again can never lower it.
// Returns { cells: [[x, y], …], floor }, or null if they had no blocks there.
function wipeTerritory(pool, mapId, playerId) {
  return tx(pool, async c => {
    await c.query('SELECT 1 FROM maps WHERE id = $1 FOR UPDATE', [mapId]);
    const { rows } = await c.query(
      'UPDATE map_cells SET owner_id = NULL, claimed_at = NULL WHERE map_id = $1 AND owner_id = $2 RETURNING x, y', [mapId, playerId]);
    if (!rows.length) return null;
    await c.query('INSERT INTO map_wipes (map_id, player_id, blocks_owned) VALUES ($1, $2, $3)', [mapId, playerId, rows.length]);
    const { rows: [s] } = await c.query(
      'UPDATE player_map_settings SET wipe_floor = GREATEST(wipe_floor, $3) WHERE map_id = $1 AND player_id = $2 RETURNING wipe_floor',
      [mapId, playerId, rows.length]);
    return { cells: rows.map(r => [r.x, r.y]), floor: s.wipe_floor };
  });
}

module.exports = { hashToken, findPlayerByToken, defaultMapId, loadMap, cellOwner, setLastMap, growMap, claimBlock, wipeTerritory };
