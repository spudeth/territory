// Seeded worlds. A map's seed (any text) decides everything about it:
//   - the terrain at every coordinate, an endless world of smooth noise (like Minecraft's): water, sand, grass,
//     forest, stone, and rare gold;
//   - its starting shape (startingShape);
//   - where each new block appears when it grows (growthPick).
// The same seed always gives the same answers. Only integer hashing and plain arithmetic are used, so every
// browser and the server agree exactly.
// Works in the browser (as a plain script) and on the server (require).
(function (exports) {
  const TERRAINS = ['grass', 'sand', 'forest', 'stone', 'water', 'gold'];

  // ---------- Hashing ----------
  function hashString(text) {   // FNV-1a
    let h = 2166136261;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // A number in [0, 1) for (seed, a, b, c), the same every time.
  function unit(seed, a, b = 0, c = 0) {
    let h = mix(seed ^ Math.imul(a | 0, 0x27d4eb2d));
    h = mix(h ^ Math.imul(b | 0, 0x165667b1));
    h = mix(h ^ Math.imul(c | 0, 0x2545f491));
    return h / 4294967296;
  }

  // ---------- Noise ----------
  // Value noise: random heights at whole coordinates, blended smoothly in between.
  function noise(seed, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = unit(seed, x0, y0), b = unit(seed, x0 + 1, y0), c = unit(seed, x0, y0 + 1), d = unit(seed, x0 + 1, y0 + 1);
    const top = a + (b - a) * sx, bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  }
  // Four octaves: big shapes with finer detail on top. Result in [0, 1].
  function fbm(seed, x, y) {
    let total = 0, amp = 1, freq = 1, sum = 0;
    for (let o = 0; o < 4; o++) {
      total += amp * noise(mix(seed + o), x * freq, y * freq);
      sum += amp; amp *= 0.5; freq *= 2;
    }
    return total / sum;
  }
  // fbm isn't spread evenly over [0, 1], so shares ("12% water") become thresholds through its measured spread.
  const SPREAD = (() => {
    const seed = hashString('calibration'), values = [];
    for (let i = 0; i < 8000; i++) values.push(fbm(seed, unit(seed, i, 1) * 4000, unit(seed, i, 2) * 4000));
    return values.sort((p, q) => p - q);
  })();
  const below = share => SPREAD[Math.min(SPREAD.length - 1, Math.max(0, Math.floor(share * (SPREAD.length - 1))))];

  // ---------- A world ----------
  // rules: { scale: blocks across a typical feature, water, sand, forest, stone, gold: shares of the world }.
  function makeWorld(seed, rules) {
    const s = hashString(seed);
    const height = mix(s ^ 0x1001), damp = mix(s ^ 0x2002), ore = mix(s ^ 0x3003);
    const water = below(rules.water), sand = below(rules.water + rules.sand), stone = below(1 - rules.stone);
    const middle = Math.max(0.01, 1 - rules.water - rules.sand - rules.stone);
    const forest = below(1 - Math.min(1, rules.forest / middle));   // forest grows in the middle band only
    const cache = new Map();
    function at(x, y) {
      const k = x + ',' + y;
      let t = cache.get(k);
      if (t) return t;
      const e = fbm(height, x / rules.scale, y / rules.scale);
      if (e < water) t = 'water';
      else if (unit(ore, x, y) < rules.gold) t = 'gold';
      else if (e < sand) t = 'sand';
      else if (e > stone) t = 'stone';
      else if (fbm(damp, x / (rules.scale * 0.8), y / (rules.scale * 0.8)) > forest) t = 'forest';
      else t = 'grass';
      cache.set(k, t);
      return t;
    }
    return { seed: String(seed), at };
  }

  // ---------- Starting shape ----------
  // `blocks` connected blocks around (0, 0): a round island with a ragged, seeded edge. Grows outward from the
  // middle, always taking the open spot with the lowest score (distance plus a little noise), so it's connected.
  // Each seed also picks the land's character: how stretched it is, how ragged its coast, and (often) big holes
  // where you see through the land; holes are skipped, so the land stays one piece.
  function startingShape(seed, blocks) {
    const s = mix(hashString(seed) ^ 0x4004), r = Math.sqrt(blocks / Math.PI), pick = n => unit(s, 900 + n);
    const stretch = 0.6 + pick(1) * 1.0, ragged = 0.5 + pick(2) * 1.1, angle = pick(3) * Math.PI;
    const holeSeed = mix(s ^ 0x7007), holes = pick(4) < 0.35 ? -1 : below(0.06 + pick(5) * 0.14);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const score = (x, y) => {
      const a = (x * ca + y * sa) / stretch, b = (y * ca - x * sa) * stretch;
      return Math.sqrt(a * a + b * b) / r + ragged * (fbm(s, x / (r * 0.45), y / (r * 0.45)) - 0.5);
    };
    const hole = (x, y) => x * x + y * y > r * r * 0.04 && fbm(holeSeed, x / (r * 0.22), y / (r * 0.22)) < holes;
    const heap = [], seen = new Set(['0,0']), out = [];
    const less = (p, q) => p[0] < q[0] || (p[0] === q[0] && (p[2] < q[2] || (p[2] === q[2] && p[1] < q[1])));
    const push = item => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const up = (i - 1) >> 1;
        if (!less(heap[i], heap[up])) break;
        [heap[i], heap[up]] = [heap[up], heap[i]]; i = up;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, rr = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (rr < heap.length && less(heap[rr], heap[m])) m = rr;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
        }
      }
      return top;
    };
    push([score(0, 0), 0, 0]);
    while (out.length < blocks && heap.length) {
      const [, x, y] = pop();
      out.push([x, y]);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = nx + ',' + ny;
        if (!seen.has(k)) { seen.add(k); if (!hole(nx, ny)) push([score(nx, ny), nx, ny]); }
      }
    }
    return out;
  }

  // ---------- Growth ----------
  // Which of `count` open spots (sorted by x, then y) the map's n-th growth takes.
  const growthPick = (seed, n, count) => Math.floor(unit(mix(hashString(seed) ^ 0x5005), n) * count);

  Object.assign(exports, { TERRAINS, makeWorld, startingShape, growthPick, hashString });
})(typeof module === 'object' ? module.exports : (window.terrain = {}));
