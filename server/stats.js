// Player stats on one map: pure functions, no database or sockets.
// A player's stats record:
//   ownedMax     most blocks owned at once           firstClaims  empty blocks claimed
//   retakes      blocks taken from other players     blocksLost   blocks other players took from them
//   bestSquare   side of the largest solid square ever owned (a 3 means 3x3)
//   bestLine     longest straight row or column ever owned
// Squares and lines are records: losing blocks later never lowers them.

const NAMES = ['ownedMax', 'firstClaims', 'retakes', 'blocksLost', 'bestSquare', 'bestLine'];
const empty = () => Object.fromEntries(NAMES.map(n => [n, 0]));

// Longest straight line of `owns` blocks through (x, y), across or down. owns(x, y) -> boolean.
function lineThrough(owns, x, y) {
  const run = (dx, dy) => { let n = 0; while (owns(x + dx * (n + 1), y + dy * (n + 1))) n++; return n; };
  return 1 + Math.max(run(-1, 0) + run(1, 0), run(0, -1) + run(0, 1));
}

// Whether some s-by-s square of `owns` blocks contains (x, y). Looks only at the (2s-1)-wide window around
// it: dp[j][i] is the side of the largest square whose bottom-right corner is that block.
function hasSquareThrough(owns, x, y, s) {
  const w = 2 * s - 1, x0 = x - s + 1, y0 = y - s + 1;
  let prev = new Array(w).fill(0);
  for (let j = 0; j < w; j++) {
    const row = new Array(w).fill(0);
    for (let i = 0; i < w; i++) {
      if (!owns(x0 + i, y0 + j)) continue;
      row[i] = 1 + Math.min(i ? row[i - 1] : 0, prev[i], i ? prev[i - 1] : 0);
      // A square of side s ending here contains (x, y) when this corner is at or past it, within s - 1.
      if (row[i] >= s && i >= s - 1 && j >= s - 1) return true;
    }
    prev = row;
  }
  return false;
}

// Side of the largest solid square containing (x, y), checking only sides above `known` (so a claim costs
// little when it doesn't beat the record). Returns at least `known`.
function squareThrough(owns, x, y, known = 0) {
  let s = known;
  while (hasSquareThrough(owns, x, y, s + 1)) s++;
  return s;
}

// The stats after `pid` claims (x, y). `owns` must already include the new block; `owned` is their block
// count after it; `from` is the previous owner (null if it was empty). Returns { stats, changed: [names] }.
function afterClaim(prev, { owns, x, y, owned, from }) {
  const next = { ...prev };
  next.ownedMax = Math.max(prev.ownedMax, owned);
  if (from === null) next.firstClaims++; else next.retakes++;
  next.bestLine = Math.max(prev.bestLine, lineThrough(owns, x, y));
  next.bestSquare = squareThrough(owns, x, y, prev.bestSquare);
  return { stats: next, changed: NAMES.filter(n => next[n] !== prev[n]) };
}

// Largest square and longest line for every owner on a whole map, in one pass each.
//   cells: Map "x,y" -> owner id or null. Returns Map owner -> { bestSquare, bestLine }.
function bestOnMap(cells) {
  const best = new Map(), at = (x, y) => cells.get(x + ',' + y) ?? null;
  const bump = (pid, field, v) => {
    const b = best.get(pid) ?? best.set(pid, { bestSquare: 0, bestLine: 0 }).get(pid);
    if (v > b[field]) b[field] = v;
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of cells.keys()) {
    const [x, y] = k.split(',').map(Number);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (minX === Infinity) return best;
  const w = maxX - minX + 1;
  let prevSq = new Int32Array(w), up = new Int32Array(w);
  for (let y = minY; y <= maxY; y++) {
    const sq = new Int32Array(w), nextUp = new Int32Array(w);
    let left = 0;
    for (let i = 0; i < w; i++) {
      const x = minX + i, pid = at(x, y);
      if (!pid) { left = 0; continue; }
      left = i && at(x - 1, y) === pid ? left + 1 : 1;
      nextUp[i] = at(x, y - 1) === pid ? up[i] + 1 : 1;
      const sameUL = i && at(x - 1, y) === pid && at(x, y - 1) === pid && at(x - 1, y - 1) === pid;
      sq[i] = sameUL ? 1 + Math.min(sq[i - 1], prevSq[i], prevSq[i - 1]) : 1;
      bump(pid, 'bestLine', Math.max(left, nextUp[i]));
      bump(pid, 'bestSquare', sq[i]);
    }
    prevSq = sq; up = nextUp;
  }
  return best;
}

module.exports = { NAMES, empty, lineThrough, squareThrough, afterClaim, bestOnMap };
