// Loop 19 Phase 8: the welcome's packed blocks (public/blocks.js) give back exactly the map's blocks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const blockPack = require('../public/blocks');

test('pack and unpack: every block, its owner (or empty) and its level above 1, on an odd shape with gaps', () => {
  const cells = new Map(), birth = new Map();
  const owners = ['7', '12', null];
  for (let y = -3; y < 20; y++) for (let x = -5; x < 30; x++) {
    if ((x * 7 + y * 13) % 5 === 0) continue;                 // gaps: no block there
    cells.set(x + ',' + y, owners[(x + y + 99) % 3]);
    if ((x + y) % 11 === 0) birth.set(x + ',' + y, 2 + ((x + 50) % 3));
  }
  birth.set('1000,1000', 3);                                  // a level for a block that isn't there is left out
  const p = blockPack.pack(cells, birth);
  const back = blockPack.unpack(JSON.parse(JSON.stringify(p)));
  assert.equal(back.length, cells.size);
  for (const [x, y, o, L] of back) {
    assert.equal(o, cells.get(x + ',' + y), `${x},${y}`);
    assert.equal(L ?? 1, birth.get(x + ',' + y) ?? 1, `${x},${y} level`);
  }
  assert.ok(JSON.stringify(p).length < JSON.stringify(back).length / 2, 'smaller than the old list');
  assert.deepEqual(blockPack.unpack(blockPack.pack(new Map(), new Map())), [], 'no blocks');
});
