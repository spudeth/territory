// ---------- Skins in the browser (loop 15; a plug-in since loop 19) ----------
// How territories look (the look hook game.js asks: plain, a pattern in the owner's color, or art; per block or one
// image over the whole area), the Skins tab of the Marketplace (buy, star), the skin and coverage choices on the
// setup screen, and favorites on the profile. Images are in art/skins/ (<id>.png, <id>-large.png, <id>-anim.png).
(function () {
  const LOOK = '/art/skins/';
  let kinds = {}, animated = [];   // from the welcome: { id: 'pattern' | 'art' }, and the animated (Legendary) ids
  Object.assign(INFO, SkinsText.info);

  // A darker shade of a color, for the second color in skin patterns.
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16), d = c => Math.round(c * 0.62).toString(16).padStart(2, '0');
    return '#' + d(n >> 16) + d((n >> 8) & 255) + d(n & 255);
  }
  const paint = (el, color) => { el.style.setProperty('--c', color); el.style.setProperty('--c2', shade(color)); };


  // ---------- The Skins tab ----------
  const section = addMarketTab({ id: 'skins', label: 'Skins', order: 10, html: `<div class="head">
  <button class="btn icon-btn" type="button" data-go="main" aria-label="Back to menu"><svg class="pix" width="16" height="16" aria-hidden="true"><use href="#i-back"/></svg></button>
  <h1>MARKETPLACE</h1>
  <span class="right" id="skins-owned"></span>
</div>
<p style="margin: 0; font-size: 15px; line-height: 1.35; color: var(--soft)">Buy skins with squares. Owned skins work on every map: you pick one when you first enter a map. Prices follow this map's level.</p>
<div class="split" style="align-items: center"><span data-info="skinPrices">Your squares</span><span class="chip"><img class="sq-icon" src="art/icons/square.svg" width="14" height="14" alt=""><span id="skins-squares">0</span></span></div>
<div class="tabs yellow" role="tablist" aria-label="Collections" id="skins-tabs"></div>
<input class="field" id="skins-search" type="search" placeholder="Search skins, e.g. Japan" autocomplete="off" aria-label="Search skins">
<div id="catalog"></div>
`, fill: () => fills.skins() });
  section.querySelector('#skins-search').addEventListener('input', () => drawSkins());

  // A skin's preview on a canvas: patterns in a color, art as it is, the plain look as the color itself.
  function drawSkinPreview(canvas, skin, color) {
    canvas.width = canvas.height = 16;
    const g = canvas.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 16, 16);
    if (skin.kind === 'default') return;
    const anim = animated.includes(skin.id), img = new Image();
    img.onload = () => {
      g.clearRect(0, 0, 16, 16);
      if (anim) {   // Legendary: play its 4 frames while the preview is on screen
        let f = 0;
        const tick = () => { if (!canvas.isConnected) return clearInterval(t); g.drawImage(img, (f++ % 4) * 16, 0, 16, 16, 0, 0, 16, 16); };
        const t = setInterval(tick, 220);
        return tick();
      }
      g.drawImage(img, 0, 0);
      if (skin.kind === 'pattern') { g.globalCompositeOperation = 'color'; g.fillStyle = color; g.fillRect(0, 0, 16, 16); g.globalCompositeOperation = 'source-over'; }
    };
    img.src = `${LOOK}${skin.id}${anim ? '-anim' : ''}.png`;
  }

  let skinsBack = 'main';   // where the back button goes: the welcome screen, or the setup screen
  let skinList = [], skinTab = 'Common';
  // The tabs: by rarity (Ultra Rare sits with Legendary), and what you own. Collections are headings inside.
  const SKIN_TABS = { Common: ['Common'], Rare: ['Rare'], Legendary: ['Ultra Rare', 'Legendary'] };
  fills.skins = async () => {
    menu.querySelector('[data-view="skins"] .head [data-go]').dataset.go = skinsBack;
    skinsBack = 'main';
    const list = await ask('skins:list');
    if (view !== 'skins') return;
    skinList = Array.isArray(list) ? list : [];
    drawSkins();
  };
  function drawSkins() {
    $('skins-owned').textContent = `${skinList.filter(s => s.owned).length} owned`;
    setNum($('skins-squares'), squares);
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
    if (skinTab === 'Owned' && !q && shown.some(s => s.starred)) groups.set('★ Starred', shown.filter(s => s.starred));   // only here
    for (const s of shown) if (!(skinTab === 'Owned' && !q && s.starred)) (groups.get(s.collection) ?? groups.set(s.collection, []).get(s.collection)).push(s);
    $('catalog').replaceChildren(...[...groups].flatMap(([collection, list]) => {
      const title = document.createElement('div');
      title.className = 'cat-title';
      title.textContent = `${collection.toUpperCase()} (${list.length})`;
      if (collection === '★ Starred' || (skinTab === 'Owned' && collection === [...groups.keys()][0])) title.dataset.info = 'starring';
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
          if (skinTab === 'Owned' && s.starrable) {   // star one pattern and one art skin (tap again to remove)
            const star = document.createElement('button');
            star.type = 'button';
            star.className = 'btn star' + (s.starred ? ' on' : '');
            star.setAttribute('aria-pressed', s.starred);
            star.setAttribute('aria-label', (s.starred ? 'Unstar ' : 'Star ') + s.name);
            star.textContent = '★';
            star.addEventListener('click', async () => {
              const r = await ask('skins:star', { skin: s.id, on: !s.starred });
              if (r.error) return fail(r.error);
              fills.skins();
            });
            t.append(star);
          }
        } else {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn buy';
          const short = s.price - squares;
          b.disabled = short > 0;
          b.innerHTML = short > 0 ? `Need ${fmtNeed(short)} more` : `${fmtSq(s.price)} <img class="sq-icon" src="art/icons/square.svg" width="12" height="12" alt="squares">`;
          b.addEventListener('click', () => buySkin(s, b));
          t.append(b);
        }
        grid.append(t);
      }
      return [title, grid];
    }));
    if (!shown.length) $('catalog').innerHTML = '<p class="note">No skins match.</p>';
  }
  async function buySkin(s, button) {
    button.disabled = true;   // a double tap sends one purchase
    const r = await ask('skins:buy', { skin: s.id });
    if (r.error) { fail(r.need ? `${r.error}: ${r.need} more needed` : r.error); button.disabled = false; return; }
    gameAudio.play('purchase');
    squares = r.squares;
    updateUI();
    s.owned = true;
    toast(`${s.name} is yours`, 'good');
    if (view === 'skins') drawSkins();
  }

  // ---------- The setup screen: skin and coverage (after the colors) ----------
  let setupSkins = [{ id: 'default', name: 'Default', kind: 'default', price: 0, owned: true }];
  const box = document.createElement('div');
  box.style.display = 'contents';
  box.innerHTML = `<h2 class="sec">2 · SKIN</h2>
<div class="skins" role="radiogroup" aria-label="Skin" id="setup-skins"></div>
<h2 class="sec"><span data-info="coverage">3 · COVERAGE</span></h2>
<div class="coverages" role="radiogroup" aria-label="Coverage">
  <button class="card" type="button" role="radio" data-coverage="tile">
    <span style="display: grid; grid-template-columns: repeat(3, 12px); gap: 2px" aria-hidden="true">
      <span class="pat-stripes cov-mini"></span><span class="pat-stripes cov-mini"></span><span class="pat-stripes cov-mini"></span>
      <span class="pat-stripes cov-mini"></span><span class="pat-stripes cov-mini"></span><span class="pat-stripes cov-mini"></span>
    </span>
    <span class="t">Per block</span><span class="d">Skin repeats on each block</span>
  </button>
  <button class="card" type="button" role="radio" data-coverage="stretch">
    <span class="pat-stripes cov-full" aria-hidden="true"></span>
    <span class="t">Full area</span><span class="d">One big image over it all</span>
  </button>
</div>
`;
  document.getElementById('setup-colors').after(box);
  let pick = null, redraw = () => {};
  for (const b of box.querySelectorAll('[data-coverage]')) b.addEventListener('click', () => { if (pick) { pick.coverage = b.dataset.coverage; redraw(); } });

  Plugins.add('skins', {
    welcome(part) { kinds = part?.kinds ?? {}; animated = part?.animated ?? []; },
    // How owner p's land is drawn.
    look(p) {
      const kind = p?.skin && p.skin !== 'default' ? kinds[p.skin] : null;
      if (!kind) return null;
      const anim = animated.includes(p.skin);
      return { kind, id: p.skin, full: p.coverage === 'stretch', anim, src: large => `${LOOK}${p.skin}${large ? '-large' : ''}${anim ? '-anim' : ''}.png` };
    },
    setupOpen(p, done) {
      ask('skins:list').then(list => { if (Array.isArray(list)) { setupSkins = list; done(); } });
    },
    setup(p, draw) {
      pick = p;
      redraw = draw;
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
          b.addEventListener('click', () => { pick.skin = k.id; redraw(); });
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
      box.querySelector('#setup-skins').replaceChildren(...skins, all);
      for (const b of box.querySelectorAll('[data-coverage]')) {
        b.setAttribute('aria-checked', b.dataset.coverage === pick.coverage);
        b.classList.toggle('picked', b.dataset.coverage === pick.coverage);
        for (const p of b.querySelectorAll('.cov-mini, .cov-full')) paint(p, pick.color);
      }
    },
    // The profile: their starred pattern and art skin, large, in their color.
    profile(p) {
      if (!p.stars) return null;
      const sec = document.createElement('div');
      sec.innerHTML = '<div class="cat-title" style="margin-top: 0">FAVORITES</div><div class="pf-stars"></div>';
      const list = sec.querySelector('.pf-stars');
      const stars = [p.stars.pattern, p.stars.art].filter(Boolean);
      list.replaceChildren(...(stars.length ? stars.map(id => {
        const box = document.createElement('div'), c = document.createElement('canvas');
        drawSkinPreview(c, { id, kind: kinds[id] ?? 'art' }, p.color || '#888');
        box.append(c, Object.assign(document.createElement('span'), { textContent: id.startsWith('flag-') ? 'Flag' : 'Starred' }));
        return box;
      }) : [Object.assign(document.createElement('span'), { textContent: 'No favorite yet' })]));
      return sec;
    },
  });
})();
