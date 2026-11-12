// The map's blocks, packed for the welcome (loop 19): instead of [x, y, owner, level] for every block, the blocks'
// bounding box read row by row as runs of the same value (0: no block, 1: empty, 2 + i: owners[i]), and the few
// blocks above level 1 as a flat list. A 50,000-block map goes from ~700 KB of JSON to a few KB. Works in the
// browser (window.blockPack) and in Node (the server packs, tests unpack).
(function (exports) {
  // cells: Map "x,y" -> owner or null; birth: Map "x,y" -> level (only above 1).
  function pack(cells, birth) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of cells.keys()) {
      const i = k.indexOf(','), x = +k.slice(0, i), y = +k.slice(i + 1);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 === Infinity) return { x0: 0, y0: 0, w: 0, h: 0, owners: [], runs: [], levels: [] };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, owners = [], index = new Map(), runs = [];
    let v = -1, n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = x + ',' + y;
        let c = 0;
        if (cells.has(k)) {
          const o = cells.get(k);
          if (o === null || o === undefined) c = 1;
          else { if (!index.has(o)) { index.set(o, owners.length); owners.push(o); } c = 2 + index.get(o); }
        }
        if (c === v) n++; else { if (n) runs.push(v, n); v = c; n = 1; }
      }
    }
    runs.push(v, n);
    const levels = [];
    for (const [k, L] of birth) if (L > 1 && cells.has(k)) { const i = k.indexOf(','); levels.push(+k.slice(0, i), +k.slice(i + 1), L); }
    return { x0, y0, w, h, owners, runs, levels };
  }

  // Calls add(x, y, owner) for every block (owner null when empty), then level(x, y, L) for each above level 1.
  function each(p, add, level) {
    let i = 0;
    for (let r = 0; r < p.runs.length; r += 2) {
      const v = p.runs[r], n = p.runs[r + 1];
      if (v > 0) for (let j = i; j < i + n; j++) add(p.x0 + (j % p.w), p.y0 + Math.floor(j / p.w), v === 1 ? null : p.owners[v - 2]);
      i += n;
    }
    if (level) for (let j = 0; j < p.levels.length; j += 3) level(p.levels[j], p.levels[j + 1], p.levels[j + 2]);
  }
  // The old shape, for tests and tools: [[x, y, owner] or [x, y, owner, level]].
  function unpack(p) {
    const out = [], at = new Map();
    each(p, (x, y, o) => { at.set(x + ',' + y, out.length); out.push([x, y, o]); }, (x, y, L) => { out[at.get(x + ',' + y)].push(L); });
    return out;
  }

  exports.pack = pack;
  exports.each = each;
  exports.unpack = unpack;
})(typeof module === 'object' ? module.exports : (window.blockPack = {}));
