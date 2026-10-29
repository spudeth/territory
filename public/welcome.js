// ---------- Welcome screen ----------
// Every visit opens here, over the live map of the selected map: blurred, dimmed, zooming out slowly and then
// drifting. PLAY zooms into the game; the in-game MENU button comes back. The camera moves are CSS transforms on
// the map canvas, so the map is redrawn only at the start and the end of a move, not on every frame.
(function () {
  // Maps that aren't ready yet: shown whited out with COMING SOON. Edit this list to add or remove them.
  const PLACEHOLDER_MAPS = [
    { name: 'White Plains', style: 'white', about: 'A plain white map' },
    { name: '???', style: 'dirt', about: 'More maps on the way' },
  ];
  const ZOOM = 1.7;          // the game view is this much closer than the welcome background
  const MOVE_MS = 1200;      // PLAY and MENU camera moves
  const EASE = 'cubic-bezier(.2, .7, .2, 1)';
  const BACKGROUND_RES = () => innerWidth < 700 ? 0.4 : 0.6;   // the blurred background is drawn at lower resolution

  const body = document.body, cnv = $('map'), stage = $('stage');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let open = true, moving = false, switching = false;
  let target = null;         // where PLAY zooms to: { cx, cy, s } (block coordinates, scale)
  let serverMaps = [], entries = [], index = 0;

  body.classList.add('welcome', 'intro', 'drifting');
  renderScale = BACKGROUND_RES();
  addEventListener('visibilitychange', () => body.classList.toggle('paused', document.hidden));   // no drift while hidden

  // ---------- Where the camera goes ----------
  // Returning players: the middle of their territory. Everyone else: a random open patch of empty blocks.
  function chooseTarget() {
    const s = Math.min(MAX_SCALE, Math.max(Math.min(innerWidth, innerHeight) * 0.92 / mapSpan(), 40));
    const mine = [], open8 = [], open4 = [], empty = [];
    for (const [k, o] of cells) {
      const [x, y] = k.split(',').map(Number);
      if (me && o === me) { mine.push([x, y]); continue; }
      if (o !== null || world?.at(x, y) === 'water') continue;   // water can't be claimed
      empty.push([x, y]);
      const free = (dx, dy) => cells.get(key(x + dx, y + dy)) === null && world?.at(x + dx, y + dy) !== 'water';
      if (free(1, 0) && free(-1, 0) && free(0, 1) && free(0, -1)) {
        open4.push([x, y]);
        if (free(1, 1) && free(-1, -1) && free(1, -1) && free(-1, 1)) open8.push([x, y]);
      }
    }
    if (mine.length) {
      return { cx: mine.reduce((t, [x]) => t + x, 0) / mine.length + 0.5, cy: mine.reduce((t, [, y]) => t + y, 0) / mine.length + 0.5, s };
    }
    const pool = open8.length ? open8 : open4.length ? open4 : empty;
    if (!pool.length) return { cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2, s };
    const [x, y] = pool[Math.floor(Math.random() * pool.length)];
    return { cx: x + 0.5, cy: y + 0.5, s };
  }

  // The background view: centred on the target, ZOOM times further out.
  function frameBackground() {
    if (!target) return;
    scale = target.s / ZOOM;
    ox = innerWidth / 2 - target.cx * scale;
    oy = innerHeight / 2 - target.cy * scale;
    draw();
  }

  // Moves the canvas picture with a CSS transform: the view drawn now (scale, ox, oy) is shown as if it were
  // drawn with `to`, so a redraw at `to` afterwards changes nothing on screen.
  const transformTo = to => {
    const a = to.s / scale;
    return `translate(${to.ox - a * ox}px, ${to.oy - a * oy}px) scale(${a})`;
  };
  const reflow = () => void cnv.offsetWidth;

  // ---------- PLAY ----------
  // after: runs once the player is in the game (e.g. the tutorial from Settings > How to play).
  function play(after) {
    if (!open || moving || !cells) return;
    open = false; moving = true;
    gameAudio.play('spawn');
    const t = target ?? chooseTarget();
    const game = { s: t.s, ox: innerWidth / 2 - t.cx * t.s, oy: innerHeight / 2 - t.cy * t.s };
    const land = () => {
      renderScale = 1;
      ({ s: scale, ox, oy } = game);
      cnv.style.transition = 'none';
      cnv.style.transform = '';
      render();
      reflow();
      cnv.style.transition = '';
      body.classList.remove('zooming');
      moving = false;
      clampView();
      enterGame(after);
    };
    if (reduceMotion.matches) {
      body.classList.remove('welcome', 'intro', 'drifting');
      return land();
    }
    // Freeze the zoom-out and drift where they are, as one transform on the canvas, then zoom from there.
    const r = cnv.getBoundingClientRect(), k = r.width / innerWidth;
    cnv.style.transition = 'none';
    cnv.style.transform = `translate(${r.left}px, ${r.top}px) scale(${k})`;
    body.classList.remove('intro', 'drifting');
    reflow();
    cnv.style.transition = `transform ${MOVE_MS}ms ${EASE}, filter .9s ease`;
    cnv.style.transform = transformTo(game);
    body.classList.add('zooming');
    body.classList.remove('welcome');
    setTimeout(land, MOVE_MS);
  }

  // In the game: the setup screen if this map's look isn't chosen yet (brand-new or wiped), else carry on.
  function enterGame(after) {
    updateUI();
    if (!locked && !chosen.has(mapInfo.id)) {
      pick = null;
      show('setup');   // Spawn there starts the tutorial for brand-new players
      return;
    }
    resumeTutorial();
    showTip();   // coach.js: a tip that waited for the game
    after?.();
  }

  // ---------- MENU: back to the welcome screen ----------
  function openWelcome() {
    if (open || moving) return;
    closeMenu();
    open = true; moving = true;
    const game = { s: scale, ox, oy };
    target = { cx: (innerWidth / 2 - ox) / scale, cy: (innerHeight / 2 - oy) / scale, s: scale };   // PLAY comes back here
    renderScale = BACKGROUND_RES();
    frameBackground();
    fill();
    refreshMaps();
    if (tip) { tipQueue.unshift(tip); tip = null; drawCoach(); }   // coach.js: a tip waits for the game again
    tell('menu:main');   // tutorial: the menu tour
    if (reduceMotion.matches) {
      body.classList.add('welcome');
      moving = false;
      return;
    }
    // Draw the background view now, shown exactly as the game view, then let it fall back and blur.
    cnv.style.transition = 'none';
    cnv.style.transform = transformTo(game);
    render();
    reflow();
    cnv.style.transition = `transform ${MOVE_MS}ms ${EASE}, filter .9s ease`;
    cnv.style.transform = '';
    body.classList.add('welcome');
    setTimeout(() => {
      cnv.style.transition = '';
      body.classList.add('drifting');
      moving = false;
    }, MOVE_MS);
  }

  // ---------- The card ----------
  function fill() {
    $('w-name').textContent = myName || 'Connecting…';
    $('w-color').style.background = myColor;
    $('w-tag').textContent = myAccount ? 'ACCOUNT' : 'GUEST';
    $('w-squares').textContent = squares;
    $('w-login').hidden = myAccount || !accountsOn;
    drawSound();
    drawPicker();
  }

  function buildEntries() {
    const names = new Set(serverMaps.map(m => m.name.toLowerCase()));
    entries = [...serverMaps.map(m => ({ ...m, real: true })),
      ...PLACEHOLDER_MAPS.filter(p => !names.has(p.name.toLowerCase())).map(p => ({ ...p, real: false }))];
    if (!serverMaps.length && mapInfo) entries.unshift({ id: mapInfo.id, name: mapInfo.name, style: mapInfo.style, real: true });
    const here = entries.findIndex(e => e.real && String(e.id) === String(mapInfo?.id));
    if (here >= 0 && !switching) index = here;
    index = Math.min(index, entries.length - 1);
  }

  async function refreshMaps() {
    const list = await ask('maps');
    if (Array.isArray(list) && list.length) serverMaps = list;
    buildEntries();
    drawPicker();
  }

  function drawPicker() {
    if (!entries.length) buildEntries();
    const e = entries[index];
    if (!e) return;
    const here = e.real && String(e.id) === String(mapInfo?.id);
    const thumb = $('w-thumb'), c = $('w-thumb-canvas');
    thumb.className = `w-thumb ${e.style === 'white' ? 'white' : e.style === 'dirt' ? 'dirt' : 'grass'}${e.real ? '' : ' soon'}`;
    if (here && cells) drawThumb(c);
    else { c.width = c.height = 1; c.getContext('2d').clearRect(0, 0, 1, 1); }
    $('w-soon').hidden = e.real;
    $('w-map-name').textContent = e.name;
    $('w-map-name').classList.toggle('soon', !e.real);
    let line1 = e.about ?? '', line2 = '';
    if (e.real) {
      // The map being shown is counted live; others come from the server.
      const mine = here ? myBlocks() : e.mine ?? 0;
      const rank = here ? 1 + Object.values(blockCounts()).filter(n => n > mine).length : e.rank;
      const size = here ? cells.size : e.blocks ?? 0;
      const played = mine > 0 || (here ? locked : e.played);
      line1 = mine ? `You: ${mine.toLocaleString()} block${mine === 1 ? '' : 's'} · #${rank}`
        : played ? 'You: no blocks here right now' : "You haven't played this map yet";
      line2 = `${size.toLocaleString()} blocks and growing`;
    }
    $('w-stat-1').textContent = line1;
    $('w-stat-2').textContent = line2;
    $('w-stat-2').hidden = !line2;
    $('w-play').hidden = !e.real;
    $('w-play').disabled = !here || switching || !cells;
    $('w-soon-btn').hidden = e.real;
    $('w-dots').replaceChildren(...entries.map((_, i) => {
      const d = document.createElement('span');
      if (i === index) d.className = 'on';
      return d;
    }));
  }

  // The arrows: a real map becomes the selected map (the background cross-fades to it); a placeholder only shows.
  async function step(by) {
    if (!entries.length || switching) return;
    index = (index + by + entries.length) % entries.length;
    const e = entries[index];
    drawPicker();
    if (!e.real || String(e.id) === String(mapInfo?.id)) return;
    switching = true;
    drawPicker();
    stage.classList.add('fading');
    const r = await ask('switchMap', e.id);   // the map itself arrives as a 'welcome' (onWelcome below)
    if (r.error) {
      switching = false;
      stage.classList.remove('fading');
      toast(r.error);
      buildEntries();
      drawPicker();
    }
  }
  $('w-prev').addEventListener('click', () => step(-1));
  $('w-next').addEventListener('click', () => step(1));
  $('w-play').addEventListener('click', () => play());

  // Shortcuts open the menu screens over the welcome screen; closing them comes back here.
  for (const b of document.querySelectorAll('#welcome [data-go]')) {
    b.addEventListener('click', () => { gameAudio.play('button'); show(b.dataset.go); });
  }

  // Sound on or off: effects and music together.
  function drawSound() {
    const off = gameAudio.settings.sfx.muted && gameAudio.settings.music.muted;
    $('w-sound').setAttribute('aria-label', off ? 'Sound on' : 'Sound off');
    $('w-sound').setAttribute('aria-pressed', off);
    $('w-sound').innerHTML = `<svg class="pix" width="18" height="18" aria-hidden="true"><use href="#i-${off ? 'muted' : 'sound'}"/></svg>`;
  }
  $('w-sound').addEventListener('click', () => {
    const off = !(gameAudio.settings.sfx.muted && gameAudio.settings.music.muted);
    gameAudio.set('sfx', { muted: off });
    gameAudio.set('music', { muted: off });
    drawSound();
    if (typeof drawVolumes === 'function') drawVolumes();
  });

  // ---------- Hooks for game.js ----------
  window.welcomeScreen = {
    isOpen: () => open,
    isMoving: () => moving,
    open: openWelcome,
    play,
    // A map arrived (first load, reconnect or a switch in the picker): frame the background on it.
    onWelcome(newMap) {
      if (newMap || !target) target = chooseTarget();
      frameBackground();
      if (switching) { switching = false; stage.classList.remove('fading'); }
      fill();
      refreshMaps();
    },
    reframe: frameBackground,   // the window changed size
    refresh() { if (open) fill(); },
  };
})();
