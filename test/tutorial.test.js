// The tutorial data and the sound placement rules, in memory: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TRIGGERS, STEPS, TIPS } = require('../public/tutorial');
const { placement, isTap, PICKS } = require('../public/audio');
const { SOUNDS } = require('../public/sfx');

test('every tutorial step and tip is complete and uses known triggers and highlights', () => {
  const ids = new Set();
  for (const s of STEPS) {
    assert.match(s.id, /^[a-z][a-z-]*$/, s.id);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title && s.text, s.id);
    assert.ok(s.text.length <= 140, `${s.id} is short and plain`);
    assert.ok(TRIGGERS.includes(s.done), `${s.id} done: ${s.done}`);
    if (s.start) assert.ok(TRIGGERS.includes(s.start), `${s.id} start: ${s.start}`);
    if (s.highlight) {
      const keys = Object.keys(s.highlight);
      assert.equal(keys.length, 1, s.id);
      if (keys[0] === 'blocks') assert.ok(['grown', 'lit', 'others', 'mine'].includes(s.highlight.blocks), s.id);
      else assert.equal(typeof s.highlight.element, 'string', s.id);
    }
  }
  const tipIds = new Set(TIPS.map(t => t.id));
  assert.equal(tipIds.size, TIPS.length, 'tip ids are unique');
  for (const t of TIPS) assert.ok(TRIGGERS.includes(t.on) && t.title && t.text.length <= 140, t.id);
  assert.deepEqual(TIPS.map(t => t.on).sort(), ['achievement', 'denied:range', 'squares', 'taken']);
});

test("other players' sounds: loudest in the middle, panned by side, silent far away", () => {
  const mid = placement(500, 400, 1000, 800);
  assert.equal(mid.pan, 0);
  assert.ok(mid.gain > 0.5 && mid.gain < 1, 'quieter than your own (1)');
  const left = placement(100, 400, 1000, 800), right = placement(900, 400, 1000, 800);
  assert.ok(left.pan < 0 && right.pan > 0);
  assert.ok(left.gain < mid.gain, 'quieter with distance');
  assert.equal(placement(-2000, 400, 1000, 800), null, 'too far to hear');
  assert.ok(placement(-50, 400, 1000, 800), 'just off screen is still heard');
});

test('a tap is progress going up; fading cracks are silent', () => {
  assert.equal(isTap(undefined, 0.1), true);
  assert.equal(isTap(0.3, 0.4), true);
  assert.equal(isTap(0.4, 0.3), false);
  assert.equal(isTap(0.1, 0), false);
});

test('every picked sound exists', () => {
  for (const [event, option] of Object.entries(PICKS)) assert.ok(SOUNDS[event]?.[option], `${event} ${option}`);
});
