// Every game rule in one place. The numbers come from Xoren's Google Sheet through data/economy.json
// (npm run sync-rules); only true code constants are written here. Restart the server to pick up a new file.
// The functions below are pure: they take plain data and return answers, with no database or sockets, so they
// can be tested in memory. The database (store.js) repeats the money rules in SQL so they hold under races;
// tests check both agree.

const economy = require('../data/economy.json');
const catalog = require('./catalog');
const upgrades = require('./upgrades');
const R = economy.rules;
const settings = {
  // Claiming
  HITS_PER_BLOCK: R.hitsPerBlock,               // hits needed to take any block, empty or owned, before upgrades
  CRACK_DECAY_SECONDS: R.crackFadeSeconds,      // crack progress fades by CRACK_DECAY_HITS for every this many seconds…
  CRACK_DECAY_HITS: R.crackFadeHits,            // …since the block was last hit

  // Squares (the currency) are kept in whole tenths (catalog.js); pay for a first claim is catalog.payTenths.

  // Players
  GUESTS_PER_IP: R.guestsPerIp,                 // new guest players one network may create…
  GUEST_WINDOW_MINUTES: R.guestWindowMinutes,   // …in this many minutes
  RENAME_COOLDOWN_MINUTES: R.renameWaitMinutes, // wait between name changes
  MAX_TAPS_PER_SECOND: R.maxTapsPerSecond,      // anti-bot: taps per player per second beyond this are ignored
  NAME_MAX_LENGTH: R.nameMaxLength,             // longest name (the database allows at most 15)

  // Name labels: an owner's name shows on their territory once it covers this share of the screen.
  NAME_LABEL_SHARE: R.nameLabelShare,

  // New maps made with npm run create-map, unless given a size
  NEW_MAP_WIDTH: R.newMapWidth,
  NEW_MAP_HEIGHT: R.newMapHeight,
  NEW_MAP_BLOCKS: catalog.E.defaultBaseBlocks,  // E for a new map made without --base (the Economy tab)
  // Terrain (public/terrain.js): the world's shares, and hits per terrain as a multiple of the normal number.
  TERRAIN: { scale: R.terrainScale, water: R.waterShare, sand: R.sandShare, forest: R.forestShare, stone: R.stoneShare, gold: R.goldShare },
  TERRAIN_HITS: { grass: 1, sand: R.sandHits, forest: R.forestHits, stone: R.stoneHits, gold: R.goldHits },
  GOLD_BONUS_SQUARES: R.goldBonusSquares,

  // Sound (sent to the browser): most at once, how far others are heard, their volume, defaults for a new device
  SOUND: { maxAtOnce: R.soundMaxAtOnce, hearing: R.soundHearingDistance, othersVolume: R.soundOthersVolume,
    effectsVolume: R.defaultEffectsVolume, musicVolume: R.defaultMusicVolume },

  // Achievements (the sheet's Achievements tab): [{ id, name, category, stat, threshold, secret, description, reward }]
  // Items (the sheet's Items tab): [{ id, name, description, price, uses, perMinutes, effect, value, seconds, enabled }]
  // Rank and reign achievements count only on maps where at least this many players own blocks.
  RANK_MIN_PLAYERS: R.rankMinPlayers,
  RANK_MIN_BLOCKS: R.rankMinBlocks,
  MAILING_ADDRESS: R.mailingAddress ?? '',   // the email footer; blank = no email is sent (email.js)   // …and only for a player with at least this many blocks there

  // Per-map look, chosen on the first claim on a map and locked until a wipe (code constants, not numbers)
  COVERAGES: ['tile', 'stretch'], // how a skin covers a territory: per block, or one image over the full area (the first is the default)
  COLORS: [                       // the free colors a player picks from on a map (from the approved menu design)
    { hex: '#29adff', name: 'Blue' }, { hex: '#ff77a8', name: 'Pink' }, { hex: '#ffa300', name: 'Orange' },
    { hex: '#ffec27', name: 'Yellow' }, { hex: '#00e4a0', name: 'Teal' }, { hex: '#c29bff', name: 'Purple' },
    { hex: '#ff4d4d', name: 'Red' }, { hex: '#f2f4f8', name: 'White' },
  ],
};

const key = (x, y) => x + ',' + y;
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Whether player `pid` may hit (x, y). Returns an error message, or null if allowed.
//   map: { cells: Map "x,y" -> owner id or null, counts: Map owner id -> blocks owned }
//   pid: the player, or null for a visitor who has no player yet
// Rules: the block must exist and not be yours; your first block must be empty; after that, blocks must touch
// your territory (up, down, left or right). Other players' blocks may be retaken.
function hitError(map, pid, x, y) {
  const k = key(x, y);
  if (!map.cells.has(k)) return 'Invalid block';
  if (map.terrainAt?.(x, y) === 'water') return "Water can't be claimed";
  const owner = map.cells.get(k);
  if (pid && owner === pid) return 'You already own this block';
  if (!pid || !map.counts.get(pid)) return owner ? 'Your first block must be unclaimed' : null;
  const adj = adjacentSides(map, pid, x, y);
  if (!adj.length) return 'You can only take blocks next to your territory';
  return null;   // plug-ins may refuse more (a wall in the way: app.js asks them)
}

// Whether blocks ([[x, y], …]) are all connected side to side (a land listing must be one piece).
function connected(blocks) {
  if (!blocks.length) return false;
  const left = new Set(blocks.map(([x, y]) => key(x, y))), queue = [blocks[0]];
  left.delete(key(...blocks[0]));
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of NEIGHBORS) if (left.delete(key(x + dx, y + dy))) queue.push([x + dx, y + dy]);
  }
  return left.size === 0;
}

// ---------- Sides (the geometry; walls are a plug-in since loop 19) ----------
// A block's sides: n (up), e, s, w.
const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
// The sides of (x, y) that touch `pid`'s land ('n': the block above is theirs).
const adjacentSides = (map, pid, x, y) => Object.keys(SIDES).filter(s => map.cells.get(key(x + SIDES[s][0], y + SIDES[s][1])) === pid);

// A fixed, seeded number for (seed, x, y) (loop 16): growth's rolls, and factories' ties, come out the same every time.
function tieRank(seed, x, y) {
  let h = Math.imul(String(seed).split('').reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261), 1) >>> 0;
  h = Math.imul(h ^ (x * 73856093), 2654435761) >>> 0;
  h = Math.imul(h ^ (y * 19349663), 2246822519) >>> 0;
  return h;
}

// A player's upgrades as they work on a block: { clickPower, defense, earnings, growth, … } values
// (upgrades.effectiveValues: capped at the end of the block's level's tier). Visitors and new players have no steps:
// NO_UPGRADES, and any value missing counts as the tier 1 start.
const NO_UPGRADES = Object.freeze({});
const value = (eff, name) => upgrades.value(eff, name);   // a variable's value, or its base before any step

// A block's hardness H: hits to mine it = hitsPerBlock x 2^(birth level - 1) x its terrain factor
// (settings.TERRAIN_HITS; grass, or no terrain, is 1). A block keeps the level it was born at.
const hardness = (terrain = 'grass', birth = 1) => catalog.hardness(settings.HITS_PER_BLOCK, birth, settings.TERRAIN_HITS[terrain] ?? 1);
// Hits needed to take a block owned by `owner` (their upgrade values on this map; null for an empty block):
// its hardness, times the owner's Defense.
const hitsNeeded = (owner, terrain = 'grass', birth = 1) => hardness(terrain, birth) * (owner ? value(owner, 'defense') : 1);

// How many hits one click by `attacker` counts as: their Click Power. Progress is kept as a fraction.
const hitPower = attacker => value(attacker, 'clickPower');

// Map blocks a brand-new claim by a player with these upgrade values creates: their Growth, whole part, plus one
// more with the fractional part as its chance (1.4: 1 block, and a 40% chance of a second). `roll` (0-1) decides;
// the game passes a seeded one so the same map and claims grow the same way.
const growthBlocks = (upgrades, roll = Math.random()) => {
  const v = value(upgrades, 'growth');
  return Math.floor(v + 1e-9) + (roll < v - Math.floor(v + 1e-9) ? 1 : 0);
};

// Whether `progress` hits are enough to take a block needing `needed` (allowing for rounding, so 10 x 0.1 is 1).
const isTaken = (progress, needed) => progress >= needed - 1e-9;

// Tenths a player with these upgrade values earns for the first claim of a block (its terrain and birth level), if
// the wipe rule allows it (earnsSquares): H x 10 / hitsPerSquare x Earnings, rounded down, plus the gold bonus.
// Pay tracks hits exactly, so income doesn't depend on level or terrain, only on upgrades.
const firstClaimTenths = (upgrades, terrain = 'grass', birth = 1) => catalog.payTenths(hardness(terrain, birth),
  value(upgrades, 'earnings'), terrain === 'gold' ? settings.GOLD_BONUS_SQUARES : 0);

// The balance players see, from a balance in tenths: whole squares only, rounded down.
const shownSquares = balance => catalog.wholeSquares(balance);

// Crack fading. `crack` is { n: hits so far (may be a fraction), at: when it last changed (ms) }. Returns the
// crack `now`: CRACK_DECAY_HITS fewer per `decayMs` passed, never below 0, with `at` moved on by the whole
// periods used.
function decayCrack(crack, now, decayMs) {
  const lost = Math.max(0, Math.floor((now - crack.at) / decayMs));
  return { n: Math.max(0, crack.n - lost * settings.CRACK_DECAY_HITS), at: crack.at + lost * decayMs, lost };
}

// The tap-rate limit (anti-bot), as a token bucket: a player may tap `rate` times a second on average, in short
// bursts of up to `rate` taps. bucket is { tokens, at } (or null for a player's first tap). Returns
// { allowed, bucket } with the bucket to keep.
function tapAllowed(bucket, now, rate) {
  const b = bucket ?? { tokens: rate, at: now };
  const tokens = Math.min(rate, b.tokens + Math.max(0, now - b.at) / 1000 * rate);
  return tokens >= 1 ? { allowed: true, bucket: { tokens: tokens - 1, at: now } } : { allowed: false, bucket: { tokens, at: now } };
}

// The wipe rule (anti-farm): a first claim earns squares only if the player now owns more blocks on this map
// than they did at any wipe there. `wipeFloor` is that highest count (0 if they never wiped).
const earnsSquares = (ownedAfterClaim, wipeFloor) => ownedAfterClaim > wipeFloor;
const wipeFloorAfterWipe = (wipeFloor, ownedAtWipe) => Math.max(wipeFloor, ownedAtWipe);

// The rules read the numbers from this same object, so tests can try other dial values.
module.exports = Object.assign(settings, { key, NEIGHBORS, NO_UPGRADES, hitError, connected, tieRank, SIDES, OPPOSITE, adjacentSides, hardness, hitsNeeded, hitPower, growthBlocks, isTaken,
  firstClaimTenths, shownSquares, decayCrack, tapAllowed, earnsSquares, wipeFloorAfterWipe });
