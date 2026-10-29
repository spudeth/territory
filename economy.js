// Xoren's Google Sheet -> data/economy.json. Pure functions: CSV text in, a checked economy (or a list of
// problems, each naming its cell) out. scripts/sync-rules.js downloads the tabs and writes the file;
// rules.js reads it. The game never reads the sheet itself.

// The upgrade tabs and the columns read from each (other columns are the sheet's own working).
const UPGRADE_TABS = { clickPower: 'Click Power', defense: 'Defense', earnings: 'Earnings', growth: 'Growth' };
const UPGRADE_COLUMNS = ['Level', 'Value after', 'Cost (squares)'];
const RULES_TAB = 'Game Rules';
const RULES_COLUMNS = ['Key', 'Value', 'What it means'];
const ACHIEVEMENTS_TAB = 'Achievements';
const ACHIEVEMENT_COLUMNS = ['Key', 'Name', 'Category', 'Stat', 'Threshold', 'Secret', 'Description', 'Reward'];
const SKINS_TAB = 'Skins';
const SKIN_COLUMNS = ['Key', 'Name', 'Kind', 'Rarity', 'Price', 'Collection', 'Enabled'];
const SKIN_KINDS = ['pattern', 'art'];          // pattern: drawn in the owner's color; art: full-color image
const RARITIES = ['Common', 'Rare', 'Legendary'];
// The image files every skin needs, under public/: one block, and the large one for Full area coverage.
const skinFiles = key => [`skins/${key}.png`, `skins/${key}-large.png`];
const TABS = [...Object.values(UPGRADE_TABS), RULES_TAB, ACHIEVEMENTS_TAB, SKINS_TAB];

// The stats an achievement can use: the ones the game counts (achievements.js has what each one means).
// bestRank counts down: a threshold of 3 means "#3 or better".
const STATS = ['claims', 'owned', 'bestSquare', 'bestLine', 'taken', 'lost', 'taps', 'squaresEarned', 'squaresSpent', 'purchases',
  'level:clickPower', 'level:defense', 'level:earnings', 'level:growth', 'terrain:sand', 'terrain:forest', 'terrain:stone', 'terrain:gold',
  'mapsPlayed', 'daysPlayed', 'bestStreak', 'bestRank', 'reignMinutes', 'wipes', 'hoursPlayed', 'sessionClaims', 'bestDayClaims',
  'chatMessages', 'squaresHeld', 'growthBlocks', 'mapGrown', 'renames', 'account', 'tutorialDone', 'achievements', 'secrets',
  'secret:castaway', 'secret:witching', 'secret:leet', 'secret:revenge', 'secret:poke', 'secret:treehugger', 'secret:speedrun',
  'secret:comeback', 'secret:helloworld', 'secret:wipedout'];

// Every Game Rules key, with the values it may take.
const int = (min, max = Infinity) => ({ integer: true, min, max });
const num = (min, max = Infinity) => ({ integer: false, min, max });
const RULE_KEYS = {
  hitsPerBlock: int(1, 1000),
  crackFadeSeconds: num(1, 86400),
  crackFadeHits: num(0.01, 1000),
  squaresPerFirstClaim: num(0, 1e6),
  guestsPerIp: int(1, 10000),
  guestWindowMinutes: num(1, 100000),
  renameWaitMinutes: num(0, 100000),
  maxTapsPerSecond: num(1, 100),
  nameMaxLength: int(1, 15),          // the database allows at most 15
  nameLabelShare: num(0.01, 1),
  newMapWidth: int(1, 1000),
  newMapHeight: int(1, 1000),
  newMapBlocks: int(1, 1000000),
  rankMinPlayers: int(2, 100000),
  rankMinBlocks: int(1, 1000000),
  terrainScale: num(2, 1000),
  waterShare: num(0, 0.6),
  sandShare: num(0, 0.6),
  forestShare: num(0, 0.9),
  stoneShare: num(0, 0.6),
  goldShare: num(0, 0.2),
  sandHits: num(0.01, 100),
  forestHits: num(0.01, 100),
  stoneHits: num(0.01, 100),
  goldHits: num(0.01, 100),
  goldBonusSquares: num(0, 1000000),
  soundMaxAtOnce: int(1, 32),
  soundHearingDistance: num(0.1, 10),
  soundOthersVolume: num(0, 1),
  defaultEffectsVolume: num(0, 1),
  defaultMusicVolume: num(0, 1),
};

// CSV text -> rows of cells (quotes, doubled quotes, commas and line breaks inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// A number as the sheet shows it: "1,161", "-2.5", "10". Anything else is null.
function parseNumber(s) {
  const t = String(s).trim();
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(t)) return null;
  return Number(t.replace(/,/g, ''));
}

// Spreadsheet cell names: column 0 -> A, row 0 -> 1.
const cellName = (col, row) => String.fromCharCode(65 + col) + (row + 1);

// Checks the downloaded tabs. tabs: { 'Click Power': csvText, … }.
// Returns { economy: { rules, upgrades }, errors: [] } or { economy: null, errors: ['…'] }.
// hasFile(path): whether a file exists under public/ (the sync passes one; skins need their images).
function validate(tabs, { hasFile = () => true } = {}) {
  const errors = [];
  const where = (tab, col, row, header) => `${tab}, cell ${cellName(col, row)}${header ? ` ("${header}")` : ''}`;

  // Each tab's columns, found by name in its header row. A missing tab shows up here too: for an unknown
  // tab name, Google's export returns the first tab instead, whose header row is different.
  function table(tab, columns) {
    if (typeof tabs[tab] !== 'string') { errors.push(`${tab}: the tab is missing`); return null; }
    const rows = parseCsv(tabs[tab]).filter(r => r.some(c => c.trim() !== ''));
    const head = (rows[0] ?? []).map(c => c.trim());
    const at = columns.map(c => head.indexOf(c));
    const missing = columns.filter((c, i) => at[i] < 0);
    if (missing.length) {
      errors.push(`${tab}: no column ${missing.map(c => `"${c}"`).join(', ')} in row 1 (is the tab named exactly "${tab}"?)`);
      return null;
    }
    return { rows: rows.slice(1), at };
  }

  const upgrades = {};
  for (const [key, tab] of Object.entries(UPGRADE_TABS)) {
    const t = table(tab, UPGRADE_COLUMNS);
    if (!t) continue;
    if (!t.rows.length) { errors.push(`${tab}: no levels below the header row`); continue; }
    const levels = [{ level: 0, value: 1, cost: 0 }];   // level 0: no upgrade, free (1 block for Growth)
    t.rows.forEach((r, i) => {
      const row = i + 1, [level, value, cost] = t.at.map((c, j) => {
        const raw = r[c] ?? '', n = parseNumber(raw);
        if (raw.trim() === '') errors.push(`${where(tab, c, row, UPGRADE_COLUMNS[j])}: blank`);
        else if (n === null) errors.push(`${where(tab, c, row, UPGRADE_COLUMNS[j])}: "${raw}" is not a number`);
        return n;
      });
      if (level === null || value === null || cost === null) return;
      const prev = levels.at(-1);
      if (level !== prev.level + 1) errors.push(`${where(tab, t.at[0], row, 'Level')}: expected level ${prev.level + 1}, found ${level}`);
      if (!(value > prev.value)) errors.push(`${where(tab, t.at[1], row, 'Value after')}: ${value} must be more than the level before (${prev.value})`);
      if (prev.level > 0 && !(cost > prev.cost)) errors.push(`${where(tab, t.at[2], row, 'Cost (squares)')}: ${cost} must be more than the level before (${prev.cost})`);
      if (!(cost > 0)) errors.push(`${where(tab, t.at[2], row, 'Cost (squares)')}: ${cost} must be more than 0`);
      if (key === 'growth' && !Number.isInteger(value)) errors.push(`${where(tab, t.at[1], row, 'Value after')}: ${value} must be a whole number of blocks`);
      levels.push({ level: prev.level + 1, value, cost });
    });
    upgrades[key] = levels;
  }

  const rules = {}, seen = new Set();
  const t = table(RULES_TAB, RULES_COLUMNS);
  if (t) {
    t.rows.forEach((r, i) => {
      const row = i + 1, [kc, vc, dc] = t.at;
      const k = (r[kc] ?? '').trim(), raw = r[vc] ?? '';
      if (!k) return errors.push(`${where(RULES_TAB, kc, row, 'Key')}: blank`);
      const spec = RULE_KEYS[k];
      if (!spec) return errors.push(`${where(RULES_TAB, kc, row, 'Key')}: unknown key "${k}"`);
      if (seen.has(k)) return errors.push(`${where(RULES_TAB, kc, row, 'Key')}: "${k}" appears twice`);
      seen.add(k);
      if (!(r[dc] ?? '').trim()) errors.push(`${where(RULES_TAB, dc, row, 'What it means')}: blank`);
      const n = parseNumber(raw);
      if (raw.trim() === '') return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: blank (${k})`);
      if (n === null) return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: "${raw}" is not a number (${k})`);
      if (spec.integer && !Number.isInteger(n)) return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: ${k} must be a whole number, not ${n}`);
      if (n < spec.min || n > spec.max) {
        return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: ${k} must be ${spec.max === Infinity ? `at least ${spec.min}` : `between ${spec.min} and ${spec.max}`}, not ${n}`);
      }
      rules[k] = n;
    });
    for (const k of Object.keys(RULE_KEYS)) if (!seen.has(k)) errors.push(`${RULES_TAB}: no row for "${k}"`);
  }
  // Achievements: one row each. Secret: "yes" hides it until earned (blank or "no" otherwise).
  const achievements = [], keys = new Set();
  const a = table(ACHIEVEMENTS_TAB, ACHIEVEMENT_COLUMNS);
  if (a) {
    const T = ACHIEVEMENTS_TAB;
    a.rows.forEach((r, i) => {
      const row = i + 1, cell = j => (r[a.at[j]] ?? '').trim(), at = j => where(T, a.at[j], row, ACHIEVEMENT_COLUMNS[j]);
      const [key, name, category, stat, rawThreshold, rawSecret, description, rawReward] = ACHIEVEMENT_COLUMNS.map((c, j) => cell(j));
      const bad = [];
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) bad.push(`${at(0)}: "${key}" must be lower-case letters, digits and dashes`);
      else if (keys.has(key)) bad.push(`${at(0)}: "${key}" appears twice`);
      keys.add(key);
      if (!name) bad.push(`${at(1)}: blank`);
      else if (name.length > 40) bad.push(`${at(1)}: at most 40 characters`);
      if (!category) bad.push(`${at(2)}: blank`);
      if (!STATS.includes(stat)) bad.push(`${at(3)}: unknown stat "${stat}" (one of: ${STATS.join(', ')})`);
      const threshold = parseNumber(rawThreshold), reward = parseNumber(rawReward);
      if (threshold === null || !(threshold > 0)) bad.push(`${at(4)}: "${rawThreshold}" must be a number above 0`);
      if (!/^(|yes|no|true|false)$/i.test(rawSecret)) bad.push(`${at(5)}: "${rawSecret}" must be yes, no or blank`);
      if (!description) bad.push(`${at(6)}: blank`);
      if (reward === null || reward < 0) bad.push(`${at(7)}: "${rawReward}" must be a number of squares, 0 or more`);
      if (bad.length) return errors.push(...bad);
      achievements.push({ id: key, name, category, stat, threshold, secret: /^(yes|true)$/i.test(rawSecret), description, reward });
    });
    if (!a.rows.length) errors.push(`${T}: no achievements below the header row`);
  }
  // Skins: one row each, with its images in public/skins/. Enabled "no" keeps a skin out of the shop (owners keep it).
  const skins = [], skinKeys = new Set();
  const k = table(SKINS_TAB, SKIN_COLUMNS);
  if (k) {
    k.rows.forEach((r, i) => {
      const row = i + 1, cell = j => (r[k.at[j]] ?? '').trim(), at = j => where(SKINS_TAB, k.at[j], row, SKIN_COLUMNS[j]);
      const [key, name, kind, rarity, rawPrice, collection, enabled] = SKIN_COLUMNS.map((c, j) => cell(j));
      const bad = [];
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key) || key === 'default') bad.push(`${at(0)}: "${key}" must be lower-case letters, digits and dashes (not "default")`);
      else if (skinKeys.has(key)) bad.push(`${at(0)}: "${key}" appears twice`);
      skinKeys.add(key);
      if (!name) bad.push(`${at(1)}: blank`);
      if (!SKIN_KINDS.includes(kind)) bad.push(`${at(2)}: "${kind}" must be pattern or art`);
      if (!RARITIES.includes(rarity)) bad.push(`${at(3)}: "${rarity}" must be ${RARITIES.join(', ')}`);
      const price = parseNumber(rawPrice);
      if (price === null || !Number.isInteger(price) || price < 1) bad.push(`${at(4)}: "${rawPrice}" must be a whole number of squares, 1 or more`);
      if (!collection) bad.push(`${at(5)}: blank`);
      if (!/^(yes|no)$/i.test(enabled)) bad.push(`${at(6)}: "${enabled}" must be yes or no`);
      for (const f of /^[a-z0-9-]+$/.test(key) ? skinFiles(key) : []) if (!hasFile(f)) bad.push(`${at(0)}: no image public/${f}`);
      if (bad.length) return errors.push(...bad);
      skins.push({ id: key, name, kind, rarity, price, collection, enabled: /^yes$/i.test(enabled) });
    });
  }
  return errors.length ? { economy: null, errors } : { economy: { rules, upgrades, achievements, skins }, errors };
}

// Option B: a stored level under the old table becomes the lowest new level whose value is at least the old
// value, so nobody gets weaker. If no new level is that strong, the top level.
function remapLevel(oldLevels, newLevels, level) {
  const old = oldLevels[Math.min(Math.max(0, level | 0), oldLevels.length - 1)].value;
  const found = newLevels.find(l => l.value >= old - 1e-9);
  return (found ?? newLevels.at(-1)).level;
}

// Every stored level that would change, per upgrade: { clickPower: [[old, new], …], … }.
function remapTable(oldUpgrades, newUpgrades) {
  const out = {};
  for (const key of Object.keys(newUpgrades)) {
    const before = oldUpgrades?.[key] ?? [{ level: 0, value: 1, cost: 0 }];
    out[key] = before.map(l => [l.level, remapLevel(before, newUpgrades[key], l.level)]).filter(([a, b]) => a !== b);
  }
  return out;
}

// What changed between two economies, in plain English, one line each.
function describeChanges(before, after) {
  const lines = [];
  const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
  for (const k of Object.keys(RULE_KEYS)) {
    const a = before?.rules?.[k], b = after.rules[k];
    if (a === undefined) lines.push(`${k}: set to ${fmt(b)}`);
    else if (a !== b) lines.push(`${k}: ${fmt(a)} → ${fmt(b)}`);
  }
  for (const [key, tab] of Object.entries(UPGRADE_TABS)) {
    const a = before?.upgrades?.[key] ?? [{ level: 0, value: 1, cost: 0 }], b = after.upgrades[key];
    const parts = [];
    if (a.length !== b.length) parts.push(`${a.length - 1} → ${b.length - 1} levels`);
    const cost = l => l?.cost, value = l => l?.value;
    if (cost(a[1]) !== cost(b[1])) parts.push(`level 1 cost ${a[1] ? fmt(a[1].cost) : 'none'} → ${fmt(b[1].cost)}`);
    if (value(a.at(-1)) !== value(b.at(-1))) parts.push(`top value ${fmt(a.at(-1).value)} → ${fmt(b.at(-1).value)}`);
    const changed = b.slice(1).filter((l, i) => a[i + 1] && (a[i + 1].cost !== l.cost || a[i + 1].value !== l.value)).length;
    if (changed) parts.push(`${changed} existing level${changed === 1 ? '' : 's'} changed`);
    if (parts.length) lines.push(`${tab}: ${parts.join('; ')}`);
  }
  for (const [key, moves] of Object.entries(remapTable(before?.upgrades, after.upgrades))) {
    if (moves.length) lines.push(`${UPGRADE_TABS[key]}: stored levels move ${moves.map(([a, b]) => `${a}→${b}`).join(', ')} (so nobody gets weaker)`);
  }
  const was = new Map((before?.achievements ?? []).map(d => [d.id, JSON.stringify(d)]));
  const now = new Map((after.achievements ?? []).map(d => [d.id, JSON.stringify(d)]));
  const added = [...now.keys()].filter(k => !was.has(k)), removed = [...was.keys()].filter(k => !now.has(k));
  const changed = [...now.keys()].filter(k => was.has(k) && was.get(k) !== now.get(k));
  if (added.length || removed.length || changed.length) {
    lines.push(`Achievements: ${now.size} in all; ${added.length} added, ${removed.length} removed, ${changed.length} changed`
      + (removed.length ? ` (removed: ${removed.join(', ')})` : ''));
  }
  const hadSkins = new Map((before?.skins ?? []).map(d => [d.id, JSON.stringify(d)]));
  const nowSkins = after.skins ?? [];
  const newSkins = nowSkins.filter(d => !hadSkins.has(d.id)).length, changedSkins = nowSkins.filter(d => hadSkins.has(d.id) && hadSkins.get(d.id) !== JSON.stringify(d)).length;
  if (newSkins || changedSkins || hadSkins.size !== nowSkins.length) lines.push(`Skins: ${nowSkins.length} in all; ${newSkins} added, ${changedSkins} changed`);
  return lines.length ? lines : ['No changes.'];
}

module.exports = { UPGRADE_TABS, RULES_TAB, ACHIEVEMENTS_TAB, SKINS_TAB, SKIN_KINDS, RARITIES, skinFiles, STATS, TABS, RULE_KEYS, parseCsv, parseNumber, validate, remapLevel, remapTable, describeChanges };
