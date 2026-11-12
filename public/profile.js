// ---------- Player profiles (loop 15) ----------
// openProfile(pid): from the leaderboard, chat, a map name tag, the death screen, or your own name on the welcome
// card. Shows nothing from the login system. On phones it's a sheet from the bottom (close: X or swipe down).
(function () {
  let showing = null;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  window.openProfile = pid => { showing = pid; show('profile'); };
  fills.profile = async () => {
    const pid = showing ?? me;
    $('pf-name').textContent = '…';
    const p = await new Promise(r => socket.timeout(10000).emit('profile', { pid }, (e, res) => r(e ? { error: 'No answer from the server. Try again.' } : res)));
    if (view !== 'profile') return;
    if (p.error) return fail(p.error);
    $('pf-name').textContent = p.name;
    $('pf-color').style.background = p.color || '#888';
    $('pf-tag').textContent = p.account ? 'ACCOUNT' : 'GUEST';
    $('pf-online').hidden = !p.online;
    // Achievements (the achievements plug-in's part of the profile): shown only when it's there.
    const ach = p.achievements;
    for (const el of [$('pf-ach'), $('pf-ach').previousElementSibling, $('pf-recent').parentElement]) el.hidden = !ach;
    if (ach) $('pf-ach').textContent = `${ach.earned} / ${ach.total}`;
    $('pf-best').textContent = p.best ? `${p.best.n.toLocaleString()} on ${p.best.map}` : 'None yet';
    $('pf-squares').textContent = fmtSq(p.squares);
    $('pf-now').textContent = p.map ? `${p.map}: ${p.blocks.toLocaleString()} block${p.blocks === 1 ? '' : 's'}${p.rank ? ` · #${p.rank}` : ''}` : '—';
    const since = new Date(p.since);
    $('pf-since').textContent = `${MONTHS[since.getMonth()]} ${since.getFullYear()}`;
    if (ach) $('pf-recent').replaceChildren(...(ach.recent.length ? ach.recent.map(a => {
      const li = document.createElement('li');
      li.textContent = a.name;
      li.append(Object.assign(document.createElement('span'), { textContent: a.description }));
      return li;
    }) : [Object.assign(document.createElement('li'), { textContent: 'None yet' })]));
    $('pf-all').onclick = () => { achTarget = String(p.id) === String(me) ? null : p.id; show('achievements'); };
    $('pf-plugins').replaceChildren(...Plugins.collect('profile', p).filter(Boolean));   // plug-ins' sections (skins: favorites)
    // Chat: mute or unmute them (not yourself).
    const other = String(p.id) !== String(me);
    $('pf-mute').hidden = !other;
    if (other) {
      const muted = () => window.chatMute?.has(p.id);
      $('pf-mute').textContent = muted() ? 'Unmute in chat' : 'Mute in chat';
      $('pf-mute').onclick = () => { window.chatMute?.set(p.id, p.name, !muted()); $('pf-mute').textContent = muted() ? 'Unmute in chat' : 'Mute in chat'; };
    }
  };

  // Your own profile: your name on the welcome card, or the Profile tile.
  $('w-name').addEventListener('click', () => { if (me) openProfile(me); });
  $('w-profile').addEventListener('click', () => { if (me) openProfile(me); else toast('Claim a block first to have a profile'); });

  // Phones: swipe the sheet down to close it.
  let startY = null;
  const panel = document.querySelector('#menu .panel');
  panel.addEventListener('touchstart', e => { startY = view === 'profile' && panel.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (startY !== null && e.changedTouches[0].clientY - startY > 80) closeMenu();
    startY = null;
  });
})();
