// ---------- State (filled in by the server) ----------
// cells: "x,y" -> owner id, or null when empty. A block that isn't in cells doesn't exist; maps grow into any shape.
let me = null, myName = '', myColor = '#888', cells = null, players = {}, hits = new Map(), squares = 0;
let myAccount = false, accountsOn = false, renameAt = null;   // logged in?  logins set up?  when renaming is allowed again
let bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };   // smallest box around every block; x1 and y1 are exclusive
const key = (x, y) => x + ',' + y;

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

// Kenney "Tiny Town" grass tiles (16x16). Most blocks use plain grass, some get a variant.
const tiles = [0, 1, 2].map(n => Object.assign(new Image(), { src: `tiles/tile_000${n}.png`, onload: draw }));
const VARIANTS = [0, 0, 0, 0, 0, 1, 1, 2];
function variant(x, y) {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0x7f4a7c15, 0xc2b2ae35);   // integer hash, so the variants look random
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

function addCell(x, y, owner) {
  cells.set(key(x, y), owner);
  bounds = { x0: Math.min(bounds.x0, x), y0: Math.min(bounds.y0, y), x1: Math.max(bounds.x1, x + 1), y1: Math.max(bounds.y1, y + 1) };
}

// ---------- Camera ----------
let scale = 20, ox = 0, oy = 0;   // scale = CSS pixels per block, (ox, oy) = screen position of block (0, 0)
const mapSpan = () => Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
const minScale = () => Math.min(innerWidth, innerHeight) / mapSpan() * 0.5;
const MAX_SCALE = 160;

function clampView() {
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
  const dpr = devicePixelRatio || 1;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.imageSmoothingEnabled = false;   // keep pixel art crisp
  ctx.fillStyle = '#14181f';
  ctx.fillRect(0, 0, w, h);
  if (!cells) return;

  // Block edges in device pixels, rounded so neighbouring blocks never leave gaps.
  const X = c => Math.round((ox + c * scale) * dpr);
  const Y = r => Math.round((oy + r * scale) * dpr);
  const ownerAt = (x, y) => cells.get(key(x, y));   // undefined where there is no block
  const iOwnSome = !!me && [...cells.values()].includes(me);
  const border = Math.max(2, Math.round(scale * dpr / 16));   // one texel thick

  const c0 = Math.max(bounds.x0, Math.floor(-ox / scale)), c1 = Math.min(bounds.x1, Math.ceil((innerWidth - ox) / scale));
  const r0 = Math.max(bounds.y0, Math.floor(-oy / scale)), r1 = Math.min(bounds.y1, Math.ceil((innerHeight - oy) / scale));

  for (let y = r0; y < r1; y++) {
    for (let x = c0; x < c1; x++) {
      const o = ownerAt(x, y);
      if (o === undefined) continue;
      const x0 = X(x), y0 = Y(y), bw = X(x + 1) - x0, bh = Y(y + 1) - y0;
      ctx.drawImage(tiles[variant(x, y)], x0, y0, bw, bh);

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

      const n = hits.get(key(x, y));
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

  // Mouse hover outline (desktop only).
  if (hover) {
    const { x, y } = hover;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(X(x) + dpr, Y(y) + dpr, X(x + 1) - X(x) - 2 * dpr, Y(y + 1) - Y(y) - 2 * dpr);
  }
}

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
    if (c && !(me && cells.get(key(c.x, c.y)) === me)) socket.emit('hit', c);
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

// ---------- UI ----------
let toastTimer;
function toast(msg, kind = 'bad') {
  $('toast').textContent = msg;
  $('toast').className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800);
}

// The leaderboard covers this map only, ranked by blocks owned.
function updateUI() {
  const counts = {};
  for (const o of cells.values()) if (o) counts[o] = (counts[o] || 0) + 1;

  $('me-name').textContent = myName;
  $('me-color').style.background = myColor;
  $('me-count').textContent = (me && counts[me]) || 0;
  $('hint').hidden = !!(me && counts[me]);

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('board-list').replaceChildren(...top.map(([pid, n]) => {
    const li = document.createElement('li');
    li.className = pid === me ? 'mine' : '';
    li.innerHTML = '<span class="swatch"></span><span class="name"></span><span class="n"></span>';
    li.children[0].style.background = players[pid]?.color || '#888';
    li.children[1].textContent = players[pid]?.name || '…';
    li.children[2].textContent = n;
    return li;
  }));
  if (!top.length) $('board-list').innerHTML = '<li class="empty">No blocks claimed yet</li>';
}

// ---------- Networking ----------
// The auth callback runs on every (re)connect. It sends the guest's saved token (visitors have none until their
// first claim) and, when logged in, a fresh login token (loginToken() is in account.js).
const socket = io({
  auth: cb => loginToken().then(jwt => cb({
    token: localStorage.getItem('territory-token'), jwt, upgrade: sessionStorage.getItem('territory-upgrade') === '1',
  })),
});

socket.on('welcome', data => {
  const first = !cells;
  ({ pid: me, name: myName, color: myColor, account: myAccount, renameAt } = data.me);
  accountsOn = data.accounts;
  sessionStorage.removeItem('territory-upgrade');
  if (data.upgraded) {
    localStorage.removeItem('territory-token');   // the guest is now this account; logging out starts afresh
    toast('Your blocks are saved to your account', 'good');
  }
  if (data.loginFailed) toast('Your login has expired. Log in again from the menu.');
  players = data.players;
  cells = new Map();
  bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y, owner] of data.cells) addCell(x, y, owner);
  hits = new Map(data.hits.map(([x, y, n]) => [key(x, y), n]));
  if (first) initialView(); else clampView();
  updateUI();
});

// After a visitor's first claim the server creates their player and hands over the secret token.
socket.on('you', ({ token, pid, name }) => {
  localStorage.setItem('territory-token', token);
  me = pid;
  myName = name;
  updateUI();
});

socket.on('player', ({ pid, name, color, coverage }) => {
  players[pid] = { name, color, coverage };
  if (pid === me) myColor = color;
});
socket.on('hit', ({ x, y, n }) => {
  if (n) hits.set(key(x, y), n); else hits.delete(key(x, y));
  draw();
});
socket.on('claim', ({ x, y, pid }) => {
  cells.set(key(x, y), pid);
  hits.delete(key(x, y));
  updateUI();
  draw();
});
socket.on('grow', ({ x, y }) => {
  addCell(x, y, null);
  draw();
});
socket.on('wipe', ({ cells: wiped }) => {
  for (const [x, y] of wiped) cells.set(key(x, y), null);
  updateUI();
  draw();
});
socket.on('rename', ({ pid, name }) => {
  if (players[pid]) players[pid].name = name;
  if (pid === me) myName = name;
  updateUI();
});
socket.on('squares', n => { squares = n; });   // not shown yet
socket.on('denied', msg => toast(msg));
socket.on('disconnect', reason => {
  if (reason !== 'io client disconnect') toast('Connection lost, reconnecting…');   // not when we reconnect on purpose
});
