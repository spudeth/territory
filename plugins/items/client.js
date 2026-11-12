// ---------- Items in the browser (loop 14; a plug-in since loop 19) ----------
// The Marketplace's Items tab (buy; used-up items in any number), the item bar on the game screen (use, with uses
// and timers), Super Click's countdown, the Terraformer's tap-a-block-then-pick-a-terrain flow, and Demolition's
// tap-blocks-then-✓. Limits are enforced on the server (server.js). It reaches the core only through hooks
// (Plugins.add below, addMarketTab) and the page's shared helpers (socket, toast, cells, …).
(function () {
  let demolishing = new Set();   // "x,y": blocks picked for Demolition (shown red, drawOver below)
  const LOOK = '/plugins/items/look/';
  Object.assign(INFO, ItemsText.info);   // its "i" texts (text.js)
  // Its pieces of the page: the item bar, the Terraformer's and Demolition's picker, and the Marketplace tab.
  const bar = Object.assign(document.createElement('div'), { id: 'itembar', hidden: true });
  const pick = Object.assign(document.createElement('div'), { id: 'terra-pick', className: 'card', hidden: true });
  pick.innerHTML = '<span id="terra-msg">Tap one of your blocks, or an empty one next to your land</span><div id="terra-choices"></div>'
    + '<button class="btn" type="button" id="terra-cancel">Cancel</button>';
  document.body.append(bar, pick);
  addMarketTab({ id: 'items', label: 'Items', order: 20, fill: () => { drawScreen(); load(); }, html: `<div class="head">
      <button class="btn icon-btn" type="button" data-go="main" aria-label="Back to menu"><svg class="pix" width="16" height="16" aria-hidden="true"><use href="#i-back"/></svg></button>
      <h1>MARKETPLACE</h1>
    </div>
    <p style="margin: 0; font-size: 15px; color: var(--soft)">${ItemsText.marketIntro}</p>
    <div class="split" style="align-items: center"><span data-info="items">Your squares</span><span class="chip"><img class="sq-icon" src="icons/square.svg" width="14" height="14" alt=""><span id="items-squares">0</span></span></div>
    <div id="items-list" class="items-list"></div>` });
  const ICONS = {
    clickMultiplier: '<svg class="pix" width="26" height="26" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 0h3L5 3h2L2 8l1-4H1z" fill="#0f131a"/></svg>',
    terraform: '<svg class="pix" width="26" height="26" viewBox="0 0 8 8" aria-hidden="true"><path d="M0 6l2-3 2 2 2-4 2 5v2H0z" fill="#0f131a"/></svg>',
    demolish: '<img class="pix" src="' + LOOK + 'demolition.png" width="26" height="26" alt="" style="filter: brightness(0) opacity(0.85)">',
  };
  const COLORS = { clickMultiplier: 'var(--yellow)', terraform: 'var(--teal)', demolish: 'var(--red)' };
  const TERRAINS = ['grass', 'sand', 'forest', 'stone', 'water'];
  let items = [], superUntil = 0, picking = null;   // picking: the Terraformer item, while choosing a block
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const ask = (event, data) => new Promise(r => socket.timeout(10000).emit(event, data, (e, res) => r(e ? { error: 'No answer from the server. Try again.' } : res)));

  async function load() {
    const r = await ask('items:list', {});
    if (Array.isArray(r.list)) { items = r.list; drawBar(); if (view === 'items') drawScreen(); }
  }
  socket.on('items:changed', () => load());
  socket.on('items:superClick', ({ until }) => { superUntil = until; drawBar(); });

  // ---------- The Items screen (its fill is in addMarketTab above) ----------
  function drawScreen() {
    setNum($('items-squares'), squares);
    $('items-list').replaceChildren(...items.map(i => {
      const c = document.createElement('div');
      c.className = 'item-card';
      c.innerHTML = `<div class="ic" style="background: ${COLORS[i.effect] ?? 'var(--raised)'}">${ICONS[i.effect] ?? ''}</div>`
        + '<div><div class="nm"></div><div class="ds"></div></div><div class="act"></div>';
      c.querySelector('.nm').textContent = i.name;
      c.querySelector('.nm').dataset.info = 'items';
      c.querySelector('.ds').textContent = i.description;
      const act = c.querySelector('.act');
      if (i.owned && !i.consumable) act.innerHTML = '<span style="color: var(--green); font-weight: 600">Owned</span>';
      else {
        if (i.consumable) act.append(Object.assign(document.createElement('span'), { className: 'have', textContent: `You have ${i.count}` }));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn buy';
        // Used-up items: how many to buy, 1 to 100 (− and +; no keyboard).
        let qty = 1;
        const show = () => {
          const short = i.price * qty - squares;
          b.disabled = short > 0;
          b.innerHTML = short > 0 ? `Need ${fmtNeed(short)} more`
            : `Buy${qty > 1 ? ' ' + qty : ''} ${fmtSq(i.price * qty)} <img class="sq-icon" src="icons/square.svg" width="14" height="14" alt="squares">`;
          if (n) n.textContent = qty;
        };
        let n = null;
        if (i.consumable) {
          const pick = Object.assign(document.createElement('div'), { className: 'qty' });
          const step = (d, label) => {
            const x = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: label });
            x.setAttribute('aria-label', d < 0 ? 'One fewer' : 'One more');
            x.addEventListener('click', () => { qty = Math.min(100, Math.max(1, qty + d)); show(); });
            return x;
          };
          n = Object.assign(document.createElement('span'), { className: 'n' });
          pick.append(step(-1, '−'), n, step(1, '+'));
          act.append(pick);
        }
        show();
        b.addEventListener('click', async () => {
          b.disabled = true;
          const r = await ask('items:buy', { item: i.id, ...(qty > 1 ? { qty } : {}) });
          if (r.error) { b.disabled = false; return toast(r.need ? `${r.error}: ${r.need} more needed` : r.error); }
          gameAudio.play('purchase');
          squares = r.squares;
          updateUI();
          toast(i.consumable ? `${i.name}: you have ${r.count}` : `${i.name} is yours`, 'good');
          load();
        });
        act.append(b);
      }
      return c;
    }));
  }

  // ---------- The item bar ----------
  function label(i) {
    const now = Date.now();
    if (i.effect === 'clickMultiplier' && superUntil > now) return `${i.name}: ${fmt(superUntil - now)}`;
    const wait = i.nextAt && i.nextAt > now ? `, next in ${fmt(i.nextAt - now)}` : '';
    if (i.consumable) return `${i.name} ×${i.count}`;
    return i.uses > 1 ? `${i.name} ${i.usesLeft}/${i.uses}${wait}` : i.usesLeft ? i.name : `${i.name}${wait}`;
  }
  function drawBar() {
    const owned = items.filter(i => i.owned);
    $('itembar').hidden = !owned.length;
    $('itembar').replaceChildren(...owned.map(i => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + ((i.effect === 'clickMultiplier' && superUntil > Date.now()) || picking === i ? ' on' : '');
      b.innerHTML = ICONS[i.effect] ?? '';
      b.append(label(i));
      b.disabled = !i.usesLeft && !(picking === i);
      b.addEventListener('click', () => use(i));
      return b;
    }));
  }
  setInterval(() => {   // timers tick; a use that frees up shows at once
    if (!items.some(i => i.owned)) return;
    for (const i of items) if (i.nextAt && i.nextAt <= Date.now() && i.usesLeft < i.uses) { load(); break; }
    drawBar();
  }, 1000);

  async function use(i) {
    if (i.effect === 'terraform' || i.effect === 'demolish') return picking === i ? stopPicking() : startPicking(i);
    const r = await ask('items:use', { item: i.id });
    if (r.error) return toast(r.nextAt ? `${r.error}: free in ${fmt(r.nextAt - Date.now())}` : r.error);
    gameAudio.play('achievement');
  }

  // ---------- Demolition (loop 18): tap your blocks (each turns red; tap again to drop it), then ✓ ----------
  // Everything built on each goes (walls, factory), no refund. One Demolition per block with something on it; you
  // can't pick more blocks than you have Demolitions.
  const builtHere = k => Plugins.collect('built', k).some(Boolean);   // anything built on it, whoever built it
  function demolishMsg(item) {
    const used = [...demolishing].filter(builtHere).length;
    $('terra-msg').textContent = demolishing.size
      ? `${demolishing.size} picked · uses ${used} · you have ${item.count}`
      : `Tap your blocks to clear what's built on them (you have ${item.count})`;
    ok.disabled = !used;
  }
  const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'btn icon-btn', textContent: '✓' });
  ok.setAttribute('aria-label', 'Demolish');
  ok.addEventListener('click', async () => {
    const item = picking;
    if (!item || item.effect !== 'demolish') return;
    ok.disabled = true;
    const r = await ask('items:use', { item: item.id, blocks: [...demolishing].map(k => k.split(',').map(Number)) });
    if (r.error) { ok.disabled = false; return toast(r.error); }
    gameAudio.play('wipe');
    toast(`Cleared ${r.cleared} ${r.cleared === 1 ? 'block' : 'blocks'}`, 'good');
    stopPicking();
  });
  function demolishTap(item, c) {
    const k = key(c.x, c.y);
    if (cells.get(k) !== me) { $('terra-msg').textContent = 'Only your own blocks'; return; }
    if (demolishing.has(k)) demolishing.delete(k);
    else if (demolishing.size >= item.count) { $('terra-msg').textContent = `You have ${item.count} ${item.name}: drop one first`; draw(); return; }
    else demolishing.add(k);
    demolishMsg(item);
    draw();
  }

  // ---------- Terraformer: tap a block, then pick a terrain ----------
  function startPicking(i) {
    picking = i;
    demolishing = new Set();
    $('terra-msg').textContent = 'Tap one of your blocks, or an empty one next to your land';
    $('terra-choices').replaceChildren(...(i.effect === 'demolish' ? [ok] : []));
    if (i.effect === 'demolish') demolishMsg(i);
    $('terra-pick').hidden = false;
    drawBar();
  }
  function stopPicking() { picking = null; demolishing = new Set(); $('terra-pick').hidden = true; drawBar(); draw(); }
  $('terra-cancel').addEventListener('click', stopPicking);
  function itemTap(c) {
    if (!picking) return false;
    const item = picking;
    if (item.effect === 'demolish') { demolishTap(item, c); return true; }
    $('terra-msg').textContent = 'Pick the new terrain (gold can\'t be made)';
    $('terra-choices').replaceChildren(...TERRAINS.map(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = t[0].toUpperCase() + t.slice(1);
      b.style.backgroundImage = `url(tiles/${t === 'grass' ? 'tile_0000' : 'terrain-' + t + (t === 'water' ? '-0' : '')}.png)`;
      b.addEventListener('click', async () => {
        const r = await ask('items:use', { item: item.id, x: c.x, y: c.y, terrain: t });
        if (r.error) return toast(r.nextAt ? `${r.error}: free in ${fmt(r.nextAt - Date.now())}` : r.error);
        gameAudio.play('grow');
        stopPicking();
      });
      return b;
    }));
    return true;
  }

  Plugins.add('items', {
    welcome: () => load(),
    tap: c => itemTap(c),
    // Blocks picked for Demolition: the whole block red, over everything.
    drawOver(ctx, { X, Y, r0, r1, c0, c1, dpr }) {
      for (const k of demolishing) {
        const [x, y] = k.split(',').map(Number);
        if (x < c0 || x >= c1 || y < r0 || y >= r1) continue;
        const x0 = X(x), y0 = Y(y), bw = X(x + 1) - x0, bh = Y(y + 1) - y0;
        ctx.fillStyle = 'rgba(255,77,77,0.6)';
        ctx.fillRect(x0, y0, bw, bh);
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = Math.max(2, Math.round(dpr * 2));
        ctx.strokeRect(x0 + 1, y0 + 1, bw - 2, bh - 2);
      }
    },
  });
})();
