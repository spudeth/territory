// ---------- The tutorial and first-time tips ----------
// Runs the steps and tips in tutorial.js. game.js and menu.js report what happens with tell(trigger, data).
// Progress ({ step, done, tips }) is saved on the server for players, and on this device for visitors until
// their first claim, when it moves to their new player (and stays with it if they make an account).
// Loaded after menu.js.

const LOCAL = 'territory-tutorial';
let progress = { step: null, done: false, tips: [] };
let active = null;        // the step showing, or null
let tip = null;           // the tip showing, or null
const tipQueue = [];
let lastGrown = null;     // the block that appeared after your last brand-new claim
let afterClaim = false;
let coachBlocks = [];     // blocks game.js outlines on the map

const card = $('coach'), ring = $('coach-ring');
const fillText = t => t.replace('{hits}', hitsPerBlock);

function saveProgress() {
  if (me) socket.emit('tutorial', progress);
  else try { localStorage.setItem(LOCAL, JSON.stringify(progress)); } catch {}
}

// Called by game.js on each welcome: players' progress comes from the server, visitors' from this device.
function loadProgress(saved) {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LOCAL) || 'null'); } catch {}
  progress = { step: null, done: false, tips: [], ...(saved ?? local ?? {}) };
  if (!Array.isArray(progress.tips)) progress.tips = [];
}

// ---------- Steps ----------
const stepAt = id => tutorial.STEPS.findIndex(s => s.id === id);

function begin(id) {
  const i = stepAt(id);
  if (i < 0) return finish();
  active = { ...tutorial.STEPS[i], index: i, started: !tutorial.STEPS[i].start };
  progress.step = active.id;
  saveProgress();
  drawCoach();
}
function advance() {
  const next = tutorial.STEPS[active.index + 1];
  next ? begin(next.id) : finish();
}
function finish() {
  active = null;
  progress.step = null;
  progress.done = true;
  saveProgress();
  drawCoach();
  showTip();
}
// Menu > How to play: from the start again (tips already seen stay seen).
function replayTutorial() {
  progress.done = false;
  closeMenu();
  begin(tutorial.STEPS[0].id);
}

// After a welcome, once this map's look is chosen: resume a tutorial left part-way.
function resumeTutorial() {
  if (!active && !progress.done && progress.step && stepAt(progress.step) >= 0 && view !== 'setup') begin(progress.step);
}

// ---------- What the game reports ----------
function tell(trigger, data) {
  if (trigger === 'claimed') afterClaim = data.from == null;    // a brand-new block grows the map…
  if (trigger === 'grew' && afterClaim) { lastGrown = data; afterClaim = false; }   // …and this is the new block
  if (trigger === 'you' && !progress.done) { saveProgress(); try { localStorage.removeItem(LOCAL); } catch {} }
  if (trigger === 'spawned' && !progress.done) {
    if (!progress.step) return begin(tutorial.STEPS[0].id);   // brand-new: straight after the setup screen
    return resumeTutorial();
  }

  if (active) {
    if (trigger === 'hit' && active.counter) { active.hits = Math.min(hitsPerBlock, Math.round(data.p * hitsPerBlock)); drawCoach(); }
    if (!active.started && trigger === active.start) { active.started = true; drawCoach(); }
    else if (active.started && trigger === active.done) advance();
    else if (trigger === 'grew' && active.highlight?.blocks) drawCoach();   // e.g. the block that just appeared
  }

  for (const t of tutorial.TIPS) {
    if (t.on === trigger && !progress.tips.includes(t.id) && !tipQueue.includes(t) && tip !== t) tipQueue.push(t);
  }
  showTip();
}

// A tip counts as seen once it shows, so one waiting behind the tutorial isn't lost if the page reloads.
function showTip() {
  if (tip || active?.started || !tipQueue.length || view === 'setup') return;
  tip = tipQueue.shift();
  progress.tips.push(tip.id);
  saveProgress();
  drawCoach();
}

// ---------- Drawing ----------
function blocksFor(name) {
  const out = [], near = (x, y) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => cells.get(key(a, b)) === me);
  for (const [k, o] of cells) {
    const [x, y] = k.split(',').map(Number);
    if (name === 'mine' ? o === me : name === 'others' ? o && o !== me : name === 'lit' ? me && o !== me && near(x, y) : false) out.push({ x, y });
    if (out.length >= 400) break;
  }
  if (name === 'grown' && lastGrown && cells.has(key(lastGrown.x, lastGrown.y))) out.push(lastGrown);
  return out;
}

function drawCoach() {
  const showing = active?.started ? active : tip;
  card.hidden = !showing || view === 'setup';
  $('hint').style.visibility = card.hidden ? '' : 'hidden';   // the card says it better
  ring.hidden = true;
  coachBlocks = [];
  if (!card.hidden) {
    const total = tutorial.STEPS.length;
    $('coach-kicker').textContent = showing === tip ? 'TIP' : `HOW TO PLAY ${active.index + 1}/${total}`;
    $('coach-title').textContent = showing.title.toUpperCase();
    $('coach-text').textContent = fillText(showing.text);
    $('coach-count').hidden = !showing.counter;
    if (showing.counter) $('coach-count').textContent = `${active.hits ?? 0}/${hitsPerBlock}`;
    $('coach-next').hidden = showing !== tip && showing.done !== 'next';
    $('coach-next').textContent = showing === tip ? 'OK' : active.index === total - 1 ? 'Done' : 'Next';
    $('coach-skip').hidden = showing === tip;

    const h = showing.highlight;
    if (h?.blocks) {
      coachBlocks = blocksFor(h.blocks);
      if (showing.focus && coachBlocks[0]) lookAt(coachBlocks[0].x, coachBlocks[0].y);
    }
    placeCoach();
  }
  draw();
}

// Keeps the ring on its element (menus open, layouts shift) and the card out of its way.
function placeCoach() {
  const h = (active?.started ? active : tip)?.highlight;
  const el = h?.element && document.querySelector(h.element);
  const r = el && el.getClientRects().length && !el.closest('[hidden]') ? el.getBoundingClientRect() : null;
  ring.hidden = !r;
  if (r) Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  card.classList.toggle('top', !!r && r.top + r.height / 2 > innerHeight / 2);
}
setInterval(() => { if (!card.hidden) placeCoach(); }, 300);
addEventListener('resize', () => { if (!card.hidden) placeCoach(); });

$('coach-next').addEventListener('click', () => {
  if (tip && !(active?.started)) { tip = null; drawCoach(); return showTip(); }
  if (active?.done === 'next') advance();
});
$('coach-skip').addEventListener('click', finish);
$('how-to-play').addEventListener('click', replayTutorial);
