// ---------- Items (loop 14) ----------
// The Items screen (buy), the item bar on the game screen (use, with uses and timers), Super Click's countdown,
// and the Terraformer's tap-a-block-then-pick-a-terrain flow. Limits are enforced on the server.
(function () {
  const ICONS = {
    clickMultiplier: '<svg class="pix" width="26" height="26" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 0h3L5 3h2L2 8l1-4H1z" fill="#0f131a"/></svg>',
    terraform: '<svg class="pix" width="26" height="26" viewBox="0 0 8 8" aria-hidden="true"><path d="M0 6l2-3 2 2 2-4 2 5v2H0z" fill="#0f131a"/></svg>',
    demolish: '<img class="pix" src="' + ART.demolition + '" width="26" height="26" alt="" style="filter: brightness(0) opacity(0.85)">',
  };
  const COLORS = { clickMultiplier: 'var(--yellow)', terraform: 'var(--teal)', demolish: 'var(--red)' };
  const TERRAINS = ['grass', 'sand', 'forest', 'stone', 'water'];
  let items = [], superUntil = 0, picking = null;   // picking: the Terraformer item, while choosing a block
  const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const ask = (event, data) => new Promise(r => socket.timeout(10000).emit(event, data, (e, res) => r(e ? { error: 'No answer from the server. Try again.' } : res)));

  async function load() {
    const r = await ask('items', {});
    if (Array.isArray(r.list)) { items = r.list; drawBar(); if (view === 'items') drawScreen(); }
  }
  socket.on('welcome', () => load());
  socket.on('itemsChanged', () => load());
  socket.on('superClick', ({ until }) => { superUntil = until; drawBar(); });

  // ---------- The Items screen ----------
  fills.items = () => { drawScreen(); load(); };
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
        const b = document.createElement('button'), short = i.price - squares;
        b.type = 'button';
        b.className = 'btn buy';
        b.disabled = short > 0;
        b.innerHTML = short > 0 ? `Need ${fmtNeed(short)} more` : `Buy ${fmtSq(i.price)} <img class="sq-icon" src="icons/square.svg" width="14" height="14" alt="squares">`;
        b.addEventListener('click', async () => {
          b.disabled = true;
          const r = await ask('buyItem', { item: i.id });
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
    const r = await ask('useItem', { item: i.id });
    if (r.error) return toast(r.nextAt ? `${r.error}: free in ${fmt(r.nextAt - Date.now())}` : r.error);
    gameAudio.play('achievement');
  }

  // ---------- Demolition: tap your factory or wall, then confirm (no refund) ----------
  async function demolishAt(item, c) {
    const info = await ask('inspect', c);
    if (info.error) return toast(info.error);
    const mine = info.owner && String(info.owner.pid) === String(me);
    const SIDES = { n: 'top', e: 'right', s: 'bottom', w: 'left' };
    const choices = !mine ? [] : [...(info.factory ? [['factory', null, 'Remove the factory']] : []),
      ...(info.walls ?? []).map(w => ['wall', w.side, `Remove the ${SIDES[w.side]} wall`])];
    if (!choices.length) { $('terra-msg').textContent = 'No factory or wall of yours there. Tap another block.'; return; }
    $('terra-msg').textContent = 'Removed for good, no refund:';
    $('terra-choices').replaceChildren(...choices.map(([target, side, label]) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: label });
      b.style.width = 'auto';
      b.addEventListener('click', async () => {
        const r = await ask('useItem', { item: item.id, x: c.x, y: c.y, target, side });
        if (r.error) return toast(r.error);
        gameAudio.play('wipe');
        stopPicking();
      });
      return b;
    }));
  }

  // ---------- Terraformer: tap a block, then pick a terrain ----------
  function startPicking(i) {
    picking = i;
    $('terra-msg').textContent = i.effect === 'demolish' ? 'Tap one of your factories or walls' : 'Tap one of your blocks, or an empty one next to your land';
    $('terra-choices').replaceChildren();
    $('terra-pick').hidden = false;
    drawBar();
  }
  function stopPicking() { picking = null; $('terra-pick').hidden = true; drawBar(); }
  $('terra-cancel').addEventListener('click', stopPicking);
  window.itemTap = c => {
    if (!picking) return false;
    const item = picking;
    if (item.effect === 'demolish') { demolishAt(item, c); return true; }
    $('terra-msg').textContent = 'Pick the new terrain (gold can\'t be made)';
    $('terra-choices').replaceChildren(...TERRAINS.map(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = t[0].toUpperCase() + t.slice(1);
      b.style.backgroundImage = `url(tiles/${t === 'grass' ? 'tile_0000' : 'terrain-' + t + (t === 'water' ? '-0' : '')}.png)`;
      b.addEventListener('click', async () => {
        const r = await ask('useItem', { item: item.id, x: c.x, y: c.y, terrain: t });
        if (r.error) return toast(r.nextAt ? `${r.error}: free in ${fmt(r.nextAt - Date.now())}` : r.error);
        gameAudio.play('grow');
        stopPicking();
      });
      return b;
    }));
    return true;
  };
})();

socket.connect();   // every script has loaded now (game.js)
