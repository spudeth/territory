// The items plug-in's sheet tab (loop 19; the checks are loop 16's): bad rows are named by cell. In memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const economy = require('../../../server/economy');
const data = require('../data');

const saved = fs.readFileSync(path.join(__dirname, 'Items.csv'), 'utf8');
const run = csv => { const errors = []; const out = data.validate({ Items: csv }, economy.sheetKit({ Items: csv }, errors), errors); return { out, errors }; };
function setCell(csv, row, col, value) {
  const rows = economy.parseCsv(csv);
  rows[row][col] = value;
  return rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

test('the saved Items tab reads as the game uses it, and matches data.json', () => {
  const { out, errors } = run(saved);
  assert.deepEqual(errors, []);
  assert.deepEqual(out.items.map(i => [i.id, i.pricing, i.consumable]), [['superClick', 'PV', false], ['terraformer', 'PV', false], ['demolition', 'Hours', true]]);
  assert.deepEqual(out, require('../data.json'));
  assert.equal(data.validate({}, economy.sheetKit({}, []), []), null, 'no tab: nothing (the sync keeps data.json)');
});

test('bad rows are named by cell', () => {
  const check = (csv, expected) => assert.ok(run(csv).errors.includes(expected), `${expected}\n  got: ${run(csv).errors.join(' | ')}`);
  check(setCell(saved, 1, 3, 'explode'), `Items, cell D2 ("Effect"): unknown effect "explode" (one of: ${data.EFFECTS.join(', ')})`);
  check(setCell(saved, 1, 9, 'Free'), 'Items, cell J2 ("Pricing"): "Free" must be PV or Hours');
  check(setCell(saved, 1, 10, ''), 'Items, cell K2 ("V (work-hours/hour)"): PV pricing needs V and P');
  check(setCell(saved, 3, 12, ''), 'Items, cell M4 ("Hours"): Hours pricing needs Hours');
  check(setCell(saved, 1, 6, ''), 'Items, cell G2 ("Uses"): a reusable item needs Uses and Per (minutes)');
  check(setCell(saved, 1, 8, 'maybe'), 'Items, cell I2 ("Consumable"): "maybe" must be yes or no');
  check(setCell(saved, 2, 0, 'superClick'), 'Items, cell A3 ("Key"): "superClick" appears twice');
});
