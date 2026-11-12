// The walls plug-in's sheet tab (loop 19): the Walls tab (Key, Value, Unit, What it means) -> data.json
// { wallStrength, wallPriceWh, maxWallsPerBlock }. npm run sync-rules calls validate() with the core's sheet tools.
const TAB = 'Walls';
const COLUMNS = ['Key', 'Value', 'Unit', 'What it means'];
// Every key, with the values it may take (kit.int / kit.num: { integer, min, max }).
const KEYS = kit => ({ wallStrength: kit.num(0, 1e6), wallPriceWh: kit.num(0, 1e6), maxWallsPerBlock: kit.int(0, 4) });

// tabs: { Walls: csv }; kit: economy.sheetKit(tabs, errors). Returns the numbers, or null if the tab isn't there.
function validate(tabs, kit, errors) {
  const { where, table, has, num1 } = kit;
  const t = has(TAB, 'Key') && has(TAB, 'Value') ? table(TAB, COLUMNS) : null;
  if (!t) return null;
  const spec = KEYS(kit), out = {}, seen = new Set();
  t.rows.forEach((r, i) => {
    const row = i + 1, [kc, vc] = t.at, k = (r[kc] ?? '').trim();
    if (!k) return errors.push(`${where(TAB, kc, row, 'Key')}: blank`);
    if (!spec[k]) return errors.push(`${where(TAB, kc, row, 'Key')}: unknown key "${k}"`);
    if (seen.has(k)) return errors.push(`${where(TAB, kc, row, 'Key')}: "${k}" appears twice`);
    seen.add(k);
    const n = num1(TAB, vc, row, 'Value', r[vc] ?? '', spec[k], k);
    if (n !== null) out[k] = n;
  });
  for (const k of Object.keys(spec)) if (!seen.has(k)) errors.push(`${TAB}: no row for "${k}"`);
  return out;
}

module.exports = { TAB, KEYS, validate };
