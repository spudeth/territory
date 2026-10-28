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

  // Owners' names on territories covering at least a quarter of the screen (labels.js), in the design's
  // style: Press Start 2P in white with a hard dark shadow, at the middle of their visible blocks.
  const shown = { x: -ox / scale, y: -oy / scale, width: innerWidth / scale, height: innerHeight / scale };
  ctx.font = `${14 * dpr}px 'Press Start 2P', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels.namesToShow(cells, shown, gameSettings.nameLabelShare)) {
    const name = players[l.owner]?.name;
    if (!name) continue;
    const sx = (ox + l.cx * scale) * dpr, sy = (oy + l.cy * scale) * dpr;
    ctx.fillStyle = '#0a0d12';
    ctx.fillText(name, sx + 3 * dpr, sy + 3 * dpr);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, sx, sy);
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
}

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
  cells = new Map();
  bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y, owner] of data.cells) addCell(x, y, owner);
  hits = new Map(data.hits.map(([x, y, p]) => [key(x, y), p]));
  if (first) initialView(); else clampView();
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
  if (pid === me) { gameAudio.play('claim'); tell('claimed', { x, y, from: before }); }
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
socket.on('squares', n => { squares = n; updateUI(); if (n > 0) tell('squares', n); });
socket.on('stat', d => onStat(d));                  // menu.js
socket.on('achievement', a => onAchievement(a));    // menu.js
socket.on('denied', msg => {
  toast(msg);
  gameAudio.play('denied');
  if (/next to your territory/.test(msg)) tell('denied:range');
});
socket.on('disconnect', reason => {
  if (reason !== 'io client disconnect') toast('Connection lost, reconnecting…');   // not when we reconnect on purpose
});
