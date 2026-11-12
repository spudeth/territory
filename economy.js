// Xoren's Google Sheet -> data/economy.json. Pure functions: CSV text in, a checked economy (or a list of
// problems, each naming its cell) out. scripts/sync-rules.js downloads the tabs and writes the file;
// rules.js reads it. The game never reads the sheet itself.

// The upgrade tabs and the columns read from each (other columns are the sheet's own working).
const RULES_TAB = 'Game Rules';
const RULES_COLUMNS = ['Key', 'Value', 'What it means'];
const ACHIEVEMENTS_TAB = 'Achievements';
const ACHIEVEMENT_COLUMNS = ['Key', 'Name', 'Category', 'Stat', 'Threshold', 'Secret', 'Description', 'Reward'];
const int = (min, max = Infinity) => ({ integer: true, min, max });
const num = (min, max = Infinity) => ({ integer: false, min, max });
// Loop 16: the new economy tabs. Each is optional in the sheet: a missing tab keeps its part of data/economy.json.
const ECONOMY_TAB = 'Economy', TIERS_TAB = 'Upgrades', GLOSSARY_TAB = 'Glossary';
// Loop 19: the Walls and Factories tabs belong to their plug-ins (plugins/<name>/data.js), not to this file.
const ECONOMY_COLUMNS = ['Key', 'Value', 'Unit', 'What it means'];
// Loop 18: each upgrade's tiers and steps, and the curves of its gains and prices (catalog.js has the formulas).
const TIER_COLUMNS = ['Key', 'Name', 'Type', 'Tier 1 start', 'Tier 1 max', 'Multiplier per tier', 'Tiers', 'Steps per tier',
  'Tier cost (work hours)', 'Price curve', 'Gain curve', 'Unit', 'What it does'];
const GLOSSARY_COLUMNS = ['Symbol', 'Name', 'What it means', 'Formula', 'Where the number lives'];
// Loop 19: any upgrade is a row; it changes the variable in its Variable column (variables.js). Without the column
// (an older sheet), the names agreed in Q39 are used.
const VARIABLE_COLUMN = 'Variable';
const TIER_FIELDS = ['variable', 'start', 'max1', 'mult', 'tiers', 'steps', 'tierWh', 'priceCurve', 'gainCurve'];   // what describeChanges compares
const TABS = [RULES_TAB, ACHIEVEMENTS_TAB, ECONOMY_TAB, TIERS_TAB, GLOSSARY_TAB];
// Old tabs the sync no longer reads (loop 16): Inputs, Summary, Click Power, Defense, Earnings, Growth.
// Game Rules keys still allowed but ignored, with a warning.
const RETIRED_RULES = ['squaresPerFirstClaim', 'newMapBlocks'];
// Economy keys still allowed but ignored, with a warning (loop 18: steps per tier are on the Upgrades tab now, and
// walls are priced in work-hours).
const RETIRED_ECONOMY = ['stepsPerTier', 'wallPaybackHours'];
// Economy keys the sheet may not have yet: a missing row is a warning, and the sync keeps the file's value.
const NEW_ECONOMY = [];
const LEGACY_VARIABLE = require('./variables').LEGACY_UPGRADE_VARIABLE;
const ECONOMY_KEYS = {
  baseBlockSeconds: num(0.1, 3600),
  hitsPerSquare: num(0.1, 1e6),
  defaultBaseBlocks: int(1, 1e9),
  maxLevel: int(1, 30),
  maxBaseBlocksOnline: int(1, 1e9),
  tickSeconds: num(1, 3600),
  inspectHoldMs: int(50, 5000),
  marketFee: num(0, 1),
  marketMinAccountDays: num(0, 3650),
};

// The stats an achievement can use: the ones the game counts (achievements.js has what each one means).
// bestRank counts down: a threshold of 3 means "#3 or better".
const STATS = ['claims', 'owned', 'bestSquare', 'bestLine', 'taken', 'lost', 'taps', 'squaresEarned', 'squaresSpent', 'purchases',
  'level:clickPower', 'level:defense', 'level:earnings', 'level:growth', 'level:factorySpeed', 'level:factoryLifetime',
  'level:factoryYield', 'tiers', 'highestLevel', 'terrain:sand', 'terrain:forest', 'terrain:stone', 'terrain:gold',
  'mapsPlayed', 'daysPlayed', 'bestStreak', 'bestRank', 'reignMinutes', 'wipes', 'hoursPlayed', 'sessionClaims', 'bestDayClaims',
  'chatMessages', 'squaresHeld', 'growthBlocks', 'mapGrown', 'renames', 'account', 'tutorialDone', 'achievements', 'secrets',
  'secret:castaway', 'secret:witching', 'secret:leet', 'secret:revenge', 'secret:poke', 'secret:treehugger', 'secret:speedrun',
  'secret:comeback', 'secret:helloworld', 'secret:wipedout'];

// Every Game Rules key, with the values it may take.
const RULE_KEYS = {
  hitsPerBlock: int(1, 1000),
  crackFadeSeconds: num(1, 86400),
  crackFadeHits: num(0.01, 1000),
  squaresPerFirstClaim: num(0, 1e6),   // retired (loop 16): allowed, ignored
  guestsPerIp: int(1, 10000),
  guestWindowMinutes: num(1, 100000),
  renameWaitMinutes: num(0, 100000),
  maxTapsPerSecond: num(1, 100),
  nameMaxLength: int(1, 15),          // the database allows at most 15
  newMapWidth: int(1, 1000),
  newMapHeight: int(1, 1000),
  newMapBlocks: int(1, 1000000),       // retired (loop 16): allowed, ignored
  rankMinPlayers: int(2, 100000),
  rankMinBlocks: int(1, 1000000),
  mailingAddress: { text: true },   // the email footer's postal address (US anti-spam law); blank = nothing is sent
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
// variables: { name: base } the upgrades may change (default: the core's and every plug-in folder's).
// The tools for reading tabs, for the core's tabs and each plug-in's data.js (loop 19): every problem goes in
// `errors`, naming its cell. where(tab, col, row, header) names a cell; table(tab, columns) finds the columns by name
// in row 1 ({ rows, at } or null); has(tab, col) tells whether a tab has that column; num1(...) reads a number
// against a spec from int() or num().
function sheetKit(tabs, errors) {
  const where = (tab, col, row, header) => `${tab}, cell ${cellName(col, row)}${header ? ` ("${header}")` : ''}`;
  // A missing tab shows up here too: for an unknown tab name, Google's export returns the first tab instead, whose
  // header row is different.
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
  const has = (tab, col) => typeof tabs[tab] === 'string' && parseCsv(tabs[tab])[0]?.some(c => c.trim() === col);
  const num1 = (tab, c, row, header, raw, spec, k) => {
    const n = parseNumber(raw);
    if (raw.trim() === '') { errors.push(`${where(tab, c, row, header)}: blank${k ? ` (${k})` : ''}`); return null; }
    if (n === null) { errors.push(`${where(tab, c, row, header)}: "${raw}" is not a number${k ? ` (${k})` : ''}`); return null; }
    if (spec.integer && !Number.isInteger(n)) { errors.push(`${where(tab, c, row, header)}: ${k ?? header} must be a whole number, not ${n}`); return null; }
    if (n < spec.min || n > spec.max) {
      errors.push(`${where(tab, c, row, header)}: ${k ?? header} must be ${spec.max === Infinity ? `at least ${spec.min}` : `between ${spec.min} and ${spec.max}`}, not ${n}`);
      return null;
    }
    return n;
  };
  return { where, table, has, num1, int, num, parseCsv, parseNumber };
}

function validate(tabs, { variables = require('./variables').declared() } = {}) {
  const errors = [], warnings = [];
  const { where, table, has, num1 } = sheetKit(tabs, errors);
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
      if (spec.text) { rules[k] = raw.trim(); return; }   // a text value; may be blank
      const n = parseNumber(raw);
      if (raw.trim() === '') return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: blank (${k})`);
      if (n === null) return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: "${raw}" is not a number (${k})`);
      if (spec.integer && !Number.isInteger(n)) return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: ${k} must be a whole number, not ${n}`);
      if (n < spec.min || n > spec.max) {
        return errors.push(`${where(RULES_TAB, vc, row, 'Value')}: ${k} must be ${spec.max === Infinity ? `at least ${spec.min}` : `between ${spec.min} and ${spec.max}`}, not ${n}`);
      }
      rules[k] = n;
    });
    for (const k of RETIRED_RULES) if (seen.has(k)) { warnings.push(`${RULES_TAB}: "${k}" is retired and ignored; the row can be deleted`); delete rules[k]; }
    for (const k of Object.keys(RULE_KEYS)) if (!seen.has(k) && !RETIRED_RULES.includes(k)) errors.push(`${RULES_TAB}: no row for "${k}"`);
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
  // Skins and Skin Rarity: the skins plug-in's (plugins/skins/data.js, loop 19).
  // The loop 16 tabs. Each one found by its header row; a missing one is left out, and the sync keeps that part
  // of data/economy.json.
  // Economy: Key, Value rows, each key once. (Walls and Factories: their plug-ins' own tabs.)
  let economyRules = null;
  const seenE = new Map();   // key -> the tab it was on
  for (const tab of [ECONOMY_TAB]) {
    const ec = has(tab, 'Unit') && has(tab, 'Key') ? table(tab, ECONOMY_COLUMNS) : null;
    if (!ec) continue;
    economyRules ??= {};
    ec.rows.forEach((r, i) => {
      const row = i + 1, [kc, vc] = ec.at, k = (r[kc] ?? '').trim();
      if (!k) return errors.push(`${where(tab, kc, row, 'Key')}: blank`);
      if (RETIRED_ECONOMY.includes(k)) { seenE.set(k, tab); return warnings.push(`${tab}: "${k}" is retired and ignored; the row can be deleted`); }
      const spec = ECONOMY_KEYS[k];
      if (!spec) return errors.push(`${where(tab, kc, row, 'Key')}: unknown key "${k}"`);
      if (seenE.has(k)) return errors.push(`${where(tab, kc, row, 'Key')}: "${k}" appears twice`);
      seenE.set(k, tab);
      const n = num1(tab, vc, row, 'Value', r[vc] ?? '', spec, k);
      if (n !== null) economyRules[k] = n;
    });
  }
  if (economyRules) {
    for (const k of Object.keys(ECONOMY_KEYS)) {
      if (seenE.has(k)) continue;
      if (NEW_ECONOMY.includes(k)) warnings.push(`${ECONOMY_TAB}: no row for "${k}" yet; keeping the value in data/economy.json`);
      else errors.push(`${ECONOMY_TAB}: no row for "${k}"`);
    }
  }
  // Upgrades (loop 18): one row per upgrade. Tier 1 runs from its start to its max; each later tier doubles (the
  // multiplier); each tier is bought in S steps, priced and gaining along log curves (catalog.js).
  let tiers = null;
  const tu = has(TIERS_TAB, 'Gain curve') ? table(TIERS_TAB, TIER_COLUMNS) : null;
  if (tu) {
    tiers = {};
    const vc = parseCsv(tabs[TIERS_TAB])[0].map(c => c.trim()).indexOf(VARIABLE_COLUMN), changedBy = new Map();
    if (vc < 0) warnings.push(`${TIERS_TAB}: no "${VARIABLE_COLUMN}" column yet; using the variables agreed in Q39`);
    tu.rows.forEach((r, i) => {
      const row = i + 1, cell = j => (r[tu.at[j]] ?? '').trim(), at = j => where(TIERS_TAB, tu.at[j], row, TIER_COLUMNS[j]);
      const key = cell(0);
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return errors.push(`${at(0)}: "${key}" must be letters and digits, starting with a letter`);
      if (tiers[key]) return errors.push(`${at(0)}: "${key}" appears twice`);
      const variable = vc < 0 ? (LEGACY_VARIABLE[key] ?? key) : (r[vc] ?? '').trim();
      if (!variable) return errors.push(`${where(TIERS_TAB, vc, row, VARIABLE_COLUMN)}: blank`);
      if (changedBy.has(variable)) return errors.push(`${vc < 0 ? at(0) : where(TIERS_TAB, vc, row, VARIABLE_COLUMN)}: "${variable}" is already changed by ${changedBy.get(variable)}`);
      changedBy.set(variable, key);
      if (!(variable in variables)) warnings.push(`${TIERS_TAB}: "${key}" changes "${variable}", which no installed plug-in has; it won't show until one does`);
      if (!cell(1)) errors.push(`${at(1)}: blank`);
      const n1 = (j, spec) => num1(TIERS_TAB, tu.at[j], row, TIER_COLUMNS[j], cell(j), spec);
      const start = n1(3, num(0.000001)), max1 = n1(4, num(0.000001)), mult = n1(5, num(1, 1000)), count = n1(6, int(1, 30)),
        steps = n1(7, int(1, 1000)), tierWh = n1(8, num(0)), priceCurve = n1(9, num(0.000001, 1e6)), gainCurve = n1(10, num(0.000001, 1e6));
      if (start !== null && max1 !== null && max1 < start) errors.push(`${at(4)}: ${max1} must be at least the tier 1 start (${start})`);
      // Q40: the tier 1 start is the variable's base (set by the core or its plug-in).
      if (start !== null && variable in variables && Math.abs(start - variables[variable]) > 1e-9) errors.push(`${at(3)}: ${start} must equal the base of "${variable}" (${variables[variable]})`);
      tiers[key] = { name: cell(1), type: cell(2), variable, start, max1, mult, tiers: count, steps, tierWh, priceCurve, gainCurve, unit: cell(11), about: cell(12) };
    });
  }
  // Items: plugins/items/data.js (loop 19).
  // Glossary: shown in full in the Game Guide.
  let glossary = null;
  const gl = has(GLOSSARY_TAB, 'Symbol') ? table(GLOSSARY_TAB, GLOSSARY_COLUMNS) : null;
  if (gl) {
    glossary = [];
    gl.rows.forEach((r, i) => {
      const [symbol, name, meaning, formula, home] = gl.at.map(c => (r[c] ?? '').trim());
      if (!symbol) return errors.push(`${where(GLOSSARY_TAB, gl.at[0], i + 1, 'Symbol')}: blank`);
      if (!meaning) return errors.push(`${where(GLOSSARY_TAB, gl.at[2], i + 1, 'What it means')}: blank`);
      glossary.push({ symbol, name, meaning, formula, home });
    });
  }
  const parts = { ...(economyRules ? { economy: economyRules } : {}), ...(tiers ? { tiers } : {}), ...(glossary ? { glossary } : {}) };
  return errors.length ? { economy: null, errors, warnings } : { economy: { rules, achievements, ...parts }, errors, warnings };
}

function describeChanges(before, after) {
  const lines = [];
  const fmt = n => typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : JSON.stringify(n);
  // Key-value parts: Game Rules and Economy.
  for (const [part, keys] of [['rules', Object.keys(RULE_KEYS).filter(k => !RETIRED_RULES.includes(k))], ['economy', Object.keys(ECONOMY_KEYS)]]) {
    if (!after[part]) continue;
    for (const k of keys) {
      const a = before?.[part]?.[k], b = after[part][k];
      if (b === undefined) continue;
      if (a === undefined) lines.push(`${k}: set to ${fmt(b)}`);
      else if (a !== b) lines.push(`${k}: ${fmt(a)} → ${fmt(b)}`);
    }
  }
  for (const k of RETIRED_RULES) if (before?.rules?.[k] !== undefined && after.rules?.[k] === undefined) lines.push(`${k}: retired (no longer used)`);
  // Upgrade tiers: what changed in each row.
  for (const [k, b] of Object.entries(after.tiers ?? {})) {
    const a = before?.tiers?.[k];
    if (!a) { lines.push(`${b.name}: added (tier 1 ${fmt(b.start)} to ${fmt(b.max1)}, x${fmt(b.mult)} a tier, ${b.tiers} tiers of ${b.steps} steps, ${fmt(b.tierWh)} work-hours a tier)`); continue; }
    const parts = TIER_FIELDS.filter(f => JSON.stringify(a[f]) !== JSON.stringify(b[f])).map(f => `${f} ${fmt(a[f])} → ${fmt(b[f])}`);
    if (parts.length) lines.push(`${b.name}: ${parts.join('; ')}`);
  }
  // Rows by id: achievements; the glossary. (Plug-ins' data: each says whether it changed.)
  const rows = (label, a = [], b) => {
    if (!b) return;
    const was = new Map(a.map(d => [d.id ?? d.symbol, JSON.stringify(d)])), now = new Map(b.map(d => [d.id ?? d.symbol, JSON.stringify(d)]));
    const added = [...now.keys()].filter(k => !was.has(k)), removed = [...was.keys()].filter(k => !now.has(k));
    const changed = [...now.keys()].filter(k => was.has(k) && was.get(k) !== now.get(k));
    if (added.length || removed.length || changed.length) {
      lines.push(`${label}: ${now.size} in all; ${added.length} added, ${removed.length} removed, ${changed.length} changed`
        + (removed.length && removed.length <= 10 ? ` (removed: ${removed.join(', ')})` : ''));
    }
  };
  rows('Achievements', before?.achievements, after.achievements);
  rows('Glossary', before?.glossary, after.glossary);
  return lines.length ? lines : ['No changes.'];
}

module.exports = { sheetKit, ECONOMY_TAB, TIERS_TAB, GLOSSARY_TAB, VARIABLE_COLUMN, TIER_COLUMNS, ECONOMY_KEYS, RETIRED_RULES, RETIRED_ECONOMY, NEW_ECONOMY, RULES_TAB, ACHIEVEMENTS_TAB, STATS, TABS, RULE_KEYS, parseCsv, parseNumber, validate, describeChanges };
