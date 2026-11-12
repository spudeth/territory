// ---------- "i" info buttons (loop 15) ----------
// All the wording in one place, for Xoren to edit. Anything with data-info="<key>" gets a small "i" button after
// it (a 44px tap area); tapping it shows the text in a popup, and any tap closes it.
const INFO = {
  squares: 'Squares are the game\'s currency, counted in tenths. Every 10 hits you put into a brand-new block earn 1 square. Spend them in the Marketplace on upgrades, skins, items and land, or build.',
  clickPower: 'Each tap counts as more hits, so you take blocks with fewer taps. Each tier doubles it. Spare power from the tap that takes a block counts toward the next one.',
  defense: 'Others need more hits to take your blocks: up to 6 times as many at tier 10.',
  earnings: 'Multiplies the squares you earn for every brand-new block you mine.',
  growth: 'Every brand-new block you mine makes the map grow. Growth adds extra new blocks to the edge of the map each time.',
  tiers: 'Each upgrade has 10 tiers of 90 steps. Tier 1 is open from the start; tier N\'s steps unlock once you\'ve mined a level-N block anywhere. Upgrades work by the block: on a level-L block, at most at the end of tier L.',
  mapLevel: 'A map\'s level rises as its blocks are mined: level 2 once as many blocks are mined as it started with, then at 3x, 7x… Each level doubles how hard new blocks are and what they pay.',
  market: 'Accounts at least 3 days old can sell connected blocks of land, with their factories and walls. 5% of every sale is destroyed. Attacking a listed block ends the listing.',
  locked: 'Your color, skin and coverage lock when you spawn. To change them on this map, wipe your territory and start again.',
  wipeFloor: 'After a wipe, you only earn squares again once you own more blocks here than you had when you wiped. It stops wipe-and-reclaim farming.',
  terrain: 'Sand takes fewer taps, forest more, and stone many more. Water can\'t be claimed, and gold pays bonus squares the first time it\'s claimed.',
  secrets: 'Secret achievements stay hidden as ??? until you find them. Each one is a small surprise.',
};

(function () {
  const pop = Object.assign(document.createElement('div'), { id: 'info-pop', hidden: true });
  document.body.append(pop);
  function add(el) {
    if (el.dataset.infoDone || !INFO[el.dataset.info]) return;
    el.dataset.infoDone = '1';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'info-btn';
    b.setAttribute('aria-label', 'What is this?');
    b.innerHTML = '<span>i</span>';
    b.addEventListener('click', e => {
      e.stopPropagation();
      pop.textContent = INFO[el.dataset.info];
      pop.hidden = false;
      const r = b.getBoundingClientRect();
      pop.style.left = Math.max(12, Math.min(innerWidth - pop.offsetWidth - 12, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
      pop.style.top = (r.bottom + pop.offsetHeight + 8 < innerHeight ? r.bottom + 4 : r.top - pop.offsetHeight - 4) + 'px';
    });
    el.after(b);
  }
  const scan = root => { for (const el of (root.querySelectorAll ? root.querySelectorAll('[data-info]') : [])) add(el); if (root.dataset?.info) add(root); };
  scan(document.body);
  new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); })
    .observe(document.body, { childList: true, subtree: true });
  addEventListener('click', () => { pop.hidden = true; }, true);   // any tap closes it
})();
