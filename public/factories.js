// ---------- Factories in the browser (loop 16; split from build.js in loop 19, a plug-in in Phase 5) ----------
// The Build menu's Factory tool, the factories on the map (awake or asleep art), and the info card's factory section
// (status, output, target, Wake up for yours).
let factories = new Map();   // "x,y" -> { x, y, owner, awakeUntil, paused }

(function () {
  BUILD_KINDS.factory = {
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
  };
  addBuildTool({ id: 'factory', order: 10, label: 'Factory', sub: info => `${fmtSq(info.factory.price)} squares · ${info.factory.count} of ${info.factory.limit}`,
    start: () => startPlacing('factory') });

  window.wakeFactoryAt = async (x, y) => {
    const r = await ask('wakeFactory', { x, y });
    if (r.error) return toast(r.error);
    gameAudio.play('spawn');
    toast('The factory is awake', 'good');
    if (inspecting) openInspect(inspecting);
  };

  // Factories from the server.
  socket.on('welcome', data => { factories = new Map((data.factories ?? []).map(f => [key(f.x, f.y), f])); });
  socket.on('factory', f => {
    if (f.gone) factories.delete(key(f.x, f.y)); else factories.set(key(f.x, f.y), f);
    draw();
  });

  // The info card: the block's factory (status, time awake left, output, target, Wake up for yours).
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

  // Factories on the map, under the territory borders: awake or asleep art.
  Plugins.add('factories', {
    drawUnder(ctx, { X, Y, r0, r1, c0, c1 }) {
      const awake = artImage('factory', draw), asleep = artImage('factoryAsleep', draw), now = Date.now();
      for (const f of factories.values()) {
        if (f.x < c0 || f.x >= c1 || f.y < r0 || f.y >= r1) continue;
        const img = f.paused || f.awakeUntil <= now ? asleep : awake;
        if (!img.complete || !img.naturalWidth) continue;
        const x0 = X(f.x), y0 = Y(f.y), w = X(f.x + 1) - x0, h = Y(f.y + 1) - y0, pad = Math.round(w * 0.12);
        ctx.drawImage(img, x0 + pad, y0 + pad, w - 2 * pad, h - 2 * pad);
      }
    },
  });
})();
