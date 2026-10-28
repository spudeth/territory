// The achievement engine's pure parts, in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const achievements = require('../achievements');

test('the placeholder list is valid', () => {
  assert.ok(achievements.index(achievements.DEFINITIONS).size > 0);
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
