const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkName, accountNames, guestNames } = require('../names');
const { isProfane } = require('../profanity');

test('the filter catches swear words through misspellings, letter swaps, stretching and spacing', () => {
  for (const name of ['fuck', 'FUCK', 'fuk you', 'phuck', 'f u c k', 'f.u.c.k', 'fuuuuck',
    'sh1t', '$hit', 'sh!t', 'xXshitXx', 'b1tch', 'biatch', 'c u n t', 'a$$', 'A.S.S', 'a55', 'a s s',
    'Big Dick', 'd1ck', 'n1gger', 'niggaaa', 'f4ggot', 'Hitl3r', 'kkk', 'wh0re', 's1ut', 'p0rn', 'ret4rd', 'fck']) {
    assert.ok(isProfane(name), `"${name}" should be blocked`);
  }
});

test('the filter allows ordinary names, including ones that contain a blocked word inside another word', () => {
  for (const name of ['Bob', 'Classic', 'Assassin', 'Peacock', 'Hancock', 'Dickens', 'Grape', 'Analyst', 'Sussex',
    'Nigeria', 'Cocktail', 'Titan', 'Hello', 'Shoe', 'Pass the Ball', 'Sly As Fox', 'Scrap Metal', 'Kitty']) {
    assert.equal(isProfane(name), false, `"${name}" should be allowed`);
  }
});

test('no generated guest or account name is ever blocked or too long', () => {
  for (let i = 0; i < 2000; i++) {
    for (const name of [...guestNames('Sly Wolf'), ...accountNames()]) {
      assert.ok(name.length <= 15, name);
      assert.equal(isProfane(name), false, name);
    }
  }
  assert.match(accountNames().next().value, /^NewUser\d{4}$/);
});

test('name rules: 1-15 characters, plain letters and numbers, tidied spaces, nothing reserved or rude', () => {
  assert.deepEqual(checkName('  Sly   Wolf  '), { name: 'Sly Wolf' });
  assert.deepEqual(checkName('Ab_c-1.2'), { name: 'Ab_c-1.2' });
  assert.deepEqual(checkName('x'.repeat(15)), { name: 'x'.repeat(15) });
  const errors = {
    '': 'Type a name', '   ': 'Type a name',
    [`${'x'.repeat(16)}`]: 'Names can be at most 15 characters',
    'Zoë': 'Use letters, numbers, spaces, - _ and . only, starting with a letter or number',
    '-dash': 'Use letters, numbers, spaces, - _ and . only, starting with a letter or number',
    '<b>hi</b>': 'Use letters, numbers, spaces, - _ and . only, starting with a letter or number',
    'Admin': 'That name is reserved', 'NewUser1234': 'That name is reserved', 'New User 7': 'That name is reserved',
    'Sh1t Head': "That name isn't allowed",
  };
  for (const [raw, error] of Object.entries(errors)) assert.deepEqual(checkName(raw), { error }, JSON.stringify(raw));
  for (const raw of [null, undefined, 42, {}, ['a']]) assert.ok(checkName(raw).error || checkName(raw).name, String(raw));
});
