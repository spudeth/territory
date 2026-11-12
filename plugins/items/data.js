// The items plug-in's sheet tab (loop 19; the check is loop 16's): the Items tab -> data.json { items: [...] }.
// One row each: Key, Name, Description, Effect, Effect value, Duration (seconds), Uses, Per (minutes), Consumable,
// Pricing (PV = P x V x W(L), or Hours x W(L)), V, P, Hours, Enabled. npm run sync-rules calls validate() with the
// core's sheet tools (economy.sheetKit) and writes data.json; it refuses to write if any check fails.
const TAB = 'Items';
const COLUMNS = ['Key', 'Name', 'Description', 'Effect', 'Effect value', 'Duration (seconds)', 'Uses', 'Per (minutes)', 'Consumable',
  'Pricing', 'V (work-hours/hour)', 'P (payback hours)', 'Hours', 'Enabled'];
// The kinds of effect this plug-in has code for (a new kind needs code; a new item of a known kind needs only a row).
const EFFECTS = ['clickMultiplier', 'terraform', 'demolish'];
const PRICINGS = ['PV', 'Hours'];

// tabs: { 'Items': csv }; kit: economy.sheetKit(tabs, errors). Returns { items } or null if the tab isn't there.
function validate(tabs, kit, errors) {
  const { where, table, has, num1, int, num } = kit;
  const ni = has(TAB, 'Pricing') ? table(TAB, COLUMNS) : null;
  if (!ni) return null;
  const items = [], ids = new Set();
  ni.rows.forEach((r, i) => {
    const row = i + 1, cell = j => (r[ni.at[j]] ?? '').trim(), at = j => where(TAB, ni.at[j], row, COLUMNS[j]);
    const opt = (j, spec) => (cell(j) === '' ? null : num1(TAB, ni.at[j], row, COLUMNS[j], cell(j), spec));
    const before = errors.length;
    const key = cell(0);
    if (!/^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/.test(key)) errors.push(`${at(0)}: "${key}" must be letters, digits and dashes`);
    else if (ids.has(key)) errors.push(`${at(0)}: "${key}" appears twice`);
    ids.add(key);
    if (!cell(1)) errors.push(`${at(1)}: blank`);
    if (!cell(2)) errors.push(`${at(2)}: blank`);
    const effect = cell(3);
    if (!EFFECTS.includes(effect)) errors.push(`${at(3)}: unknown effect "${effect}" (one of: ${EFFECTS.join(', ')})`);
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
    items.push({ id: key, name: cell(1), description: cell(2), effect, value: value ?? 0, seconds: seconds ?? 0, uses: uses ?? 1,
      perMinutes: per ?? 0, consumable, pricing, V, P, hours, enabled: /^yes$/i.test(cell(13)) });
  });
  return { items };
}

module.exports = { TAB, COLUMNS, EFFECTS, PRICINGS, validate };
