// The factories plug-in's sheet tab (loop 19): the Factories tab (Key, Value, Unit, What it means) -> data.json
// { factoryBlocksPerFactory, factoryBuildPaybackHours, factoryValuePerHour, factoryBuildGrowth, factoryAreaSize,
// factoryDistancePenaltyWh }. npm run sync-rules calls validate() with the core's sheet tools.
const TAB = 'Factories';
const COLUMNS = ['Key', 'Value', 'Unit', 'What it means'];
// Every key, with the values it may take (kit.int / kit.num: { integer, min, max }).
const KEYS = kit => ({
  factoryBlocksPerFactory: kit.int(1, 1e6),
  factoryBuildPaybackHours: kit.num(0, 1e6),
  factoryValuePerHour: kit.num(0, 1e6),
  factoryBuildGrowth: kit.num(1, 100),
  factoryAreaSize: kit.int(1, 101),
  factoryDistancePenaltyWh: kit.num(0, 1e6),
});

// tabs: { Factories: csv }; kit: economy.sheetKit(tabs, errors). Returns the numbers, or null if the tab isn't there.
function validate(tabs, kit, errors) {
  const { where, table, has, num1 } = kit;
  const t = has(TAB, 'Key') && has(TAB, 'Value') ? table(TAB, COLUMNS) : null;
  if (!t) return null;
  const spec = KEYS(kit), out = {}, seen = new Map();   // key -> its row
  t.rows.forEach((r, i) => {
    const row = i + 1, [kc, vc] = t.at, k = (r[kc] ?? '').trim();
    if (!k) return errors.push(`${where(TAB, kc, row, 'Key')}: blank`);
    if (!spec[k]) return errors.push(`${where(TAB, kc, row, 'Key')}: unknown key "${k}"`);
    if (seen.has(k)) return errors.push(`${where(TAB, kc, row, 'Key')}: "${k}" appears twice`);
    seen.set(k, row);
    const n = num1(TAB, vc, row, 'Value', r[vc] ?? '', spec[k], k);
    if (n !== null) out[k] = n;
  });
  for (const k of Object.keys(spec)) if (!seen.has(k)) errors.push(`${TAB}: no row for "${k}"`);
  if (out.factoryAreaSize % 2 === 0) errors.push(`${where(TAB, t.at[1], seen.get('factoryAreaSize'), 'Value')}: factoryAreaSize must be odd, so the factory is in the middle (not ${out.factoryAreaSize})`);
  return out;
}

module.exports = { TAB, KEYS, validate };
