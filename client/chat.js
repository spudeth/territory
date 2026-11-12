// ---------- Chat with everyone on this map (bottom right) ----------
// Closed: the newest few messages show over the map and fade. Open: the last 30, a box to type in, and tap a
// name to mute that player on this device. The server cleans messages and limits how often they're sent.
(function () {
  const box = $('chat'), log = $('chat-log'), form = $('chat-form'), input = $('chat-input');
  const SHOWN_CLOSED = 4;       // newest messages shown while closed
  const FADE_MS = 12000;        // how long a new message stays over the map while closed
  const KEEP = 30;              // messages kept in the open log (the server sends the last 30 on arrival)

  let muted;
  try { muted = new Set(JSON.parse(localStorage.getItem('territory-muted') || '[]')); } catch { muted = new Set(); }
  const saveMuted = () => { try { localStorage.setItem('territory-muted', JSON.stringify([...muted])); } catch {} };

  const isOpen = () => box.classList.contains('open');
  function setOpen(open) {
    box.classList.toggle('open', open);
    form.hidden = !open;
    $('chat-button').setAttribute('aria-expanded', open);
    $('chat-button').textContent = open ? 'CLOSE' : 'CHAT';
    drawMuted();
    if (open) { $('chat-button').classList.remove('unread'); input.focus(); log.scrollTop = log.scrollHeight; }
    else input.blur();
  }

  // Only the newest few show while closed.
  function trim() {
    while (log.children.length > KEEP) log.firstElementChild.remove();
    const items = [...log.children];
    items.forEach((li, i) => li.classList.toggle('hide-closed', i < items.length - SHOWN_CLOSED));
  }

  function add({ pid, name, text, mentions }, fresh) {
    if (muted.has(String(pid))) return;
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = name;
    who.style.color = String(pid) === String(me) ? 'var(--gold)' : players[pid]?.color || 'var(--soft)';
    who.dataset.pid = pid;
    who.dataset.name = name;
    // Mentions: highlighted; more strongly (and a soft sound) when it's you.
    const names = (mentions ?? []).map(m => m.name).filter(Boolean);
    if (names.length) {
      const re = new RegExp('(' + names.map(n => '@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
      li.append(who, ...text.split(re).map(part => {
        const m = names.find(n => part.toLowerCase() === '@' + n.toLowerCase());
        return m ? Object.assign(document.createElement('span'), { className: 'mention', textContent: part }) : document.createTextNode(part);
      }));
      if (mentions.some(m => String(m.pid) === String(me))) {
        li.classList.add('mentions-me');
        if (fresh) gameAudio.play('mention');
      }
    } else li.append(who, document.createTextNode(text));
    if (!fresh) li.classList.add('old');
    else setTimeout(() => li.classList.add('old'), FADE_MS);
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.append(li);
    trim();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function drawMuted() {
    $('chat-muted').hidden = !isOpen() || !muted.size;
    $('chat-muted-n').textContent = `${muted.size} muted`;
  }

  // A new map (or a reconnect): its recent chat, already faded.
  socket.on('welcome', data => {
    log.replaceChildren();
    for (const m of data.chat ?? []) add(m, false);
  });
  socket.on('chat', m => {
    add(m, true);
    // A dot on the button for new messages from others while closed (phones show no messages then).
    if (!isOpen() && String(m.pid) !== String(me) && !muted.has(String(m.pid))) $('chat-button').classList.add('unread');
  });

  $('chat-button').addEventListener('click', () => setOpen(!isOpen()));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    $('chat-send').disabled = true;
    const r = await new Promise(resolve =>
      socket.timeout(10000).emit('chat', text, (err, res) => resolve(err ? { error: 'No answer from the server. Try again.' } : res)));
    $('chat-send').disabled = false;
    if (r.error) return toast(r.error);
    input.value = '';
  });
  // @ autocomplete: players on this map, filtered as you type; tap or Enter picks one.
  const pickList = Object.assign(document.createElement('ul'), { id: 'chat-mention', hidden: true });
  form.before(pickList);
  let picks = [], picked = 0;
  function query() {
    const upto = input.value.slice(0, input.selectionStart), at = upto.lastIndexOf('@');
    return at >= 0 && !/\s{2}/.test(upto.slice(at)) ? { at, q: upto.slice(at + 1).toLowerCase() } : null;
  }
  function drawPicks() {
    const m = query();
    picks = m ? Object.entries(players).filter(([pid, p]) => p?.name && String(pid) !== String(me) && p.name.toLowerCase().startsWith(m.q)).map(([, p]) => p.name).slice(0, 6) : [];
    picked = 0;
    pickList.hidden = !picks.length;
    pickList.replaceChildren(...picks.map((n, i) => {
      const li = document.createElement('li');
      li.textContent = n;
      li.classList.toggle('on', i === picked);
      li.addEventListener('pointerdown', e => { e.preventDefault(); choose(n); });
      return li;
    }));
  }
  function choose(name) {
    const m = query();
    if (!m) return;
    input.value = input.value.slice(0, m.at) + '@' + name + ' ' + input.value.slice(input.selectionStart);
    input.setSelectionRange(m.at + name.length + 2, m.at + name.length + 2);
    pickList.hidden = true;
  }
  input.addEventListener('input', drawPicks);
  input.addEventListener('keydown', e => {
    if (!pickList.hidden && picks.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); return choose(picks[picked]); }
    if (!pickList.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); picked = (picked + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length;
      [...pickList.children].forEach((li, i) => li.classList.toggle('on', i === picked));
    }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });

  // Tap a name in the open chat to mute that player here; their messages disappear.
  // Tap a name in the open chat: their profile (muting is a button there, window.chatMute).
  log.addEventListener('click', e => {
    const who = e.target.closest('.chat-who');
    if (who && isOpen()) openProfile(who.dataset.pid);
  });
  window.chatMute = { has: pid => muted.has(String(pid)), set(pid, name, on) {
    if (on) {
      muted.add(String(pid));
      for (const w of log.querySelectorAll(`.chat-who[data-pid="${pid}"]`)) w.parentElement.remove();
    } else muted.delete(String(pid));
    saveMuted(); trim(); drawMuted();
    toast(on ? `Muted ${name}` : `Unmuted ${name}`, 'good');
  } };
  $('chat-unmute').addEventListener('click', () => {
    muted.clear();
    saveMuted();
    drawMuted();
    toast('Everyone unmuted (new messages show again)', 'good');
  });
})();
