// ---------- Achievements in the browser (loop 7; a plug-in since loop 19) ----------
// The Achievements screen (only what's earned, by category, each with a tier badge), the
// yellow pop-up when one is earned, and the screen refreshing as the player's stats change.
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

<div class="ach-list" id="ach-list"></div>
` });

  // Only what's earned, grouped by category (none earned: the category is hidden). Each category's badge is a tier plate
  // with the category's icon on top; the plate gets fancier (tier 1 to 6) as more of the category is earned.
  const fmtNum = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const slug = category => category.toLowerCase().replace(/\s+/g, '-');
  let achData = null;

  function drawAchievements() {
    const { list, earned } = achData;
    const got = new Set(earned.map(e => e.id));
    $('ach-total').textContent = `${got.size} / ${list.length}`;
    $('ach-total-bar').style.width = `${list.length ? got.size / list.length * 100 : 0}%`;
    const groups = new Map();
    for (const a of list) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)).push(a);
    $('ach-list').replaceChildren(...[...groups].flatMap(([category, tiers]) => {
      const have = tiers.filter(a => got.has(a.id));
      if (!have.length) return [];
      const tier = Math.max(1, Math.ceil(6 * have.length / tiers.length));
      const card = document.createElement('div');
      card.className = 'ach-cat' + (have.length === tiers.length ? ' got' : '');
      card.innerHTML = '<div class="ach-head"><span class="ach-badge"><img class="plate" alt=""><img class="icon" alt=""></span><span class="t"></span><span class="n"></span></div>';
      card.querySelector('.plate').src = `/art/achievements/tier-${tier}.png`;
      card.querySelector('.icon').src = `/art/achievements/cat-${slug(category)}.png`;
      card.querySelector('.t').textContent = category;
      if (tiers.every(a => a.secret)) card.querySelector('.t').dataset.info = 'secrets';
      card.querySelector('.n').textContent = `${have.length} / ${tiers.length}`;
      for (const a of have) {
        const row = document.createElement('div');
        row.className = 'ach-secret got';
        row.innerHTML = '<span class="t"></span><span class="sub"></span>';
        row.querySelector('.t').textContent = a.name;
        row.querySelector('.sub').textContent = `${a.description} · +${fmtNum(a.reward)} squares`;
        card.append(row);
      }
      return card;
    }));
  }
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
    $('popup-what').textContent = a.description ? `${a.name} Â· ${a.description}` : a.name;
    $('popup-reward').hidden = !a.reward;
    $('popup-reward-n').textContent = `+${fmtNum(a.reward ?? 0)}`;
    $('popup').hidden = false;
    clearTimeout(popupTimer);
    popupTimer = setTimeout(() => { $('popup').hidden = true; }, 4000);
    if (view === 'achievements') fills.achievements();
  }
  // The screen follows the player's stats, at most once a second.
  function statChanged() {
    if (view !== 'achievements' || achTimer) return;
    achTimer = setTimeout(() => { achTimer = null; if (view === 'achievements') fills.achievements(); }, 1000);
  }


  socket.on('achievements:earned', a => earned(a));
  Plugins.add('achievements', { stat: () => statChanged() });
})();
