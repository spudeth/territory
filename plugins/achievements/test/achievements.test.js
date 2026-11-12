// The achievement engine's pure parts, in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const achievements = require('../rules');

test('the list from the sheet: exactly 300, about 10 secret, every one paying something', () => {
  const list = require('../data.json').achievements;
  assert.equal(list.length, 300);
  assert.ok(achievements.index(list).size > 30);
  const secrets = list.filter(d => d.secret);
  assert.ok(secrets.length >= 8 && secrets.length <= 12, `${secrets.length} secrets`);
  for (const d of list) assert.ok(d.reward > 0, `${d.id} pays ${d.reward}`);
  // Claiming pays half the squares mined since the tier before (Xoren): First Block 0.5, then 4.5 for blocks 2-10.
  assert.deepEqual(['first-block', 'claims-5'].map(id => list.find(d => d.id === id).reward), [0.5, 4.5]);
  // Top tiers (about 1,000 hours) pay about 2,000 squares (2 an hour).
  for (const id of ['claims-100k', 'owned-10k', 'square-50', 'line-150', 'taken-25k', 'taps-2m', 'hours-1000']) {
    assert.ok(list.find(d => d.id === id).reward >= 1500, id);
  }
  // The ids the placeholder list used are kept, so achievements earned before still count.
  for (const id of ['first-block', 'owned-100', 'owned-1000', 'square-10', 'square-50', 'line-10', 'line-100', 'retakes-10']) {
    assert.ok(list.some(d => d.id === id), id);
  }
});

test('rank counts down: #3 meets "top 5" but not "#1"', () => {
  assert.equal(achievements.meets('bestRank', 3, 5), true);
  assert.equal(achievements.meets('bestRank', 3, 1), false);
  assert.equal(achievements.meets('bestRank', 0, 10), false, 'unranked');
  assert.equal(achievements.meets('claims', 9.9999999999, 10), true, 'rounding');
});

test('reaching a threshold earns each achievement once, lowest and highest alike', () => {
  const byStat = achievements.index([
    { id: 'a', name: 'A', stat: 'owned', threshold: 10 },
    { id: 'b', name: 'B', stat: 'owned', threshold: 100 },
    { id: 'c', name: 'C', stat: 'bestLine', threshold: 5 },
  ]);
  const ids = (stat, v, have = []) => achievements.reached(byStat, stat, v, new Set(have)).map(d => d.id);
  assert.deepEqual(ids('owned', 9), []);
  assert.deepEqual(ids('owned', 10), ['a']);
  assert.deepEqual(ids('owned', 150), ['a', 'b'], 'jumping past two thresholds earns both');
  assert.deepEqual(ids('owned', 150, ['a']), ['b']);
  assert.deepEqual(ids('retakes', 999), [], 'a stat with no achievements');
});

test('bad definitions are refused', () => {
  assert.throws(() => achievements.index([{ id: 'x', name: 'X', stat: 'owned', threshold: 1 }, { id: 'x', name: 'Y', stat: 'owned', threshold: 2 }]), /duplicate/);
  assert.throws(() => achievements.index([{ id: 'x', name: 'X', stat: 'owned', threshold: 0 }]), /bad achievement/);
});

test('the Achievements tab is data.json; bad rows are named by cell; without the tab data.json stays', () => {
  const fs = require('fs'), path = require('path'), economy = require('../../../server/economy'), data = require('../data');
  const read = tabs => { const errors = [], out = data.validate(tabs, economy.sheetKit(tabs, errors), errors); return { errors, out }; };
  const csv = fs.readFileSync(path.join(__dirname, 'Achievements.csv'), 'utf8');
  const ok = read({ Achievements: csv });
  assert.deepEqual(ok, { errors: [], out: require('../data.json') }, 'the saved tab is data.json');
  assert.equal(ok.out.achievements.length, 300);
  assert.deepEqual(ok.out.achievements[0], { id: 'first-block', name: 'First Block', category: 'Claiming', stat: 'claims', threshold: 1, secret: false, description: 'Claim 1 empty block', reward: 0.5 });
  const lines = csv.split(/\r?\n/);
  lines[1] = lines[2].replace(/^claims-5,/, 'claims-5,');                // a duplicate key
  lines[3] = 'Bad Key,Name,Claiming,claims,1,,Desc,5';
  lines[4] = 'ok-key,Name,Claiming,flying,1,,Desc,5';
  lines[5] = 'ok-key-2,Name,Claiming,claims,0,maybe,,-1';
  const { errors } = read({ Achievements: lines.join('\n') });
  assert.ok(errors.some(e => /Achievements, cell A\d+ \("Key"\): "claims-5" appears twice/.test(e)), errors.join('\n'));
  for (const re of [/"Bad Key" must be lower-case/, /unknown stat "flying"/, /"0" must be a number above 0/, /"maybe" must be yes, no or blank/,
    /\("Description"\): blank/, /"-1" must be a number of squares/]) assert.ok(errors.some(e => re.test(e)), String(re));
  assert.equal(read({}).out, null, 'no tab: data.json stays as it is');
});

test('the guide lists every achievement, secrets as "???"', () => {
  const { renderGuide } = require('../../../server/guide');
  const D = require('../data.json');
  let section = null;
  require('../server')({ options: {}, plugin: { data: D }, catalog: require('../../../server/catalog'), rules: require('../../../server/rules'),
    on: (hook, fn) => { if (hook === 'guide') section = fn; }, socket() {} });
  const html = renderGuide({ pluginSections: helpers => [section(helpers)] });
  assert.ok(html.includes('href="#achievements">Achievements</a>') && html.includes(D.achievements.find(a => !a.secret).name));
  const secret = D.achievements.find(a => a.secret);
  if (secret) assert.ok(!html.includes(secret.description.replace(/&/g, '&amp;')), 'secrets stay hidden');
});
