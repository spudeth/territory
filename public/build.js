// ---------- Build (loop 16) ----------
// The Build button (under the leaderboard) opens a small menu: Factory, Wall, Sell land. (Waking a factory is on
// its info card: press and hold it.) Placing one thing: pick it, tap a block; a see-through ghost shows there
// (green, or red with a short reason), tapping another block moves it; ✓ buys, ✗ cancels. Placing many (walls,
// multi: true): each tap adds or drops one, the bar shows the count and total, ✓ buys them all.
// Each kind of building is an entry in BUILD_KINDS (what it needs, how it shows, what ✓ sends), so a new
// building or add-on is one more entry.
let factories = new Map();   // "x,y" -> { x, y, owner, awakeUntil, paused }
let buildGhost = null;       // what draw() shows while placing one thing: { x, y, ok }

const BUILD_KINDS = {
  factory: {
    label: 'Factory',
    // Why not here (shown in red), or null.
    refuse(c) {
      const k = key(c.x, c.y);
      if (cells.get(k) !== me) return 'Only on your own land';
      if ((terrainChanges.get(k) ?? (world ? world.at(c.x, c.y) : 'grass')) === 'water') return 'Not on water';
      if (factories.has(k)) return 'There is a factory here already';
      if (typeof listedBlocks !== 'undefined' && listedBlocks.has(k)) return 'Not on land for sale';
      return null;
    },
    place: c => ({ x: c.x, y: c.y }),
    send: g => ({ kind: 'factory', x: g.x, y: g.y }),
    done: 'Factory built',
  },
};

(function () {
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn build-btn', id: 'build-btn' });
  btn.innerHTML = `<img class="pix" src="${ART.build}" width="16" height="16" alt="">Build`;
  $('board').append(btn);
  const menuBox = Object.assign(document.createElement('div'), { id: 'build-menu', className: 'card', hidden: true });
  document.body.append(menuBox);
  const bar = Object.assign(document.createElement('div'), { id: 'build-bar', className: 'card', hidden: true });
  bar.innerHTML = '<span id="build-msg"></span><button class="btn icon-btn" type="button" id="build-ok" aria-label="Build here">✓</button>'
    + '<button class="btn icon-btn" type="button" id="build-cancel" aria-label="Cancel">✗</button>';
  document.body.append(bar);
  let placing = null;   // the BUILD_KINDS entry being placed

  async function openMenu() {
    if (!me) return toast('Claim a block first');
    const info = await ask('buildInfo');
    if (info.error) return toast(info.error);
    const f = info.factory, why = info.reasons ?? {};
    // A tool that can't be used says why when it's picked, before any ghost appears.
    const tool = (name, start) => () => (why[name] ? toast(why[name]) : start());
    const item = (label, sub, onClick, disabled, dim) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn' + (dim ? ' dim' : ''), disabled: !!disabled });
      b.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('small'), { textContent: sub }));
      b.addEventListener('click', () => { menuBox.hidden = true; onClick(); });
      return b;
    };
    menuBox.replaceChildren(
      item('Factory', why.factory ?? `${fmtSq(f.price)} squares · ${f.count} of ${f.limit}`, tool('factory', () => startPlacing('factory')), false, !!why.factory),
      ...(BUILD_KINDS.wall ? [item('Wall', why.wall ?? BUILD_KINDS.wall.sub?.() ?? 'Tap near the edge of your land', tool('wall', () => startPlacing('wall', info)), false, !!why.wall)] : []),
      ...(window.startSelling ? [item('Sell land', why.sell ?? 'Pick connected blocks, then a price', tool('sell', () => window.startSelling()), false, !!why.sell)] : []));
    menuBox.hidden = false;
  }
  btn.addEventListener('click', e => { e.stopPropagation(); if (!menuBox.hidden) menuBox.hidden = true; else openMenu(); });
  addEventListener('click', e => { if (!menuBox.contains(e.target) && e.target !== btn) menuBox.hidden = true; });

  window.wakeFactoryAt = async (x, y) => {
    const r = await ask('wakeFactory', { x, y });
    if (r.error) return toast(r.error);
    gameAudio.play('spawn');
    toast('The factory is awake', 'good');
    if (inspecting) openInspect(inspecting);
  };

  function startPlacing(kind, info) {
    placing = BUILD_KINDS[kind];
    buildGhost = null;
    placing.start?.(info);
    $('build-msg').textContent = placing.multi ? placing.summary() : `${placing.label}: tap where it goes`;
    $('build-msg').classList.remove('bad');
    $('build-ok').disabled = true;
    bar.hidden = false;
    closeInspect?.();
    draw();
  }
  function stopPlacing() { placing?.stop?.(); placing = null; buildGhost = null; bar.hidden = true; draw(); }
  $('build-cancel').addEventListener('click', stopPlacing);
  $('build-ok').addEventListener('click', async () => {
    if (!placing || (placing.multi ? !placing.count() : !buildGhost?.ok)) return;
    $('build-ok').disabled = true;
    const r = await ask('build', placing.multi ? placing.send() : placing.send(buildGhost));
    if (r.error) { $('build-ok').disabled = false; return toast(r.need ? `${r.error}: need ${fmtNeed(r.need)} more` : r.error); }
    gameAudio.play('purchase');
    toast(typeof placing.done === 'function' ? placing.done(r) : placing.done, 'good');
    stopPlacing();
  });
  // game.js asks here first on every tap: while placing, a tap moves the ghost (screen position for edges).
  window.buildTap = (c, sx, sy) => {
    if (!placing) return false;
    if (placing.multi) {   // each tap adds or drops one
      placing.tap(c, sx, sy);
      $('build-msg').textContent = placing.summary();
      $('build-ok').disabled = !placing.count();
      draw();
      return true;
    }
    const spot = placing.place(c, sx, sy);
    const why = spot ? placing.refuse(spot) : 'Pick a block';
    buildGhost = spot ? { ...spot, ok: !why } : null;
    $('build-msg').textContent = why ?? `${placing.label}: ✓ to build here, or tap another block`;
    $('build-msg').classList.toggle('bad', !!why);
    $('build-ok').disabled = !!why;
    draw();
    return true;
  };

  // Factories from the server.
  socket.on('welcome', data => {
    factories = new Map((data.factories ?? []).map(f => [key(f.x, f.y), f]));
    stopPlacing();
  });
  socket.on('factory', f => {
    if (f.gone) factories.delete(key(f.x, f.y)); else factories.set(key(f.x, f.y), f);
    draw();
  });

  // The info card: the block's factory (status, time awake left, target, Wake up for yours).
  const left = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  inspectSections.push(info => {
    if (!info.factory) return null;
    const f = info.factory, box = Object.assign(document.createElement('div'), { className: 'ic-sec' });
    const asleep = f.awakeUntil <= Date.now();
    const status = f.paused ? 'Paused (own more land)' : asleep ? 'Asleep (Zzz)' : `Awake · ${left(f.awakeUntil - Date.now())} left`;
    const row = (a, b) => { const r = Object.assign(document.createElement('div'), { className: 'ic-row' }); r.append(Object.assign(document.createElement('span'), { textContent: a }), Object.assign(document.createElement('b'), { textContent: b })); return r; };
    // Output: new blocks an hour at its current target (loop 18).
    const ph = f.perHour ?? 0, out = ph ? `${ph.toLocaleString(undefined, { maximumFractionDigits: ph < 10 ? 1 : 0 })} new ${ph === 1 ? 'block' : 'blocks'} an hour${f.paused || asleep ? ' when awake' : ''}` : 'None (nothing to mine)';
    box.append(row('Factory', status), row('Output', out), row('Target', f.target ? `${f.target.x}, ${f.target.y}` : 'None (idle)'));
    if (f.mine) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: 'Wake up' });
      b.addEventListener('click', () => wakeFactoryAt(info.x, info.y));
      box.append(b);
    }
    return box;
  });
})();

// Draws factories, for-sale markers and the ghost while placing, over the map (walls come after the borders). Called by game.js render with its helpers.
function drawBuilt(ctx, X, Y, r0, r1, c0, c1) {
  const awake = artImage('factory', draw), asleep = artImage('factoryAsleep', draw), now = Date.now();
  for (const f of factories.values()) {
    if (f.x < c0 || f.x >= c1 || f.y < r0 || f.y >= r1) continue;
    const img = f.paused || f.awakeUntil <= now ? asleep : awake;
    if (!img.complete || !img.naturalWidth) continue;
    const x0 = X(f.x), y0 = Y(f.y), w = X(f.x + 1) - x0, h = Y(f.y + 1) - y0, pad = Math.round(w * 0.12);
    ctx.drawImage(img, x0 + pad, y0 + pad, w - 2 * pad, h - 2 * pad);
  }
  window.drawListings?.(ctx, X, Y, r0, r1, c0, c1);
  if (buildGhost) {
    const g = buildGhost, x0 = X(g.x), y0 = Y(g.y), w = X(g.x + 1) - x0, h = Y(g.y + 1) - y0;
    ctx.fillStyle = g.ok ? 'rgba(0,228,90,0.45)' : 'rgba(255,77,77,0.45)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = g.ok ? '#00e45a' : '#ff4d4d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  }
}
