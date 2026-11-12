// The Game Guide (loop 16): a public page at /guide, no login, built from data/economy.json every time it's
// asked for, so it always shows the numbers the game uses. Same look as the privacy and terms pages (page.css).
const catalog = require('./catalog');
const upgrades = require('./upgrades');
const rules = require('./rules');
const economy = require('./data/economy.json');

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

  sections.push(`<h2 id="glossary">Glossary</h2>`
    + table(['Symbol', 'Name', 'What it means', 'Formula', 'Where the number lives'], (economy.glossary ?? []).map(g => [g.symbol, g.name, g.meaning, g.formula, g.home])));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Game Guide · Territory</title>
  <link rel="icon" href="tiles/tile_0002.png">
  <link rel="stylesheet" href="page.css">
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
    <nav>${[['play', 'Playing'], ['levels', 'Levels'], ['pay', 'Pay'], ['upgrades', 'Upgrades'],
      ...extra.map(p => [p.id, p.title]), ['market', 'Market'], ['glossary', 'Glossary']].map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>
    ${sections.join('\n')}
    <p class="links foot"><a href="/">Back to the game</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  </main>
</body>
</html>`;
}

module.exports = { renderGuide };
