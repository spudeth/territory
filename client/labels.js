// Where owners' names go on the map, so you can see who's who: every territory on screen gets one name tag,
// on its own blocks, at the block deepest inside the part you can see (never on grass or someone else's land).
// Works in the browser (as a plain script) and on the server (require), so tests can check it.
(function (exports) {
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // One spot per owner with blocks in view, biggest territory first.
  //   cells: Map "x,y" -> owner id or null (blocks that exist; anything else is empty)
  //   view:  the visible area in block units { x, y, width, height }; it may cut blocks in half
  // Returns [{ owner, blocks, depth, cx, cy }]: blocks = how many of theirs are in view; (cx, cy) = the centre of
  // their deepest visible block; depth = how many blocks it is from the edge of their land (1 = on the edge).
  function nameSpots(cells, view) {
    const x0 = Math.floor(view.x), y0 = Math.floor(view.y);
    const x1 = Math.ceil(view.x + view.width), y1 = Math.ceil(view.y + view.height);
    if (!(x1 > x0 && y1 > y0)) return [];
    // Depth of every visible owned block: 1 next to another owner, empty land or the edge of the view, and
    // one more for each block further in (a breadth-first search from the edges).
    const depth = new Map(), owners = new Map(), queue = [];
    const ownerAt = (x, y) => (x < x0 || x >= x1 || y < y0 || y >= y1) ? undefined : cells.get(x + ',' + y);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = cells.get(x + ',' + y);
        if (o == null) continue;
        const k = x + ',' + y;
        const t = owners.get(o) ?? owners.set(o, { blocks: 0, sx: 0, sy: 0 }).get(o);
        t.blocks++; t.sx += x; t.sy += y;
        if (N4.some(([dx, dy]) => ownerAt(x + dx, y + dy) !== o)) { depth.set(k, 1); queue.push([x, y, o]); }
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y, o] = queue[i], d = depth.get(x + ',' + y);
      for (const [dx, dy] of N4) {
        const k = (x + dx) + ',' + (y + dy);
        if (ownerAt(x + dx, y + dy) === o && !depth.has(k)) { depth.set(k, d + 1); queue.push([x + dx, y + dy, o]); }
      }
    }
    // Each owner's deepest block; between equals, the one nearest the middle of their visible land.
    const best = new Map();
    for (const [k, d] of depth) {
      const [x, y] = k.split(',').map(Number), o = cells.get(k), t = owners.get(o);
      const off = (x - t.sx / t.blocks) ** 2 + (y - t.sy / t.blocks) ** 2;
      const b = best.get(o);
      if (!b || d > b.depth || (d === b.depth && off < b.off)) best.set(o, { depth: d, off, x, y });
    }
    return [...best].map(([owner, b]) => ({ owner, blocks: owners.get(owner).blocks, depth: b.depth, cx: b.x + 0.5, cy: b.y + 0.5 }))
      .sort((p, q) => q.blocks - p.blocks || q.depth - p.depth);
  }

  // Which tags fit: placed in order (put your own first), each skipped if it would overlap one already placed.
  // tags: [{ ..., box: { x, y, w, h } }] in screen pixels. Returns the ones to draw.
  function withoutOverlaps(tags, gap = 4) {
    const placed = [];
    for (const t of tags) {
      const b = t.box;
      if (placed.some(({ box: p }) => b.x < p.x + p.w + gap && p.x < b.x + b.w + gap && b.y < p.y + p.h + gap && p.y < b.y + b.h + gap)) continue;
      placed.push(t);
    }
    return placed;
  }

  exports.nameSpots = nameSpots;
  exports.withoutOverlaps = withoutOverlaps;
})(typeof module === 'object' ? module.exports : (window.labels = {}));
