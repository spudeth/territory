// ---------- "i" info buttons (loop 15) ----------
// All the wording in one place, for Xoren to edit. Anything with data-info="<key>" gets a small "i" button after
// it (a 44px tap area); tapping it shows the text in a popup, and any tap closes it.
const INFO = {
  squares: 'Squares are the game\'s currency. You earn them by claiming brand-new blocks and from achievements, and spend them on upgrades, skins and items.',
  clickPower: 'Each tap counts as more hits, so you take blocks with fewer taps. Spare power from the tap that takes a block counts toward the next one.',
  defense: 'Others need more hits to take your blocks. At the top level, your blocks are 6 times as hard to take.',
  earnings: 'You earn more squares for every brand-new block you claim.',
  growth: 'Every brand-new block you claim makes the map grow. Growth adds extra new blocks to the edge of the map each time.',
  coverage: 'Per block repeats your skin on every block. Full area shows one big image over your whole territory.',
  locked: 'Your color, skin and coverage lock when you spawn. To change them on this map, wipe your territory and start again.',
  wipeFloor: 'After a wipe, you only earn squares again once you own more blocks here than you had when you wiped. It stops wipe-and-reclaim farming.',
  terrain: 'Sand takes fewer taps, forest more, and stone many more. Water can\'t be claimed, and gold pays bonus squares the first time it\'s claimed.',
  skinPrices: 'Skin prices rise as you collect. Each rarity reaches its top price once you own half of its skins.',
  secrets: 'Secret achievements stay hidden as ??? until you find them. Each one is a small surprise.',
  rank: 'Ranks count on busy maps only: at least 10 players with blocks, and you need 100 blocks yourself. Ties count against you.',
  items: 'Items are bought once and are yours for good. Each can be used a few times an hour, on any map.',
  online: 'A green dot means the player has the game open right now.',
  starring: 'Star one pattern and one art skin as your favorites. They show at the top here and on your profile.',
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
