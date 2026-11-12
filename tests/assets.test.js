// Loop 19 Phase 8: files are gzipped; code is fingerprinted and kept for a year; the page is always checked;
// images and sounds are kept for an hour. In memory (no database: the game is never asked for a map).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../server/app');
const { YEAR, HOUR, CHECK } = require('../server/assets');

let game, url;
before(async () => {
  game = createGame({ query: async () => { throw new Error('no database in this test'); } }, { achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(() => { game.io.close(); });

test('the page names its code by fingerprint; code by fingerprint is kept a year, gzipped; the page and old addresses are checked; images an hour', async () => {
  const page = await fetch(url + '/', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(page.headers.get('cache-control'), CHECK);
  assert.equal(page.headers.get('content-encoding'), 'gzip');
  const html = await page.text();
  const game = /<script src="(game\.js\?v=[0-9a-f]{10})"><\/script>/.exec(html), css = /href="(art\/styles\/style\.css\?v=[0-9a-f]{10})"/.exec(html);
  assert.ok(game && css, 'game.js and style.css by fingerprint');
  const js = await fetch(url + '/' + game[1], { headers: { 'accept-encoding': 'gzip' } });
  assert.deepEqual([js.status, js.headers.get('cache-control'), js.headers.get('content-encoding')], [200, YEAR, 'gzip']);
  assert.equal((await fetch(url + '/game.js?v=0000000000')).headers.get('cache-control'), CHECK, 'a wrong fingerprint is only checked');
  assert.equal((await fetch(url + '/game.js')).headers.get('cache-control'), CHECK, 'no fingerprint: checked');
  assert.equal((await fetch(url + '/art/tiles/terrain-forest.png')).headers.get('cache-control'), HOUR);
  assert.equal((await fetch(url + '/art/skins/stripes.png')).headers.get('cache-control'), HOUR, 'plug-in art too');
  assert.equal((await fetch(url + '/privacy')).headers.get('cache-control'), CHECK);
});
