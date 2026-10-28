// Every game number and rule in one place. Change a number here and restart the server.
// The functions below are pure: they take plain data and return answers, with no database or sockets, so they
// can be tested in memory. The database (store.js) repeats the money rules in SQL so they hold under races;
// tests check both agree.

const settings = {
  // Claiming
  HITS_TO_CLAIM: 3,               // taps needed to take a block, before upgrades
  CRACK_DECAY_SECONDS: 60,        // a cracked block loses one crack level for every this many seconds without a hit

  // Squares (the currency)
  SQUARES_PER_FIRST_CLAIM: 1,     // squares for claiming an empty block, before upgrades (and only beyond the wipe floor)

  // Players
  GUESTS_PER_IP: 5,               // new guest players one network may create…
  GUEST_WINDOW_MINUTES: 60,       // …in this many minutes
  RENAME_COOLDOWN_MINUTES: 10,    // wait between name changes

  // Upgrades. Each player has a level for each (0 = none). These tables give the effect at each level,
  // starting at level 0; a level past the end of a table uses its last entry. Defaults have no effect.
  CLICK_POWER_HITS_REMOVED: [0],  // Click Power: hits taken off what the attacker needs
  DEFENSE_MULTIPLIER: [1],        // Defense: multiplies the hits others need to take your blocks
  EARNINGS_MULTIPLIER: [1],       // Earnings: multiplies squares per first claim
  MIN_HITS: 1,                    // no block ever takes fewer hits than this

  // Per-map look, chosen on the first claim on a map and locked forever
  COVERAGES: ['tile', 'stretch'], // how a skin covers a territory (the first is the default)
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

// Hits needed for `attacker` to take a block owned by `owner` (null for an empty block); both are upgrade
// levels like NO_UPGRADES. The attacker's Click Power comes off first, then the owner's Defense multiplies
// what is left, rounded up, and the result is at least MIN_HITS.
function hitsToTake(attacker, owner) {
  const base = settings.HITS_TO_CLAIM - effect(settings.CLICK_POWER_HITS_REMOVED, attacker?.clickPower);
  const defended = owner ? base * effect(settings.DEFENSE_MULTIPLIER, owner.defense) : base;
  return Math.max(settings.MIN_HITS, Math.ceil(defended - 1e-9));
}

// Squares a player with these upgrade levels earns for one first claim, if the wipe rule allows it
// (earnsSquares). Rounded down.
const squaresForFirstClaim = upgrades =>
  Math.floor(settings.SQUARES_PER_FIRST_CLAIM * effect(settings.EARNINGS_MULTIPLIER, upgrades?.earnings) + 1e-9);

// Crack fading. `crack` is { n: level, at: when the level last changed (ms) }. Returns the crack `now`:
// one level lower per `decayMs` passed, never below 0, with `at` moved on by the whole periods used.
function decayCrack(crack, now, decayMs) {
  const lost = Math.max(0, Math.floor((now - crack.at) / decayMs));
  return { n: Math.max(0, crack.n - lost), at: crack.at + lost * decayMs, lost };
}

// The wipe rule (anti-farm): a first claim earns squares only if the player now owns more blocks on this map
// than they did at any wipe there. `wipeFloor` is that highest count (0 if they never wiped).
const earnsSquares = (ownedAfterClaim, wipeFloor) => ownedAfterClaim > wipeFloor;
const wipeFloorAfterWipe = (wipeFloor, ownedAtWipe) => Math.max(wipeFloor, ownedAtWipe);

// The rules read the numbers from this same object, so tests can try other dial values.
module.exports = Object.assign(settings, { key, NEIGHBORS, NO_UPGRADES, hitError, hitsToTake, squaresForFirstClaim,
  decayCrack, earnsSquares, wipeFloorAfterWipe });
