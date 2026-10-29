// ---------- The menu: one panel showing one view at a time ----------
// Loaded after game.js (uses its socket, state and toast) and before account.js, which adds the account views.
// game.js calls afterWelcome, afterWipe, onStat and onAchievement (at the end of this file); they only run
// once the connection is open, after this file has loaded.

const menu = $('menu');
const fills = {};     // view name -> function that fills the view in just before it shows
let view = null;      // the view showing, or null when the menu is closed

function show(name) {
  if (name === 'main') return closeMenu();   // the old menu hub: the welcome screen is underneath now
  if (menu.hidden) gameAudio.play('menuOpen');
  for (const v of menu.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== name;
  const section = menu.querySelector(`[data-view="${name}"]`);
  section.querySelector('.head').after($('menu-error'));   // errors show under the view's title
  $('menu-error').textContent = '';
  menu.classList.toggle('strong', name === 'wipe' || name === 'reset' || name === 'setup');
  menu.classList.toggle('bare', name === 'wipe' || name === 'reset');
  menu.hidden = false;
  view = name;
  fills[name]?.();
  menu.querySelector('.panel').scrollTop = 0;
  tell('menu:' + name);   // tutorial: the menu tour
}
function closeMenu() {
  if (view === 'setup') return;   // the setup screen closes with Spawn
  if (!menu.hidden) gameAudio.play('menuClose');
  menu.hidden = true;
  view = null;
  tell('menu:closed');
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

$('menu-button').addEventListener('click', () => welcomeScreen.open());   // welcome.js
menu.addEventListener('click', e => {
  if (e.target.closest('button, a') && !e.target.closest('.close, #spawn')) gameAudio.play('button');
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

// ---------- Reset all progress ----------
fills.reset = () => {
  $('reset-squares').textContent = `${squares} square${squares === 1 ? '' : 's'}`;
  $('reset-word').value = '';
  $('reset-go').disabled = true;
};
$('reset-open').addEventListener('click', () => show('reset'));
$('reset-word').addEventListener('input', () => { $('reset-go').disabled = $('reset-word').value.trim() !== 'RESET'; });
$('reset-go').addEventListener('click', async () => {
  if ($('reset-word').value.trim() !== 'RESET') return;
  $('reset-go').disabled = true;
  const r = await ask('resetProgress');   // on success the server also sends a 'reset' notice, which reloads
  if (r.error) { fail(r.error); $('reset-go').disabled = false; return; }
  location.reload();
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
  // Owned skins first (pick one), then a few locked ones with their price (they open the Skins screen).
  const owned = setupSkins.filter(k => k.owned), locked = setupSkins.filter(k => !k.owned).sort((a, b) => a.price - b.price).slice(0, 4);
  const skins = [...owned, ...locked].map(k => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'skin';
    b.setAttribute('role', 'radio');
    b.innerHTML = '<canvas class="skin-prev"></canvas><span class="label"></span>';
    drawSkinPreview(b.querySelector('canvas'), k, pick.color);
    b.querySelector('.label').textContent = k.name;
    if (k.owned) {
      b.setAttribute('aria-checked', pick.skin === k.id);
      b.classList.toggle('picked', pick.skin === k.id);
      b.addEventListener('click', () => { pick.skin = k.id; drawSetup(); });
    } else {
      b.setAttribute('aria-label', `${k.name}, ${k.price} squares`);
      b.insertAdjacentHTML('beforeend', `<span class="tag">${k.price.toLocaleString()}</span>`);
      b.addEventListener('click', () => { skinsBack = 'setup'; show('skins'); });
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

let setupSkins = [{ id: 'default', name: 'Default', kind: 'default', price: 0, owned: true }];
fills.setup = () => {
  pick ??= { color: myColor, skin: mySkin, coverage: myCoverage };
  ask('skins').then(list => { if (Array.isArray(list)) { setupSkins = list; if (view === 'setup') drawSetup(); } });
  $('setup-map').textContent = mapInfo.name.toUpperCase();
  drawSetup();
};
// Changed your mind: back to the welcome screen without spawning (nothing is saved until the first claim).
$('setup-cancel').addEventListener('click', () => {
  view = null;   // the setup screen can't be closed any other way
  menu.hidden = true;
  welcomeScreen.open();
});
$('spawn').addEventListener('click', async () => {
  $('spawn').disabled = true;
  const r = await ask('setup', pick);
  $('spawn').disabled = false;
  if (r.error) return fail(r.error);
  ({ color: myColor, skin: mySkin, coverage: myCoverage } = r);
  chosen.set(mapInfo.id, r);
  pick = null;
  view = null;   // lets the menu close
  menu.hidden = true;
  gameAudio.play('spawn');
  updateUI();
  tell('spawned');   // tutorial: brand-new players start here
});

// ---------- Skins ----------
// A skin's preview on a canvas: patterns in a color, art as it is, the plain look as the color itself.
function drawSkinPreview(canvas, skin, color) {
  canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 16, 16);
  if (skin.kind === 'default') return;
  const img = new Image();
  img.onload = () => {
    g.clearRect(0, 0, 16, 16);
    g.drawImage(img, 0, 0);
    if (skin.kind === 'pattern') { g.globalCompositeOperation = 'color'; g.fillStyle = color; g.fillRect(0, 0, 16, 16); g.globalCompositeOperation = 'source-over'; }
  };
  img.src = `skins/${skin.id}.png`;
}

let skinsBack = 'main';   // where the back button goes: the welcome screen, or the setup screen
let skinList = [], skinTab = 'Common';
// The tabs: by rarity (Ultra Rare sits with Legendary), and what you own. Collections are headings inside.
const SKIN_TABS = { Common: ['Common'], Rare: ['Rare'], Legendary: ['Ultra Rare', 'Legendary'] };
fills.skins = async () => {
  menu.querySelector('[data-view="skins"] .head [data-go]').dataset.go = skinsBack;
  skinsBack = 'main';
  const list = await ask('skins');
  if (view !== 'skins') return;
  skinList = Array.isArray(list) ? list : [];
  drawSkins();
};
function drawSkins() {
  $('skins-owned').textContent = `${skinList.filter(s => s.owned).length} owned`;
  $('skins-squares').textContent = squares;
  $('skins-tabs').replaceChildren(...[...Object.keys(SKIN_TABS), 'Owned'].map(name => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', name === skinTab);
    b.textContent = name;
    b.addEventListener('click', () => { skinTab = name; drawSkins(); });
    return b;
  }));
  const q = $('skins-search').value.trim().toLowerCase();
  // A search looks through every skin; otherwise the tab picks them.
  const shown = skinList.filter(s => q ? s.name.toLowerCase().includes(q) : skinTab === 'Owned' ? s.owned : SKIN_TABS[skinTab].includes(s.rarity));
  const groups = new Map();
  for (const s of shown) (groups.get(s.collection) ?? groups.set(s.collection, []).get(s.collection)).push(s);
  $('catalog').replaceChildren(...[...groups].flatMap(([collection, list]) => {
    const title = document.createElement('div');
    title.className = 'cat-title';
    title.textContent = `${collection.toUpperCase()} (${list.length})`;
    const grid = document.createElement('div');
    grid.className = 'catalog';
    for (const s of list) {
      const t = document.createElement('div');
      t.className = 'tile';
      t.innerHTML = '<canvas class="prev"></canvas><span class="nm"></span><span class="rar"></span>';
      drawSkinPreview(t.querySelector('canvas'), s, myColor);
      t.querySelector('.nm').textContent = s.name;
      t.querySelector('.rar').textContent = s.rarity.toUpperCase();
      t.querySelector('.rar').classList.add(s.rarity.replace(/ /g, '-'));   // 'Ultra Rare' has a space
      if (s.owned) {
        t.insertAdjacentHTML('beforeend', '<span class="pr" style="color: var(--green)">Owned</span>');
      } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn buy';
        const short = s.price - squares;
        b.disabled = short > 0;
        b.innerHTML = short > 0 ? `Need ${short.toLocaleString()} more` : `${s.price.toLocaleString()} <img class="sq-icon" src="icons/square.svg" width="12" height="12" alt="squares">`;
        b.addEventListener('click', () => buySkin(s, b));
        t.append(b);
      }
      grid.append(t);
    }
    return [title, grid];
  }));
  if (!shown.length) $('catalog').innerHTML = '<p class="note">No skins match.</p>';
}
$('skins-search').addEventListener('input', () => drawSkins());
async function buySkin(s, button) {
  button.disabled = true;   // a double tap sends one purchase
  const r = await ask('buySkin', { skin: s.id });
  if (r.error) { fail(r.need ? `${r.error}: ${r.need} more needed` : r.error); button.disabled = false; return; }
  gameAudio.play('purchase');
  squares = r.squares;
  updateUI();
  s.owned = true;
  toast(`${s.name} is yours`, 'good');
  if (view === 'skins') drawSkins();
}

// ---------- Upgrades ----------
const num = v => (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) ? 1 : 0, maximumFractionDigits: 2 });
const plural = (v, word) => `${word}${v === 1 ? '' : 's'}`;
// Each upgrade's effect at a level and what it means, shown as "+40% → +50% more powerful clicks": the real change,
// never a rounded count of clicks. Growth stays a count of blocks.
const pct = v => `+${Math.round((v - 1) * 1000) / 10}%`;
const UPGRADES = [
  { key: 'clickPower', name: 'Click Power', about: 'Each click counts as more hits', color: 'var(--orange)',
    icon: '<path d="M4 0h2v3h2v1H7v1H6v1H5v1H4v1H3V5H1V4h1V3h1V2h1z" fill="#0f131a"/>',
    effect: v => [pct(v), 'more powerful clicks'] },
  { key: 'defense', name: 'Defense', about: 'Others need more hits to take your blocks', color: 'var(--blue)',
    icon: '<path d="M0 0h8v4H7v2H6v1H5v1H3V7H2V6H1V4H0z" fill="#0f131a"/>',
    effect: v => [pct(v), 'more hits needed to take your blocks'] },
  { key: 'earnings', name: 'Earnings', about: 'More squares per brand-new block', color: 'var(--text)',
    icon: '<path d="M0 4h3v4H0zM5 4h3v4H5zM2 0h4v3H2z" fill="#0f131a"/>',
    effect: v => [pct(v), 'more squares per new block'] },
  { key: 'growth', name: 'Growth', about: 'More new map blocks per brand-new block', color: 'var(--green)',
    icon: '<path d="M3 0h2v3h3v2H5v3H3V5H0V3h3z" fill="#0f131a"/>',
    effect: v => [v, 'new map ' + plural(v, 'block') + ' per claim'] },
];
const show2 = n => typeof n === 'string' ? n : num(n).replace(/\.0$/, '');   // 4 rather than 4.0 in "5 → 4"

let upgradeData = null;
fills.upgrades = async () => {
  const u = await ask('upgrades');
  if (view !== 'upgrades') return;
  if (u.error) return fail(u.error);
  upgradeData = u;
  drawUpgrades();
  $('upg-squares').textContent = squares;
};
function drawUpgrades() {
  const u = upgradeData;
  $('upgrade-list').replaceChildren(...UPGRADES.map(up => {
    const levels = u.upgrades[up.key], top = levels.length - 1;
    const level = Math.min(Math.max(0, u.levels[up.key] | 0), top), next = levels[level + 1];
    const card = document.createElement('div');
    card.className = 'card upg';
    card.innerHTML = `<div class="top"><div class="ic"><svg class="pix" width="20" height="20" viewBox="0 0 8 8" aria-hidden="true">${up.icon}</svg></div>`
      + '<div style="display: flex; flex-direction: column"><span class="t"></span><span class="d"></span></div></div>'
      + '<div class="pips" aria-hidden="true"></div><div class="bar" hidden><div></div></div><div class="stat"><span></span><span></span></div>'
      + '<details class="levels-box"><summary></summary><ul class="levels"></ul></details>'
      + '<button class="btn" type="button"></button>';
    card.querySelector('.ic').style.background = up.color;
    card.querySelector('.t').textContent = up.name;
    card.querySelector('.d').textContent = up.about;
    // Pips for a few levels, a bar for many.
    const pips = card.querySelector('.pips'), bar = card.querySelector('.bar');
    pips.replaceChildren(...levels.slice(1).map((_, i) => {
      const p = document.createElement('span');
      p.className = 'pip';
      if (i < level) p.style.background = up.color;
      return p;
    }));
    pips.hidden = top < 1 || top > 20;
    bar.hidden = top <= 20;
    bar.firstElementChild.style.cssText = `width: ${level / (top || 1) * 100}%; background: ${up.color}`;
    // "Level 3" and "10 → 9 clicks per block", or "… · MAX" at the top.
    const [lv, eff] = card.querySelectorAll('.stat span');
    lv.textContent = `Level ${level}${top ? ` of ${top}` : ''}`;
    const [now, unit] = up.effect(levels[level].value, u);
    eff.textContent = next ? `${show2(now)} → ${show2(up.effect(next.value, u)[0])} ${unit}` : `${show2(now)} ${unit}`;
    // Every level, with its effect and cost.
    card.querySelector('summary').textContent = `All ${top} levels`;
    card.querySelector('.levels-box').hidden = top < 1;
    card.querySelector('.levels').replaceChildren(...levels.slice(1).map(l => {
      const li = document.createElement('li');
      li.className = l.level === level ? 'cur' : '';
      const [n, what] = up.effect(l.value, u);
      li.textContent = `Level ${l.level}: ${show2(n)} ${what} · ${l.cost.toLocaleString()} squares`;
      return li;
    }));
    // The button: buy the next level, or why not.
    const btn = card.querySelector('.btn');
    btn.style.cssText = `background: ${up.color}; color: var(--well)`;
    if (!next) { btn.disabled = true; btn.textContent = top ? 'MAX' : 'No levels yet'; }
    else if (u.balance + 1e-9 >= next.cost) {
      btn.innerHTML = `Upgrade · <img class="sq-icon" src="icons/square.svg" width="16" height="16" alt="squares"> ${next.cost.toLocaleString()}`;
      btn.addEventListener('click', () => buy(up, level, btn));
    } else {
      btn.disabled = true;
      btn.innerHTML = `<img class="sq-icon" src="icons/square.svg" width="16" height="16" alt="squares"> ${next.cost.toLocaleString()} · Need ${Math.ceil(next.cost - u.balance - 1e-9).toLocaleString()} more`;
    }
    return card;
  }));
}
async function buy(up, level, btn) {
  btn.disabled = true;   // one tap, one purchase (the server refuses repeats too)
  const r = await ask('buyUpgrade', { upgrade: up.key, level });
  if (r.error) {
    toast(r.need ? `${r.error}: need ${Math.ceil(r.need - 1e-9)} more` : r.error);
    return fills.upgrades();
  }
  gameAudio.play('purchase');
  Object.assign(upgradeData, { levels: r.levels, balance: r.balance });
  squares = r.squares;
  updateUI();
  $('upg-squares').textContent = squares;
  toast(`${up.name} level ${r.levels[up.key]}`, 'good');
  if (view === 'upgrades') drawUpgrades();
}

// ---------- Achievements ----------
// Grouped by category, each with its next tier and a progress bar toward it. Secret ones show as "???".
const fmtNum = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
const COUNTS_DOWN = new Set(['bestRank']);   // #3 is better than #10
let achData = null, achFilter = 'all';   // all, pending (not earned yet) or claimed (earned)

function drawAchievements() {
  const { list, earned, values } = achData;
  const got = new Set(earned.map(e => e.id));
  $('ach-total').textContent = `${got.size} / ${list.length}`;
  $('ach-total-bar').style.width = `${list.length ? got.size / list.length * 100 : 0}%`;
  for (const b of $('ach-filter').children) b.setAttribute('aria-selected', b.dataset.filter === achFilter);
  const groups = new Map();
  for (const a of list) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)).push(a);
  $('ach-list').replaceChildren(...[...groups].flatMap(([category, tiers]) => {
    const card = document.createElement('div'), done = tiers.filter(a => got.has(a.id)).length;
    if ((achFilter === 'pending' && done === tiers.length) || (achFilter === 'claimed' && !done)) return [];
    card.className = 'ach-cat' + (done === tiers.length ? ' got' : '');
    card.innerHTML = '<div class="ach-head"><span class="t"></span><span class="n"></span></div>';
    card.querySelector('.t').textContent = category;
    card.querySelector('.n').textContent = `${done} / ${tiers.length}`;
    if (tiers.every(a => a.secret)) {
      // Secrets: each on its own line.
      for (const a of tiers) {
        const row = document.createElement('div');
        row.className = 'ach-secret' + (got.has(a.id) ? ' got' : '');
        row.innerHTML = '<span class="t"></span><span class="sub"></span>';
        row.querySelector('.t').textContent = a.name;
        row.querySelector('.sub').textContent = got.has(a.id) ? `${a.description} · +${fmtNum(a.reward)} squares` : a.description;
        card.append(row);
      }
      return card;
    }
    const next = tiers.find(a => !got.has(a.id));
    const info = document.createElement('div');
    info.className = 'ach-next';
    if (next) {
      const v = values[next.stat] ?? 0, down = COUNTS_DOWN.has(next.stat);
      const share = down ? (v ? Math.min(1, next.threshold / v) : 0) : Math.min(1, v / next.threshold);
      info.innerHTML = '<span class="t"></span><span class="sub"></span><div class="bar"><div></div></div><span class="sub p"></span>';
      info.querySelector('.t').textContent = next.name;
      info.querySelector('.sub').textContent = `${next.description} · +${fmtNum(next.reward)} squares`;
      info.querySelector('.bar > div').style.width = `${share * 100}%`;
      info.querySelector('.p').textContent = down ? (v ? `Best so far: #${v}` : 'Not ranked yet') : `${fmtNum(v)} / ${fmtNum(next.threshold)}`;
    } else {
      info.innerHTML = '<span class="sub">All earned. Well played!</span>';
    }
    card.append(info);
    const pips = document.createElement('div');
    pips.className = 'ach-pips';
    for (const a of tiers) {
      const pip = document.createElement('span');
      if (got.has(a.id)) pip.className = 'on';
      pip.title = `${a.name}: ${a.description}`;
      pips.append(pip);
    }
    card.append(pips);
    return card;
  }));
}
for (const b of $('ach-filter').children) b.addEventListener('click', () => { achFilter = b.dataset.filter; if (achData) drawAchievements(); });
fills.achievements = async () => {
  const r = await ask('achievements');
  if (view !== 'achievements') return;
  if (r.error) return fail(r.error);
  achData = r;
  drawAchievements();
};

// The yellow pop-up when one is earned.
let popupTimer, achTimer;
function onAchievement(a) {
  gameAudio.play('achievement');
  tell('achievement', a);
  $('popup-what').textContent = a.description ? `${a.name} · ${a.description}` : a.name;
  $('popup-reward').hidden = !a.reward;
  $('popup-reward-n').textContent = `+${fmtNum(a.reward ?? 0)}`;
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
  } else if (!locked && !welcomeScreen.isOpen()) {   // on the welcome screen, PLAY shows it (welcome.js)
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
