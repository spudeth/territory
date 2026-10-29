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

// One tab as CSV, through the sheet's public export. (For a tab name that doesn't exist, Google returns the
// first tab instead; economy.validate catches that by its header row.)
async function download(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download the "${tab}" tab (HTTP ${res.status}); is the sheet still shared by link?`);
  return res.text();
}

async function main() {
  const from = arg('from');
  const tabs = {};
  for (const tab of economy.TABS) {
    if (from) {
      const file = path.join(from, tab + '.csv');
      if (fs.existsSync(file)) tabs[tab] = fs.readFileSync(file, 'utf8');
    } else {
      tabs[tab] = await download(tab);
    }
  }

  const hasFile = f => fs.existsSync(path.join(__dirname, '..', 'public', f));   // skins need their images
  const { economy: next, errors } = economy.validate(tabs, { hasFile });
  if (errors.length) {
    console.error(`The sheet has ${errors.length} problem${errors.length === 1 ? '' : 's'}; nothing was written:`);
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
    return;
  }

  const out = arg('out') ?? OUT;
  const before = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  if (!next.skins) next.skins = before?.skins ?? [];   // no Skins tab in the sheet yet: keep the current skins
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
