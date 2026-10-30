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

  function add({ pid, name, text }, fresh) {
    if (muted.has(String(pid))) return;
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = name;
    who.style.color = String(pid) === String(me) ? 'var(--gold)' : players[pid]?.color || 'var(--soft)';
    who.dataset.pid = pid;
    who.dataset.name = name;
    li.append(who, document.createTextNode(text));
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
