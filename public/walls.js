// ---------- Walls (loop 16) ----------
// Build → Wall, then tap near a block's edge: the ghost snaps to the nearest outer side of one of your blocks (a
// side facing a square you don't own). At most maxWallsPerBlock per block, on different sides, so corners work.
// A wall makes attackers who can only reach the block through it break the wall first; it also stops its owner
// from claiming across it. Walls last until the block is taken, or until Demolition removes them.
let walls = new Map();        // "x,y" -> [{ side, hits }]
let wallCracks = new Map();   // "x,y|side" -> crack share (0-1)
const WALL_SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const WALL_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDE_NAMES = { n: 'top', e: 'right', s: 'bottom', w: 'left' };

(function () {
  let maxWalls = 2;
  BUILD_KINDS.wall = {
    label: 'Wall',
    sub: () => `On the edge of your land · at most ${maxWalls} per block`,
    // Snap the tap to the nearest edge of the tapped block; the wall goes on whichever side of that edge is yours.
    place(c, sx, sy) {
      const fx = (sx - ox) / scale - c.x, fy = (sy - oy) / scale - c.y;
      const d = { n: fy, s: 1 - fy, w: fx, e: 1 - fx };
      const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
      const [dx, dy] = WALL_SIDES[side], nx = c.x + dx, ny = c.y + dy;
      if (cells.get(key(c.x, c.y)) === me) return { x: c.x, y: c.y, side };
      if (cells.get(key(nx, ny)) === me) return { x: nx, y: ny, side: WALL_OPPOSITE[side] };
      return { x: c.x, y: c.y, side };
    },
    refuse(g) {
      const k = key(g.x, g.y), [dx, dy] = WALL_SIDES[g.side];
      if (cells.get(k) !== me) return 'Only on the edge of your own land';
      if (cells.get(key(g.x + dx, g.y + dy)) === me) return 'Walls go on the edge of your land';
      const here = walls.get(k) ?? [];
      if (here.some(w => w.side === g.side)) return 'There is a wall there already';
      if (here.length >= maxWalls) return `At most ${maxWalls} walls on one block`;
      if (typeof listedBlocks !== 'undefined' && listedBlocks.has(k)) return 'Not on land for sale';
      return null;
    },
    send: g => ({ kind: 'wall', x: g.x, y: g.y, side: g.side }),
    done: 'Wall built',
  };

  socket.on('welcome', data => {
    walls = new Map((data.walls ?? []).map(([x, y, w]) => [key(x, y), w]));
    wallCracks = new Map();
    if (data.build?.maxWallsPerBlock) maxWalls = data.build.maxWallsPerBlock;
  });
  socket.on('walls', ({ x, y, walls: w, broken }) => {
    if (w.length) walls.set(key(x, y), w); else walls.delete(key(x, y));
    if (broken) { wallCracks.delete(key(x, y) + '|' + broken); gameAudio.play('wipe', screenAt(x, y)); }
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

// Walls along their sides (art/wall.svg stretched), darker as they crack. Called from drawBuilt (build.js).
window.drawWalls = (ctx, X, Y, r0, r1, c0, c1) => {
  const img = artImage('wall', draw);
  if (!img.complete || !img.naturalWidth) return;
  for (const [k, list] of walls) {
    const [x, y] = k.split(',').map(Number);
    if (x < c0 - 1 || x > c1 || y < r0 - 1 || y > r1) continue;
    const x0 = X(x), y0 = Y(y), w = X(x + 1) - x0, h = Y(y + 1) - y0, t = Math.max(3, Math.round(w / 5));
    for (const wall of list) {
      const r = { n: [x0, y0, w, t], s: [x0, y0 + h - t, w, t], w: [x0, y0, t, h], e: [x0 + w - t, y0, t, h] }[wall.side];
      if (wall.side === 'w' || wall.side === 'e') {   // the art is horizontal: turn it for the upright sides
        ctx.save();
        ctx.translate(r[0] + r[2], r[1]);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, 0, 0, r[3], r[2]);
        ctx.restore();
      } else ctx.drawImage(img, ...r);
      const crack = wallCracks.get(k + '|' + wall.side);
      if (crack) { ctx.fillStyle = `rgba(0,0,0,${0.15 + crack * 0.5})`; ctx.fillRect(...r); }
    }
  }
};
