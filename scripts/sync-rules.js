// npm run sync-rules: copies the game numbers from Xoren's Google Sheet into data/economy.json.
//   npm run sync-rules                      download the tabs, check them, write the file, report the changes
//   npm run sync-rules -- --check           check only, write nothing
//   npm run sync-rules -- --from <folder>   use saved tabs instead (<Tab name>.csv), e.g. test/fixtures/sheet
// It refuses to write if any check fails, and names each cell and why. Changes reach players only when the
// file is merged into main and deployed. The game never reads the sheet itself.
const fs = require('fs');
const path = require('path');
const economy = require('../economy');

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
  for (const tab of economy.TABS) {
    if (from) {
      const file = path.join(from, tab + '.csv');
      if (fs.existsSync(file)) tabs[tab] = fs.readFileSync(file, 'utf8');
    } else {
      const csv = await download(tab, ids);
      if (csv !== null) tabs[tab] = csv;
    }
  }

  const hasFile = f => fs.existsSync(path.join(__dirname, '..', 'public', f));   // skins need their images
  const { economy: next, errors, warnings = [] } = economy.validate(tabs, { hasFile });
  for (const w of warnings) console.warn('Warning: ' + w);
  if (errors.length) {
    console.error(`The sheet has ${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing was written:`);
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }

  const out = arg('out') ?? OUT;
  const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  // A tab missing from the sheet keeps its part of the current file (Skins, Items and the loop 16 tabs).
  for (const part of ['skins', 'items', 'economy', 'tiers', 'skinRarity', 'glossary']) if (!next[part] && before?.[part]) next[part] = before[part];
  if (!next.skins) next.skins = [];
  if (!next.items) next.items = [];
  console.log('Changes:');
  for (const line of economy.describeChanges(before, next)) console.log('  - ' + line);
  if (arg('check')) return console.log('Checked only (--check): nothing was written.');

  const file = { source: from ? `saved copy: ${from}` : `https://docs.google.com/spreadsheets/d/${SHEET}`,
    syncedAt: new Date().toISOString(), ...next };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), out)}. Commit it; it goes live when merged into main.`);
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
