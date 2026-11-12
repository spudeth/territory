// The skins plug-in's sheet tabs (loop 19): Skins (one row per skin) and Skin Rarity (work-hours per rarity) ->
// data.json { skins, skinRarity }. npm run sync-rules calls validate() with the core's sheet tools. A tab missing from
// the sheet keeps its part of data.json.
const fs = require('fs');
const path = require('path');
const SKINS_TAB = 'Skins';
const SKIN_COLUMNS = ['Key', 'Name', 'Kind', 'Rarity', 'Price', 'Collection', 'Enabled'];
const SKIN_KINDS = ['pattern', 'art'];          // pattern: drawn in the owner's color; art: full-color image
const RARITIES = ['Common', 'Rare', 'Ultra Rare', 'Legendary'];
const RARITY_TAB = 'Skin Rarity';
const RARITY_COLUMNS = ['Rarity', 'Work-hours', 'What it means'];
// The image files every skin needs, in look/: one block, and the large one for Full area coverage.
const skinFiles = key => [`${key}.png`, `${key}-large.png`];
const LOOK = path.join(__dirname, 'look');

// tabs: { Skins: csv, 'Skin Rarity': csv }; kit: economy.sheetKit(tabs, errors). hasFile(name): whether look/ has
// that image (tests pass their own). Returns { skins, skinRarity }, or null when neither tab is there.
function validate(tabs, kit, errors, warnings = [], { hasFile = f => fs.existsSync(path.join(LOOK, f)), current = readCurrent() } = {}) {
  const { where, table, has, num1, num, parseCsv, parseNumber } = kit;
  // Skins: one row each, with its images in look/. Enabled "no" keeps a skin out of the shop (owners keep it).
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
      for (const f of /^[a-z0-9-]+$/.test(key) ? skinFiles(key) : []) if (!hasFile(f)) bad.push(`${at(0)}: no image plugins/skins/look/${f}`);
      if (bad.length) return errors.push(...bad);
      skins.push({ id: key, name, kind, rarity, price, collection, enabled: /^yes$/i.test(enabled) });
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
  if (!skinsTab && !skinRarity) return null;
  return { skins: skinsTab ? skins : current.skins ?? [], skinRarity: skinRarity ?? current.skinRarity ?? {} };
}
function readCurrent() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8')); } catch { return {}; }
}

module.exports = { SKINS_TAB, RARITY_TAB, SKIN_KINDS, RARITIES, skinFiles, validate };
