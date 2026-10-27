// ---------- State (filled in by the server) ----------
let SIZE = 32, me = null, owners = null, players = {}, hits = {};

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// Kenney "Tiny Town" grass tiles (16x16). Most blocks use plain grass, some get a variant.
const tiles = [0, 1, 2].map(n => Object.assign(new Image(), { src: `tiles/tile_000${n}.png`, onload: draw }));
const VARIANTS = [0, 0, 0, 0, 0, 1, 1, 2];
function variant(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);   // integer hash, so the variants look random
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return VARIANTS[((h ^ (h >>> 16)) >>> 0) % VARIANTS.length];
}

// Crack overlay drawn on the 16x16 texel grid: '1' shows after the 1st hit, '2' after the 2nd.
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

// ---------- Camera ----------
let scale = 20, ox = 0, oy = 0;   // scale = CSS pixels per block, (ox, oy) = screen position of the map's top-left
const minScale = () => Math.min(innerWidth, innerHeight) / SIZE * 0.5;
const MAX_SCALE = 160;

function clampView() {
  scale = Math.min(MAX_SCALE, Math.max(minScale(), scale));
  const map = SIZE * scale;
  ox = Math.min(innerWidth / 2, Math.max(innerWidth / 2 - map, ox));
  oy = Math.min(innerHeight / 2, Math.max(innerHeight / 2 - map, oy));
  draw();
}

function zoomAt(x, y, factor) {
  const old = scale;
  scale = Math.min(MAX_SCALE, Math.max(minScale(), scale * factor));
  ox = x - (x - ox) * (scale / old);
  oy = y - (y - oy) * (scale / old);
  clampView();
}

// Show the whole map, or zoom in on our territory if we have one.
function initialView() {
  const mine = owners.map((o, i) => o === me ? i : -1).filter(i => i >= 0);
  let cx = SIZE / 2, cy = SIZE / 2;
  scale = Math.min(innerWidth, innerHeight) * 0.92 / SIZE;
  if (mine.length) {
    cx = mine.reduce((s, i) => s + i % SIZE, 0) / mine.length + 0.5;
    cy = mine.reduce((s, i) => s + Math.floor(i / SIZE), 0) / mine.length + 0.5;
    scale = Math.max(scale, 40);
  }
  ox = innerWidth / 2 - cx * scale;
  oy = innerHeight / 2 - cy * scale;
  clampView();
}

// ---------- Rendering ----------
let queued = false, hover = -1;
function draw() {
  if (!queued) { queued = true; requestAnimationFrame(render); }
}

function render() {
  queued = false;
  const dpr = devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.imageSmoothingEnabled = false;   // keep pixel art crisp
  ctx.fillStyle = '#14181f';
  ctx.fillRect(0, 0, w, h);
  if (!owners) return;

  // Block edges in device pixels, rounded so neighbouring blocks never leave gaps.
  const X = c => Math.round((ox + c * scale) * dpr);
  const Y = r => Math.round((oy + r * scale) * dpr);
  const ownerAt = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE) ? undefined : owners[y * SIZE + x];
  const iOwnSome = owners.includes(me);
  const border = Math.max(2, Math.round(scale * dpr / 16));   // one texel thick

  const c0 = Math.max(0, Math.floor(-ox / scale)), c1 = Math.min(SIZE, Math.ceil((innerWidth - ox) / scale));
  const r0 = Math.max(0, Math.floor(-oy / scale)), r1 = Math.min(SIZE, Math.ceil((innerHeight - oy) / scale));

  for (let y = r0; y < r1; y++) {
    for (let x = c0; x < c1; x++) {
      const i = y * SIZE + x, o = owners[i];
      const x0 = X(x), y0 = Y(y), bw = X(x + 1) - x0, bh = Y(y + 1) - y0;
      ctx.drawImage(tiles[variant(i)], x0, y0, bw, bh);

      if (o) {
        // Recolor the grass to the owner's hue (keeping its shading); solid border marks the territory edge.
        ctx.fillStyle = players[o]?.color || '#888';
        ctx.globalCompositeOperation = 'color';
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x0, y0, bw, bh);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (ownerAt(x - 1, y) !== o) ctx.fillRect(x0, y0, border, bh);
        if (ownerAt(x + 1, y) !== o) ctx.fillRect(x0 + bw - border, y0, border, bh);
        if (ownerAt(x, y - 1) !== o) ctx.fillRect(x0, y0, bw, border);
        if (ownerAt(x, y + 1) !== o) ctx.fillRect(x0, y0 + bh - border, bw, border);
      }

      // Light up blocks we're allowed to take next.
      if (iOwnSome && o !== me && [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => ownerAt(a, b) === me)) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x0, y0, bw, bh);
      }

      const n = hits[i]?.n;
      if (n) {
        ctx.fillStyle = `rgba(0,0,0,${0.1 * n})`;
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

  // Faint grid so individual blocks are readable on seamless grass.
  if (scale > 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = c0; x <= c1; x++) ctx.fillRect(X(x), Y(r0), 1, Y(r1) - Y(r0));
    for (let y = r0; y <= r1; y++) ctx.fillRect(X(c0), Y(y), X(c1) - X(c0), 1);
  }

  // Mouse hover outline (desktop only).
  if (hover >= 0) {
    const x = hover % SIZE, y = Math.floor(hover / SIZE);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(X(x) + dpr, Y(y) + dpr, X(x + 1) - X(x) - 2 * dpr, Y(y + 1) - Y(y) - 2 * dpr);
  }
}

// ---------- Input: tap vs. drag vs. pinch ----------
const TAP_SLOP = 10;              // px a finger may wiggle and still count as a tap
const pointers = new Map();       // pointerId -> last position
let tap = null;                   // start position of a possible tap, null once it became a drag/pinch

function cellAt(x, y) {
  const cx = Math.floor((x - ox) / scale), cy = Math.floor((y - oy) / scale);
  return cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE ? cy * SIZE + cx : -1;
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tap = pointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    const c = pointers.size ? -1 : cellAt(e.clientX, e.clientY);
    if (c !== hover) { hover = c; draw(); }
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
    const i = cellAt(e.clientX, e.clientY);
    if (i >= 0 && owners && owners[i] !== me) socket.emit('hit', i);
  }
  tap = null;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => { if (hover >= 0) { hover = -1; draw(); } });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)));
}, { passive: false });

document.addEventListener('gesturestart', e => e.preventDefault());   // stop iOS page zoom
addEventListener('resize', clampView);

// ---------- UI ----------
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800);
}

function updateUI() {
  const counts = {};
  for (const o of owners) if (o) counts[o] = (counts[o] || 0) + 1;

  $('me-name').textContent = players[me].name;
  $('me-color').style.background = players[me].color;
  $('me-count').textContent = counts[me] || 0;
  $('hint').hidden = !!counts[me];

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('board-list').replaceChildren(...top.map(([pid, n]) => {
    const li = document.createElement('li');
    li.className = pid === me ? 'mine' : '';
    li.innerHTML = '<span class="swatch"></span><span class="name"></span><span class="n"></span>';
    li.children[0].style.background = players[pid].color;
    li.children[1].textContent = players[pid].name;
    li.children[2].textContent = n;
    return li;
  }));
  if (!top.length) $('board-list').innerHTML = '<li class="empty">No blocks claimed yet</li>';
}

// ---------- Networking ----------
// The auth callback runs on every (re)connect, so a reconnect reuses the saved account.
const socket = io({ auth: cb => cb({ token: localStorage.getItem('territory-token') }) });

socket.on('welcome', data => {
  localStorage.setItem('territory-token', data.token);
  const first = !owners;
  ({ size: SIZE, pid: me, players, owners, hits } = data);
  if (first) initialView();
  updateUI();
  draw();
});

socket.on('player', ({ pid, name, color }) => { players[pid] = { name, color }; });
socket.on('hit', ({ i, n }) => { hits[i] = { n }; draw(); });
socket.on('claim', ({ i, pid }) => {
  owners[i] = pid;
  delete hits[i];
  updateUI();
  draw();
});
socket.on('denied', toast);
socket.on('disconnect', () => toast('Connection lost, reconnecting…'));
