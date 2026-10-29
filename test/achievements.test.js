// The achievement engine's pure parts, in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const achievements = require('../achievements');

test('the list from the sheet: exactly 300, about 10 secret, every one with a reward of at least 1 square', () => {
  const list = achievements.DEFINITIONS;
  assert.equal(list.length, 300);
  assert.ok(achievements.index(list).size > 30);
  const secrets = list.filter(d => d.secret);
  assert.ok(secrets.length >= 8 && secrets.length <= 12, `${secrets.length} secrets`);
  for (const d of list) assert.ok(d.reward >= 1, `${d.id} pays ${d.reward}`);
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
