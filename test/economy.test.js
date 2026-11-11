// The sheet sync: checks and change reports, using a saved copy of the sheet (no internet).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const economy = require('../economy');

const DIR = path.join(__dirname, 'fixtures', 'sheet');
const saved = () => Object.fromEntries(economy.TABS.map(t => [t, fs.readFileSync(path.join(DIR, t + '.csv'), 'utf8')]));
// Changes one cell of a tab's CSV: row and column counted from 0, the header being row 0.
function setCell(csv, row, col, value) {
  const rows = economy.parseCsv(csv);
  rows[row][col] = value;
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}
const errorsWith = (tabs) => economy.validate(tabs).errors;

test('the saved sheet passes and reads every tab as shown; retired Game Rules keys are ignored with a warning', () => {
  const { economy: e, errors, warnings } = economy.validate(saved());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ['Game Rules: "squaresPerFirstClaim" is retired and ignored; the row can be deleted',
    'Game Rules: "newMapBlocks" is retired and ignored; the row can be deleted',
    'Upgrades: no "Variable" column yet; using the variables agreed in Q39']);
  assert.equal(e.rules.hitsPerBlock, 10);
  assert.equal(e.rules.squaresPerFirstClaim, undefined);
  assert.equal(e.achievements.length, 300);
  assert.deepEqual(e.achievements[0], { id: 'first-block', name: 'First Block', category: 'Claiming', stat: 'claims', threshold: 1, secret: false, description: 'Claim 1 empty block', reward: 0.5 });
  assert.equal(e.economy.defaultBaseBlocks, 431649);
  assert.equal(e.economy.marketFee, 0.05);
  // Loop 19: Economy, Walls and Factories are read into one part; each key once, on its own tab.
  assert.deepEqual(Object.keys(e.economy).sort(), Object.keys(economy.ECONOMY_KEYS).sort());
  assert.deepEqual([e.economy.wallPriceWh, e.economy.factoryAreaSize, economy.homeTab('wallStrength'), economy.homeTab('factoryAreaSize'), economy.homeTab('marketFee')],
    [0.01, 5, 'Walls', 'Factories', 'Economy']);
  assert.deepEqual(Object.keys(e.tiers), ['clickPower', 'earnings', 'defense', 'growth', 'factorySpeed', 'factoryLifetime', 'factoryYield']);
  assert.deepEqual(Object.values(e.tiers).map(u => u.variable), ['clickPower', 'earnings', 'defense', 'growth', 'factories.speed', 'factories.lifetime', 'factories.yield'],
    'no Variable column yet: the names agreed in Q39');
  assert.deepEqual(e.tiers.clickPower, { name: 'Click Power', type: 'Income', variable: 'clickPower', start: 1, max1: 10, mult: 2, tiers: 10, steps: 90, tierWh: 12, priceCurve: 9, gainCurve: 9,
    unit: 'x hits per tap', about: 'Each tap counts as this many hits' });
  assert.deepEqual([e.tiers.factorySpeed.start, e.tiers.factorySpeed.max1], [0.05, 0.1]);
  assert.deepEqual(e.items.map(i => [i.id, i.pricing, i.consumable]), [['superClick', 'PV', false], ['terraformer', 'PV', false], ['demolition', 'Hours', true]]);
  assert.deepEqual(e.skinRarity, { Common: 0.3333, Rare: 1, 'Ultra Rare': 5, Legendary: 20 });
  assert.ok(e.glossary.length >= 20);
  assert.deepEqual(e.glossary[0].symbol, 'E');
});

test('a missing tab, or the first tab returned in its place, is refused by name; the new tabs are left out instead', () => {
  const tabs = saved();
  delete tabs['Game Rules'];
  assert.deepEqual(errorsWith(tabs), ['Game Rules: the tab is missing']);
  const fallback = saved();
  fallback['Game Rules'] = '"Territory upgrade economy: edit the yellow cells","",""\n"Hits to take a plain block","10","Game rule"';
  assert.match(errorsWith(fallback)[0], /^Game Rules: no column "Key", "Value", "What it means" in row 1/);
  // Google returns the first tab (Economy) for a tab that doesn't exist: each new tab is then left out.
  const none = saved();
  for (const t of ['Upgrades', 'Items', 'Skin Rarity', 'Glossary']) none[t] = none.Economy;
  delete none.Economy;
  const r = economy.validate(none);
  assert.deepEqual(r.errors, []);
  for (const part of ['economy', 'tiers', 'items', 'skinRarity', 'glossary']) assert.equal(r.economy[part], undefined, part);
});

test('the Economy, Walls and Factories tabs: unknown, missing, twice, on the wrong tab, out of range, not whole and not a number are refused by cell', () => {
  const tab = saved().Economy;
  const row = k => economy.parseCsv(tab).findIndex(r => r[0] === k);
  const check = (csv, expected) => {
    const tabs = saved();
    tabs.Economy = csv;
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  };
  check(setCell(tab, row('maxLevel'), 0, 'maxLevle'), `Economy, cell A${row('maxLevel') + 1} ("Key"): unknown key "maxLevle"`);
  check(setCell(tab, row('maxLevel'), 0, 'maxLevle'), 'Economy: no row for "maxLevel"');
  check(setCell(tab, row('tickSeconds'), 0, 'maxLevel'), `Economy, cell A${row('tickSeconds') + 1} ("Key"): "maxLevel" appears twice`);
  check(setCell(tab, row('marketFee'), 1, '1.5'), `Economy, cell B${row('marketFee') + 1} ("Value"): marketFee must be between 0 and 1, not 1.5`);
  check(setCell(tab, row('defaultBaseBlocks'), 1, '1.5'), `Economy, cell B${row('defaultBaseBlocks') + 1} ("Value"): defaultBaseBlocks must be a whole number, not 1.5`);
  check(setCell(tab, row('baseBlockSeconds'), 1, 'three'), `Economy, cell B${row('baseBlockSeconds') + 1} ("Value"): "three" is not a number (baseBlockSeconds)`);
  // The walls' and factories' own tabs.
  const fac = saved().Factories, frow = k => economy.parseCsv(fac).findIndex(r => r[0] === k);
  const checkTab = (name, csv, expected) => {
    const tabs = saved();
    tabs[name] = csv;
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  };
  checkTab('Factories', setCell(fac, frow('factoryAreaSize'), 1, '4'), 'Factories: factoryAreaSize must be odd, so the factory is in the middle (not 4)');
  checkTab('Factories', setCell(fac, frow('factoryAreaSize'), 0, 'wallStrength'), `Factories, cell A${frow('factoryAreaSize') + 1} ("Key"): "wallStrength" belongs on the Walls tab`);
  checkTab('Factories', setCell(fac, frow('factoryAreaSize'), 0, 'factoryAreaSise'), 'Factories: no row for "factoryAreaSize"');
  // An older sheet with a factory key still on Economy: accepted, but not on both.
  checkTab('Economy', tab + '\nfactoryAreaSize,5,blocks,old row', `Factories, cell A${frow('factoryAreaSize') + 1} ("Key"): "factoryAreaSize" appears twice (also on Economy)`);
  const old = saved();
  old.Economy = tab + '\n' + economy.parseCsv(fac).slice(1).map(r => r.map(c => JSON.stringify(c)).join(',')).join('\n');
  delete old.Factories;
  assert.deepEqual(economy.validate(old).errors, [], 'factory rows on the Economy tab of an older sheet');
});

test('the Upgrades tab: unknown upgrades, bad numbers and missing rows are refused by cell', () => {
  const tab = saved().Upgrades;
  const row = k => economy.parseCsv(tab).findIndex(r => r[0] === k);
  const check = (csv, expected) => {
    const tabs = saved();
    tabs.Upgrades = csv;
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  };
  check(setCell(tab, row('defense'), 0, 'arm or'), `Upgrades, cell A${row('defense') + 1} ("Key"): "arm or" must be letters and digits, starting with a letter`);
  check(setCell(tab, row('defense'), 3, '2'), `Upgrades, cell D${row('defense') + 1} ("Tier 1 start"): 2 must equal the base of "defense" (1)`);
  check(setCell(tab, row('defense'), 4, '0.5'), `Upgrades, cell E${row('defense') + 1} ("Tier 1 max"): 0.5 must be at least the tier 1 start (1)`);
  check(setCell(tab, row('earnings'), 5, '0.5'), `Upgrades, cell F${row('earnings') + 1} ("Multiplier per tier"): Multiplier per tier must be between 1 and 1000, not 0.5`);
  check(setCell(tab, row('growth'), 6, '2.5'), `Upgrades, cell G${row('growth') + 1} ("Tiers"): Tiers must be a whole number, not 2.5`);
  check(setCell(tab, row('growth'), 7, '0'), `Upgrades, cell H${row('growth') + 1} ("Steps per tier"): Steps per tier must be between 1 and 1000, not 0`);
  check(setCell(tab, row('clickPower'), 8, ''), `Upgrades, cell I${row('clickPower') + 1} ("Tier cost (work hours)"): blank`);
  check(setCell(tab, row('clickPower'), 9, '0'), `Upgrades, cell J${row('clickPower') + 1} ("Price curve"): Price curve must be between 0.000001 and 1000000, not 0`);
  check(setCell(tab, row('clickPower'), 10, 'x'), `Upgrades, cell K${row('clickPower') + 1} ("Gain curve"): "x" is not a number`);
});

test('the Items, Skin Rarity and Glossary tabs: bad rows are named by cell', () => {
  const items = saved().Items;
  const check = (tab, csv, expected) => {
    const tabs = saved();
    tabs[tab] = csv;
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  };
  check('Items', setCell(items, 1, 3, 'explode'), `Items, cell D2 ("Effect"): unknown effect "explode" (one of: ${economy.ITEM_EFFECTS.join(', ')})`);
  check('Items', setCell(items, 1, 9, 'Free'), 'Items, cell J2 ("Pricing"): "Free" must be PV or Hours');
  check('Items', setCell(items, 1, 10, ''), 'Items, cell K2 ("V (work-hours/hour)"): PV pricing needs V and P');
  check('Items', setCell(items, 3, 12, ''), 'Items, cell M4 ("Hours"): Hours pricing needs Hours');
  check('Items', setCell(items, 1, 6, ''), 'Items, cell G2 ("Uses"): a reusable item needs Uses and Per (minutes)');
  check('Items', setCell(items, 1, 8, 'maybe'), 'Items, cell I2 ("Consumable"): "maybe" must be yes or no');
  check('Items', setCell(items, 2, 0, 'superClick'), 'Items, cell A3 ("Key"): "superClick" appears twice');
  const rarity = saved()['Skin Rarity'];
  check('Skin Rarity', setCell(rarity, 1, 0, 'Mythic'), 'Skin Rarity, cell A2 ("Rarity"): "Mythic" must be Common, Rare, Ultra Rare, Legendary');
  check('Skin Rarity', setCell(rarity, 2, 1, '0'), 'Skin Rarity, cell B3 ("Work-hours"): Work-hours must be at least 0.0001, not 0');
  check('Glossary', setCell(saved().Glossary, 2, 2, ''), 'Glossary, cell C3 ("What it means"): blank');
});

test('numbers: plain, with thousands commas, negative and decimal; anything else is not a number', () => {
  for (const [s, n] of [['10', 10], ['1,161', 1161], ['116,172', 116172], ['-2.5', -2.5], ['0.25', 0.25], [' 7 ', 7]]) assert.equal(economy.parseNumber(s), n, s);
  for (const s of ['', 'ten', '1,16', '10%', '1.2.3', '$5', '1e3']) assert.equal(economy.parseNumber(s), null, s);
  assert.deepEqual(economy.parseCsv('"a, b","say ""hi"""\n"x\ny",2'), [['a, b', 'say "hi"'], ['x\ny', '2']]);
});

test('the change report says what changed in plain English', () => {
  const after = economy.validate(saved()).economy;
  const before = JSON.parse(JSON.stringify(after));
  before.rules.hitsPerBlock = 3;
  before.rules.squaresPerFirstClaim = 1;
  before.economy.marketFee = 0.1;
  before.tiers.clickPower.tierWh = 5;
  before.skinRarity.Rare = 2;
  before.items.pop();
  const lines = economy.describeChanges(before, after);
  for (const l of ['hitsPerBlock: 3 → 10', 'marketFee: 0.1 → 0.05', 'squaresPerFirstClaim: retired (no longer used)', 'Click Power: tierWh 5 → 12',
    'Rare skins: 2 → 1 work-hours', 'Items: 3 in all; 1 added, 0 removed, 0 changed']) assert.ok(lines.includes(l), `${l}\n${lines.join('\n')}`);
  assert.deepEqual(economy.describeChanges(after, after), ['No changes.']);
});

test('npm run sync-rules: writes the file from a saved copy, keeps parts the sheet lacks, and refuses to write when a check fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')), out = path.join(tmp, 'economy.json');
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sync-rules.js'), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const report = run('--from', DIR, '--out', out);
  assert.match(report, /defaultBaseBlocks: set to 431,649/);
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(file.economy.stepsPerTier, undefined, 'retired');
  assert.equal(file.tiers.clickPower.steps, 90);
  assert.match(run('--from', DIR, '--out', out), /No changes\./);

  // A sheet without the Glossary tab keeps the file's glossary.
  const partial = path.join(tmp, 'partial');
  fs.mkdirSync(partial);
  for (const t of economy.TABS) if (t !== 'Glossary') fs.copyFileSync(path.join(DIR, t + '.csv'), path.join(partial, t + '.csv'));
  run('--from', partial, '--out', out);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).glossary, file.glossary);

  const bad = path.join(tmp, 'bad');
  fs.mkdirSync(bad);
  for (const t of economy.TABS) fs.copyFileSync(path.join(DIR, t + '.csv'), path.join(bad, t + '.csv'));
  fs.writeFileSync(path.join(bad, 'Economy.csv'), setCell(fs.readFileSync(path.join(DIR, 'Economy.csv'), 'utf8'), 1, 1, 'fast'));
  const before = fs.readFileSync(out, 'utf8');
  assert.throws(() => run('--from', bad, '--out', out), e => /1 problem; nothing was written/.test(e.stderr) && /cell B2/.test(e.stderr));
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'the file was not touched');
});

test('Game Rules keys: unknown, missing, twice, out of range and not whole are refused', () => {
  const rules = saved()['Game Rules'];
  const row = k => economy.parseCsv(rules).findIndex(r => r[0] === k);
  const check = (csv, expected) => {
    const tabs = saved();
    tabs['Game Rules'] = csv;
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  };
  check(setCell(rules, row('hitsPerBlock'), 0, 'hitsPerBlok'), 'Game Rules, cell A2 ("Key"): unknown key "hitsPerBlok"');
  check(setCell(rules, row('hitsPerBlock'), 0, 'hitsPerBlok'), 'Game Rules: no row for "hitsPerBlock"');
  check(setCell(rules, row('guestsPerIp'), 0, 'crackFadeHits'), `Game Rules, cell A${row('guestsPerIp') + 1} ("Key"): "crackFadeHits" appears twice`);
  check(setCell(rules, row('nameMaxLength'), 1, '20'), `Game Rules, cell B${row('nameMaxLength') + 1} ("Value"): nameMaxLength must be between 1 and 15, not 20`);
  check(setCell(rules, row('hitsPerBlock'), 1, '10.5'), 'Game Rules, cell B2 ("Value"): hitsPerBlock must be a whole number, not 10.5');
  check(setCell(rules, row('crackFadeSeconds'), 1, ''), 'Game Rules, cell B3 ("Value"): blank (crackFadeSeconds)');
  check(setCell(rules, row('crackFadeSeconds'), 2, ''), 'Game Rules, cell C3 ("What it means"): blank');
});

test('the Achievements tab: bad rows are named by cell; a missing tab is refused', () => {
  const tabs = saved();
  const lines = tabs['Achievements'].split('\n');
  lines[1] = lines[2].replace(/^claims-5,/, 'claims-5,');                // a duplicate key
  lines[3] = 'Bad Key,Name,Claiming,claims,1,,Desc,5';
  lines[4] = 'ok-key,Name,Claiming,flying,1,,Desc,5';
  lines[5] = 'ok-key-2,Name,Claiming,claims,0,maybe,,-1';
  tabs['Achievements'] = lines.join('\n');
  const errors = errorsWith(tabs);
  assert.ok(errors.some(e => /Achievements, cell A\d+ \("Key"\): "claims-5" appears twice/.test(e)), errors.join('\n'));
  assert.ok(errors.some(e => /"Bad Key" must be lower-case/.test(e)));
  assert.ok(errors.some(e => /unknown stat "flying"/.test(e)));
  assert.ok(errors.some(e => /"0" must be a number above 0/.test(e)));
  assert.ok(errors.some(e => /"maybe" must be yes, no or blank/.test(e)));
  assert.ok(errors.some(e => /\("Description"\): blank/.test(e)));
  assert.ok(errors.some(e => /"-1" must be a number of squares/.test(e)));
  const missing = saved();
  delete missing['Achievements'];
  assert.deepEqual(errorsWith(missing), ['Achievements: the tab is missing']);
});

test('the Upgrades tab\'s Variable column (loop 19): any upgrade is a row; one variable each; unknown variables are warned, not refused', () => {
  const rows = economy.parseCsv(saved().Upgrades);
  const withVar = vars => rows.map((r, i) => [...r, i === 0 ? 'Variable' : vars[i - 1]].map(c => JSON.stringify(c)).join(',')).join('\n');
  const run = vars => { const tabs = saved(); tabs.Upgrades = withVar(vars); return economy.validate(tabs); };
  const Q39 = ['clickPower', 'earnings', 'defense', 'growth', 'factories.speed', 'factories.lifetime', 'factories.yield'];
  const ok = run(Q39);
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some(w => w.includes('Variable')), 'no warning once the column is there');
  assert.equal(ok.economy.tiers.factorySpeed.variable, 'factories.speed');
  const twice = run(['clickPower', 'clickPower', ...Q39.slice(2)]);
  assert.ok(twice.errors.includes(`Upgrades, cell N3 ("Variable"): "clickPower" is already changed by clickPower`), twice.errors.join(' | '));
  const unknown = run([...Q39.slice(0, 6), 'robots.speed']);
  assert.deepEqual(unknown.errors, []);
  assert.ok(unknown.warnings.includes('Upgrades: "factoryYield" changes "robots.speed", which no installed plug-in has; it won\'t show until one does'));
});
