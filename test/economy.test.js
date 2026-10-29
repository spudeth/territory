// The sheet sync: checks, change reports and level remapping, using a saved copy of the sheet (no internet).
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

test('the saved sheet passes and reads every level and rule as shown', () => {
  const { economy: e, errors } = economy.validate(saved());
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.fromEntries(Object.entries(e.upgrades).map(([k, v]) => [k, v.length - 1])),
    { clickPower: 70, defense: 50, earnings: 100, growth: 5 });
  assert.deepEqual(e.upgrades.clickPower[0], { level: 0, value: 1, cost: 0 }, 'level 0 is no upgrade');
  assert.deepEqual(e.upgrades.clickPower[1], { level: 1, value: 1.13, cost: 22 });
  assert.deepEqual(e.upgrades.clickPower[70], { level: 70, value: 10, cost: 15590 }, '"15,590" read as 15590');
  assert.deepEqual(e.upgrades.growth.map(l => l.value), [1, 2, 3, 4, 5, 6]);
  assert.equal(e.rules.hitsPerBlock, 10);
  assert.equal(e.achievements.length, 300);
  assert.deepEqual(e.achievements[0], { id: 'first-block', name: 'First Block', category: 'Claiming', stat: 'claims', threshold: 1, secret: false, description: 'Claim 1 empty block', reward: 0.5 });
  assert.equal(Object.keys(e.rules).length, Object.keys(economy.RULE_KEYS).length);
});

test('a missing tab, or the first tab returned in its place, is refused by name', () => {
  const tabs = saved();
  delete tabs['Game Rules'];
  assert.deepEqual(errorsWith(tabs), ['Game Rules: the tab is missing']);
  const fallback = saved();
  fallback['Game Rules'] = '"Territory upgrade economy: edit the yellow cells","",""\n"Hits to take a plain block","10","Game rule"';
  assert.match(errorsWith(fallback)[0], /^Game Rules: no column "Key", "Value", "What it means" in row 1/);
});

test('blank cells, words and wrong order are refused with the exact cell', () => {
  const cases = [
    ['Click Power', 3, 2, '', 'Click Power, cell C4 ("Cost (squares)"): blank'],
    ['Defense', 2, 1, 'lots', 'Defense, cell B3 ("Value after"): "lots" is not a number'],
    ['Earnings', 5, 2, '1', 'Earnings, cell C6 ("Cost (squares)"): 1 must be more than the level before (12)'],
    ['Click Power', 4, 1, '1.2', 'Click Power, cell B5 ("Value after"): 1.2 must be more than the level before (1.39)'],
    ['Defense', 4, 0, '7', 'Defense, cell A5 ("Level"): expected level 4, found 7'],
    ['Growth', 2, 1, '3.5', 'Growth, cell B3 ("Value after"): 3.5 must be a whole number of blocks'],
  ];
  for (const [tab, row, col, value, expected] of cases) {
    const tabs = saved();
    tabs[tab] = setCell(tabs[tab], row, col, value);
    assert.ok(errorsWith(tabs).includes(expected), `${expected}\n  got: ${errorsWith(tabs).join(' | ')}`);
  }
});

test('the real Growth tab (fractions, see Q9) is refused cell by cell', () => {
  const tabs = saved();
  tabs.Growth = fs.readFileSync(path.join(__dirname, 'fixtures', 'growth-as-in-sheet.csv'), 'utf8');
  assert.deepEqual(errorsWith(tabs), ['B2', 'B3', 'B4', 'B5'].map((c, i) =>
    `Growth, cell ${c} ("Value after"): ${[1.8, 2.6, 3.4, 4.2][i]} must be a whole number of blocks`));
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

test('numbers: plain, with thousands commas, negative and decimal; anything else is not a number', () => {
  for (const [s, n] of [['10', 10], ['1,161', 1161], ['116,172', 116172], ['-2.5', -2.5], ['0.25', 0.25], [' 7 ', 7]]) assert.equal(economy.parseNumber(s), n, s);
  for (const s of ['', 'ten', '1,16', '10%', '1.2.3', '$5', '1e3']) assert.equal(economy.parseNumber(s), null, s);
  assert.deepEqual(economy.parseCsv('"a, b","say ""hi"""\n"x\ny",2'), [['a, b', 'say "hi"'], ['x\ny', '2']]);
});

test('option B: a stored level becomes the lowest new level at least as strong, so nobody gets weaker', () => {
  const lv = values => [{ level: 0, value: 1, cost: 0 }, ...values.map((value, i) => ({ level: i + 1, value, cost: i + 1 }))];
  const old = lv([1.5, 2, 3]), fine = lv([1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3.5]);
  assert.equal(economy.remapLevel(old, fine, 0), 0, 'no upgrade stays no upgrade');
  assert.equal(economy.remapLevel(old, fine, 1), 3, '1.5 -> the first level of at least 1.5 (1.6)');
  assert.equal(economy.remapLevel(old, fine, 2), 5, 'exactly equal counts (2)');
  assert.equal(economy.remapLevel(old, fine, 3), 7, '3 -> 3');
  assert.equal(economy.remapLevel(old, lv([2, 2.5]), 3), 2, 'nothing as strong: the top level');
  assert.equal(economy.remapLevel(old, fine, 99), 7, 'a level past the old table counts as its top');
  assert.deepEqual(economy.remapTable({ clickPower: old }, { clickPower: fine }).clickPower, [[1, 3], [2, 5], [3, 7]]);
  // Every old level maps to something at least as strong, over the real tables and a shuffled copy.
  const real = economy.validate(saved()).economy.upgrades;
  const coarse = [real.clickPower[0], ...real.clickPower.filter(l => l.level % 7 === 0 && l.level)].map((l, i) => ({ ...l, level: i }));
  for (const [a, b] of [[real.clickPower, coarse], [coarse, real.clickPower]]) {
    for (const l of a) {
      const to = b[economy.remapLevel(a, b, l.level)];
      assert.ok(to.value >= l.value - 1e-9 || to.level === b.length - 1, `level ${l.level} (${l.value}) -> ${to.level} (${to.value})`);
    }
  }
});

test('the change report says what changed in plain English', () => {
  const after = economy.validate(saved()).economy;
  const before = JSON.parse(JSON.stringify(after));
  before.upgrades.clickPower = before.upgrades.clickPower.slice(0, 51);
  before.upgrades.clickPower[1].cost = 119;
  before.rules.hitsPerBlock = 3;
  const lines = economy.describeChanges(before, after);
  assert.ok(lines.includes('hitsPerBlock: 3 → 10'), lines.join('\n'));
  assert.ok(lines.includes('Click Power: 50 → 70 levels; level 1 cost 119 → 22; top value 7.43 → 10; 1 existing level changed'), lines.join('\n'));
  assert.deepEqual(economy.describeChanges(after, after), ['No changes.']);
});

test('npm run sync-rules: writes the file from a saved copy, and refuses to write when a check fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')), out = path.join(tmp, 'economy.json');
  const run = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sync-rules.js'), ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const report = run('--from', DIR, '--out', out);
  assert.match(report, /Click Power: 0 → 70 levels/);
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(file.upgrades.growth.length, 6);
  assert.match(run('--from', DIR, '--out', out), /No changes\./);

  const bad = path.join(tmp, 'bad');
  fs.mkdirSync(bad);
  for (const t of economy.TABS) fs.copyFileSync(path.join(DIR, t + '.csv'), path.join(bad, t + '.csv'));
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'growth-as-in-sheet.csv'), path.join(bad, 'Growth.csv'));
  const before = fs.readFileSync(out, 'utf8');
  assert.throws(() => run('--from', bad, '--out', out), e => /4 problems; nothing was written/.test(e.stderr) && /cell B2/.test(e.stderr));
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'the file was not touched');
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
