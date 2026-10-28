// ---------- The menu: one panel showing one view at a time ----------
// Loaded after game.js (uses its socket, state and toast) and before account.js, which adds the account views.
// game.js calls afterWelcome, afterWipe, onStat and onAchievement (at the end of this file); they only run
// once the connection is open, after this file has loaded.

const menu = $('menu');
const fills = {};     // view name -> function that fills the view in just before it shows
let view = null;      // the view showing, or null when the menu is closed

function show(name) {
  for (const v of menu.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== name;
  const section = menu.querySelector(`[data-view="${name}"]`);
  section.querySelector('.head').after($('menu-error'));   // errors show under the view's title
  $('menu-error').textContent = '';
  menu.classList.toggle('strong', name === 'wipe' || name === 'setup');
  menu.classList.toggle('bare', name === 'wipe');
  menu.hidden = false;
  view = name;
  fills[name]?.();
  menu.querySelector('.panel').scrollTop = 0;
}
function closeMenu() {
  if (view === 'setup') return;   // the setup screen closes with Spawn
  menu.hidden = true;
  view = null;
}
const fail = msg => { $('menu-error').textContent = msg; };

// Asks the server something and resolves with its answer, or { error } if it doesn't answer in time.
const ask = (event, ...args) => new Promise(resolve =>
  socket.timeout(10000).emit(event, ...args, (err, res) => resolve(err ? { error: 'No answer from the server. Try again.' } : res)));

// Runs a form's action with its button disabled, so a double tap doesn't send it twice.
function onSubmit(form, action) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try { await action(new FormData(form)); } finally { button.disabled = false; }
  });
}

// ---------- Menu hub ----------
fills.main = () => {
  $('hub-color').style.background = myColor;
  $('hub-name').textContent = myName;
  $('hub-tag').textContent = myAccount ? 'ACCOUNT' : me ? 'GUEST' : 'VISITOR';
  $('hub-map').textContent = mapInfo?.name ?? '';
  $('hub-squares').textContent = squares;
  const offerLogin = !myAccount && accountsOn;
  $('hub-login').hidden = $('hub-login-note').hidden = !offerLogin;
  $('hub-off').hidden = accountsOn;
  menu.querySelector('.hub-row').classList.toggle('solo', !offerLogin);
};

for (const b of menu.querySelectorAll('[data-soon]')) b.addEventListener('click', () => toast(`${b.dataset.soon}: coming soon`, 'good'));

$('menu-button').addEventListener('click', () => show('main'));
menu.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); show(go.dataset.go); }
  else if (e.target.closest('.close') || e.target === menu) closeMenu();
});
addEventListener('keydown', e => { if (e.key === 'Escape' && view) closeMenu(); });

// "Blue · Default skin · Per block": a player's locked choices on this map.
const COVERAGE_NAMES = { tile: 'Per block', stretch: 'Full area' };
function lookText() {
  const color = choices.colors.find(c => c.hex === myColor)?.name ?? 'Custom color';
  return `${color} · ${skinName(mySkin)} skin · ${COVERAGE_NAMES[myCoverage] ?? myCoverage}`;
}
const skinName = id => id[0].toUpperCase() + id.slice(1);

// ---------- Wipe dialog ----------
fills.wipe = () => {
  const blocks = myBlocks();
  $('wipe-title').textContent = `WIPE ${(mapInfo?.name ?? '').toUpperCase()}?`;
  $('wipe-count').textContent = `${blocks} block${blocks === 1 ? '' : 's'}`;
  const floor = Math.max(wipeFloor, blocks);   // the wipe rule: the floor never goes down
  $('wipe-floor').textContent = `more than ${floor} block${floor === 1 ? '' : 's'}`;
  $('wipe-word').value = '';
  $('wipe-go').disabled = true;
};
$('wipe-open').addEventListener('click', () => show('wipe'));
$('wipe-word').addEventListener('input', () => { $('wipe-go').disabled = $('wipe-word').value.trim() !== 'WIPE'; });
$('wipe-go').addEventListener('click', () => {
  if ($('wipe-word').value.trim() !== 'WIPE') return;
  $('wipe-go').disabled = true;
  socket.emit('wipe');   // the answer is a 'wipe' event (afterWipe below), or 'denied'
});

// ---------- Maps ----------
// A tiny picture of this map: one pixel per block, in its owner's color.
function drawThumb(canvas) {
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  for (const [k, o] of cells) {
    if (!o) continue;
    const [x, y] = k.split(',').map(Number);
    g.fillStyle = players[o]?.color || '#888';
    g.fillRect(x - bounds.x0, y - bounds.y0, 1, 1);
  }
}

fills.maps = async () => {
  const counts = blockCounts(), mine = myBlocks();
  const rank = 1 + Object.values(counts).filter(n => n > mine).length;
  $('now-thumb').className = `thumb big ${mapInfo.style === 'white' ? 'white' : 'grass'}`;
  drawThumb($('now-canvas'));
  $('now-name').textContent = mapInfo.name;
  $('now-mine').textContent = mine ? `You own ${mine} block${mine === 1 ? '' : 's'} · #${rank}` : 'You have no blocks here yet';
  $('now-size').textContent = `${cells.size.toLocaleString()} blocks and growing`;

  const list = await ask('maps');
  if (view !== 'maps') return;
  $('map-list').replaceChildren(...(Array.isArray(list) ? list : []).map(m => {
    const here = m.id === mapInfo.id;
    const row = document.createElement(here ? 'div' : 'button');
    row.className = 'card map-row';
    if (!here) row.type = 'button';
    row.innerHTML = '<div class="thumb"></div><div class="info"><span style="font-size: 18px; font-weight: 600"></span>'
      + '<span style="font-size: 14px; color: var(--muted)"></span></div>';
    row.querySelector('.thumb').classList.add(m.style === 'white' ? 'white' : 'grass');
    row.querySelector('.info').children[0].textContent = m.name;
    row.querySelector('.info').children[1].textContent = `Official · ${m.style === 'white' ? 'plain white' : m.style}`;
    if (here) row.insertAdjacentHTML('beforeend', '<span class="tag here">HERE</span>');
    else row.addEventListener('click', async () => {
      const r = await ask('switchMap', m.id);   // the map itself arrives as a 'welcome'
      if (r.error) return fail(r.error);
      closeMenu();
      toast(`Welcome to ${m.name}`, 'good');
    });
    return row;
  }));
};

// ---------- First entry on a map (and after a wipe): pick color, skin and coverage ----------
// Choices are only proposals until the player's first claim here, so they're kept per map for this visit and
// sent again if the connection starts over.
const chosen = new Map();   // map id -> { color, skin, coverage } picked on the setup screen
let pick = null;            // the choice being made on the setup screen

// A darker shade of a color, for the second color in skin patterns.
function shade(hex) {
  const n = parseInt(hex.slice(1), 16), d = c => Math.round(c * 0.62).toString(16).padStart(2, '0');
  return '#' + d(n >> 16) + d((n >> 8) & 255) + d(n & 255);
}
const SKIN_LOOKS = ['checker', 'stripes', 'brick', 'dots', 'rows', 'diamond'];   // shown locked, from the design
const paint = (el, color) => { el.style.setProperty('--c', color); el.style.setProperty('--c2', shade(color)); };

function drawSetup() {
  $('setup-colors').replaceChildren(...choices.colors.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-checked', c.hex === pick.color);
    b.classList.toggle('picked', c.hex === pick.color);
    b.style.background = c.hex;
    b.addEventListener('click', () => { pick.color = c.hex; drawSetup(); });
    return b;
  }));
  const skins = ['default', ...SKIN_LOOKS.slice(0, 4)].map(id => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `skin pat-${id}`;
    b.setAttribute('role', 'radio');
    paint(b, pick.color);
    if (id === 'default') {
      b.setAttribute('aria-checked', pick.skin === 'default');
      b.classList.toggle('picked', pick.skin === 'default');
      b.innerHTML = '<span class="label">Default</span>';
    } else {
      b.disabled = true;
      b.setAttribute('aria-label', `${skinName(id)}, locked`);
      b.innerHTML = '<span class="tag">LOCK</span>';
    }
    return b;
  });
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'skin all';
  all.textContent = 'All skins';
  all.addEventListener('click', () => { skinsBack = 'setup'; show('skins'); });
  $('setup-skins').replaceChildren(...skins, all);
  for (const b of menu.querySelectorAll('[data-coverage]')) {
    b.setAttribute('aria-checked', b.dataset.coverage === pick.coverage);
    b.classList.toggle('picked', b.dataset.coverage === pick.coverage);
    for (const p of b.querySelectorAll('.cov-mini, .cov-full')) paint(p, pick.color);
  }
}
for (const b of menu.querySelectorAll('[data-coverage]')) b.addEventListener('click', () => { pick.coverage = b.dataset.coverage; drawSetup(); });

fills.setup = () => {
  pick ??= { color: myColor, skin: mySkin, coverage: myCoverage };
  $('setup-map').textContent = mapInfo.name.toUpperCase();
  drawSetup();
};
$('spawn').addEventListener('click', async () => {
  $('spawn').disabled = true;
  const r = await ask('setup', pick);
  $('spawn').disabled = false;
  if (r.error) return fail(r.error);
  ({ color: myColor, skin: mySkin, coverage: myCoverage } = r);
  chosen.set(mapInfo.id, r);
  pick = null;
  view = null;   // lets the menu close
  closeMenu();
  updateUI();
});

// ---------- Skins ----------
let skinsBack = 'main';   // where the back button goes: the hub, or the setup screen
fills.skins = async () => {
  menu.querySelector('[data-view="skins"] .head [data-go]').dataset.go = skinsBack;
  skinsBack = 'main';
  const real = await ask('skins');
  if (view !== 'skins') return;
  const owned = Array.isArray(real) ? real.filter(s => s.owned) : [];
  $('skins-owned').textContent = `${owned.length} owned`;
  const tile = (look, name, price, ownedSkin) => {
    const t = document.createElement('div');
    t.className = 'tile';
    t.innerHTML = '<div class="prev"></div><span class="nm"></span><span class="pr"></span>';
    const prev = t.querySelector('.prev');
    prev.className = `prev pat-${look}`;
    paint(prev, myColor);
    if (ownedSkin) prev.classList.add('owned-mark');
    else if (look === 'mystery') prev.textContent = '?';
    else prev.innerHTML = '<span class="tag">LOCK</span>';
    t.querySelector('.nm').textContent = name;
    const pr = t.querySelector('.pr');
    if (ownedSkin) { pr.textContent = 'Owned'; pr.style.color = 'var(--green)'; }
    else pr.innerHTML = price ? '<svg class="pix" width="10" height="10" aria-hidden="true"><use href="#i-square"/></svg>SOON' : 'Coming soon';
    return t;
  };
  $('catalog').replaceChildren(
    ...owned.map(s => tile(s.id === 'default' ? 'default' : s.id, s.name, false, true)),
    ...SKIN_LOOKS.map(id => tile(id, skinName(id), true, false)),
    tile('mystery', 'Mystery', false, false), tile('mystery', 'Mystery', false, false));
};

// ---------- Upgrades ----------
const num = v => (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) ? 1 : 0, maximumFractionDigits: 2 });
const plural = (v, word) => `${word}${v === 1 ? '' : 's'}`;
const UPGRADES = [
  { key: 'clickPower', name: 'Click Power', about: 'Each click counts as more hits', color: 'var(--orange)',
    icon: '<path d="M4 0h2v3h2v1H7v1H6v1H5v1H4v1H3V5H1V4h1V3h1V2h1z" fill="#0f131a"/>',
    effect: (v, u) => `${num(v)} ${plural(v, 'hit')} per click` },
  { key: 'defense', name: 'Defense', about: 'Others need more hits to take your blocks', color: 'var(--blue)',
    icon: '<path d="M0 0h8v4H7v2H6v1H5v1H3V7H2V6H1V4H0z" fill="#0f131a"/>',
    effect: (v, u) => { const h = Math.round(u.hitsPerBlock * v * 100) / 100; return `${h.toLocaleString()} ${plural(h, 'hit')} to take`; } },
  { key: 'earnings', name: 'Earnings', about: 'More squares per brand-new block', color: 'var(--text)',
    icon: '<path d="M0 4h3v4H0zM5 4h3v4H5zM2 0h4v3H2z" fill="#0f131a"/>',
    effect: (v, u) => { const s = u.squaresPerClaim * v; return `${num(s)} ${plural(s, 'square')} per block`; } },
];
fills.upgrades = async () => {
  const u = await ask('upgrades');
  if (view !== 'upgrades') return;
  if (u.error) return fail(u.error);
  $('upgrade-list').replaceChildren(...UPGRADES.map(up => {
    const table = u.tables[up.key], level = Math.min(Math.max(0, u.levels[up.key] | 0), table.length - 1);
    const card = document.createElement('div');
    card.className = 'card upg';
    card.innerHTML = `<div class="top"><div class="ic"><svg class="pix" width="20" height="20" viewBox="0 0 8 8" aria-hidden="true">${up.icon}</svg></div>`
      + '<div style="display: flex; flex-direction: column"><span class="t"></span><span class="d"></span></div></div>'
      + '<div class="pips" aria-hidden="true"></div><div class="stat"><span></span><span></span></div><ul class="levels"></ul>'
      + '<button class="btn" type="button" disabled>Upgrade · SOON</button>';
    card.querySelector('.ic').style.background = up.color;
    card.querySelector('.btn').style.cssText = `background: ${up.color}; color: var(--well)`;
    card.querySelector('.t').textContent = up.name;
    card.querySelector('.d').textContent = up.about;
    // One pip per level above 0; filled up to the player's level.
    const pips = card.querySelector('.pips');
    pips.replaceChildren(...table.slice(1).map((_, i) => {
      const p = document.createElement('span');
      p.className = 'pip';
      if (i < level) p.style.background = up.color;
      return p;
    }));
    pips.hidden = table.length < 2;
    const [lv, now] = card.querySelectorAll('.stat span');
    lv.textContent = `Level ${level}`;
    now.textContent = up.effect(table[level], u);
    const levels = card.querySelector('.levels');
    levels.replaceChildren(...table.map((v, i) => {
      const li = document.createElement('li');
      li.className = i === level ? 'cur' : '';
      li.textContent = `Level ${i}: ${up.effect(v, u)}`;
      return li;
    }));
    if (table.length < 2) levels.insertAdjacentHTML('beforeend', '<li>More levels are coming.</li>');
    return card;
  }));
};

// ---------- Achievements ----------
const ACH_TEXT = {
  firstClaims: n => `Claim ${n} empty ${plural(n, 'block')}`,
  owned: n => `Own ${n.toLocaleString()} blocks at once`,
  bestSquare: n => `Own a solid ${n}×${n} square`,
  bestLine: n => `Own ${n} blocks in a straight line`,
  retakes: n => `Take ${n} ${plural(n, 'block')} from other players`,
  blocksLost: n => `Lose ${n} ${plural(n, 'block')} to other players`,
};
const describe = a => (ACH_TEXT[a.stat] ?? (n => `${a.stat} ${n}`))(a.threshold);
const progressText = (a, v) => a.stat === 'bestSquare' ? `best ${v}×${v}` : a.stat === 'bestLine' ? `best ${v}` : `${v.toLocaleString()} so far`;
let achFilter = 'all', achData = null;

function drawAchievements() {
  const { list, earned, best } = achData;
  const got = new Map(earned.map(e => [e.id, e.map]));
  $('ach-total').textContent = `${got.size} / ${list.length}`;
  $('ach-total-bar').style.width = `${list.length ? got.size / list.length * 100 : 0}%`;
  for (const b of $('ach-filter').children) b.setAttribute('aria-selected', b.dataset.filter === achFilter);
  const shown = list.filter(a => achFilter === 'all' || (achFilter === 'earned') === got.has(a.id));
  // Earned first, then the closest to being earned.
  const near = a => Math.min(1, (best[a.stat] ?? 0) / a.threshold);
  shown.sort((a, b) => (got.has(b.id) - got.has(a.id)) || near(b) - near(a));
  $('ach-list').replaceChildren(...shown.map(a => {
    const row = document.createElement('div'), v = best[a.stat] ?? 0, done = got.has(a.id);
    row.className = 'ach' + (done ? ' got' : '');
    row.innerHTML = `<div class="badge"><svg class="pix" width="${done ? 18 : 16}" height="${done ? 18 : 16}" aria-hidden="true" style="color: ${done ? '#0f131a' : 'var(--muted)'}"><use href="#i-${done ? 'check' : 'lock'}"/></svg></div>`
      + '<div class="info"><span class="t"></span><span class="sub"></span></div>';
    row.querySelector('.t').textContent = a.name;
    row.querySelector('.sub').textContent = done ? describe(a) + (got.get(a.id) ? ` · ${got.get(a.id)}` : '') : `${describe(a)} · ${progressText(a, v)}`;
    if (!done) row.querySelector('.info').insertAdjacentHTML('beforeend', `<div class="bar"><div style="width: ${near(a) * 100}%"></div></div>`);
    return row;
  }));
}
fills.achievements = async () => {
  const r = await ask('achievements');
  if (view !== 'achievements') return;
  if (r.error) return fail(r.error);
  achData = r;
  drawAchievements();
};
for (const b of $('ach-filter').children) b.addEventListener('click', () => { achFilter = b.dataset.filter; if (achData) drawAchievements(); });

// The yellow pop-up when one is earned.
let popupTimer, achTimer;
function onAchievement(a) {
  $('popup-what').textContent = a.stat && a.threshold ? `${a.name} · ${describe(a)}` : a.name;
  $('popup').hidden = false;
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { $('popup').hidden = true; }, 4000);
  if (view === 'achievements') fills.achievements();
}
// Progress bars move as stats change, at most once a second.
function onStat() {
  if (view !== 'achievements' || achTimer) return;
  achTimer = setTimeout(() => { achTimer = null; if (view === 'achievements') fills.achievements(); }, 1000);
}

// ---------- Hooks from game.js ----------
// A new welcome (first load, reconnect or map switch): show the setup screen if this map's look isn't chosen
// yet. If it was chosen earlier this visit, send it again: a new connection starts with fresh proposals.
function afterWelcome() {
  if (!locked && chosen.has(mapInfo.id)) {
    ask('setup', chosen.get(mapInfo.id)).then(r => { if (!r.error) ({ color: myColor, skin: mySkin, coverage: myCoverage } = r); updateUI(); });
  } else if (!locked) {
    pick = null;
    return show('setup');
  }
  if (view === 'setup') { view = null; menu.hidden = true; }   // e.g. the look was locked from another device
  if (view) fills[view]?.();
}
// After this player's own wipe: their look here is unlocked, so they pick it again.
function afterWipe() {
  chosen.delete(mapInfo.id);
  pick = null;
  toast('Territory wiped', 'good');
  show('setup');
}
