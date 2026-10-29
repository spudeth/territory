// Every database read and write the game makes. Ids come back from Postgres as strings.
const crypto = require('crypto');
const { tx } = require('./db');
const rules = require('./rules');
const terrain = require('./public/terrain');
const skinPrices = require('./public/skins');
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
  const { rows: [map] } = await pool.query('SELECT id, name, style, seed FROM maps WHERE id = $1', [mapId]);
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

// A seeded map's n-th growth takes the spot terrain.growthPick chooses from its open spots, sorted, so the
// same seed and the same claims always grow the same map.
const GROW_AT = GROW.replace(
  '(SELECT map_id, x, y FROM map_edges WHERE map_id = $1 ORDER BY random() LIMIT 1)', '($1::bigint, $2::integer, $3::integer)');

async function growMap(client, mapId) {
  // One growth at a time per map.
  const { rows: [m] } = await client.query('SELECT seed, grown FROM maps WHERE id = $1 FOR UPDATE', [mapId]);
  let grown;
  if (m.seed === null) grown = (await client.query(GROW, [mapId])).rows[0];
  else {
    const { rows: spots } = await client.query('SELECT x, y FROM map_edges WHERE map_id = $1 ORDER BY x, y', [mapId]);
    const spot = spots[terrain.growthPick(m.seed, m.grown, spots.length)];
    grown = spot && (await client.query(GROW_AT, [mapId, spot.x, spot.y])).rows[0];
    await client.query('UPDATE maps SET grown = grown + 1 WHERE id = $1', [mapId]);
  }
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
      const pay = Number(rewards[id]) || 0;
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
// 013_seeds.sql); its starting shape is the seed's island of `blocks` blocks (rules.NEW_MAP_BLOCKS), or a
// width-by-height rectangle when those are given. seed '' means a random one. A rectangle without a seed is
// all grass and grows at random, like the maps from before seeds (tests use these).
async function createMap(pool, { name, style = 'grass', seed, blocks = rules.NEW_MAP_BLOCKS, width = null, height = null }) {
  if (!name || typeof name !== 'string') throw new Error('a map needs a name');
  if (!STYLES.includes(style)) throw new Error(`style must be one of: ${STYLES.join(', ')}`);
  const rectangle = width !== null || height !== null;
  if (seed === undefined || seed === null) seed = rectangle ? null : '';
  if (style === 'white') seed = null;   // a white plain: no terrain, ever
  if (seed !== null) seed = String(seed).trim() || randomSeed();
  if (seed?.length > 100) throw new Error('the seed must be at most 100 characters');
  if (rectangle) {
    for (const n of [width, height]) if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error('width and height must be 1-1000');
  } else if (!Number.isInteger(blocks) || blocks < 1 || blocks > 1000000) throw new Error('blocks must be 1-1000000');
  return tx(pool, async c => {
    const { rows: [m] } = await c.query("INSERT INTO maps (name, style, type, seed) VALUES ($1, $2, 'official', $3) RETURNING id", [name, style, seed]);
    await fillShape(c, m.id, seed, rectangle ? { width, height } : { blocks });
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
// Prices are what this player would pay now (skins.skinPrice: they rise with how many of a rarity they own).
async function skinsFor(pool, playerId) {
  const owned = new Set(playerId ? (await pool.query('SELECT skin_id FROM player_skins WHERE player_id = $1', [playerId])).rows.map(r => r.skin_id) : []);
  const count = rarity => { const ids = rules.SKINS.filter(s => s.rarity === rarity); return [ids.filter(s => owned.has(s.id)).length, ids.length]; };
  return [{ id: 'default', name: 'Default', kind: 'default', rarity: 'Common', price: 0, collection: 'Basic', owned: true },
    ...rules.SKINS.filter(s => s.enabled || owned.has(s.id)).map(({ enabled, ...s }) => ({ ...s, price: skinPrices.skinPrice(s.rarity, ...count(s.rarity)), owned: owned.has(s.id) }))];
}

// Buys a skin with squares, in one transaction: the player row is locked, so a double tap or two devices can
// never pay twice. skin: a catalog entry { id, name, price }. Returns { squares } (the new exact balance), or
// { error } with `need` (squares short) when there aren't enough.
function buySkin(pool, playerId, skin) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (!p) return { error: 'Claim a block first' };
    if ((await c.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [playerId, skin.id])).rowCount) return { error: 'You already own this skin' };
    // The price now: it rises with how many skins of this rarity they own (counted inside the lock).
    const same = rules.SKINS.filter(s => s.rarity === skin.rarity).map(s => s.id);
    const { rows: [o] } = await c.query('SELECT count(*)::int AS n FROM player_skins WHERE player_id = $1 AND skin_id = ANY($2)', [playerId, same]);
    const price = skinPrices.skinPrice(skin.rarity, o.n, same.length);
    const balance = Number(p.squares);
    if (balance < price - 1e-9) return { error: 'Not enough squares', need: rules.roundSquares(price - balance) };
    await c.query(`INSERT INTO skins (id, name, image, price_squares) VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_squares = EXCLUDED.price_squares`, [skin.id, skin.name, skin.id + '.png', price]);
    const { rows: [after] } = await c.query('UPDATE players SET squares = squares - $2 WHERE id = $1 RETURNING squares', [playerId, price]);
    await c.query("INSERT INTO player_skins (player_id, skin_id, source) VALUES ($1, $2, 'squares')", [playerId, skin.id]);
    await c.query('INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)',
      [playerId, -price, after.squares, 'skin:' + skin.id]);
    return { squares: Number(after.squares), price };
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

// Buys the next level of one upgrade with squares, in one transaction: the player's row is locked, so two
// purchases at the same moment (two taps, two tabs) take turns and can never spend the same squares twice.
//   levels: the upgrade's table (rules.UPGRADES[upgrade]); expected: the level the player saw when tapping,
//   so a repeated tap for a level already bought is refused instead of buying the next one too.
// Returns { level, squares } (the new level and exact balance) or { error, need? } (need: squares short).
async function buyUpgrade(pool, playerId, upgrade, expected, levels) {
  const column = UPGRADE_COLUMNS[upgrade];
  if (!column) return { error: 'Unknown upgrade' };
  return tx(pool, async c => {
    const { rows: [p] } = await c.query(`SELECT squares, ${column} AS level FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    if (!p) return { error: 'No such player' };
    if (p.level !== expected) return { error: 'Already bought', level: p.level, squares: Number(p.squares) };
    const next = levels[p.level + 1];
    if (!next) return { error: 'This upgrade is at its maximum' };
    // Compared in the database, so fractions are exact.
    const { rows: [paid] } = await c.query(
      `UPDATE players SET squares = squares - $2, ${column} = ${column} + 1 WHERE id = $1 AND squares >= $2 RETURNING squares`,
      [playerId, next.cost]);
    if (!paid) return { error: 'Not enough squares', need: Number(next.cost) - Number(p.squares) };
    await c.query(`INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, $3, $4)`,
      [playerId, -next.cost, paid.squares, `upgrade:${upgrade}:${next.level}`]);
    return { level: next.level, squares: Number(paid.squares) };
  });
}

// Records players who went over the tap-rate limit: [[playerId, taps ignored], …].
async function logTapLimits(pool, entries) {
  await pool.query('INSERT INTO tap_limit_log (player_id, ignored) SELECT * FROM unnest($1::bigint[], $2::int[])',
    [entries.map(e => e[0]), entries.map(e => e[1])]);
}

Object.assign(module.exports, { skinsFor, buySkin, achievementProgress, saveTutorial, applyEconomy, buyUpgrade, logTapLimits });

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
      const { rows: [m] } = await c.query('SELECT seed FROM maps WHERE id = $1', [mapId]);
      await c.query('DELETE FROM map_cells WHERE map_id = $1', [mapId]);
      await c.query('UPDATE maps SET grown = 0 WHERE id = $1', [mapId]);
      await fillShape(c, mapId, m.seed, m.seed ? { blocks: size.blocks ?? rules.NEW_MAP_BLOCKS } : size);
    } else {
      await c.query('UPDATE map_cells SET owner_id = NULL, claimed_at = NULL WHERE map_id = $1 AND owner_id IS NOT NULL', [mapId]);
    }
    await c.query('UPDATE player_map_settings SET wipe_floor = 0, unlocked = true WHERE map_id = $1', [mapId]);
    const { rows: [b] } = await c.query('SELECT count(*)::int AS blocks FROM map_cells WHERE map_id = $1', [mapId]);
    return { ...n, blocks: b.blocks };
  });
}

// Deletes an account for good. Their blocks everywhere go empty; their login, sessions, email codes and
// personal data are erased, in Neon Auth too; their name is freed. The row stays, anonymous, because the
// squares ledger refers to it. Returns { maps: ids of maps where they had blocks, authDeleted }.
function deleteAccount(pool, playerId) {
  return tx(pool, async c => {
    const { rows: [p] } = await c.query('SELECT auth_user_id, squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const { rows: maps } = await c.query('SELECT DISTINCT map_id FROM map_cells WHERE owner_id = $1', [playerId]);
    await c.query('UPDATE map_cells SET owner_id = NULL, claimed_at = NULL WHERE owner_id = $1', [playerId]);
    for (const t of ['player_tokens', 'player_map_settings', 'player_map_stats', 'player_achievements', 'player_skins',
      'level_remaps', 'tap_limit_log', 'bans', 'player_totals']) {
      await c.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
    }
    await c.query('DELETE FROM player_links WHERE account_id = $1 OR guest_id = $1', [playerId]);
    if (Number(p.squares) > 0) {
      await c.query("INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, 0, 'account deleted')",
        [playerId, -Number(p.squares)]);
    }
    await c.query(`UPDATE players SET name = 'deleted' || id, auth_user_id = NULL, name_changed_at = NULL, last_map_id = NULL,
      squares = 0, click_power = 0, defense = 0, earnings = 0, growth = 0, tutorial = '{}', deleted_at = now() WHERE id = $1`, [playerId]);
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
    await c.query('UPDATE map_cells SET owner_id = NULL, claimed_at = NULL WHERE owner_id = $1', [playerId]);
    for (const t of ['player_map_settings', 'player_map_stats', 'player_achievements', 'level_remaps', 'player_totals']) {
      await c.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
    }
    await c.query("DELETE FROM player_skins WHERE player_id = $1 AND source <> 'purchase'", [playerId]);
    if (Number(p.squares) > 0) {
      await c.query("INSERT INTO square_ledger (player_id, delta, balance_after, reason) VALUES ($1, $2, 0, 'progress reset')",
        [playerId, -Number(p.squares)]);
    }
    await c.query('UPDATE players SET squares = 0, click_power = 0, defense = 0, earnings = 0, growth = 0 WHERE id = $1', [playerId]);
    return { maps: maps.map(r => r.map_id) };
  });
}

// Deletes a map for good (admin delete-map): its blocks, edges, and everyone's look, stats and wipes there.
// Squares, the ledger, achievements and accounts stay (their map reference is cleared).
function deleteMap(pool, mapId) {
  return tx(pool, async c => {
    for (const sql of ['UPDATE players SET last_map_id = NULL WHERE last_map_id = $1', 'UPDATE square_ledger SET map_id = NULL WHERE map_id = $1',
      'UPDATE player_achievements SET map_id = NULL WHERE map_id = $1', 'DELETE FROM player_map_settings WHERE map_id = $1',
      'DELETE FROM player_map_stats WHERE map_id = $1', 'DELETE FROM map_wipes WHERE map_id = $1', 'DELETE FROM map_edges WHERE map_id = $1',
      'DELETE FROM map_cells WHERE map_id = $1', 'DELETE FROM maps WHERE id = $1']) await c.query(sql, [mapId]);
  });
}
Object.assign(module.exports, { deleteMap });

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
