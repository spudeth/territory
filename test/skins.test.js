// Skins: the catalog from the sheet, how they're drawn, and buying them (the dev database, a throwaway schema).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createGame } = require('../app');
const economy = require('../economy');
const rules = require('../rules');
const store = require('../store');
const skins = require('../public/skins');
const { testDb, connectPlayer } = require('./helpers');

// ---------- In memory ----------
test('the catalog: 6 patterns and the flags of every UN member plus regions, each with both images', () => {
  const patterns = rules.SKINS.filter(s => s.collection === 'Patterns'), flags = rules.SKINS.filter(s => s.collection === 'Flags');
  assert.equal(patterns.length, 6);
  assert.ok(patterns.every(s => s.kind === 'pattern' && s.rarity === 'Common' && s.price >= 100 && s.price <= 300));
  assert.ok(flags.length >= 199, `${flags.length} flags`);
  assert.ok(flags.every(s => s.kind === 'art' && s.rarity === 'Rare'), 'flags are art, rare');
  assert.equal(new Set(flags.map(s => s.price)).size, 1, 'one price for all flags');
  for (const s of rules.SKINS) for (const f of economy.skinFiles(s.id)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', f)), f);
});

test('art skins get the thicker border in the owner color; Full area images cover without stretching', () => {
  assert.equal(skins.borderTexels('art'), 2);
  assert.equal(skins.borderTexels('pattern'), 1);
  assert.equal(skins.borderTexels('default'), 1);
  const f = skins.coverFit(96, 64, 300, 100);   // a 3:2 flag over a wide territory
  assert.equal(f.dw / f.dh, 96 / 64, 'same proportions');
  assert.ok(f.dw >= 300 && f.dh >= 100, 'covers the whole area');
  assert.equal(f.dx, (300 - f.dw) / 2, 'centred');
});

test('the Skins tab: bad rows are named by cell, and every skin needs its images', () => {
  const dir = path.join(__dirname, 'fixtures', 'sheet');
  const tabs = Object.fromEntries(economy.TABS.map(t => [t, fs.readFileSync(path.join(dir, t + '.csv'), 'utf8')]));
  assert.deepEqual(economy.validate(tabs).errors, []);
  const lines = tabs.Skins.split(/\r?\n/);
  lines[1] = 'checker,Checker,shiny,Epic,cheap,Patterns,maybe';
  lines[2] = 'checker,Again,pattern,Common,100,,yes';
  tabs.Skins = lines.join('\n');
  const errors = economy.validate(tabs, { hasFile: f => !f.includes('flag-fr') }).errors;
  for (const re of [/"shiny" must be pattern or art/, /"Epic" must be Common, Rare, Ultra Rare, Legendary/, /"cheap" must be a whole number/,
    /"maybe" must be yes or no/, /"checker" appears twice/, /\("Collection"\): blank/, /no image public\/skins\/flag-fr\.png/]) {
    assert.ok(errors.some(e => re.test(e)), `${re} in:\n${errors.join('\n')}`);
  }
});

// ---------- Buying ----------
let db, pool, game, url;
const sockets = [];
before(async () => {
  db = await testDb('skins');
  pool = db.pool;
  game = createGame(pool, { tapsPerSecond: 1000, achievementList: [] });   // no reward squares here
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  game.io.close();
  await db.drop();
});
const player = auth => { const s = connectPlayer(url, auth); sockets.push(s); return s; };
const at = (x, y) => d => d.x === x && d.y === y;
let row = 0;
async function guestWith(balance) {
  const s = player(), y = row++;
  await s.welcome;
  s.take(0, y);
  const { pid, token } = await s.next('you');
  await s.next('claim', at(0, y));
  await pool.query('UPDATE players SET squares = $2 WHERE id = $1', [pid, balance]);
  const fresh = player({ token });
  await fresh.welcome;
  return { s: fresh, pid, token };
}
const flag = rules.SKINS.find(s => s.id === 'flag-jp');
const owns = async (pid, id) => (await pool.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [pid, id])).rowCount === 1;
const balance = async pid => Number((await pool.query('SELECT squares FROM players WHERE id = $1', [pid])).rows[0].squares);

test('buying at exactly the price works and is written to the ledger; one square short is refused', async () => {
  const g = await guestWith(flag.price);
  assert.deepEqual(await g.s.ask('buySkin', { skin: flag.id }), { squares: 0, balance: 0 });
  assert.ok(await owns(g.pid, flag.id));
  const { rows } = await pool.query("SELECT delta::float, reason FROM square_ledger WHERE player_id = $1 AND reason LIKE 'skin:%'", [g.pid]);
  assert.deepEqual(rows, [{ delta: -flag.price, reason: 'skin:flag-jp' }]);
  assert.deepEqual(await g.s.ask('buySkin', { skin: flag.id }), { error: 'You already own this skin' });

  const short = await guestWith(flag.price - 1);
  assert.deepEqual(await short.s.ask('buySkin', { skin: flag.id }), { error: 'Not enough squares', need: 1 });
  assert.equal(await owns(short.pid, flag.id), false);
  assert.equal(await balance(short.pid), flag.price - 1, 'nothing taken');
  assert.deepEqual(await short.s.ask('buySkin', { skin: 'flag-atlantis' }), { error: 'That skin is not for sale' });
});

test('a double tap, or two devices at once, pays only once', async () => {
  const g = await guestWith(flag.price * 3);
  const other = player({ token: g.token });
  await other.welcome;
  const answers = await Promise.all([g.s.ask('buySkin', { skin: flag.id }), g.s.ask('buySkin', { skin: flag.id }), other.ask('buySkin', { skin: flag.id })]);
  assert.equal(answers.filter(a => a.squares !== undefined).length, 1, JSON.stringify(answers));
  assert.equal(await balance(g.pid), flag.price * 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM square_ledger WHERE player_id = $1 AND reason = 'skin:flag-jp'", [g.pid])).rows[0].n, 1);
});

test('an owned skin can be picked on every map; one not owned cannot', async () => {
  const g = await guestWith(flag.price);
  assert.deepEqual(await g.s.ask('setup', { skin: flag.id }), { error: 'Your color, skin and coverage are locked for this map' }, 'locked here after the first claim');
  assert.deepEqual(await g.s.ask('buySkin', { skin: flag.id }), { squares: 0, balance: 0 });
  const id = await store.createMap(pool, { name: 'Elsewhere', width: 4, height: 4 });
  assert.deepEqual(await g.s.ask('switchMap', id), { ok: true });
  await g.s.next('welcome');
  const r = await g.s.ask('setup', { skin: flag.id, coverage: 'stretch' });
  assert.equal(r.skin, flag.id);
  assert.deepEqual(await g.s.ask('setup', { skin: 'flag-fr' }), { error: "You don't own that skin" });
  g.s.take(1, 1);
  await g.s.next('player', d => String(d.pid) === String(g.pid) && d.skin === flag.id && d.coverage === 'stretch');
  const list = await g.s.ask('skins');
  assert.ok(list.find(k => k.id === flag.id).owned && list[0].id === 'default');
});

test('prices rise as you collect: Common from 100 to 1,500 at half the commons owned, and the same model per rarity', () => {
  const commons = rules.SKINS.filter(s => s.rarity === 'Common').length;
  assert.equal(skins.skinPrice('Common', 0, commons), 100);
  assert.equal(skins.skinPrice('Common', Math.ceil(commons / 2), commons), 1500);
  assert.equal(skins.skinPrice('Common', commons, commons), 1500, 'never above the top');
  assert.ok(skins.skinPrice('Common', 5, commons) > 100 && skins.skinPrice('Common', 5, commons) < 1500);
  assert.equal(skins.skinPrice('Rare', 0, 199), 1000);
  assert.equal(skins.skinPrice('Legendary', 10, 10), 25000);
});
