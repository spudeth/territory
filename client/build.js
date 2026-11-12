// ---------- Build (loop 16; core since loop 19) ----------
// The Build button (under the leaderboard) opens a small menu of the tools that registered with addBuildTool:
// factories, walls, selling land. It shows only when some tool is there. Placing one thing: pick it, tap a block; a
// see-through ghost shows there (green, or red with a short reason), tapping another block moves it; ✓ buys, ✗
// cancels. Placing many (walls, multi: true): each tap adds or drops one, the bar shows the count and total, ✓ buys
// them all. Each kind of building is an entry in BUILD_KINDS (what it needs, how it shows, what ✓ sends).
let buildGhost = null;       // what draw() shows while placing one thing: { x, y, ok }
const BUILD_KINDS = {};      // kind -> { label, place, refuse, send, done } (or multi: start, tap, count, summary, send, done, stop)
const BUILD_MENU = [];       // { id, order, label, sub(info), start(info) }: the menu's entries
// A tool for the Build menu: id is also the key of its reason in buildInfo (why it can't be used now).
function addBuildTool(tool) {
  BUILD_MENU.push(tool);
  BUILD_MENU.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const btn = document.getElementById('build-btn');
  if (btn) btn.hidden = false;
}

(function () {
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn build-btn', id: 'build-btn', hidden: !BUILD_MENU.length });
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
    const why = info.reasons ?? {};
    // A tool that can't be used says why when it's picked, before any ghost appears.
    const item = t => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn' + (why[t.id] ? ' dim' : '') });
      b.append(Object.assign(document.createElement('span'), { textContent: t.label }), Object.assign(document.createElement('small'), { textContent: why[t.id] ?? t.sub(info) }));
      b.addEventListener('click', () => { menuBox.hidden = true; if (why[t.id]) toast(why[t.id]); else t.start(info); });
      return b;
    };
    menuBox.replaceChildren(...BUILD_MENU.map(item));
    menuBox.hidden = false;
  }
  btn.addEventListener('click', e => { e.stopPropagation(); if (!menuBox.hidden) menuBox.hidden = true; else openMenu(); });
  addEventListener('click', e => { if (!menuBox.contains(e.target) && e.target !== btn) menuBox.hidden = true; });

  window.startPlacing = function startPlacing(kind, info) {
    placing = BUILD_KINDS[kind];
    buildGhost = null;
    placing.start?.(info);
    $('build-msg').textContent = placing.multi ? placing.summary() : `${placing.label}: tap where it goes`;
    $('build-msg').classList.remove('bad');
    $('build-ok').disabled = true;
    bar.hidden = false;
    closeInspect?.();
    draw();
  };
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
  socket.on('welcome', () => stopPlacing());
})();

// Draws for-sale markers and the ghost while placing, over the map (plug-ins draw theirs with drawUnder and
// drawOver). Called by game.js render with its helpers.
function drawBuilt(ctx, X, Y, r0, r1, c0, c1) {
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
