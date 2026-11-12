// ---------- Achievements in the browser (loop 7; a plug-in since loop 19) ----------
// The Achievements screen (by category, each with its next tier and a progress bar; secret ones as "???"), the
// yellow pop-up when one is earned, and progress bars that follow the player's stats.
let achTarget = null;   // another player's id when opened from their profile (read-only); menu.js clears it
(function () {
  const section = addScreen({ id: 'achievements', html: `<div class="head">
  <button class="btn icon-btn" type="button" data-go="main" aria-label="Back to menu"><svg class="pix" width="16" height="16" aria-hidden="true"><use href="#i-back"/></svg></button>
  <h1 style="font-size: 13px">ACHIEVEMENTS</h1>
</div>
<div style="display: flex; flex-direction: column; gap: 6px">
  <div class="split"><span>Earned</span><span style="font: 11px var(--title); color: var(--yellow)" id="ach-total"></span></div>
  <div class="bar total"><div id="ach-total-bar"></div></div>
</div>

<div class="tabs yellow" role="tablist" aria-label="Filter" id="ach-filter">
  <button type="button" role="tab" aria-selected="true" data-filter="all">All</button>
  <button type="button" role="tab" aria-selected="false" data-filter="pending">Pending</button>
  <button type="button" role="tab" aria-selected="false" data-filter="claimed">Claimed</button>
</div>
<div class="ach-list" id="ach-list"></div>
` });

  // Grouped by category, each with its next tier and a progress bar toward it. Secret ones show as "???".
  const fmtNum = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const COUNTS_DOWN = new Set(['bestRank']);   // #3 is better than #10
  let achData = null, achFilter = 'all';   // all, pending (not earned yet) or claimed (earned)

  function drawAchievements() {
    const { list, earned, values } = achData;
    const got = new Set(earned.map(e => e.id));
    $('ach-total').textContent = `${got.size} / ${list.length}`;
    $('ach-total-bar').style.width = `${list.length ? got.size / list.length * 100 : 0}%`;
    for (const b of $('ach-filter').children) b.setAttribute('aria-selected', b.dataset.filter === achFilter);
    const groups = new Map();
    for (const a of list) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)).push(a);
    $('ach-list').replaceChildren(...[...groups].flatMap(([category, tiers]) => {
      const card = document.createElement('div'), done = tiers.filter(a => got.has(a.id)).length;
      if ((achFilter === 'pending' && done === tiers.length) || (achFilter === 'claimed' && !done)) return [];
      card.className = 'ach-cat' + (done === tiers.length ? ' got' : '');
      card.innerHTML = '<div class="ach-head"><span class="t"></span><span class="n"></span></div>';
      card.querySelector('.t').textContent = category;
      if (tiers.every(a => a.secret)) card.querySelector('.t').dataset.info = 'secrets';
      card.querySelector('.n').textContent = `${done} / ${tiers.length}`;
      if (tiers.every(a => a.secret)) {
        // Secrets: each on its own line.
        for (const a of tiers) {
          const row = document.createElement('div');
          row.className = 'ach-secret' + (got.has(a.id) ? ' got' : '');
          row.innerHTML = '<span class="t"></span><span class="sub"></span>';
          row.querySelector('.t').textContent = a.name;
          row.querySelector('.sub').textContent = got.has(a.id) ? `${a.description} · +${fmtNum(a.reward)} squares` : a.description;
          card.append(row);
        }
        return card;
      }
      const next = tiers.find(a => !got.has(a.id));
      const info = document.createElement('div');
      info.className = 'ach-next';
      if (next) {
        const v = values[next.stat] ?? 0, down = COUNTS_DOWN.has(next.stat);
        const share = down ? (v ? Math.min(1, next.threshold / v) : 0) : Math.min(1, v / next.threshold);
        info.innerHTML = '<span class="t"></span><span class="sub"></span><div class="bar"><div></div></div><span class="sub p"></span>';
        info.querySelector('.t').textContent = next.name;
        info.querySelector('.sub').textContent = `${next.description} · +${fmtNum(next.reward)} squares`;
        info.querySelector('.bar > div').style.width = `${share * 100}%`;
        info.querySelector('.p').textContent = down ? (v ? `Best so far: #${v}` : 'Not ranked yet') : `${fmtNum(v)} / ${fmtNum(next.threshold)}`;
      } else {
        info.innerHTML = '<span class="sub">All earned. Well played!</span>';
      }
      card.append(info);
      const pips = document.createElement('div');
      pips.className = 'ach-pips';
      for (const a of tiers) {
        const pip = document.createElement('span');
        if (got.has(a.id)) pip.className = 'on';
        pip.title = `${a.name}: ${a.description}`;
        pips.append(pip);
      }
      card.append(pips);
      return card;
    }));
  }
  for (const b of $('ach-filter').children) b.addEventListener('click', () => { achFilter = b.dataset.filter; if (achData) drawAchievements(); });
  fills.achievements = async () => {
    const r = await (achTarget ? ask('achievements:list', { pid: achTarget }) : ask('achievements:list'));
    if (view !== 'achievements') return;
    if (r.error) return fail(r.error);
    achData = r;
    drawAchievements();
  };

  // The yellow pop-up when one is earned.
  let popupTimer, achTimer;
  function earned(a) {
    gameAudio.play('achievement');
    tell('achievement', a);
    $('popup-what').textContent = a.description ? `${a.name} · ${a.description}` : a.name;
    $('popup-reward').hidden = !a.reward;
    $('popup-reward-n').textContent = `+${fmtNum(a.reward ?? 0)}`;
    $('popup').hidden = false;
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => { $('popup').hidden = true; }, 4000);
    if (view === 'achievements') fills.achievements();
  }
  // Progress bars move as stats change, at most once a second.
  function statChanged() {
    if (view !== 'achievements' || achTimer) return;
    achTimer = setTimeout(() => { achTimer = null; if (view === 'achievements') fills.achievements(); }, 1000);
  }


  socket.on('achievements:earned', a => earned(a));
  Plugins.add('achievements', { stat: () => statChanged() });
})();
