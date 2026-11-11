// Xoren's Google Sheet -> data/economy.json. Pure functions: CSV text in, a checked economy (or a list of
// problems, each naming its cell) out. scripts/sync-rules.js downloads the tabs and writes the file;
// rules.js reads it. The game never reads the sheet itself.

// The upgrade tabs and the columns read from each (other columns are the sheet's own working).
const RULES_TAB = 'Game Rules';
const RULES_COLUMNS = ['Key', 'Value', 'What it means'];
const ACHIEVEMENTS_TAB = 'Achievements';
const ACHIEVEMENT_COLUMNS = ['Key', 'Name', 'Category', 'Stat', 'Threshold', 'Secret', 'Description', 'Reward'];
const SKINS_TAB = 'Skins';
const SKIN_COLUMNS = ['Key', 'Name', 'Kind', 'Rarity', 'Price', 'Collection', 'Enabled'];
const SKIN_KINDS = ['pattern', 'art'];          // pattern: drawn in the owner's color; art: full-color image
const RARITIES = ['Common', 'Rare', 'Ultra Rare', 'Legendary'];
// The image files every skin needs, under public/: one block, and the large one for Full area coverage.
const skinFiles = key => [`skins/${key}.png`, `skins/${key}-large.png`];
const ITEMS_TAB = 'Items';
// The kinds of effect the game knows (a new kind needs code; a new item of a known kind needs only a row).
const ITEM_EFFECTS = ['clickMultiplier', 'terraform', 'demolish'];
const int = (min, max = Infinity) => ({ integer: true, min, max });
const num = (min, max = Infinity) => ({ integer: false, min, max });
// Loop 16: the new economy tabs. Each is optional in the sheet: a missing tab keeps its part of data/economy.json.
const ECONOMY_TAB = 'Economy', TIERS_TAB = 'Upgrades', RARITY_TAB = 'Skin Rarity', GLOSSARY_TAB = 'Glossary';
const ECONOMY_COLUMNS = ['Key', 'Value', 'Unit', 'What it means'];
const TIER_COLUMNS = ['Key', 'Name', 'Type', 'Tier 1 value (v0)', 'Tier 10 value (vmax)', 'Step', 'c_u (work-hours)', 'Unit', 'What it does'];
const NEW_ITEM_COLUMNS = ['Key', 'Name', 'Description', 'Effect', 'Effect value', 'Duration (seconds)', 'Uses', 'Per (minutes)', 'Consumable',
  'Pricing', 'V (work-hours/hour)', 'P (payback hours)', 'Hours', 'Enabled'];
const RARITY_COLUMNS = ['Rarity', 'Work-hours', 'What it means'];
const GLOSSARY_COLUMNS = ['Symbol', 'Name', 'What it means', 'Formula', 'Where the number lives'];
// The upgrades the code has an effect for (a new one needs a handler in catalog.js; its numbers are a row).
const TIER_KEYS = ['clickPower', 'earnings', 'defense', 'growth', 'factorySpeed', 'factoryLifetime', 'factoryYield'];
const PRICINGS = ['PV', 'Hours'];   // how an item's price is worked out (catalog.js)
const TIER_COUNT = 10;
const TABS = [RULES_TAB, ACHIEVEMENTS_TAB, SKINS_TAB, ITEMS_TAB, ECONOMY_TAB, TIERS_TAB, RARITY_TAB, GLOSSARY_TAB];
// Old tabs the sync no longer reads (loop 16): Inputs, Summary, Click Power, Defense, Earnings, Growth.
// Game Rules keys still allowed but ignored, with a warning.
const RETIRED_RULES = ['squaresPerFirstClaim', 'newMapBlocks'];
const ECONOMY_KEYS = {
  baseBlockSeconds: num(0.1, 3600),
  hitsPerSquare: num(0.1, 1e6),
  defaultBaseBlocks: int(1, 1e9),
  maxLevel: int(1, 30),
  stepsPerTier: int(1, 1000),
  maxBaseBlocksOnline: int(1, 1e9),
  tickSeconds: num(1, 3600),
  inspectHoldMs: int(50, 5000),
  factoryBlocksPerFactory: int(1, 1e6),
  factoryBuildPaybackHours: num(0, 1e6),
  factoryValuePerHour: num(0, 1e6),
  factoryBuildGrowth: num(1, 100),
  factoryAreaSize: int(1, 101),
  factoryDistancePenaltyWh: num(0, 1e6),
  wallStrength: num(0, 1e6),
  wallPaybackHours: num(0, 1e6),
  maxWallsPerBlock: int(0, 4),
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

  // The old per-upgrade level tabs are no longer read (loop 16); data/economy.json keeps their tables until
  // the tier upgrades replace them.
  const warnings = [];
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
  // Skins: one row each, with its images in public/skins/. Enabled "no" keeps a skin out of the shop (owners keep it).
  const skins = [], skinKeys = new Set();
  // No Skins tab yet (Google returns the first tab for an unknown name): skins stay as they are (the sync keeps them).
  const skinsTab = typeof tabs[SKINS_TAB] === 'string' && parseCsv(tabs[SKINS_TAB])[0]?.some(c => c.trim() === 'Kind');
  const k = skinsTab ? table(SKINS_TAB, SKIN_COLUMNS) : null;
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
  // The loop 16 tabs. Each one found by its header row; a missing one is left out, and the sync keeps that part
  // of data/economy.json.
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
  let economyRules = null;
  const ec = has(ECONOMY_TAB, 'Unit') && has(ECONOMY_TAB, 'Key') ? table(ECONOMY_TAB, ECONOMY_COLUMNS) : null;
  if (ec) {
    economyRules = {};
    const seenE = new Set();
    ec.rows.forEach((r, i) => {
      const row = i + 1, [kc, vc] = ec.at, k = (r[kc] ?? '').trim();
      if (!k) return errors.push(`${where(ECONOMY_TAB, kc, row, 'Key')}: blank`);
      const spec = ECONOMY_KEYS[k];
      if (!spec) return errors.push(`${where(ECONOMY_TAB, kc, row, 'Key')}: unknown key "${k}"`);
      if (seenE.has(k)) return errors.push(`${where(ECONOMY_TAB, kc, row, 'Key')}: "${k}" appears twice`);
      seenE.add(k);
      const n = num1(ECONOMY_TAB, vc, row, 'Value', r[vc] ?? '', spec, k);
      if (n !== null) economyRules[k] = n;
    });
    for (const k of Object.keys(ECONOMY_KEYS)) if (!seenE.has(k)) errors.push(`${ECONOMY_TAB}: no row for "${k}"`);
    if (economyRules.factoryAreaSize % 2 === 0) errors.push(`${ECONOMY_TAB}: factoryAreaSize must be odd, so the factory is in the middle (not ${economyRules.factoryAreaSize})`);
  }
  // Upgrades: one row per upgrade, 10 tiers each. Step "geometric" (v0 to vmax) or "list:" with 10 values.
  let tiers = null;
  const tu = has(TIERS_TAB, 'Step') ? table(TIERS_TAB, TIER_COLUMNS) : null;
  if (tu) {
    tiers = {};
    tu.rows.forEach((r, i) => {
      const row = i + 1, cell = j => (r[tu.at[j]] ?? '').trim(), at = j => where(TIERS_TAB, tu.at[j], row, TIER_COLUMNS[j]);
      const key = cell(0);
      if (!TIER_KEYS.includes(key)) return errors.push(`${at(0)}: unknown upgrade "${key}" (one of: ${TIER_KEYS.join(', ')})`);
      if (tiers[key]) return errors.push(`${at(0)}: "${key}" appears twice`);
      if (!cell(1)) errors.push(`${at(1)}: blank`);
      const v0 = num1(TIERS_TAB, tu.at[3], row, TIER_COLUMNS[3], cell(3), num(0.000001));
      const vmax = num1(TIERS_TAB, tu.at[4], row, TIER_COLUMNS[4], cell(4), num(0.000001));
      const cu = num1(TIERS_TAB, tu.at[6], row, TIER_COLUMNS[6], cell(6), num(0));
      let step = cell(5), list = null;
      if (/^list:/i.test(step)) {
        list = step.slice(5).split(',').map(s => parseNumber(s));
        if (list.length !== TIER_COUNT || list.some(n => n === null)) { errors.push(`${at(5)}: a list needs ${TIER_COUNT} numbers, e.g. list:1,2,2,3,3,4,4,5,5,6`); list = null; }
        else if (list.some((n, j) => j && n < list[j - 1])) errors.push(`${at(5)}: the list must never go down`);
        step = 'list';
      } else if (step !== 'geometric') errors.push(`${at(5)}: "${step}" must be geometric or list:…`);
      if (v0 !== null && vmax !== null && vmax < v0) errors.push(`${at(4)}: ${vmax} must be at least the tier 1 value (${v0})`);
      tiers[key] = { name: cell(1), type: cell(2), v0, vmax, step, ...(list ? { list } : {}), cu, unit: cell(7), about: cell(8) };
    });
    for (const k of TIER_KEYS) if (!tiers[k] && !errors.some(e => e.includes(`"${k}"`))) errors.push(`${TIERS_TAB}: no row for "${k}"`);
  }
  // Items: one row each. Pricing PV (P x V x W(L)) or Hours (Hours x W(L)).
  let newItems = null;
  const ni = has(ITEMS_TAB, 'Pricing') ? table(ITEMS_TAB, NEW_ITEM_COLUMNS) : null;
  if (ni) {
    newItems = [];
    const ids = new Set();
    ni.rows.forEach((r, i) => {
      const row = i + 1, cell = j => (r[ni.at[j]] ?? '').trim(), at = j => where(ITEMS_TAB, ni.at[j], row, NEW_ITEM_COLUMNS[j]);
      const opt = (j, spec) => cell(j) === '' ? null : num1(ITEMS_TAB, ni.at[j], row, NEW_ITEM_COLUMNS[j], cell(j), spec);
      const before = errors.length;
      const key = cell(0);
      if (!/^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/.test(key)) errors.push(`${at(0)}: "${key}" must be letters, digits and dashes`);
      else if (ids.has(key)) errors.push(`${at(0)}: "${key}" appears twice`);
      ids.add(key);
      if (!cell(1)) errors.push(`${at(1)}: blank`);
      if (!cell(2)) errors.push(`${at(2)}: blank`);
      const effect = cell(3);
      if (!ITEM_EFFECTS.includes(effect)) errors.push(`${at(3)}: unknown effect "${effect}" (one of: ${ITEM_EFFECTS.join(', ')})`);
      const value = opt(4, num(0)), seconds = opt(5, num(0)), uses = opt(6, int(1, 1000)), per = opt(7, num(1));
      if (!/^(yes|no)$/i.test(cell(8))) errors.push(`${at(8)}: "${cell(8)}" must be yes or no`);
      const consumable = /^yes$/i.test(cell(8));
      if (!consumable && (uses === null || per === null)) errors.push(`${at(6)}: a reusable item needs Uses and Per (minutes)`);
      const pricing = cell(9);
      if (!PRICINGS.includes(pricing)) errors.push(`${at(9)}: "${pricing}" must be ${PRICINGS.join(' or ')}`);
      const V = opt(10, num(0)), P = opt(11, num(0)), hours = opt(12, num(0));
      if (pricing === 'PV' && (V === null || P === null)) errors.push(`${at(10)}: PV pricing needs V and P`);
      if (pricing === 'Hours' && hours === null) errors.push(`${at(12)}: Hours pricing needs Hours`);
      if (!/^(yes|no)$/i.test(cell(13))) errors.push(`${at(13)}: "${cell(13)}" must be yes or no`);
      if (errors.length > before) return;
      newItems.push({ id: key, name: cell(1), description: cell(2), effect, value: value ?? 0, seconds: seconds ?? 0, uses: uses ?? 1,
        perMinutes: per ?? 0, consumable, pricing, V, P, hours, enabled: /^yes$/i.test(cell(13)) });
    });
  }
  // Skin Rarity: work-hours per rarity (a skin's price = hours x W(L)).
  let skinRarity = null;
  const sr = has(RARITY_TAB, 'Work-hours') ? table(RARITY_TAB, RARITY_COLUMNS) : null;
  if (sr) {
    skinRarity = {};
    sr.rows.forEach((r, i) => {
      const row = i + 1, rarity = (r[sr.at[0]] ?? '').trim();
      if (!RARITIES.includes(rarity)) return errors.push(`${where(RARITY_TAB, sr.at[0], row, 'Rarity')}: "${rarity}" must be ${RARITIES.join(', ')}`);
      if (rarity in skinRarity) return errors.push(`${where(RARITY_TAB, sr.at[0], row, 'Rarity')}: "${rarity}" appears twice`);
      const h = num1(RARITY_TAB, sr.at[1], row, 'Work-hours', r[sr.at[1]] ?? '', num(0.0001));
      if (h !== null) skinRarity[rarity] = h;
    });
    for (const k of RARITIES) if (!(k in skinRarity) && !errors.some(e => e.startsWith(RARITY_TAB))) errors.push(`${RARITY_TAB}: no row for "${k}"`);
  }
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
  const parts = { ...(skinsTab ? { skins } : {}), ...(newItems ? { items: newItems } : {}), ...(economyRules ? { economy: economyRules } : {}),
    ...(tiers ? { tiers } : {}), ...(skinRarity ? { skinRarity } : {}), ...(glossary ? { glossary } : {}) };
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
    if (!a) { lines.push(`${b.name}: added (tier 1 ${fmt(b.v0)}, tier 10 ${fmt(b.vmax)}, c_u ${fmt(b.cu)})`); continue; }
    const parts = ['v0', 'vmax', 'step', 'cu'].filter(f => JSON.stringify(a[f]) !== JSON.stringify(b[f])).map(f => `${f} ${fmt(a[f])} → ${fmt(b[f])}`);
    if (JSON.stringify(a.list) !== JSON.stringify(b.list)) parts.push(`list ${a.list?.join(',') ?? 'none'} → ${b.list?.join(',') ?? 'none'}`);
    if (parts.length) lines.push(`${b.name}: ${parts.join('; ')}`);
  }
  // Rows by id: achievements, skins, items; the skin rarity hours; the glossary.
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
  rows('Skins', before?.skins, after.skins);
  rows('Items', before?.items, after.items);
  rows('Glossary', before?.glossary, after.glossary);
  for (const [r, h] of Object.entries(after.skinRarity ?? {})) {
    const a = before?.skinRarity?.[r];
    if (a !== h) lines.push(`${r} skins: ${a === undefined ? 'set to' : `${fmt(a)} →`} ${fmt(h)} work-hours`);
  }
  return lines.length ? lines : ['No changes.'];
}

module.exports = { ECONOMY_TAB, TIERS_TAB, RARITY_TAB, GLOSSARY_TAB, TIER_KEYS, TIER_COUNT, ECONOMY_KEYS, RETIRED_RULES, PRICINGS, RULES_TAB, ACHIEVEMENTS_TAB, SKINS_TAB, ITEMS_TAB, ITEM_EFFECTS, SKIN_KINDS, RARITIES, skinFiles, STATS, TABS, RULE_KEYS, parseCsv, parseNumber, validate, describeChanges };
