// Every database read and write the game makes. Ids come back from Postgres as strings.
const crypto = require('crypto');
const { tx } = require('./db');
const rules = require('./rules');
const { accountNames } = require('./names');

const hashToken = token => crypto.createHash('sha256').update(token).digest();
const PLAYER = 'p.id, p.name, p.last_map_id, p.auth_user_id, p.name_changed_at, p.click_power, p.defense, p.earnings, p.growth, p.squares, p.tutorial';

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
    pool.query('SELECT s.player_id, p.name, s.color, s.skin_id, s.coverage, s.unlocked, s.wipe_floor, p.click_power, p.defense, p.earnings, p.growth FROM player_map_settings s JOIN players p ON p.id = s.player_id WHERE s.map_id = $1', [mapId]),
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
// Growth: a random spot from map_edges (each equally likely) becomes a block, and its empty neighbours become
// edge spots. growMap holds the map's lock, so two growths never pick the same spot.
const GROW = `
  WITH spot AS (
    DELETE FROM map_edges WHERE (map_id, x, y) =
      (SELECT map_id, x, y FROM map_edges WHERE map_id = $1 ORDER BY random() LIMIT 1)
    RETURNING x, y
  ), cell AS (
    INSERT INTO map_cells (map_id, x, y) SELECT $1, x, y FROM spot RETURNING x, y
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

async function growMap(client, mapId) {
  await client.query('SELECT 1 FROM maps WHERE id = $1 FOR UPDATE', [mapId]);   // one growth at a time per map
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
//   color:    stored if this is the player's first claim on this map (or since a wipe); null if their choices are locked
//   earn:     squares for a first claim (rules.squaresForFirstClaim with the player's upgrades; may be a fraction)
//   coverage, skin: stored with the color; locked with it until the player wipes this map
//   stats:    the claimer's stats after this claim (stats.afterClaim); `from` loses a block
// Returns { conflict: true } if the block changed hands first, otherwise
//   { playerId, name, joinedMap, grown: [{x, y}, …] (empty unless a first claim), squares: new exact balance | null }.
//   grow:     blocks a first claim adds to the map (rules.growthBlocks: 1, or more with the Growth upgrade)
async function claimBlock(pool, { mapId, x, y, from, playerId, newGuest, color, coverage = 'tile', skin = 'default', grow = 1, earn = rules.squaresForFirstClaim(),
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
        for (let i = 0; i < grow; i++) { const g = await growMap(c, mapId); if (g) grown.push(g); }
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
      'UPDATE map_cells SET owner_id = NULL, claimed_at = NULL WHERE map_id = $1 AND owner_id = $2 RETURNING x, y', [mapId, playerId]);
    if (!rows.length) return null;
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
async function earnAchievements(pool, playerId, mapId, ids) {
  const { rows } = await pool.query(
    `INSERT INTO player_achievements (player_id, achievement_id, map_id) SELECT $1, unnest($2::text[]), $3
     ON CONFLICT DO NOTHING RETURNING achievement_id`, [playerId, ids, mapId]);
  return rows.map(r => r.achievement_id);
}

Object.assign(module.exports, { earnedAchievements, earnAchievements });

// The maps players can go to (official ones; purchased and VIP maps come later), oldest first.
async function listMaps(pool) {
  const { rows } = await pool.query("SELECT id, name, style FROM maps WHERE type = 'official' ORDER BY id");
  return rows;
}

// Makes a new official map: a width-by-height rectangle of empty blocks. Admin script only (scripts/create-map.js).
const STYLES = ['grass', 'white'];
async function createMap(pool, { name, style, width, height }) {
  if (!name || typeof name !== 'string') throw new Error('a map needs a name');
  if (!STYLES.includes(style)) throw new Error(`style must be one of: ${STYLES.join(', ')}`);
  for (const n of [width, height]) if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('width and height must be 1-1000');
  return tx(pool, async c => {
    const { rows: [m] } = await c.query("INSERT INTO maps (name, style, type) VALUES ($1, $2, 'official') RETURNING id", [name, style]);
    await c.query(`INSERT INTO map_cells (map_id, x, y)
      SELECT $1, x, y FROM generate_series(0, $2 - 1) AS x, generate_series(0, $3 - 1) AS y`, [m.id, width, height]);
    await rebuildEdges(c, m.id);
    return m.id;
  });
}

Object.assign(module.exports, { STYLES, listMaps, createMap });

// The skin catalog, with whether this player owns each (free skins count as owned by everyone).
async function skinsFor(pool, playerId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.is_free OR ps.skin_id IS NOT NULL AS owned FROM skins s
     LEFT JOIN player_skins ps ON ps.skin_id = s.id AND ps.player_id = $1 ORDER BY s.is_free DESC, s.id`, [playerId]);
  return rows;
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

// Brings players' stored upgrade levels in line with `upgrades` (rules.UPGRADES, from data/economy.json).
// Stored levels refer to the tables last applied; if those differ, each stored level moves to the lowest new
// level at least as strong (economy.remapLevel), every move is recorded in level_remaps, and the new tables are
// recorded. Run at startup, before players connect. Returns [{ upgrade, from, to, players }] for the log.
const UPGRADE_COLUMNS = { clickPower: 'click_power', defense: 'defense', earnings: 'earnings', growth: 'growth' };
function applyEconomy(pool, upgrades) {
  const { remapLevel } = require('./economy');
  return tx(pool, async c => {
    await c.query('INSERT INTO economy_applied (upgrades) VALUES ($1) ON CONFLICT DO NOTHING', [JSON.stringify(upgrades)]);
    const { rows: [applied] } = await c.query('SELECT upgrades FROM economy_applied FOR UPDATE');
    const moves = [];
    for (const [upgrade, column] of Object.entries(UPGRADE_COLUMNS)) {
      const before = applied.upgrades[upgrade] ?? [{ level: 0, value: 1, cost: 0 }], after = upgrades[upgrade];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const { rows } = await c.query(`SELECT DISTINCT ${column} AS level FROM players WHERE ${column} > 0`);
      const map = rows.map(r => [r.level, remapLevel(before, after, r.level)]).filter(([a, b]) => a !== b);
      if (!map.length) continue;
      // One statement, so a player moved from 1 to 3 is never moved again by a 3 -> 5 step.
      const { rows: moved } = await c.query(
        `WITH m (old_level, new_level) AS (SELECT * FROM unnest($1::int[], $2::int[])),
              u AS (UPDATE players p SET ${column} = m.new_level FROM m WHERE p.${column} = m.old_level
                    RETURNING p.id, m.old_level, m.new_level)
         INSERT INTO level_remaps (player_id, upgrade, old_level, new_level) SELECT id, $3, old_level, new_level FROM u
         RETURNING old_level, new_level`,
        [map.map(m => m[0]), map.map(m => m[1]), upgrade]);
      for (const [from, to] of map) {
        const players = moved.filter(r => r.old_level === from).length;
        if (players) moves.push({ upgrade, from, to, players });
      }
    }
    await c.query('UPDATE economy_applied SET upgrades = $1, applied_at = now()', [JSON.stringify(upgrades)]);
    return moves;
  });
}

Object.assign(module.exports, { skinsFor, achievementProgress, saveTutorial, applyEconomy });
