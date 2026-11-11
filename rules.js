// Every game rule in one place. The numbers come from Xoren's Google Sheet through data/economy.json
// (npm run sync-rules); only true code constants are written here. Restart the server to pick up a new file.
// The functions below are pure: they take plain data and return answers, with no database or sockets, so they
// can be tested in memory. The database (store.js) repeats the money rules in SQL so they hold under races;
// tests check both agree.

const economy = require('./data/economy.json');
const catalog = require('./catalog');
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
  ACHIEVEMENTS: economy.achievements ?? [],
  // Skins (the sheet's Skins tab): [{ id, name, kind: pattern|art, rarity, price, collection, enabled }]
  SKINS: economy.skins ?? [],
  // Items (the sheet's Items tab): [{ id, name, description, price, uses, perMinutes, effect, value, seconds, enabled }]
  ITEMS: economy.items ?? [],
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
  const near = NEIGHBORS.some(([dx, dy]) => map.cells.get(key(x + dx, y + dy)) === pid);
  return near ? null : 'You can only take blocks next to your territory';
}

// A player's upgrades as they work on a map: { clickPower, defense, earnings, growth, … } values
// (catalog.effectiveValues: each tier capped at the map's level). Visitors and new players are at tier 1:
// NO_UPGRADES, and any value missing counts as tier 1's.
const NO_UPGRADES = Object.freeze({});
const value = (eff, key) => eff?.[key] ?? catalog.tierValue(key, 1);

// A block's hardness H: hits to mine it = hitsPerBlock x 2^(birth level - 1) x its terrain factor
// (settings.TERRAIN_HITS; grass, or no terrain, is 1). A block keeps the level it was born at.
const hardness = (terrain = 'grass', birth = 1) => catalog.hardness(settings.HITS_PER_BLOCK, birth, settings.TERRAIN_HITS[terrain] ?? 1);
// Hits needed to take a block owned by `owner` (their upgrade values on this map; null for an empty block):
// its hardness, times the owner's Defense.
const hitsNeeded = (owner, terrain = 'grass', birth = 1) => hardness(terrain, birth) * (owner ? value(owner, 'defense') : 1);

// How many hits one click by `attacker` counts as: their Click Power. Progress is kept as a fraction.
const hitPower = attacker => value(attacker, 'clickPower');

// Map blocks a brand-new claim by a player with these upgrade values creates: their Growth (1 at tier 1).
const growthBlocks = upgrades => value(upgrades, 'growth');

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
module.exports = Object.assign(settings, { key, NEIGHBORS, NO_UPGRADES, hitError, hardness, hitsNeeded, hitPower, growthBlocks, isTaken,
  firstClaimTenths, shownSquares, decayCrack, tapAllowed, earnsSquares, wipeFloorAfterWipe });
