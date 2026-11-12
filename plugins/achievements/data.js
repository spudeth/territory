// The achievements plug-in's sheet tab (loop 19): Achievements (one row each) -> data.json { achievements }.
// npm run sync-rules calls validate() with the core's sheet tools. The stats an achievement may use are the core's
// (economy.STATS: the ones the game counts).
const { STATS } = require('../../economy');
const ACHIEVEMENTS_TAB = 'Achievements';
const ACHIEVEMENT_COLUMNS = ['Key', 'Name', 'Category', 'Stat', 'Threshold', 'Secret', 'Description', 'Reward'];

// tabs: { Achievements: csv }; kit: economy.sheetKit(tabs, errors). Returns { achievements }, or null without the tab.
function validate(tabs, kit, errors) {
  const { where, table, has, parseNumber } = kit;
  if (!has(ACHIEVEMENTS_TAB, 'Key')) return null;
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
  return { achievements };
}

module.exports = { ACHIEVEMENTS_TAB, validate };
