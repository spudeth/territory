// Loop 19: the plug-in host. A fixture plug-in (test/fixtures/plugins/hello) and a game with no plug-ins at all.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createGame } = require('../server/app');
const pluginHost = require('../server/plugins');
const upgrades = require('../server/upgrades');
const variables = require('../server/variables');
const { testDb, connectPlayer } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'plugins');
let db, withHello, bare;
const sockets = [];
const listen = async game => { await new Promise(r => game.server.listen(0, r)); return `http://localhost:${game.server.address().port}`; };
before(async () => {
  db = await testDb();
  withHello = createGame(db.pool, { pluginDir: FIXTURES });
  withHello.url = await listen(withHello);
  bare = createGame(db.pool, { plugins: [] });
  bare.url = await listen(bare);
});
after(async () => { for (const s of sockets) s.disconnect(); withHello.io.close(); bare.io.close(); await db.drop(); });
const player = (url, auth) => { const s = connectPlayer(url, auth); sockets.push(s); return s; };

test('the host reads each plugin.json, with defaults, in order', () => {
  const [hello] = pluginHost.list({ dir: FIXTURES });
  assert.deepEqual([hello.name, hello.order, hello.tabs, hello.client, hello.variables], ['hello', 50, [], ['client.js'], { 'hello.size': 3 }]);
  assert.deepEqual(pluginHost.list({ dir: FIXTURES, names: [] }), [], 'none asked for');
  assert.deepEqual(pluginHost.list({ dir: path.join(FIXTURES, 'nowhere') }), [], 'no folder: no plug-ins');
  assert.deepEqual(pluginHost.clientList([hello]), [{ name: 'hello', files: ['/plugins/hello/client.js'] }]);
  // Hooks: in order; first and collect skip empty answers; collectBy names the owner.
  const h = pluginHost.createHooks();
  h.on('x', () => null, 'a');
  h.on('x', n => n + 1, 'b');
  h.on('x', n => n * 10, 'c');
  assert.deepEqual([h.first('x', 2), h.collect('x', 2), h.collectBy('x', 2), h.has('x'), h.has('y')], [3, [3, 20], [['b', 3], ['c', 20]], true, false]);
});

test('variables: the core\'s four, plus each plug-in\'s; an upgrade shows only when its variable exists', () => {
  const [hello] = pluginHost.list({ dir: FIXTURES });
  assert.deepEqual(Object.entries(variables.CORE), [['clickPower', 1], ['earnings', 1], ['defense', 1], ['growth', 1]]);
  assert.equal(variables.declared([hello])['hello.size'], 3);
  assert.deepEqual(upgrades.available({ clickPower: 1, growth: 1 }), ['clickPower', 'growth'], 'no factory variables, no factory upgrades');
  assert.equal(upgrades.value(null, 'factories.speed'), 0.05, 'nobody\'s steps: the base');
  assert.equal(upgrades.value(upgrades.effectiveValues({ clickPower: 90 }, 1), 'clickPower'), 10, 'a variable after its upgrade\'s steps');
});

test('a plug-in gets its part of the welcome, its own socket events and its data; only its browser files are served', async () => {
  const s = player(withHello.url);
  const w = await s.welcome;
  assert.deepEqual(w.plugins.map(p => p.name), ['hello']);
  assert.match(w.plugins[0].files[0], /^\/plugins\/hello\/client\.js\?v=[0-9a-f]{10}$/, 'by its fingerprint (loop 19)');
  assert.deepEqual(w.pluginData.hello, { greeting: 'hello from hello', mapId: w.map.id, pid: null, size: 3, data: {} });
  assert.deepEqual(await s.ask('hello:ping', 41), { pong: 42, pid: null });
  assert.equal((await fetch(withHello.url + '/plugins/hello/client.js')).status, 200);
  assert.equal((await fetch(withHello.url + '/plugins/hello/server.js')).status, 404, 'server code is never served');
  assert.equal((await fetch(withHello.url + '/plugins/hello/plugin.json')).status, 404);
  assert.deepEqual(withHello.plugins, ['hello']);
});

test('no plug-ins at all: plain tap-to-claim works, and the welcome lists none', async () => {
  const s = player(bare.url);
  const w = await s.welcome;
  assert.deepEqual([w.plugins, w.pluginData], [[], {}]);
  const empty = w.cells.find(([, , o]) => o === null);
  s.take(empty[0], empty[1]);
  const { pid } = await s.next('you');
  const claimed = await s.next('claim', d => d.x === empty[0] && d.y === empty[1]);
  assert.equal(claimed.pid, pid);
  assert.deepEqual(bare.plugins, []);
});

test('the browser host loads a fingerprinted stylesheet as a stylesheet and scripts in order (loop 19)', () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const added = [];
  const el = tag => ({ tag });
  const document = { createElement: el, head: { append: e => added.push(['head', e]) }, body: { append: e => added.push(['body', e]) } };
  const ctx = vm.createContext({ document, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'client', 'plugins.js'), 'utf8') + '\nthis.Plugins = Plugins;', ctx);
  ctx.Plugins.load([{ name: 'items', files: ['/plugins/items/text.js?v=1a2b', '/plugins/items/style.css?v=3c4d', '/plugins/items/client.js?v=5e6f'] }]);
  assert.deepEqual(added.map(([where, e]) => [where, e.tag, e.href ?? e.src]), [
    ['body', 'script', '/plugins/items/text.js?v=1a2b'], ['head', 'link', '/plugins/items/style.css?v=3c4d'], ['body', 'script', '/plugins/items/client.js?v=5e6f']]);
});
