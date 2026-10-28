// The chat filter (in memory, no database).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../chat');

test('bad words become ***, disguised or not', () => {
  for (const [said, shown] of [
    ['what the fuck', 'what the ***'], ['FUCKING hell', '*** hell'], ['sh1t move', '*** move'], ['fuuuuck', '***'],
    ['f.u.c.k off', '*** off'], ['f u c k you', '*** you'], ['you $lut', 'you ***'], ['b!tch', '***'],
  ]) assert.equal(chat.cleanMessage(said), shown, said);
});

test('ordinary words with a bad word inside are left alone', () => {
  for (const ok of ['Scunthorpe', 'cucumber', 'raccoon', 'cockpit', 'grape', 'class assessment', 'a b c', 'I own 100 blocks', 'Dickens', 'shiitake'])
    assert.equal(chat.cleanMessage(ok), ok, ok);
});

test('messages are tidied: spaces, invisible characters, length; empty is nothing', () => {
  assert.equal(chat.cleanMessage('  hi \n\n  there  '), 'hi there');
  assert.equal(chat.cleanMessage('hi​there‮'), 'hithere');
  assert.equal(chat.cleanMessage('x'.repeat(500)).length, chat.MAX_LENGTH);
  for (const empty of ['', '   ', '​', null, 42, { text: 'hi' }]) assert.equal(chat.cleanMessage(empty), null);
});
