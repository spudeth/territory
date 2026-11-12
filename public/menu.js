// ---------- The menu: one panel showing one view at a time ----------
// Loaded after game.js (uses its socket, state and toast) and before account.js, which adds the account views.
// game.js calls afterWelcome and afterWipe (at the end of this file); they only run
// once the connection is open, after this file has loaded.

const menu = $('menu');
const fills = {};     // view name -> function that fills the view in just before it shows
let view = null;      // the view showing, or null when the menu is closed

// The Marketplace: one screen with tabs, each the screen it always was: [view, label, order]. The core has Land;
// plug-ins add theirs with addMarketTab (loop 19: skins, items). Upgrades is its own screen (loop 17).
const MARKET_TABS = [['land', 'Land', 30]];
let marketTab = null;   // the last tab shown (the first one until then)
function drawMarketTabs() {
  MARKET_TABS.sort((a, b) => a[2] - b[2]);
  for (const [v] of MARKET_TABS) {
    const section = menu.querySelector(`[data-view="${v}"]`);
    section.querySelector('.market-tabs')?.remove();
    const bar = document.createElement('div');
    bar.className = 'tabs market-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Marketplace');
    bar.replaceChildren(...MARKET_TABS.map(([t, label]) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t === v);
      b.addEventListener('click', () => { if (t !== v) show(t); });
      return b;
    }));
    section.querySelector('.head').after(bar);
  }
}
drawMarketTabs();
// A plug-in's Marketplace tab: a <section data-view="id"> made from `html` (a .head first), its label and place, and
// fill() to run just before it shows. Returns the section.
function addMarketTab({ id, label, order = 100, html, fill }) {
  const section = Object.assign(document.createElement('section'), { hidden: true, innerHTML: html });
  section.dataset.view = id;
  menu.querySelector('[data-view="land"]').before(section);
  MARKET_TABS.push([id, label, order]);
  if (fill) fills[id] = fill;
  drawMarketTabs();
  return section;
}
// A plug-in's own menu screen (loop 19: achievements): a <section data-view="id"> from `html` (a .head first), and
// fill() to run just before it shows. Returns the section.
function addScreen({ id, html, fill }) {
  const section = Object.assign(document.createElement('section'), { hidden: true, innerHTML: html });
  section.dataset.view = id;
  $('menu-error').before(section);
  if (fill) fills[id] = fill;
  return section;
}
function show(name) {
  if (name === 'market') name = MARKET_TABS.some(([t]) => t === marketTab) ? marketTab : MARKET_TABS[0][0];
  if (!menu.querySelector(`[data-view="${name}"]`) && name !== 'main') return;   // a plug-in's screen that isn't there (yet)
  if (MARKET_TABS.some(([t]) => t === name)) marketTab = name;
  if (name !== 'achievements' && typeof achTarget !== 'undefined') achTarget = null;
  if (name === 'main') return closeMenu();   // the old menu hub: the welcome screen is underneath now
  if (menu.hidden) gameAudio.play('menuOpen');
  for (const v of menu.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== name;
  const section = menu.querySelector(`[data-view="${name}"]`);
  section.querySelector('.head').after($('menu-error'));   // errors show under the view's title
  $('menu-error').textContent = '';
  menu.classList.toggle('strong', name === 'wipe' || name === 'reset' || name === 'setup');
  menu.classList.toggle('bare', name === 'wipe' || name === 'reset');
  menu.classList.toggle('sheet', name === 'profile');   // phones: a sheet from the bottom
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
  setNum($('hub-squares'), squares);
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
  $('reset-squares').textContent = `${fmtSq(squares)} square${squares === 1 ? '' : 's'}`;
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
  Plugins.run('setup', pick, drawSetup);   // plug-ins' choices (skins: skin and coverage)
}

fills.setup = () => {
  pick ??= { color: myColor, skin: mySkin, coverage: myCoverage };
  Plugins.run('setupOpen', pick, () => { if (view === 'setup') drawSetup(); });   // plug-ins load what their choices need (skins)
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


// ---------- Upgrades ----------
const num = v => (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) ? 1 : 0, maximumFractionDigits: 2 });
const plural = (v, word) => `${word}${v === 1 ? '' : 's'}`;
// Upgrades (loop 17, new curves in loop 18): tiers of S steps each, from the Upgrades tab. Each card: what it does,
// "Tier 1 · step 12/90", the value now → after the next step, Buy (that step's price) and Buy max (as many steps as
// you can afford, one purchase), and every tier's range and total cost. On a level-L block, an upgrade works at most
// at the end of tier L.
const UPGRADE_LOOKS = {
  clickPower: { color: 'var(--orange)', icon: '<path d="M4 0h2v3h2v1H7v1H6v1H5v1H4v1H3V5H1V4h1V3h1V2h1z" fill="#0f131a"/>' },
  defense: { color: 'var(--blue)', icon: '<path d="M0 0h8v4H7v2H6v1H5v1H3V7H2V6H1V4H0z" fill="#0f131a"/>' },
  earnings: { color: 'var(--text)', icon: '<path d="M0 4h3v4H0zM5 4h3v4H5zM2 0h4v3H2z" fill="#0f131a"/>' },
  growth: { color: 'var(--green)', icon: '<path d="M3 0h2v3h3v2H5v3H3V5H0V3h3z" fill="#0f131a"/>' },
  factorySpeed: { color: 'var(--yellow)', icon: '<path d="M0 8V3l2 1V3l2 1V3l2 1V0h2v8z" fill="#0f131a"/>' },
  factoryLifetime: { color: 'var(--teal)', icon: '<path d="M2 0h4v1H5v1h1v1h1v4H6v1H2V7H1V3h1V2h1V1H2zM4 3v2h2V4H5V3z" fill="#0f131a"/>' },
  factoryYield: { color: 'var(--pink)', icon: '<path d="M0 8V3l2 1V3l2 1V3l2 1V0h2v8zM3 6h2v1H3z" fill="#0f131a"/>' },
};
// A value with its unit: "x2.15 hits per tap", "1.4 new blocks", "4.5 hours awake".
// d: decimal places (enough to see a step's change; the card picks it).
const tierText = (v, unit, d = v < 10 ? 2 : 1) => {
  const n = Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
  if (Number(v.toFixed(d)) === 1) unit = unit.replace(/blocks$/, 'block');   // "1 new block"
  return /^x /.test(unit) ? `×${n} ${unit.slice(2)}` : `${n} ${unit}`;
};
// The value after s steps (the same formula as the server's catalog.stepValue): tier N runs from its range's
// `from` to `to` along a log curve, lo + (hi - lo) x ln(1 + g j/S) / ln(1 + g).
const stepValue = (up, s) => {
  const S = up.steps, n = Math.min(Math.max(0, s), up.tiers.length * S);
  if (n <= 0) return up.start;
  const t = up.tiers[Math.ceil(n / S) - 1], j = n - (t.tier - 1) * S;
  return t.from + (t.to - t.from) * Math.log(1 + up.gain * j / S) / Math.log(1 + up.gain);
};

let upgradeData = null;
fills.upgrades = async () => {
  const u = await ask('upgrades');
  if (view !== 'upgrades') return;
  if (u.error) return fail(u.error);
  upgradeData = u;
  drawUpgradeCards($('upgrade-list'));
  setNum($('upg-squares'), squares);
};
function drawUpgradeCards(list) {
  const u = upgradeData;
  list.replaceChildren(...u.list.map(up => {
    const S = up.steps, top = up.tiers.length * S;
    const look = UPGRADE_LOOKS[up.key] ?? { color: 'var(--raised)', icon: '' };
    const owned = u.steps[up.key] ?? 0, next = u.prices[up.key];
    const tier = Math.max(1, Math.ceil(owned / S)), step = owned === 0 ? 0 : owned - (tier - 1) * S;
    const card = document.createElement('div');
    card.className = 'card upg';
    card.innerHTML = `<div class="top"><div class="ic"><svg class="pix" width="20" height="20" viewBox="0 0 8 8" aria-hidden="true">${look.icon}</svg></div>`
      + '<div style="display: flex; flex-direction: column"><span class="t"></span><span class="d"></span></div></div>'
      + '<div class="pips" aria-hidden="true"></div><div class="stat"><span></span><span></span></div><p class="cap note" hidden></p>'
      + `<details class="levels-box"><summary>All ${up.tiers.length} tiers</summary><ul class="levels"></ul></details>`
      + '<div class="buy-row"><button class="btn buy-one" type="button"></button><button class="btn buy-max" type="button">Buy max</button></div>';
    card.querySelector('.ic').style.background = look.color;
    card.querySelector('.t').textContent = up.name;
    card.querySelector('.t').dataset.info = up.key;   // info.js
    card.querySelector('.d').textContent = up.about;
    // One pip per tier, filled as far as the steps go.
    card.querySelector('.pips').replaceChildren(...up.tiers.map(t => {
      const p = document.createElement('span'), lo = (t.tier - 1) * S, fill = Math.max(0, Math.min(1, (owned - lo) / S));
      p.className = 'pip';
      p.style.background = `linear-gradient(90deg, ${look.color} ${fill * 100}%, transparent ${fill * 100}%)`;
      return p;
    }));
    const [lv, eff] = card.querySelectorAll('.stat span');
    lv.textContent = owned >= top ? `Tier ${up.tiers.length} · max` : `Tier ${owned === 0 ? 1 : tier} · step ${step}/${S}`;
    const now = stepValue(up, owned);
    // As many decimals as it takes to see what the next step adds (a step is small: x1.0026 pay).
    let d = now < 10 ? 2 : 1;
    while (next && d < 4 && now.toFixed(d) === next.value.toFixed(d)) d++;
    eff.textContent = next ? `${tierText(now, up.unit, d)} → ${tierText(next.value, up.unit, d)}` : tierText(now, up.unit);
    // Past tier 1: on a lower-level block it works at most at the end of that block's level's tier.
    if (owned > S) {
      const c = card.querySelector('.cap');
      c.hidden = false;
      c.textContent = `In full on level-${tier}+ blocks. On a level-L block, at most the end of tier L (level 1: ${tierText(up.tiers[0].to, up.unit)}).`;
    }
    card.querySelector('.levels').replaceChildren(...up.tiers.map(t => {
      const li = document.createElement('li');
      li.className = t.tier === tier ? 'cur' : '';
      li.textContent = `Tier ${t.tier}: ${tierText(t.from, up.unit)} to ${tierText(t.to, up.unit)} · ${S} steps, ${fmtSq(t.cost)} squares in all`;
      return li;
    }));
    // The buttons: the next step, or why not; Buy max.
    const one = card.querySelector('.buy-one'), max = card.querySelector('.buy-max');
    one.style.cssText = `background: ${look.color}; color: var(--well)`;
    const price = n => `<img class="sq-icon" src="icons/square.svg" width="14" height="14" alt="squares"> ${fmtSq(n)}`;
    if (!next) { one.disabled = max.disabled = true; one.textContent = 'MAX'; }
    else if (u.highest < next.tier) { one.disabled = max.disabled = true; one.textContent = `Mine a level-${next.tier} block to unlock`; }
    else if (u.balance + 1e-9 >= next.price) {
      one.innerHTML = `Buy · ${price(next.price)}`;
      one.addEventListener('click', () => buySteps(up, owned, 1, one));
      max.addEventListener('click', () => buySteps(up, owned, 'max', max));
    } else {
      one.disabled = max.disabled = true;
      one.innerHTML = `${price(next.price)} · Need ${fmtNeed(next.price - u.balance)} more`;
    }
    return card;
  }));
}
async function buySteps(up, from, count, btn) {
  btn.disabled = true;   // one tap, one purchase (the server refuses repeats too)
  const r = await ask('buyUpgrade', { upgrade: up.key, from, count });
  if (r.error) {
    toast(r.need ? `${r.error}: need ${fmtNeed(r.need)} more` : r.error);
    return fills.upgrades();
  }
  gameAudio.play('purchase');
  squares = r.squares;
  updateUI();
  toast(r.bought > 1 ? `${up.name}: ${r.bought} steps` : `${up.name}: 1 step`, 'good');
  fills.upgrades();
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
