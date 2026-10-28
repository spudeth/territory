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

// Hits needed for `attacker` to take a block owned by `owner` (null for an empty block).
const hitsToTake = (attacker, owner) => settings.HITS_TO_CLAIM;

// Squares `playerId` earns for one first claim, if the wipe rule allows it (earnsSquares).
const squaresForFirstClaim = playerId => settings.SQUARES_PER_FIRST_CLAIM;

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

module.exports = { ...settings, key, NEIGHBORS, hitError, hitsToTake, squaresForFirstClaim, decayCrack,
  earnsSquares, wipeFloorAfterWipe };
