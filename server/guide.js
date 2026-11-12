// The Game Guide (loop 16): a public page at /guide, no login, built from data/economy.json every time it's
// asked for, so it always shows the numbers the game uses. Same look as the privacy and terms pages (page.css).
const catalog = require('./catalog');
const upgrades = require('./upgrades');
const rules = require('./rules');
const economy = require('../data/economy.json');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
const table = (head, rows) => `<div class="scroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`
  + rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
const unitText = (v, unit) => (/^x /.test(unit) ? `×${n(v)} ${unit.slice(2)}` : `${n(v)} ${unit}`);

// pluginSections(helpers): each plug-in's section, [{ id, title, html }] (loop 19), shown after Upgrades, in plug-in order.
function renderGuide({ maps = [], pluginSections = () => [] } = {}) {
  const shown = new Set(upgrades.available(require('./variables').declared()));   // upgrades whose variable exists (loop 19)
  const E = catalog.E, L = Array.from({ length: E.maxLevel }, (_, i) => i + 1);
  const terrains = Object.entries(rules.TERRAIN_HITS);
  const sections = [];

  sections.push(`<h2 id="play">What Territory is</h2>
    <p>Territory is a multiplayer map of blocks. Tap a block to hit it; enough hits and it's yours. Your first block can be any empty one;
      after that you take blocks touching your land, empty or someone else's. Mining a brand-new block pays <b>squares</b> (the currency)
      and grows the map. Spend squares on upgrades, skins, items, buildings and land.</p>
    <p>Press and hold any block (right-click on a computer) to see its info card: its level, hardness, pay, owner, walls, factory and price
      if it's for sale.</p>`);

  sections.push(`<h2 id="taking">Taking blocks</h2>
    <ul>
      <li>Your <b>first block</b> on a map can be any empty block. After that you can only hit blocks touching your land (up, down, left,
        right), empty or someone else's, and never across your own wall.</li>
      <li>One tap counts as your Click Power in hits. Power to spare from the tap that takes a block counts toward the next one.</li>
      <li><b>Only one player's progress counts:</b> if someone else hits a block, its hits start over for them and yours are gone.</li>
      <li><b>Cracks fade:</b> ${n(rules.CRACK_DECAY_HITS)} hit of progress for every ${n(rules.CRACK_DECAY_SECONDS)} seconds since the last hit.
        A factory's progress never fades.</li>
      <li><b>Repair:</b> tapping your own cracked block takes off hits equal to your Click Power, free. With no crack on the block, the tap
        repairs its most cracked wall. Tapping your own undamaged block does nothing.</li>
      <li>At most ${n(rules.MAX_TAPS_PER_SECOND)} taps a second count; faster taps are ignored.</li>
    </ul>`);

  sections.push(`<h2 id="squares">Squares and the wipe rule</h2>
    <p>Squares are counted in tenths and always rounded down. You see whole squares unless Settings → Show tenths is on. Every change to a
      balance is written to a ledger, and every square spent is destroyed.</p>
    <p>You can wipe all your blocks on a map (Settings → Wipe and restart this map, then type WIPE); your walls, factories and listings there
      go too, and your look there unlocks. After a wipe, new blocks on that map pay squares only once you own <b>more</b> blocks there than
      you had when you wiped (the highest count from any wipe counts).</p>`);

  sections.push(`<h2 id="levels">Maps and levels</h2>
    <p>Every map starts with <b>E</b> blocks (its base size, fixed when it's made). Its <b>level</b> rises as blocks are mined there
      (by players and factories; the extra blocks from Growth don't count):</p>
    <p class="formula">L = 1 + floor(log2(mined ÷ E + 1)), at most ${E.maxLevel}. Level L starts after (2^(L−1) − 1) × E blocks are mined.</p>
    <p>New blocks are born at the map's level and keep it forever. Each level up doubles hardness and pay, and every upgrade
      works at most at the level of the map you're on.</p>
    ${table(['Level', 'Starts at (blocks mined)', ...maps.map(m => `${m.name} (E = ${n(m.base, 0)})`)],
      L.map(l => [l, `${n(2 ** (l - 1) - 1, 0)} × E`, ...maps.map(m => n((2 ** (l - 1) - 1) * m.base, 0))]))}`);

  sections.push(`<h2 id="pay">Hardness and pay</h2>
    <p class="formula">H = hitsPerBlock × 2^(level − 1) × terrain = ${rules.HITS_PER_BLOCK} × 2^(L−1) × t</p>
    <p class="formula">Pay for a new block = H ÷ ${n(E.hitsPerSquare)} × Earnings squares (rounded down to a tenth), + ${n(rules.GOLD_BONUS_SQUARES)} on gold</p>
    <p>Every ${n(E.hitsPerSquare)} hits you put into a new block earn 1 square, so income depends only on your upgrades. Taking someone's
      block pays nothing. Hits to take an owned block = H × the owner's Defense, plus any walls in the way.</p>
    ${table(['Terrain', 'Factor t', ...L.map(l => `L${l} hits`)], terrains.map(([t, f]) => [t, n(f), ...L.map(l => n(rules.hardness(t, l)))]))}
    <p>Water can't be claimed. One work-hour at level L is worth <b>W(L) = ${n(3600 / E.baseBlockSeconds, 0)} × 2^(L−1)</b> squares;
      most prices are a number of work-hours times W(L) at the map's level.</p>`);

  sections.push(`<h2 id="upgrades">Upgrades</h2>
    <p>Each upgrade has tiers, each bought in <b>S</b> small steps. Tier 1 runs from its start to its max; every later tier runs from the end of
      the one before to <b>m</b> times that (m, the multiplier per tier, is 2 for every upgrade now):</p>
    <p class="formula">lo<sub>1</sub> = start; lo<sub>N</sub> = max<sub>1</sub> × m^(N−2); hi<sub>N</sub> = max<sub>1</sub> × m^(N−1)</p>
    <p>Early steps in a tier give the most (the gain curve g), and early steps cost the least (the price curve c):</p>
    <p class="formula">Value after step j of tier N = lo<sub>N</sub> + (hi<sub>N</sub> − lo<sub>N</sub>) × ln(1 + g·j/S) ÷ ln(1 + g)</p>
    <p class="formula">Price of step j of tier N = T × W(N) × ln(1 + c·j/S) ÷ Σ<sub>i=1..S</sub> ln(1 + c·i/S) squares</p>
    <p>So a whole tier N costs exactly <b>T × W(N)</b>, where T is the tier cost in work-hours, and prices never change. Tier 1 is open from
      the start; tier N's steps can be bought once you've mined a level-N block somewhere. <b>Upgrades work by the block:</b> on a level-L
      block every upgrade works at most at hi<sub>L</sub>, the end of tier L. That covers your Click Power and Repair on it, Earnings and
      Growth when you mine it, its owner's Defense, and Factory Speed and Yield on it. Values can be fractions: Growth 1.4 means 1 new block
      and a 40% chance of a second.</p>`
    + Object.entries(economy.tiers).filter(([key]) => shown.has(key)).map(([key, u]) => `<h3>${esc(u.name)}</h3><p>${esc(u.about)}. ${u.tiers} tiers of ${u.steps} steps; T = ${n(u.tierWh)} work-hours,
      c = ${n(u.priceCurve)}, g = ${n(u.gainCurve)}.</p>`
      + table(['Tier', 'From', 'To (end of the tier)', 'First step (squares)', 'Last step (squares)', 'Whole tier (squares)'], Array.from({ length: u.tiers }, (_, i) =>
        [i + 1, unitText(upgrades.lo(key, i + 1), u.unit), unitText(upgrades.hi(key, i + 1), u.unit),
          n(catalog.fromTenths(upgrades.stepCostTenths(key, i * u.steps + 1)), 1), n(catalog.fromTenths(upgrades.stepCostTenths(key, (i + 1) * u.steps)), 1),
          n(catalog.fromTenths(upgrades.tierCostTenths(key, i + 1)), 1)]))).join(''));

  const extra = pluginSections({ n, table, esc, E, catalog });
  for (const p of extra) sections.push(p.html);

  sections.push(`<h2 id="market">The land market</h2>
    <p>Accounts at least ${n(E.marketMinAccountDays)} days old can sell connected blocks of their land (Build → Sell land) at any price, and
      buy land anywhere on the map (it needn't touch theirs). Factories and walls go with the land. ${n(E.marketFee * 100)}% of every sale is
      destroyed; the seller gets the rest. Any attack on a listed block ends its listing.</p>`);

  const skins = extra.some(p => p.id === 'skins');
  sections.push(`<h2 id="look">Your look on each map</h2>
    <p>Before your first claim on a map you pick a <b>color</b> (${rules.COLORS.length} free ones)${skins ? ', a <b>skin</b> you own, and its <b>coverage</b>: Per block (the skin repeats on each block) or Full area (one big image over your whole territory)' : ''}.
      Your first claim there locks them on that map; a wipe unlocks them. You can look different on each map.</p>`);

  sections.push(`<h2 id="players">Guests and accounts</h2>
    <ul>
      <li>Anyone can look and start hitting. Your first claim makes you a <b>guest</b> with a random name, remembered by your browser
        (clearing it loses the guest). One network can make at most ${n(rules.GUESTS_PER_IP)} new guests per ${n(rules.GUEST_WINDOW_MINUTES)} minutes.</li>
      <li><b>Accounts</b> sign up with email and password (a 6-digit code checks the address) or with Google. Signing up from your own guest
        profile keeps your blocks, squares and settings; logging into an existing account never merges anything.</li>
      <li>Accounts can <b>rename</b> (Settings): at most ${n(rules.NAME_MAX_LENGTH)} letters, numbers, spaces, -, _ and ., unique ignoring
        capitals, no rude or reserved names, and ${n(rules.RENAME_COOLDOWN_MINUTES)} minutes between changes.</li>
    </ul>`);

  sections.push(`<h2 id="stats">Stats and names on the map</h2>
    <p>For each map the game keeps your blocks owned now and the most ever at once, empty blocks claimed, blocks taken from others, blocks
      lost to others (wipes don't count), and your largest solid square and longest straight line ever owned (records: losing blocks never
      lowers them). Rank counts only on maps where at least ${n(rules.RANK_MIN_PLAYERS)} players own blocks, for players with at least
      ${n(rules.RANK_MIN_BLOCKS)} blocks there; ties count against you.</p>
    <p>Every territory on screen shows its owner's name on a small tag in their color, on its deepest visible block. Yours is gold and
      always shows; where tags would overlap, the bigger territory's shows first.</p>`);

  sections.push(`<h2 id="controls">Controls, sound and help</h2>
    <ul>
      <li>Tap or click a block to hit it; drag to move; pinch or use the mouse wheel to zoom. A touch that moves more than 10 pixels is a drag.</li>
      <li>Press and hold a block (right-click on a computer) for its info card. The Menu button opens the welcome screen: Marketplace,
        Upgrades, Awards, Profile, Maps and Settings.</li>
      <li>Your own sounds always play. Other players' taps and claims play only near what you're looking at, quieter further away, and
        at most ${n(rules.SOUND.maxAtOnce)} sounds play at once. Music starts on your first tap (browsers allow no sound before that).
        Settings → Sound has a slider and mute for each, saved on that device.</li>
      <li>New players get a short guided first game after the setup screen; Skip ends it and Menu → How to play starts it again. A few
        tips show once each, ever.</li>
    </ul>`);

  sections.push(`<h2 id="glossary">Glossary</h2>`
    + table(['Symbol', 'Name', 'What it means', 'Formula', 'Where the number lives'], (economy.glossary ?? []).map(g => [g.symbol, g.name, g.meaning, g.formula, g.home])));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Game Guide · Territory</title>
  <link rel="icon" href="art/tiles/tile_0002.png">
  <link rel="stylesheet" href="art/styles/page.css">
  <style>
    .formula { font-family: "Press Start 2P", monospace; font-size: 11px; line-height: 1.8; background: rgba(255,255,255,0.05); padding: 8px 10px; }
    .scroll { overflow-x: auto; margin: 8px 0 16px; }
    table { border-collapse: collapse; font-size: 14px; min-width: 100%; }
    th, td { border: 1px solid rgba(255,255,255,0.12); padding: 4px 8px; text-align: left; white-space: nowrap; }
    td:nth-child(2) { white-space: normal; }
    .gallery { display: flex; flex-wrap: wrap; gap: 8px; }
    .gallery figure { margin: 0; width: 64px; text-align: center; font-size: 11px; }
    .gallery img { image-rendering: pixelated; display: block; margin: 0 auto 2px; }
    nav a { margin-right: 10px; }
  </style>
</head>
<body>
  <main>
    <h1>Game Guide</h1>
    <p class="sub">Every number here comes straight from the game's rules, so it's always current.</p>
    <nav>${[['play', 'Playing'], ['taking', 'Taking blocks'], ['squares', 'Squares'], ['levels', 'Levels'], ['pay', 'Pay'], ['upgrades', 'Upgrades'],
      ...extra.map(p => [p.id, p.title]), ['market', 'Market'], ['look', 'Your look'], ['players', 'Accounts'], ['stats', 'Stats'],
      ['controls', 'Controls'], ['glossary', 'Glossary']].map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    ${sections.join('\n')}
    <p class="links foot"><a href="/">Back to the game</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  </main>
</body>
</html>`;
}

module.exports = { renderGuide };
