// ---------- Walls (loop 16; batches and the new look in loop 18) ----------
// Build → Wall, then tap the outer sides of your blocks: each tap snaps to the nearest side of the tapped block (a
// side facing a square you don't own) and adds a wall there, shown at half strength; tapping one again drops it.
// Sides where a wall can't go show nothing. The bar shows how many and the total price; ✓ builds them all (one
// purchase, all or nothing), ✗ cancels. At most maxWallsPerBlock per block, on different sides, so corners work.
// A wall makes attackers who can only reach the block through it break the wall first; it also stops its owner
// from claiming across it. Walls last until the block is taken, or until Demolition removes them.
let walls = new Map();        // "x,y" -> [{ side, hits }]
let wallCracks = new Map();   // "x,y|side" -> crack share (0-1)
const WALL_SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const WALL_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDE_NAMES = { n: 'top', e: 'right', s: 'bottom', w: 'left' };
let wallPreview = new Map();  // "x,y|side" -> { x, y, side }: the batch being placed

(function () {
  let maxWalls = 2, prices = null;   // prices: { owned, factor, byLevel: { L: squares } } from buildInfo
  // Why a wall can't go on side `side` of (x, y), counting the ones already in the batch, or null.
  function refuse(x, y, side) {
    const k = key(x, y), [dx, dy] = WALL_SIDES[side];
    if (cells.get(k) !== me) return 'Only on the edge of your own land';
    if (cells.get(key(x + dx, y + dy)) === me) return 'Walls go on the edge of your land';
    const here = walls.get(k) ?? [], batch = [...wallPreview.values()].filter(w => w.x === x && w.y === y);
    if (here.some(w => w.side === side)) return 'There is a wall there already';
    if (here.length + batch.length >= maxWalls) return `At most ${maxWalls} walls on one block`;
    if (typeof listedBlocks !== 'undefined' && listedBlocks.has(k)) return 'Not on land for sale';
    return null;
  }
  // A wall's price on (x, y) for this batch: by the block's level, at the multiplier from the walls owned before.
  const priceAt = (x, y) => {
    const L = levels.get(key(x, y)) ?? 1;
    return prices?.byLevel?.[L] ?? (prices?.byLevel?.[1] ?? 0) * 2 ** (L - 1);
  };
  const total = () => [...wallPreview.values()].reduce((t, w) => t + priceAt(w.x, w.y), 0);

  BUILD_KINDS.wall = {
    label: 'Wall',
    multi: true,
    sub: () => `On the edge of your land · at most ${maxWalls} per block`,
    start(info) { prices = info?.walls ?? null; wallPreview = new Map(); },
    stop() { wallPreview = new Map(); },
    // The tap snaps to the nearest edge of the tapped block; the wall goes on whichever side of that edge is yours.
    tap(c, sx, sy) {
      const fx = (sx - ox) / scale - c.x, fy = (sy - oy) / scale - c.y;
      const d = { n: fy, s: 1 - fy, w: fx, e: 1 - fx };
      const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
      const [dx, dy] = WALL_SIDES[side], nx = c.x + dx, ny = c.y + dy;
      const spot = cells.get(key(c.x, c.y)) === me ? { x: c.x, y: c.y, side }
        : cells.get(key(nx, ny)) === me ? { x: nx, y: ny, side: WALL_OPPOSITE[side] } : null;
      if (!spot) return;
      const k = key(spot.x, spot.y) + '|' + spot.side;
      if (wallPreview.has(k)) wallPreview.delete(k);   // tapped again: dropped
      else if (!refuse(spot.x, spot.y, spot.side)) wallPreview.set(k, spot);   // not allowed: nothing shows
    },
    count: () => wallPreview.size,
    summary: () => (wallPreview.size
      ? `${wallPreview.size} ${wallPreview.size === 1 ? 'wall' : 'walls'} · ${fmtSq(total())} squares`
      : 'Wall: tap the edges of your land'),
    send: () => ({ kind: 'wall', walls: [...wallPreview.values()] }),
    done: r => (r.built === 1 ? 'Wall built' : `${r.built} walls built`),
  };

  Plugins.add('walls', { built: k => !!walls.get(k)?.length });
  addBuildTool({ id: 'wall', order: 20, label: 'Wall', sub: () => BUILD_KINDS.wall.sub(), start: info => startPlacing('wall', info) });

  socket.on('welcome', data => {
    walls = new Map((data.walls ?? []).map(([x, y, w]) => [key(x, y), w]));
    wallCracks = new Map();
    wallPreview = new Map();
    if (data.build?.maxWallsPerBlock) maxWalls = data.build.maxWallsPerBlock;
  });
  socket.on('walls', ({ x, y, walls: w, broken }) => {
    if (w.length) walls.set(key(x, y), w); else walls.delete(key(x, y));
    if (broken) { wallCracks.delete(key(x, y) + '|' + broken); gameAudio.play('wipe', screenAt(x, y)); }
    // A preview that can't be built any more (the block was lost, or the wall is there now) goes.
    for (const [k, p] of wallPreview) if (cells.get(key(p.x, p.y)) !== me || (walls.get(key(p.x, p.y)) ?? []).some(o => o.side === p.side)) wallPreview.delete(k);
    draw();
  });
  window.wallHit = ({ x, y, side, p }) => {
    const k = key(x, y) + '|' + side;
    if (p) wallCracks.set(k, p); else wallCracks.delete(k);
    gameAudio.play('tap', screenAt(x, y));
    draw();
  };

  // The info card: the block's walls and how strong each is.
  inspectSections.push(info => {
    if (!info.walls?.length) return info.wallFirst ? Object.assign(document.createElement('div'), { className: 'ic-sec', textContent: `A wall is in your way (${SIDE_NAMES[info.wallFirst]})` }) : null;
    const box = Object.assign(document.createElement('div'), { className: 'ic-sec' });
    for (const w of info.walls) {
      const r = Object.assign(document.createElement('div'), { className: 'ic-row' });
      r.append(Object.assign(document.createElement('span'), { textContent: `Wall (${SIDE_NAMES[w.side]})` }),
        Object.assign(document.createElement('b'), { textContent: `${w.hits.toLocaleString()} hits${info.wallFirst === w.side ? ' · in your way' : ''}` }));
      box.append(r);
    }
    return box;
  });
})();

// A colour 50% darker ("#rrggbb" -> "rgb(...)"), for a wall's shadow on its owner's border.
const darker = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return 'rgba(0,0,0,0.5)';
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16 & 255) >> 1},${(n >> 8 & 255) >> 1},${(n & 255) >> 1})`;
};

// Walls along their sides (art/wall.svg stretched), solid, on top of the territory border, each casting a shadow
// on its inner edge (30% of the border's thickness, in the border's colour 50% darker); darker as they crack. The
// batch being placed shows at half strength. Called by game.js render after the borders, with its helpers and the
// border thickness (device pixels) for each owner.
window.drawWalls = (ctx, X, Y, r0, r1, c0, c1, borderOf) => {
  const img = artImage('wall', draw);
  if (!img.complete || !img.naturalWidth) return;
  const bar = (x, y, side, alpha, crack) => {
    const x0 = X(x), y0 = Y(y), w = X(x + 1) - x0, h = Y(y + 1) - y0, t = Math.max(3, Math.round(w / 5));
    const r = { n: [x0, y0, w, t], s: [x0, y0 + h - t, w, t], w: [x0, y0, t, h], e: [x0 + w - t, y0, t, h] }[side];
    ctx.globalAlpha = alpha;
    // The shadow: just inside the wall, along its length.
    const o = cells.get(key(x, y)), sh = Math.max(1, Math.round(0.3 * (borderOf?.(o) ?? 2)));
    ctx.fillStyle = darker(players[o]?.color);
    ctx.fillRect(...{ n: [x0, y0 + t, w, sh], s: [x0, y0 + h - t - sh, w, sh], w: [x0 + t, y0, sh, h], e: [x0 + w - t - sh, y0, sh, h] }[side]);
    if (side === 'w' || side === 'e') {   // the art is horizontal: turn it for the upright sides
      ctx.save();
      ctx.translate(r[0] + r[2], r[1]);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, r[3], r[2]);
      ctx.restore();
    } else ctx.drawImage(img, ...r);
    if (crack) { ctx.fillStyle = `rgba(0,0,0,${0.15 + crack * 0.5})`; ctx.fillRect(...r); }
    ctx.globalAlpha = 1;
  };
  const shown = (x, y) => x >= c0 - 1 && x <= c1 && y >= r0 - 1 && y <= r1;
  for (const [k, list] of walls) {
    const [x, y] = k.split(',').map(Number);
    if (shown(x, y)) for (const wall of list) bar(x, y, wall.side, 1, wallCracks.get(k + '|' + wall.side));
  }
  for (const p of wallPreview.values()) if (shown(p.x, p.y)) bar(p.x, p.y, p.side, 0.5, 0);
};
