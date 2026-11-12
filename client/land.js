// ---------- The land market (loop 16) ----------
// Selling: Build → Sell land, tap your blocks to pick them (they must stay connected side to side; the count
// shows), enter a price, ✓. Listed blocks show the for-sale marker and can't get new buildings or walls. Cancel
// from the info card or the Land tab. Buying: press and hold a listed block; the card highlights the whole bundle
// with its price and Buy, then a confirm step. Accounts only. Any attack on a listed block ends the listing.
let listedBlocks = new Map();   // "x,y" -> listing id
let landListings = new Map();   // id -> { id, seller, price, size, levels, blocks }
let landSelect = null;          // while selling: Set of "x,y"
let landHighlight = null;       // the listing whose bundle the info card highlights

(function () {
  const bar = Object.assign(document.createElement('div'), { id: 'sell-bar', className: 'card', hidden: true });
  bar.innerHTML = '<span id="sell-msg"></span><input id="sell-price" type="number" min="0.1" step="0.1" inputmode="decimal" placeholder="Price" aria-label="Price in squares">'
    + '<button class="btn icon-btn" type="button" id="sell-ok" aria-label="List for sale">✓</button>'
    + '<button class="btn icon-btn" type="button" id="sell-cancel" aria-label="Cancel">✗</button>';
  document.body.append(bar);

  // Whether blocks ("x,y" keys) are connected side to side.
  function connected(keys) {
    if (!keys.size) return false;
    const left = new Set(keys), first = [...keys][0], queue = [first];
    left.delete(first);
    while (queue.length) {
      const [x, y] = queue.pop().split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = key(x + dx, y + dy); if (left.delete(n)) queue.push(n); }
    }
    return !left.size;
  }
  function refresh() {
    const n = landSelect.size, ok = connected(landSelect);
    $('sell-msg').textContent = !n ? 'Tap your blocks to sell' : ok ? `${n} block${n === 1 ? '' : 's'}` : `${n} blocks · not connected`;
    $('sell-msg').classList.toggle('bad', n > 0 && !ok);
    $('sell-ok').disabled = !ok || !(Number($('sell-price').value) > 0);
    draw();
  }
  addBuildTool({ id: 'sell', order: 30, label: 'Sell land', sub: () => 'Pick connected blocks, then a price', start: () => window.startSelling() });
  window.startSelling = () => {
    landSelect = new Set();
    $('sell-price').value = '';
    bar.hidden = false;
    closeInspect();
    refresh();
  };
  const stopSelling = () => { landSelect = null; bar.hidden = true; draw(); };
  $('sell-cancel').addEventListener('click', stopSelling);
  $('sell-price').addEventListener('input', refresh);
  $('sell-ok').addEventListener('click', async () => {
    $('sell-ok').disabled = true;
    const r = await ask('listLand', { blocks: [...landSelect].map(k => k.split(',').map(Number)), price: Number($('sell-price').value) });
    if (r.error) { toast(r.error); return refresh(); }
    gameAudio.play('purchase');
    toast('Your land is for sale', 'good');
    stopSelling();
  });
  // While selling, a tap picks or unpicks one of your blocks (game.js asks here first).
  const before = window.buildTap;
  window.buildTap = (c, sx, sy) => {
    if (!landSelect) return before(c, sx, sy);
    const k = key(c.x, c.y);
    if (cells.get(k) !== me) toast('Only your own blocks');
    else if (listedBlocks.has(k)) toast('That block is already for sale');
    else if (landSelect.has(k)) landSelect.delete(k); else landSelect.add(k);
    refresh();
    return true;
  };

  // Listings from the server.
  const put = l => { landListings.set(l.id, l); for (const [x, y] of l.blocks) listedBlocks.set(key(x, y), l.id); };
  const drop = id => { const l = landListings.get(id); if (!l) return; landListings.delete(id); for (const [x, y] of l.blocks) listedBlocks.delete(key(x, y)); };
  socket.on('welcome', data => {
    listedBlocks = new Map();
    landListings = new Map();
    for (const l of data.listings ?? []) put(l);
    stopSelling();
  });
  socket.on('listing', l => { if (l.gone) drop(l.id); else put(l); if (view === 'land') fills.land(); draw(); });

  // The info card: a listed block shows its bundle (highlighted), price and Buy, or Cancel for your own.
  inspectSections.push(info => {
    landHighlight = info.listing ?? null;
    draw();
    if (!info.listing) return null;
    const l = info.listing, box = Object.assign(document.createElement('div'), { className: 'ic-sec hl' });
    box.append(Object.assign(document.createElement('div'), { className: 'ic-row', innerHTML: '<span>For sale</span><b></b>' }));
    box.querySelector('b').textContent = `${l.size} block${l.size === 1 ? '' : 's'} · ${fmtSq(l.price)} squares`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn' });
    if (l.mine) {
      b.textContent = 'Cancel the listing';
      b.addEventListener('click', async () => { const r = await ask('cancelListing', { id: l.id }); if (r.error) return toast(r.error); toast('No longer for sale', 'good'); closeInspect(); });
    } else {
      b.textContent = `Buy · ${fmtSq(l.price)}`;
      b.addEventListener('click', () => {
        if (b.dataset.confirm) return buy(l);
        b.dataset.confirm = '1';
        b.textContent = `Confirm: pay ${fmtSq(l.price)} squares for ${l.size} block${l.size === 1 ? '' : 's'}`;
      });
    }
    box.append(b);
    return box;
  });
  async function buy(l) {
    const r = await ask('buyLand', { id: l.id });
    if (r.error) return toast(r.need ? `${r.error}: need ${fmtNeed(r.need)} more` : r.error);
    gameAudio.play('purchase');
    toast(`${r.blocks} block${r.blocks === 1 ? '' : 's'} bought`, 'good');
    closeInspect();
  }
  const closeBefore = window.closeInspect;
  window.closeInspect = () => { landHighlight = null; closeBefore(); draw(); };

  // The Marketplace's Land tab: every listing on this map, with Jump to it.
  fills.land = async () => {
    const r = await ask('landList');
    if (view !== 'land') return;
    if (r.error) return fail(r.error);
    $('land-list').replaceChildren(...(r.list.length ? r.list.map(l => {
      const c = document.createElement('div');
      c.className = 'item-card';
      c.innerHTML = `<div class="ic" style="background: var(--yellow)"><img class="pix" src="${ART.forSale}" width="26" height="26" alt=""></div>`
        + '<div><div class="nm"></div><div class="ds"></div></div><div class="act"></div>';
      c.querySelector('.nm').textContent = `${l.size} block${l.size === 1 ? '' : 's'} · ${fmtSq(l.price)} squares`;
      c.querySelector('.ds').textContent = `${l.mine ? 'Yours' : `By ${l.seller.name ?? 'someone'}`} · level ${l.levels[0] === l.levels[1] ? l.levels[0] : `${l.levels[0]}-${l.levels[1]}`}`;
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Jump to it' });
      b.addEventListener('click', () => { closeMenu(); lookAt(l.blocks[0][0] + 0.5, l.blocks[0][1] + 0.5); openInspect({ x: l.blocks[0][0], y: l.blocks[0][1] }); });
      c.querySelector('.act').append(b);
      return c;
    }) : [Object.assign(document.createElement('p'), { className: 'note', textContent: 'No land for sale on this map right now.' })]));
  };
})();

// For-sale markers, the bundle the card highlights, and the blocks picked while selling. From drawBuilt.
window.drawListings = (ctx, X, Y, r0, r1, c0, c1) => {
  const img = artImage('forSale', draw);
  for (const [k, id] of listedBlocks) {
    const [x, y] = k.split(',').map(Number);
    if (x < c0 || x >= c1 || y < r0 || y >= r1) continue;
    const x0 = X(x), y0 = Y(y), w = X(x + 1) - x0, h = Y(y + 1) - y0;
    if (landHighlight?.id === id) { ctx.fillStyle = 'rgba(255,211,77,0.35)'; ctx.fillRect(x0, y0, w, h); }
    if (img.complete && img.naturalWidth) ctx.drawImage(img, x0 + w * 0.55, y0 + h * 0.05, w * 0.4, h * 0.4);
  }
  if (landSelect) for (const k of landSelect) {
    const [x, y] = k.split(',').map(Number), x0 = X(x), y0 = Y(y), w = X(x + 1) - x0, h = Y(y + 1) - y0;
    ctx.fillStyle = 'rgba(255,211,77,0.45)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  }
};
