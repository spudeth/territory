// npm run sync-rules: copies the game numbers from Xoren's Google Sheet into data/economy.json.
//   npm run sync-rules                      download the tabs, check them, write the file, report the changes
//   npm run sync-rules -- --check           check only, write nothing
//   npm run sync-rules -- --from <folder>   use saved tabs instead (<Tab name>.csv), e.g. test/fixtures/sheet
// It refuses to write if any check fails, and names each cell and why. Changes reach players only when the
// file is merged into main and deployed. The game never reads the sheet itself.
// Loop 19: each plug-in with a data.js reads its own tabs (plugin.json "tabs") into its own data.json; a tab no
// one reads is skipped with a warning (Charts is display only).
const fs = require('fs');
const path = require('path');
const economy = require('../server/economy');
const plugins = require('../server/plugins');
const IGNORED_TABS = ['Charts'];

const SHEET = '1YIivEUXUWMkdw3w3hlmRn7PkTzH6Xry7EJTr8SuFKiM';
const OUT = path.join(__dirname, '..', 'data', 'economy.json');
const arg = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? null : process.argv[i + 1] ?? true; };

// The sheet's tabs, name -> gid, from its public page.
async function tabIds() {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/htmlview`);
  if (!res.ok) throw new Error(`could not open the sheet (HTTP ${res.status}); is it still shared by link?`);
  const html = await res.text();
  return new Map([...html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*gid=(\d+)/g)].map(m => [JSON.parse(`"${m[1]}"`), m[2]]));
}
// One tab as CSV, exactly as the cells show (this export never guesses a column's type, so a text value in a
// column of numbers, like mailingAddress, comes through). Null if the sheet has no such tab.
async function download(tab, ids) {
  if (!ids.has(tab)) return null;
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${ids.get(tab)}`);
  if (!res.ok) throw new Error(`could not download the "${tab}" tab (HTTP ${res.status}); is the sheet still shared by link?`);
  return res.text();
}

async function main() {
  const from = arg('from');
  const tabs = {};
  const ids = from ? null : await tabIds();
  const withData = plugins.list().filter(p => fs.existsSync(path.join(p.dir, 'data.js')));
  const allTabs = [...economy.TABS, ...withData.flatMap(p => p.tabs)];
  for (const t of ids?.keys() ?? []) if (!allTabs.includes(t) && !IGNORED_TABS.includes(t)) console.warn(`Warning: no installed plug-in reads the "${t}" tab; skipped`);
  for (const tab of allTabs) {
    if (from) {
      const file = path.join(from, tab + '.csv');
      if (fs.existsSync(file)) tabs[tab] = fs.readFileSync(file, 'utf8');
    } else {
      const csv = await download(tab, ids);
      if (csv !== null) tabs[tab] = csv;
    }
  }

  const { economy: next, errors, warnings = [] } = economy.validate(tabs);
  // Each plug-in's tabs, with the same tools. null: its tab isn't there (its data.json stays as it is).
  const pluginParts = withData.map(p => {
    const before = errors.length, part = require(path.join(p.dir, 'data.js')).validate(tabs, economy.sheetKit(tabs, errors), errors, warnings);
    return { p, part: errors.length > before ? null : part };
  });
  for (const w of warnings) console.warn('Warning: ' + w);
  if (errors.length) {
    console.error(`The sheet has ${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing was written:`);
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }

  const out = arg('out') ?? OUT;
  const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  // A tab missing from the sheet keeps its part of the current file (the loop 16 tabs).
  for (const part of ['economy', 'tiers', 'glossary']) if (!next[part] && before?.[part]) next[part] = before[part];
  // A new Economy key the sheet doesn't have yet keeps the file's value (economy.NEW_ECONOMY).
  for (const k of economy.NEW_ECONOMY) if (next.economy && next.economy[k] === undefined && before?.economy?.[k] !== undefined) next.economy[k] = before.economy[k];
  delete next.items;   // the plug-ins' now (plugins/items, plugins/skins: data.json)
  delete next.skins;
  delete next.skinRarity;
  console.log('Changes:');
  for (const line of economy.describeChanges(before, next)) console.log('  - ' + line);
  // A plug-in's file goes next to its folder, or, with --out (tests), under <out's folder>/plugins/<name>/.
  const pluginOut = p => (arg('out') ? path.join(path.dirname(arg('out')), 'plugins', p.name, 'data.json') : path.join(p.dir, 'data.json'));
  for (const { p, part } of pluginParts.filter(x => x.part)) {
    const was = fs.existsSync(pluginOut(p)) ? fs.readFileSync(pluginOut(p), 'utf8') : null;
    console.log(`  - ${p.name}: ${was === JSON.stringify(part, null, 2) + '\n' ? 'no changes' : 'changed'}`);
  }
  if (arg('check')) return console.log('Checked only (--check): nothing was written.');
  for (const { p, part } of pluginParts.filter(x => x.part)) {
    fs.mkdirSync(path.dirname(pluginOut(p)), { recursive: true });
    fs.writeFileSync(pluginOut(p), JSON.stringify(part, null, 2) + '\n');
  }

  const file = { source: from ? `saved copy: ${from}` : `https://docs.google.com/spreadsheets/d/${SHEET}`,
    syncedAt: new Date().toISOString(), ...next };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), out)}. Commit it; it goes live when merged into main.`);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
