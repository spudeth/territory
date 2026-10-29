// ---------- State (filled in by the server) ----------
// cells: "x,y" -> owner id, or null when empty. A block that isn't in cells doesn't exist; maps grow into any shape.
let me = null, myName = '', myColor = '#888', cells = null, players = {}, hits = new Map(), squares = 0;
let myAccount = false, accountsOn = false, renameAt = null;   // logged in?  logins set up?  when renaming is allowed again
// This map: its { id, name, style }, my skin and coverage here, whether they're locked, my wipe floor here, and
// the colors and coverages the setup screen offers.
let hitsPerBlock = 10;   // hits to take a block with no upgrades (the server sends the real number)
let gameSettings = { nameLabelShare: 0.25, nameMaxLength: 15, sound: {} };   // replaced by the server's on welcome
let mapInfo = null, mySkin = 'default', myCoverage = 'tile', locked = false, wipeFloor = 0, choices = { colors: [], coverages: [] };
let bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };   // smallest box around every block; x1 and y1 are exclusive
const key = (x, y) => x + ',' + y;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// Kenney "Tiny Town" grass tiles (16x16). Most blocks use plain grass, some get a variant.
const tiles = [0, 1, 2].map(n => Object.assign(new Image(), { src: `tiles/tile_000${n}.png`, onload: draw }));
const VARIANTS = [0, 0, 0, 0, 0, 1, 1, 2];
// Terrain tiles for seeded maps (terrain.js), drawn for this game in the same style. Water has two frames.
const terrainTile = name => Object.assign(new Image(), { src: `tiles/terrain-${name}.png`, onload: draw });
const TERRAIN_TILES = { sand: terrainTile('sand'), forest: terrainTile('forest'), stone: terrainTile('stone'), gold: terrainTile('gold'),
  water: [terrainTile('water-0'), terrainTile('water-1')] };
const WATER_FRAME_MS = 700;
// The night sky behind the island: a pixel Milky Way (a glowing diagonal band with dark dust lanes) and scattered
// stars, drawn once at a third of the screen's resolution and scaled up; brighter stars twinkle on two layers.
function paintSky() {
  const P = 3, w = Math.ceil(innerWidth / P), h = Math.ceil(innerHeight / P);
  const rand = (() => { let s = 12345; return () => (s = Math.imul(s ^ (s >>> 15), 2654435761) >>> 0) / 4294967296; })();
  const grid = Array.from({ length: 40 * 40 }, rand);   // value noise for the band's clouds and dust
  const noise = (x, y) => {
    const gx = x * 39, gy = y * 39, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const g = (a, b) => grid[(Math.min(39, a)) * 40 + Math.min(39, b)];
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  };
  const sky = $('sky'), g = Object.assign(sky, { width: w, height: h }).getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const d = (u + v - 1) / 0.3;                                   // across the band, which runs bottom-left to top-right
      const glow = Math.exp(-d * d) * (0.45 + 0.55 * noise(u, v)) * (1 - 0.65 * Math.max(0, noise(u * 0.7 + 0.3, v * 0.7) - 0.45) * 2.5 * Math.exp(-d * d * 4));
      const i = (y * w + x) * 4;
      img.data[i] = 4 + 55 * glow; img.data[i + 1] = 5 + 52 * glow; img.data[i + 2] = 16 + 95 * glow; img.data[i + 3] = 255;   // darker, less purple
      const star = rand(), dense = 0.012 + 0.05 * Math.exp(-d * d);
      if (star < dense) { const b = 140 + rand() * 115; img.data[i] = img.data[i + 1] = b; img.data[i + 2] = Math.min(255, b + 30); }
    }
  }
  g.putImageData(img, 0, 0);
  for (const [id, n] of [['twinkle-a', 70], ['twinkle-b', 70]]) {
    const c = Object.assign($(id), { width: w, height: h }).getContext('2d');
    for (let k = 0; k < n; k++) {
      const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
      c.fillStyle = rand() < 0.5 ? '#ffffff' : '#cfd8ff';
      c.fillRect(x, y, 1, 1);
      if (rand() < 0.3) { c.fillStyle = 'rgba(200,210,255,0.6)'; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
    }
  }
}
paintSky();
let skyTimer;
addEventListener('resize', () => { clearTimeout(skyTimer); skyTimer = setTimeout(paintSky, 300); });

// Pixel clouds: each one a random clump of 2-4 puffs, a random size and a random speed, drifting left or right.
// Limits keep them from getting too big, too small or too fast. The far layer moves with the map at 0.35 of its
// speed and the near one at 1.6 (parallax); with reduce motion they only move when you pan.
const clouds = [];
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const [layer, count, near] of [['clouds-back', 9, false], ['clouds-front', 5, true]]) {
    for (let i = 0; i < count; i++) {
      const c = Object.assign(document.createElement('canvas'), { width: 40, height: 16 }), g = c.getContext('2d');
      for (let n = 2 + Math.floor(Math.random() * 3), k = 0; k < n; k++) {
        const x = 2 + Math.floor(Math.random() * 22), y = 2 + Math.floor(Math.random() * 6), w = 8 + Math.floor(Math.random() * 8);
        g.fillStyle = '#ffffff'; g.fillRect(x + 2, y, w - 4, 2); g.fillRect(x, y + 2, w, 4);
        g.fillStyle = '#d7deea'; g.fillRect(x, y + 6, w, 2);
      }
      const size = (near ? 4 : 2) + Math.random() * 3;   // pixels per cloud texel, within limits
      const img = Object.assign(new Image(), { src: c.toDataURL() });
      img.style.width = 40 * size + 'px';
      document.getElementById(layer).append(img);
      clouds.push({ img, w: 40 * size, x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        v: still ? 0 : (4 + Math.random() * 14) * (Math.random() < 0.5 ? -1 : 1), f: near ? 1.6 : 0.35 });
    }
  }
  let last = performance.now();
  function step(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const c of clouds) {
      c.x += c.v * dt;
      const spanX = innerWidth + 2 * c.w, spanY = innerHeight + 2 * c.w;
      const sx = (((c.x + ox * c.f) % spanX) + spanX) % spanX - c.w, sy = (((c.y + oy * c.f) % spanY) + spanY) % spanY - c.w;
      c.img.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
    }
    requestAnimationFrame(step);   // the browser pauses this while the tab is hidden
  }
  requestAnimationFrame(step);
})();

// Skin images (public/skins/<id>.png, and -large.png for Full area), loaded the first time they're needed.
const skinImages = new Map();
function skinImage(id, large, anim) {
  const k = id + (large ? '-large' : '') + (anim ? '-anim' : '');
  if (!skinImages.has(k)) skinImages.set(k, Object.assign(new Image(), { src: `skins/${k}.png`, onload: draw }));
  const img = skinImages.get(k);
  return img.complete && img.naturalWidth ? img : null;
}
// How an owner's land is drawn: { kind: 'default' | 'pattern' | 'art', id, full: Full area coverage }.
function lookOf(o) {
  const p = players[o], kind = p?.skin && p.skin !== 'default' ? gameSettings.skinKinds?.[p.skin] : null;
  return kind ? { kind, id: p.skin, full: p.coverage === 'stretch', anim: gameSettings.skinAnimated?.includes(p.skin) } : { kind: 'default' };
}
let world = null;   // this map's terrain (terrain.makeWorld), or null for a map without a seed (all grass)
let waterTimer = null;
function variant(x, y) {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0x7f4a7c15, 0xc2b2ae35);   // integer hash, so the variants look random
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return VARIANTS[((h ^ (h >>> 16)) >>> 0) % VARIANTS.length];
}

// Crack overlay drawn on the 16x16 texel grid: '1' shows after the 1st hit, '2' after the 2nd.
const CRACK_STAGES = 2;
const CRACK = [
  '................',
  '..............2.',
  '..2.........22..',
  '...2.......2....',
  '....2.....1.....',
  '.....2...1......',
  '......211.......',
  '.......1........',
  '......1.1.......',
  '.....1...11.....',
  '....1......1....',
  '...2........1...',
  '..2..........2..',
  '.2............2.',
  '................',
  '................',
];

function addCell(x, y, owner) {
  cells.set(key(x, y), owner);
  bounds = { x0: Math.min(bounds.x0, x), y0: Math.min(bounds.y0, y), x1: Math.max(bounds.x1, x + 1), y1: Math.max(bounds.y1, y + 1) };
}

// ---------- Camera ----------
let scale = 20, ox = 0, oy = 0;   // scale = CSS pixels per block, (ox, oy) = screen position of block (0, 0)
let renderScale = 1;              // under 1 draws the map at lower resolution (the blurred welcome background)
const mapSpan = () => Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
const minScale = () => Math.min(innerWidth, innerHeight) / mapSpan() * 0.5;
const MAX_SCALE = 160;

function clampView() {
  // The welcome screen places the camera itself (welcome.js).
  if (window.welcomeScreen?.isMoving()) return draw();
  if (window.welcomeScreen?.isOpen()) return welcomeScreen.reframe();
  scale = Math.min(MAX_SCALE, Math.max(minScale(), scale));
  ox = Math.min(innerWidth / 2 - bounds.x0 * scale, Math.max(innerWidth / 2 - bounds.x1 * scale, ox));
  oy = Math.min(innerHeight / 2 - bounds.y0 * scale, Math.max(innerHeight / 2 - bounds.y1 * scale, oy));
  draw();
}

function zoomAt(x, y, factor) {
  const old = scale;
  scale = Math.min(MAX_SCALE, Math.max(minScale(), scale * factor));
  ox = x - (x - ox) * (scale / old);
  oy = y - (y - oy) * (scale / old);
  clampView();
}

// Centres the view on a block (the tutorial uses this to show the block it points at).
function lookAt(x, y) {
  ox = innerWidth / 2 - (x + 0.5) * scale;
  oy = innerHeight / 2 - (y + 0.5) * scale;
  clampView();
}

// Show the whole map, or zoom in on our territory if we have one.
function initialView() {
  const mine = [...cells].filter(([, o]) => me && o === me).map(([k]) => k.split(',').map(Number));
  let cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
  scale = Math.min(innerWidth, innerHeight) * 0.92 / mapSpan();
  if (mine.length) {
    cx = mine.reduce((s, [x]) => s + x, 0) / mine.length + 0.5;
    cy = mine.reduce((s, [, y]) => s + y, 0) / mine.length + 0.5;
    scale = Math.max(scale, 40);
  }
  ox = innerWidth / 2 - cx * scale;
  oy = innerHeight / 2 - cy * scale;
  clampView();
}

// ---------- Rendering ----------
let queued = false, hover = null;
function draw() {
  if (!queued) { queued = true; requestAnimationFrame(render); }
}

function render() {
  queued = false;
  const dpr = (devicePixelRatio || 1) * renderScale;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.imageSmoothingEnabled = false;   // keep pixel art crisp
  ctx.clearRect(0, 0, w, h);   // space shows through (index.html #space)
  if (!cells) return;

  // Block edges in device pixels, rounded so neighbouring blocks never leave gaps.
  const X = c => Math.round((ox + c * scale) * dpr);
  const Y = r => Math.round((oy + r * scale) * dpr);
  const ownerAt = (x, y) => cells.get(key(x, y));   // undefined where there is no block
  const iOwnSome = !!me && [...cells.values()].includes(me);
  const border = Math.max(2, Math.round(scale * dpr / 16));   // one texel thick

  const c0 = Math.max(bounds.x0, Math.floor(-ox / scale)), c1 = Math.min(bounds.x1, Math.ceil((innerWidth - ox) / scale));
  const r0 = Math.max(bounds.y0, Math.floor(-oy / scale)), r1 = Math.min(bounds.y1, Math.ceil((innerHeight - oy) / scale));

  const waterFrame = Math.floor(performance.now() / WATER_FRAME_MS) % 2;
  let waterShown = false, animShown = false;   // keep redrawing while water or an animated skin is on screen
  const animFrame = Math.floor(performance.now() / 220) % 4;
  const fullArea = new Map();   // owner -> their visible blocks, for Full area skins
  const white = mapInfo?.style === 'white' && !world;
  for (let y = r0; y < r1; y++) {
    for (let x = c0; x < c1; x++) {
      const o = ownerAt(x, y);
      if (o === undefined) continue;
      const x0 = X(x), y0 = Y(y), bw = X(x + 1) - x0, bh = Y(y + 1) - y0;
      const ground = world ? world.at(x, y) : 'grass';
      if (ground === 'water') { waterShown = true; ctx.drawImage(TERRAIN_TILES.water[waterFrame], x0, y0, bw, bh); }
      else if (white) { ctx.fillStyle = '#f7f8fa'; ctx.fillRect(x0, y0, bw, bh); }   // the white style: clean white blocks
      else ctx.drawImage(ground === 'grass' ? tiles[variant(x, y)] : TERRAIN_TILES[ground], x0, y0, bw, bh);

      // The floating island's underside: where no block is below, a cliff of dirt and rock hangs down, with a
      // soft shadow under it.
      if (ownerAt(x, y + 1) === undefined) {
        const t = bh / 16, h = (n, m) => (Math.imul(x * 73856093 ^ (y + n) * 19349663, 83492791) >>> 0) % m;
        ctx.fillStyle = '#7a4e2a'; ctx.fillRect(x0, y0 + bh, bw, Math.round(5 * t));
        ctx.fillStyle = '#5a5e6b'; ctx.fillRect(x0, y0 + bh + Math.round(5 * t), bw, Math.round((4 + h(1, 4)) * t));
        ctx.fillStyle = '#5c3a1e'; ctx.fillRect(x0 + h(2, 12) * t, y0 + bh + 2 * t, 2 * t, t);
        ctx.fillStyle = '#41444f'; ctx.fillRect(x0 + h(3, 12) * t, y0 + bh + 7 * t, 3 * t, (2 + h(4, 3)) * t);
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x0, y0 + bh + Math.round((9 + h(1, 4)) * t), bw, Math.round(6 * t));
      }

      if (o) {
        // The owner's skin. Default: the ground recolored to their hue (keeping its shading). A pattern: its grey
        // art in their color. Art: the image as it is. Full area skins are drawn over the whole territory below.
        const look = lookOf(o), img = look.kind !== 'default' && !look.full && skinImage(look.id, false, look.anim);
        if (look.full) { (fullArea.get(o) ?? fullArea.set(o, []).get(o)).push([x, y]); }
        else if (img && look.anim) { animShown = true; ctx.drawImage(img, animFrame * img.naturalWidth / 4, 0, img.naturalWidth / 4, img.naturalHeight, x0, y0, bw, bh); }
        else if (img) ctx.drawImage(img, x0, y0, bw, bh);
        if (look.kind !== 'art' && !(look.full && look.kind === 'pattern')) {
          ctx.fillStyle = players[o]?.color || '#888';
          // On white there's no shading to keep, so the color goes on directly.
          ctx.globalCompositeOperation = white && look.kind === 'default' ? 'source-over' : 'color';
          ctx.globalAlpha = look.kind === 'pattern' ? 1 : white ? 0.85 : 0.9;
          ctx.fillRect(x0, y0, bw, bh);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // Full area: one enlarged image over each such territory, covering its whole shape (never stretched), clipped
  // to its blocks.
  for (const [o, mine] of fullArea) {
    const look = lookOf(o), img = skinImage(look.id, true, look.anim);
    if (!img) continue;
    const fw = look.anim ? img.naturalWidth / 4 : img.naturalWidth;
    if (look.anim) animShown = true;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [k, owner] of cells) {
      if (owner !== o) continue;
      const [x, y] = k.split(',').map(Number);
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + 1); by1 = Math.max(by1, y + 1);
    }
    const sx = X(bx0), sy = Y(by0), fit = skins.coverFit(fw, img.naturalHeight, X(bx1) - sx, Y(by1) - sy);
    ctx.save();
    ctx.beginPath();
    for (const [x, y] of mine) ctx.rect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
    ctx.clip();
    ctx.drawImage(img, look.anim ? animFrame * fw : 0, 0, fw, img.naturalHeight, sx + fit.dx, sy + fit.dy, fit.dw, fit.dh);
    if (look.kind === 'pattern') {
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = players[o]?.color || '#888';
      ctx.fillRect(sx, sy, X(bx1) - sx, Y(by1) - sy);
    }
    ctx.restore();
  }

  // Borders, highlights and cracks, on top of every skin.
  for (let y = r0; y < r1; y++) {
    for (let x = c0; x < c1; x++) {
      const o = ownerAt(x, y);
      if (o === undefined) continue;
      const x0 = X(x), y0 = Y(y), bw = X(x + 1) - x0, bh = Y(y + 1) - y0;
      if (o) {
        // The territory edge in the owner's color: thicker around art skins, which don't show the color.
        const b = border * skins.borderTexels(lookOf(o).kind);
        ctx.fillStyle = players[o]?.color || '#888';
        if (ownerAt(x - 1, y) !== o) ctx.fillRect(x0, y0, b, bh);
        if (ownerAt(x + 1, y) !== o) ctx.fillRect(x0 + bw - b, y0, b, bh);
        if (ownerAt(x, y - 1) !== o) ctx.fillRect(x0, y0, bw, b);
        if (ownerAt(x, y + 1) !== o) ctx.fillRect(x0, y0 + bh - b, bw, b);
      }

      // Light up blocks we're allowed to take next.
      if (iOwnSome && o !== me && [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => ownerAt(a, b) === me)) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x0, y0, bw, bh);
      }

      // Crack progress p runs from 0 to 1 (a share of the hits needed). The art has CRACK_STAGES stages,
      // split evenly over it; the shade deepens with every hit.
      const p = hits.get(key(x, y));
      if (p) {
        const n = Math.ceil(p * CRACK_STAGES);
        ctx.fillStyle = `rgba(0,0,0,${0.3 * p})`;
        ctx.fillRect(x0, y0, bw, bh);
        ctx.fillStyle = 'rgba(25,18,10,0.85)';
        const tx = t => x0 + Math.round(t * bw / 16), ty = t => y0 + Math.round(t * bh / 16);
        for (let r = 0; r < 16; r++) {
          for (let c = 0; c < 16; c++) {
            const ch = CRACK[r][c];
            if (ch !== '.' && +ch <= n) ctx.fillRect(tx(c), ty(r), tx(c + 1) - tx(c), ty(r + 1) - ty(r));
          }
        }
      }
    }
  }

  // Water ripples: draw again for the next frame while water is on screen (not while the tab is hidden).
  if ((waterShown || animShown) && !waterTimer && !document.hidden) {
    const every = animShown ? 220 : WATER_FRAME_MS;
    waterTimer = setTimeout(() => { waterTimer = null; draw(); }, every - performance.now() % every);
  }

  // Faint grid so individual blocks are readable on seamless grass: each block's top and left edge,
  // plus its right and bottom edge where the map ends.
  if (scale > 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = r0; y < r1; y++) {
      for (let x = c0; x < c1; x++) {
        if (ownerAt(x, y) === undefined) continue;
        const x0 = X(x), y0 = Y(y), x1 = X(x + 1), y1 = Y(y + 1);
        ctx.fillRect(x0, y0, x1 - x0, 1);
        ctx.fillRect(x0, y0, 1, y1 - y0);
        if (ownerAt(x + 1, y) === undefined) ctx.fillRect(x1, y0, 1, y1 - y0);
        if (ownerAt(x, y + 1) === undefined) ctx.fillRect(x0, y1, x1 - x0 + 1, 1);
      }
    }
  }

  // Who's who (labels.js): a name tag on every territory in view, on its deepest visible block. A dark tag with
  // the owner's color, white text (yours in gold). Yours goes first, then the biggest; a tag that would overlap
  // one already placed waits until you zoom in.
  const shown = { x: -ox / scale, y: -oy / scale, width: innerWidth / scale, height: innerHeight / scale };
  const fontPx = 10 * dpr, pad = 5 * dpr, dot = 8 * dpr;
  ctx.font = `${fontPx}px 'Press Start 2P', monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tags = [];
  for (const l of labels.nameSpots(cells, shown)) {
    const name = players[l.owner]?.name;
    if (!name) continue;
    const w = dot + pad + ctx.measureText(name).width + pad * 2, h = fontPx + pad * 2;
    const cx = (ox + l.cx * scale) * dpr, cy = (oy + l.cy * scale) * dpr;
    const tag = { owner: l.owner, name, box: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) } };
    if (String(l.owner) === String(me)) tags.unshift(tag); else tags.push(tag);
  }
  for (const { owner, name, box } of labels.withoutOverlaps(tags, 4 * dpr)) {
    ctx.fillStyle = 'rgba(10,13,18,0.82)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = players[owner]?.color || '#888';
    ctx.fillRect(box.x + pad, Math.round(box.y + (box.h - dot) / 2), dot, dot);
    ctx.fillStyle = String(owner) === String(me) ? '#f7c948' : '#ffffff';
    ctx.fillText(name, box.x + pad * 2 + dot, box.y + box.h / 2 + dpr);
    if (online.has(String(owner))) {   // a green dot: they have the game open right now
      const r = 3.5 * dpr;
      ctx.fillStyle = '#0a0d12';
      ctx.beginPath(); ctx.arc(box.x + box.w, box.y, r + dpr, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#2fd35b';
      ctx.beginPath(); ctx.arc(box.x + box.w, box.y, r, 0, 2 * Math.PI); ctx.fill();
    }
  }

  // Blocks the tutorial points at (coach.js): a thick yellow outline with a dark edge.
  const cw = Math.max(3, Math.round(3 * dpr));
  for (const { x, y } of coachBlocks) {
    const bx = X(x), by = Y(y), bw = X(x + 1) - bx, bh = Y(y + 1) - by;
    ctx.lineWidth = cw;
    ctx.strokeStyle = '#0a0d12';
    ctx.strokeRect(bx - cw / 2, by - cw / 2, bw + cw, bh + cw);
    ctx.strokeStyle = '#ffec27';
    ctx.strokeRect(bx + cw / 2, by + cw / 2, bw - cw, bh - cw);
  }

  // Mouse hover outline (desktop only).
  if (hover) {
    const { x, y } = hover;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(X(x) + dpr, Y(y) + dpr, X(x + 1) - X(x) - 2 * dpr, Y(y + 1) - Y(y) - 2 * dpr);
  }

  // New squares rising off the block that earned them (the mockup: claude.ai/artifact/PXtXotyzsRZayFM6m3pBXh).
  const now = performance.now();
  squarePops = squarePops.filter(p => now - p.t0 < SQUARE_POP.ms);
  for (const p of squarePops) {
    if (now < p.t0) continue;   // a later square of the same claim, not started yet
    const e = 1 - Math.pow(1 - (now - p.t0) / SQUARE_POP.ms, SQUARE_POP.power);   // fast, then slow
    const s = SQUARE_POP.size * scale * dpr;
    const bottom = Y(p.y) + (SQUARE_POP.centered ? s / 2 : 0) - e * SQUARE_POP.rise * scale * dpr;
    ctx.globalAlpha = 1 - e;   // fades on the same curve
    if (squareIcon.complete) ctx.drawImage(squareIcon, (ox + (p.x + 0.5) * scale) * dpr - s / 2, bottom - s, s, s);
    ctx.globalAlpha = 1;
  }
  // A death: the last block's pieces falling away.
  shards = shards.filter(s => now - s.t0 < 1500);
  for (const s of shards) {
    const t = (now - s.t0) / 1000;
    ctx.globalAlpha = Math.max(0, 1 - t / 1.5);
    ctx.fillStyle = s.color;
    ctx.fillRect((ox + (s.x + s.vx * t) * scale) * dpr, (oy + (s.y + s.vy * t + 4 * t * t) * scale) * dpr, scale * dpr / 4, scale * dpr / 4);
  }
  ctx.globalAlpha = 1;
  if (squarePops.length || shards.length) draw();   // keep animating
}

// The square that pops off a block when it earns a new whole square.
// ms: how long it lasts; rise: blocks it travels up; power: how fast-then-slow (1 = steady); size: share of a block;
// centered: starts centered on the block's top grid line instead of sitting on it.
const SQUARE_POP = { ms: 1350, rise: 1.15, power: 4.5, size: 0.28, centered: false };   // Xoren's picks
const squareIcon = Object.assign(new Image(), { src: 'icons/square.svg' });
let squarePops = [];

// Where a block's centre is on screen, for placing other players' sounds.
const screenAt = (x, y) => ({ sx: ox + (x + 0.5) * scale, sy: oy + (y + 0.5) * scale });
const myTaps = new Map();   // "x,y" -> when we last tapped it, so our own taps aren't played twice

// ---------- Input: tap vs. drag vs. pinch ----------
const TAP_SLOP = 10;              // px a finger may wiggle and still count as a tap
const pointers = new Map();       // pointerId -> last position
let tap = null;                   // start position of a possible tap, null once it became a drag/pinch

// The block under a screen position, or null if there is none.
function cellAt(sx, sy) {
  const x = Math.floor((sx - ox) / scale), y = Math.floor((sy - oy) / scale);
  return cells?.has(key(x, y)) ? { x, y } : null;
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    const c = pointers.size ? null : cellAt(e.clientX, e.clientY);
    if (c?.x !== hover?.x || c?.y !== hover?.y) { hover = c; draw(); }
  }
  const p = pointers.get(e.pointerId);
  if (!p) return;

  if (pointers.size === 1) {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) tap = null;
    if (tap) return;   // not moved enough yet; p keeps its start position so no movement is lost
    ox += e.clientX - p.x;
    oy += e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    clampView();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d0 = Math.hypot(a.x - b.x, a.y - b.y);
    p.x = e.clientX; p.y = e.clientY;
    const mid1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d1 = Math.hypot(a.x - b.x, a.y - b.y);
    ox += mid1.x - mid0.x;
    oy += mid1.y - mid0.y;
    zoomAt(mid1.x, mid1.y, d0 ? d1 / d0 : 1);
  }
});

function pointerEnd(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (e.type === 'pointerup' && tap && pointers.size === 0) {
    const c = cellAt(e.clientX, e.clientY);
    if (c && !(me && cells.get(key(c.x, c.y)) === me)) {
      socket.emit('hit', c);
      gameAudio.play('tap');
      myTaps.set(key(c.x, c.y), Date.now());
    }
  }
  tap = null;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)));
}, { passive: false });

document.addEventListener('gesturestart', e => e.preventDefault());   // stop iOS page zoom
addEventListener('resize', clampView);
addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });   // water starts moving again
document.fonts?.ready.then(draw);   // the label font arrives after the first frames

// ---------- UI ----------
let toastTimer;
function toast(msg, kind = 'bad') {
  $('toast').textContent = msg;
  $('toast').className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800);
}

// Blocks owned on this map, by owner id.
function blockCounts() {
  const counts = {};
  for (const o of cells.values()) if (o) counts[o] = (counts[o] || 0) + 1;
  return counts;
}
const myBlocks = () => (me && blockCounts()[me]) || 0;

// The player card (top left) and the leaderboard (top right, this map only, ranked by blocks owned).
function updateUI() {
  const counts = blockCounts();
  $('me-name').textContent = myName;
  $('me-color').style.background = myColor;
  const mine = (me && counts[me]) || 0;
  $('me-count').textContent = `${mine} block${mine === 1 ? '' : 's'}`;
  $('me-squares').textContent = squares;
  $('hint').hidden = !!(me && counts[me]);
  $('hint').textContent = `Tap any empty block ${hitsPerBlock} times to claim your first block`;

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('board-list').replaceChildren(...top.map(([pid, n]) => {
    const li = document.createElement('li');
    li.className = pid === me ? 'mine' : '';
    li.innerHTML = '<span class="sq"></span><span class="name"></span><span class="n"></span>';
    li.children[0].style.background = players[pid]?.color || '#888';
    li.children[1].textContent = players[pid]?.name || '…';
    li.children[1].classList.toggle('online', online.has(String(pid)));
    li.children[2].textContent = n;
    return li;
  }));
  if (!top.length) $('board-list').innerHTML = '<li class="empty">No blocks claimed yet</li>';
  window.welcomeScreen?.refresh();
}

// ---------- Networking ----------
// The auth callback runs on every (re)connect. It sends the guest's saved token (visitors have none until their
// first claim) and, when logged in, a fresh login token (loginToken() is in account.js).
const socket = io({
  auth: cb => loginToken().then(jwt => cb({
    token: localStorage.getItem('territory-token'), jwt, upgrade: sessionStorage.getItem('territory-upgrade') === '1',
  })),
});

// Players with the game open in a visible tab on this map (green dots), and telling the server about our tab.
let online = new Set();
socket.on('online', list => { online = new Set(list.map(String)); updateUI(); draw(); });
document.addEventListener('visibilitychange', () => socket.emit('visible', !document.hidden));
socket.on('connect', () => { if (document.hidden) socket.emit('visible', false); });

socket.on('welcome', data => {
  const first = !cells || data.map.id !== mapInfo?.id;   // a new map (or a switch) gets a fresh view
  ({ pid: me, name: myName, color: myColor, skin: mySkin, coverage: myCoverage, locked, wipeFloor, squares,
    account: myAccount, renameAt } = data.me);
  accountsOn = data.accounts;
  mapInfo = data.map;
  choices = data.choices;
  hitsPerBlock = data.hitsPerBlock;
  gameSettings = data.settings;   // numbers from the sheet the browser needs
  gameAudio.configure(gameSettings.sound);
  $('name-input').maxLength = gameSettings.nameMaxLength;
  sessionStorage.removeItem('territory-upgrade');
  if (data.upgraded) {
    localStorage.removeItem('territory-token');   // the guest is now this account; logging out starts afresh
    toast('Your blocks are saved to your account', 'good');
  }
  if (data.loginFailed) toast('Your login has expired. Log in again from the menu.');
  players = data.players;
  world = data.map.seed && data.map.style !== 'white' ? terrain.makeWorld(data.map.seed, data.settings.terrain) : null;   // white maps: no terrain
  cells = new Map();
  bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y, owner] of data.cells) addCell(x, y, owner);
  hits = new Map(data.hits.map(([x, y, p]) => [key(x, y), p]));
  if (window.welcomeScreen?.isOpen()) welcomeScreen.onWelcome(first);
  else if (first) initialView(); else clampView();
  updateUI();
  loadProgress(data.me.tutorial);   // coach.js
  afterWelcome();   // menu.js: the setup screen if this map's look isn't chosen yet
  resumeTutorial(); // coach.js: carry on where they left off
});

// After a visitor's first claim the server creates their player and hands over the secret token.
socket.on('you', ({ token, pid, name }) => {
  localStorage.setItem('territory-token', token);
  me = pid;
  myName = name;
  updateUI();
  tell('you');   // coach.js: the visitor's tutorial progress moves to their new player
});

socket.on('player', ({ pid, name, color, skin, coverage }) => {
  players[pid] = { name, color, skin, coverage };
  if (pid === me) { myColor = color; mySkin = skin; myCoverage = coverage; locked = true; updateUI(); }
});
socket.on('hit', ({ x, y, p }) => {
  const k = key(x, y), mine = Date.now() - (myTaps.get(k) ?? 0) < 1500;
  if (gameAudio.isTap(hits.get(k), p) && !mine) gameAudio.play('tap', screenAt(x, y));
  if (mine) tell('hit', { x, y, p });   // tutorial: the tap counter
  if (p) hits.set(k, p); else hits.delete(k);
  draw();
});
socket.on('claim', ({ x, y, pid }) => {
  const before = cells.get(key(x, y));
  cells.set(key(x, y), pid);
  hits.delete(key(x, y));
  myTaps.delete(key(x, y));
  if (pid === me) { gameAudio.play(before ? 'steal' : 'claim'); tell('claimed', { x, y, from: before }); }
  else if (me && before === me) { gameAudio.play('taken'); tell('taken', { x, y }); }
  else gameAudio.play('claim', screenAt(x, y));
  updateUI();
  draw();
});
socket.on('grow', ({ x, y }) => {
  addCell(x, y, null);
  gameAudio.play('grow', screenAt(x, y));
  tell('grew', { x, y });
  draw();
});
socket.on('wipe', ({ pid, cells: wiped, floor }) => {
  for (const [x, y] of wiped) cells.set(key(x, y), null);
  updateUI();
  draw();
  if (pid === me) { locked = false; wipeFloor = floor; gameAudio.play('wipe'); afterWipe(); }   // menu.js: pick a new look
});
socket.on('rename', ({ pid, name }) => {
  if (players[pid]) players[pid].name = name;
  if (pid === me) myName = name;
  updateUI();
});
// One rising square per square a claim mined: they come fast, then slower (the gaps grow), over at most 1.5 s.
socket.on('mined', ({ x, y, count }) => {
  const t = performance.now(), n = Math.min(count, 50), span = Math.min(1500, 150 * (n - 1));
  for (let i = 0; i < n; i++) squarePops.push({ x, y, t0: t + span * (n > 1 ? (i / (n - 1)) ** 2 : 0) });
  draw();
});
socket.on('squares', n => {
  squares = n;
  updateUI();
  if (n > 0) tell('squares', n);
  if (view === 'upgrades') fills.upgrades();   // menu.js: what can be afforded now
});
socket.on('stat', d => onStat(d));                  // menu.js
socket.on('achievement', a => onAchievement(a));    // menu.js
socket.on('denied', msg => {
  toast(msg);
  gameAudio.play('denied');
  if (/next to your territory/.test(msg)) tell('denied:range');
});
socket.on('disconnect', reason => {
  // Not when we reconnect on purpose, nor when the server ended the game for now with a notice.
  if (reason !== 'io client disconnect' && reason !== 'io server disconnect') toast('Connection lost, reconnecting…');
});
// The server is about to disconnect us for good: banned, kicked by an admin, account deleted, or restored.
const NOTICE_TITLES = { banned: "YOU'VE BEEN BANNED", kicked: 'DISCONNECTED', deleted: 'ACCOUNT DELETED', restored: 'GAME RESTORED' };
// ---------- Death (loop 13) ----------
// The last block shatters, the screen flashes and goes grey, the camera eases to it; then the death screen.
// Reduce motion: a quick fade. A death while away shows the screen straight away.
let shards = [];
socket.on('died', life => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || life.offline || life.x == null;
  if (!life.offline) gameAudio.play('death');
  if (!calm) {
    for (let i = 0; i < 16; i++) shards.push({ x: life.x + (i % 4) / 4, y: life.y + Math.floor(i / 4) / 4, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 1.5,
      t0: performance.now(), color: myColor });
    document.body.classList.add('dying');
    const from = { ox, oy }, to = { ox: innerWidth / 2 - (life.x + 0.5) * scale, oy: innerHeight / 2 - (life.y + 0.5) * scale }, t0 = performance.now();
    const ease = now => { const k = Math.min(1, (now - t0) / 900), e = 1 - (1 - k) ** 3; ox = from.ox + (to.ox - from.ox) * e; oy = from.oy + (to.oy - from.oy) * e; draw(); if (k < 1) requestAnimationFrame(ease); };
    requestAnimationFrame(ease);
  }
  setTimeout(() => showDeath(life), calm ? 0 : 1500);
});
function showDeath(life) {
  const s = Math.max(0, Math.round(life.seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  $('death-time').textContent = h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
  $('death-peak').textContent = life.peak.toLocaleString();
  $('death-killer').textContent = life.killer ?? 'someone';
  $('death-claims').textContent = life.claims.toLocaleString();
  $('death-squares').textContent = (Math.round(life.squares * 10) / 10).toLocaleString();
  $('death').hidden = false;
}
const leaveDeath = () => { $('death').hidden = true; document.body.classList.remove('dying'); };
// Respawn: back on this map with no blocks and the same look (dying isn't wiping), so no setup screen.
$('death-respawn').addEventListener('click', () => { gameAudio.play('button'); leaveDeath(); });
$('death-menu').addEventListener('click', () => { gameAudio.play('button'); leaveDeath(); welcomeScreen.open(); });

socket.on('notice', ({ kind, message }) => {
  if (kind === 'reset') return location.reload();   // this player started over: load the fresh start
  $('notice-title').textContent = NOTICE_TITLES[kind] ?? 'DISCONNECTED';
  $('notice-text').textContent = message;
  $('notice-reload').hidden = kind === 'banned';
  $('notice').hidden = false;
  if (kind === 'deleted') localStorage.removeItem('territory-token');
});
$('notice-reload').addEventListener('click', () => location.reload());
