// ---------- The block info card (loop 16) ----------
// Press and hold a block (inspectHoldMs), or right-click it on a computer, to see what it is: coordinates,
// terrain, level and hardness; its pay if mined or the hits to take it; its owner (tap for their profile).
// The card is a list of sections: each is a function (info) -> element or null. Later features add a section
// (land listings) with inspectSections.push; plug-ins (walls, factories) with their infoCard hook.
const inspectSections = [];
let inspecting = null;   // the block on the card, { x, y }, or null

(function () {
  const card = Object.assign(document.createElement('div'), { id: 'inspect', className: 'card', hidden: true });
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Block info');
  document.body.append(card);
  const TERRAIN_NAMES = { grass: 'Grass', sand: 'Sand', forest: 'Forest', stone: 'Stone', gold: 'Gold', water: 'Water' };
  const row = (label, value) => {
    const r = document.createElement('div');
    r.className = 'ic-row';
    r.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('b'), { textContent: value }));
    return r;
  };

  // The basics, first.
  inspectSections.push(info => {
    const box = document.createElement('div');
    box.append(row('Terrain', TERRAIN_NAMES[info.terrain] ?? info.terrain), row('Level', String(info.level)),
      row('Hardness', `${info.hardness.toLocaleString()} hits`));
    if (info.water) box.append(row('Water', "can't be claimed"));
    else if (info.pay !== undefined) box.append(row('Pay if mined', `${fmtSq(info.pay)} squares`));
    else if (info.hits !== undefined) box.append(row('Hits to take', info.hits.toLocaleString()));
    if (info.owner) {
      const r = row('Owner', '');
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'text-btn', textContent: info.owner.name ?? 'Someone' });
      b.addEventListener('click', () => { closeInspect(); openProfile(info.owner.pid); });
      r.querySelector('b').append(b);
      box.append(r);
    }
    return box;
  });

  window.openInspect = async c => {
    inspecting = c;
    card.replaceChildren(Object.assign(document.createElement('div'), { className: 'ic-head', textContent: 'Loading…' }));
    card.hidden = false;
    const info = await new Promise(r => socket.timeout(10000).emit('inspect', c, (e, res) => r(e ? { error: 'No answer from the server. Try again.' } : res)));
    if (inspecting !== c) return;
    if (info.error) { closeInspect(); return toast(info.error); }
    showInspect(info);
  };
  // Fills the card from an info object (the server's answer; also used when it changes while open).
  window.showInspect = info => {
    const head = document.createElement('div');
    head.className = 'ic-head';
    const icon = artImage('infoCard');
    head.append(Object.assign(document.createElement('img'), { src: icon.src, width: 16, height: 16, alt: '', className: 'pix' }),
      Object.assign(document.createElement('span'), { textContent: `BLOCK ${info.x}, ${info.y}` }));
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 'btn icon-btn', textContent: '✕' });
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', closeInspect);
    head.append(x);
    card.replaceChildren(head, ...inspectSections.map(f => f(info)).filter(Boolean), ...Plugins.collect('infoCard', info).filter(Boolean));   // plug-ins add theirs (loop 19)
  };
  window.closeInspect = () => { inspecting = null; card.hidden = true; };
  addEventListener('keydown', e => { if (e.key === 'Escape' && !card.hidden) closeInspect(); });
  canvas.addEventListener('pointerdown', () => { if (!card.hidden) closeInspect(); });
})();
