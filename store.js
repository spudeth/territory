// Every database read and write the game makes. Ids come back from Postgres as strings.
const crypto = require('crypto');
const { tx } = require('./db');
const rules = require('./rules');
const { accountNames } = require('./names');

const hashToken = token => crypto.createHash('sha256').update(token).digest();
const PLAYER = 'p.id, p.name, p.last_map_id, p.auth_user_id, p.name_changed_at, p.click_power, p.defense, p.earnings';

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
  const { rows: [map] } = await pool.query('SELECT id, name, style FROM maps WHERE id = $1', [mapId]);
  if (!map) return null;
  const [cells, players, stats] = await Promise.all([
    pool.query('SELECT x, y, owner_id FROM map_cells WHERE map_id = $1', [mapId]),
    pool.query('SELECT s.player_id, p.name, s.color, s.coverage, p.click_power, p.defense, p.earnings FROM player_map_settings s JOIN players p ON p.id = s.player_id WHERE s.map_id = $1', [mapId]),
    pool.query('SELECT * FROM player_map_stats WHERE map_id = $1', [mapId]),
  ]);
  return { ...map, cells: cells.rows, players: players.rows, stats: stats.rows };
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

// Gives $5 squares for a first claim, but only if the player now owns more blocks here than at any wipe (wipe_floor).
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
//   color:    stored if this is the player's first claim on this map; null if they have already joined it
//   earn:     squares for a first claim (rules.squaresForFirstClaim with the player's upgrades)
//   coverage: stored with the color ('tile' or 'stretch'); like color and skin it can never change afterwards
//   stats:    the claimer's stats after this claim (stats.afterClaim); `from` loses a block
// Returns { conflict: true } if the block changed hands first, otherwise
//   { playerId, name, joinedMap, grown: {x, y} | null, squares: new balance | null }.
async function claimBlock(pool, { mapId, x, y, from, playerId, newGuest, color, coverage = 'tile', earn = rules.squaresForFirstClaim(),
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
        : await c.query('UPDATE map_cells SET owner_id = $4, claimed_at = now() WHERE map_id = $1 AND x = $2 AND y = $3 AND owner_id = $5', [mapId, x, y, playerId, from]);
      if (!taken.rowCount) throw new Conflict();

      let joinedMap = false;
      if (color !== null) {
        const r = await c.query(
          "INSERT INTO player_map_settings (player_id, map_id, color, skin_id, coverage) VALUES ($1, $2, $3, 'default', $4) ON CONFLICT DO NOTHING",
          [playerId, mapId, color, coverage]);
        joinedMap = r.rowCount === 1;
      }

      if (stats) await saveStats(c, mapId, playerId, stats);
      if (from !== null) {
        await c.query(`INSERT INTO player_map_stats (map_id, player_id, blocks_lost) VALUES ($1, $2, 1)
          ON CONFLICT (map_id, player_id) DO UPDATE SET blocks_lost = player_map_stats.blocks_lost + 1`, [mapId, from]);
      }

      let grown = null, squares = null;
      if (from === null) {
        grown = await growMap(c, mapId);
        squares = (await c.query(EARN, [mapId, playerId, x, y, earn])).rows[0]?.balance_after ?? null;
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

module.exports = { hashToken, findPlayerByToken, accountPlayer, renamePlayer, defaultMapId, loadMap, cellOwner, setLastMap,
  growMap, claimBlock, wipeTerritory };
