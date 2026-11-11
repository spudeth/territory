// Real taps in a real browser (Chrome through puppeteer-core): the Build button opens its menu and never sends a hit
// to the map; tapping your own block does nothing; a Build tool that can't be used says why before any ghost; while
// placing, map taps never attack. Skipped where Chrome isn't installed (set CHROME_PATH to point at it).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { createGame } = require('../app');
const store = require('../store');
const { testDb } = require('./helpers');

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
const PHONE = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
let db, pool, game, url, browser;
before(async () => {
  if (!CHROME) return;
  db = await testDb('ui');
  pool = db.pool;
  game = createGame(pool, { achievementList: [] });
  await new Promise(r => game.server.listen(0, r));
  url = `http://localhost:${game.server.address().port}`;
  browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true });
});
after(async () => { if (!CHROME) return; await browser.close(); game.io.close(); await db.drop(); });
const wait = ms => new Promise(r => setTimeout(r, ms));

// A player with `n` blocks in a row on a fresh map, who has finished the tutorial; their phone, in the game.
async function playerWith(n) {
  const id = await store.createMap(pool, { name: 'Taps ' + crypto.randomBytes(3).toString('hex'), width: Math.max(n + 2, 6), height: 3 });
  const token = crypto.randomUUID();
  const g = await store.claimBlock(pool, { mapId: id, x: 0, y: 1, from: null, playerId: null, color: '#29adff',
    newGuest: { names: ['Tapper ' + crypto.randomBytes(2).toString('hex')], tokenHash: store.hashToken(token) } });
  for (let x = 1; x < n; x++) await store.claimBlock(pool, { mapId: id, x, y: 1, from: null, playerId: g.playerId, newGuest: null, color: null });
  await pool.query(`UPDATE players SET last_map_id = $2, tutorial = '{"step":null,"done":true,"tips":["square"]}' WHERE id = $1`, [g.playerId, id]);
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport(PHONE);
  await page.evaluateOnNewDocument(t => localStorage.setItem('territory-token', t), token);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await wait(800);
  await page.evaluate(() => document.getElementById('w-play').click());
  await wait(1800);
  // Every hit the page sends, and every toast it shows.
  await page.evaluate(() => {
    window.__hits = [];
    const emit = socket.emit.bind(socket);
    socket.emit = (ev, ...a) => { if (ev === 'hit') window.__hits.push(a[0]); return emit(ev, ...a); };
    window.__toasts = [];
    new MutationObserver(() => window.__toasts.push(document.getElementById('toast').textContent)).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true });
  });
  return { page, id, pid: g.playerId };
}
const tapAt = (page, x, y) => page.touchscreen.tap(x, y);
const centre = (page, sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
// A point on block (x, y) (fx, fy: where inside it, 0-1), scrolled into view.
const blockAt = (page, x, y, fx = 0.5, fy = 0.5) => page.evaluate(([x, y, fx, fy]) => { lookAt(x, y); draw(); return [ox + (x + fx) * scale, oy + (y + fy) * scale]; }, [x, y, fx, fy]);

test('a tap on the Build button opens its menu and never sends a hit to the map', { skip: !CHROME && 'Chrome is not installed' }, async () => {
  const { page } = await playerWith(3);
  await tapAt(page, ...await centre(page, '#build-btn'));
  await wait(800);
  assert.equal(await page.evaluate(() => document.getElementById('build-menu').hidden), false, 'the menu opened');
  assert.deepEqual(await page.evaluate(() => window.__hits), [], 'no hit went to the map');
  // The i buttons and leaderboard rows on the HUD take taps too.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#me .info-btn')).pointerEvents), 'auto');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#board-list li')).pointerEvents), 'auto');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('board')).pointerEvents), 'none', 'the panel itself stays tap-through');
  await page.close();
});

test('tapping your own block does nothing: no message, no sound', { skip: !CHROME && 'Chrome is not installed' }, async () => {
  const { page } = await playerWith(3);
  await page.evaluate(() => { window.__sounds = []; const play = gameAudio.play; gameAudio.play = (n, ...a) => { window.__sounds.push(n); return play.call(gameAudio, n, ...a); }; });
  await tapAt(page, ...await blockAt(page, 2, 1, 0.8, 0.9));   // their own block, clear of their name tag (a tag opens the profile)
  await wait(800);
  assert.deepEqual(await page.evaluate(() => window.__toasts.filter(Boolean)), []);
  assert.deepEqual(await page.evaluate(() => window.__sounds), []);
  await page.close();
});

test('a Build tool that can\'t be used says why before any ghost; while placing, map taps never attack', { skip: !CHROME && 'Chrome is not installed' }, async () => {
  const { page } = await playerWith(9);
  await tapAt(page, ...await centre(page, '#build-btn'));
  await wait(800);
  await page.evaluate(() => [...document.querySelectorAll('#build-menu .btn')].find(b => b.innerText.startsWith('Factory')).click());
  await wait(500);
  assert.equal(await page.evaluate(() => document.getElementById('toast').textContent), 'You need 20 blocks for your first factory (you have 9).');
  assert.equal(await page.evaluate(() => document.getElementById('build-bar').hidden), true, 'no placing started');
  // Wall works with 9 blocks: while placing, a tap on someone else's (or an empty) block only moves the ghost.
  await tapAt(page, ...await centre(page, '#build-btn'));
  await wait(800);
  await page.evaluate(() => [...document.querySelectorAll('#build-menu .btn')].find(b => b.innerText.startsWith('Wall')).click());
  await wait(300);
  await tapAt(page, ...await blockAt(page, 9, 1));   // an empty block next to the land
  await tapAt(page, ...await blockAt(page, 4, 2));
  await wait(500);
  assert.deepEqual(await page.evaluate(() => window.__hits), [], 'no hits while a Build tool is active');
  await page.close();
});
