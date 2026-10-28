// Every game number and rule in one place. Change a number here and restart the server.
// The functions below are pure: they take plain data and return answers, with no database or sockets, so they
// can be tested in memory. The database (store.js) repeats the money rules in SQL so they hold under races;
// tests check both agree.

const settings = {
  // Claiming
  HITS_PER_BLOCK: 10,             // hits needed to take any block, empty or owned, before upgrades
  CRACK_DECAY_SECONDS: 60,        // crack progress fades by CRACK_DECAY_HITS for every this many seconds…
  CRACK_DECAY_HITS: 1,            // …since the block was last hit

  // Squares (the currency)
  SQUARES_PER_FIRST_CLAIM: 1,     // squares for claiming an empty block, before upgrades (and only beyond the wipe floor)
  SQUARE_DECIMALS: 6,             // balances keep fractions to this many places (the database column matches); players see whole squares

  // Players
  GUESTS_PER_IP: 5,               // new guest players one network may create…
  GUEST_WINDOW_MINUTES: 60,       // …in this many minutes
  RENAME_COOLDOWN_MINUTES: 10,    // wait between name changes

  // Upgrades. Each player has a level for each (0 = none). These tables give the effect at each level,
  // starting at level 0; a level past the end of a table uses its last entry. Defaults have no effect.
  CLICK_POWER_MULTIPLIER: [1],    // Click Power: how many hits one click counts as (1.2 = +20%)
  DEFENSE_MULTIPLIER: [1],        // Defense: multiplies the hits others need to take your blocks
  EARNINGS_MULTIPLIER: [1],       // Earnings: multiplies squares per first claim, fractions kept

  // Name labels: an owner's name shows on their territory once it covers this share of the screen.
  // Set in public/labels.js, which the browser loads too.
  NAME_LABEL_SHARE: require('./public/labels').NAME_LABEL_SHARE,

  // Per-map look, chosen on the first claim on a map and locked forever
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
  const owner = map.cells.get(k);
  if (pid && owner === pid) return 'You already own this block';
  if (!pid || !map.counts.get(pid)) return owner ? 'Your first block must be unclaimed' : null;
  const near = NEIGHBORS.some(([dx, dy]) => map.cells.get(key(x + dx, y + dy)) === pid);
  return near ? null : 'You can only take blocks next to your territory';
}

// A player's upgrade levels. Visitors and new players have none.
const NO_UPGRADES = Object.freeze({ clickPower: 0, defense: 0, earnings: 0 });
const effect = (table, level) => table[Math.min(Math.max(0, level | 0), table.length - 1)];

// Hits needed to take a block owned by `owner` (upgrade levels like NO_UPGRADES; null for an empty block):
// HITS_PER_BLOCK, times the owner's Defense.
const hitsNeeded = owner => settings.HITS_PER_BLOCK * (owner ? effect(settings.DEFENSE_MULTIPLIER, owner.defense) : 1);

// How many hits one click by `attacker` counts as: their Click Power. Progress is kept as a fraction.
const hitPower = attacker => effect(settings.CLICK_POWER_MULTIPLIER, attacker?.clickPower);

// Whether `progress` hits are enough to take a block needing `needed` (allowing for rounding, so 10 x 0.1 is 1).
const isTaken = (progress, needed) => progress >= needed - 1e-9;

// Squares a player with these upgrade levels earns for one first claim, if the wipe rule allows it
// (earnsSquares). Fractions are kept, to SQUARE_DECIMALS places.
const roundSquares = n => Math.round(n * 10 ** settings.SQUARE_DECIMALS) / 10 ** settings.SQUARE_DECIMALS;
const squaresForFirstClaim = upgrades =>
  roundSquares(settings.SQUARES_PER_FIRST_CLAIM * effect(settings.EARNINGS_MULTIPLIER, upgrades?.earnings));

// The balance players see: whole squares only, rounded down.
const shownSquares = balance => Math.floor(Number(balance) + 1e-9);

// Crack fading. `crack` is { n: hits so far (may be a fraction), at: when it last changed (ms) }. Returns the
// crack `now`: CRACK_DECAY_HITS fewer per `decayMs` passed, never below 0, with `at` moved on by the whole
// periods used.
function decayCrack(crack, now, decayMs) {
  const lost = Math.max(0, Math.floor((now - crack.at) / decayMs));
  return { n: Math.max(0, crack.n - lost * settings.CRACK_DECAY_HITS), at: crack.at + lost * decayMs, lost };
}

// The wipe rule (anti-farm): a first claim earns squares only if the player now owns more blocks on this map
// than they did at any wipe there. `wipeFloor` is that highest count (0 if they never wiped).
const earnsSquares = (ownedAfterClaim, wipeFloor) => ownedAfterClaim > wipeFloor;
const wipeFloorAfterWipe = (wipeFloor, ownedAtWipe) => Math.max(wipeFloor, ownedAtWipe);

// The rules read the numbers from this same object, so tests can try other dial values.
module.exports = Object.assign(settings, { key, NEIGHBORS, NO_UPGRADES, hitError, hitsNeeded, hitPower, isTaken,
  squaresForFirstClaim, shownSquares, decayCrack, earnsSquares, wipeFloorAfterWipe });
