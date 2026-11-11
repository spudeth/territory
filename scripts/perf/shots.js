// Screenshots to compare (loop 19): node scripts/perf/shots.js before|after
// The same views on iPhone SE, iPhone 15 and a desktop, each on a fresh game (scripts/perf/server.js, a throwaway
// dev schema), saved as docs/screenshots/loop19-<label>-<device>-<view>.png. Toasts and popups are hidden and the
// water animation is held on one frame, so the "before" and "after" pictures can be compared pixel by pixel.
const path = require('path');
const { fork } = require('child_process');
const puppeteer = require('puppeteer-core');

const LABEL = process.argv[2] || 'before';
const OUT = path.join(__dirname, '..', '..', 'docs', 'screenshots');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEVICES = {
  'iphone-se': { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'iphone-15': { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1100, height: 780, deviceScaleFactor: 1 },
};
const wait = ms => new Promise(r => setTimeout(r, ms));

async function shoot(browser, name, vp) {
  const child = fork(path.join(__dirname, 'server.js'), [], { stdio: 'inherit', env: { ...process.env, PERF_SHOTS: '1', PERF_PORT: process.env.PERF_PORT || '3098' } });
  const g = await new Promise((res, rej) => { child.once('message', res); child.once('exit', c => rej(new Error('server exited ' + c))); });
  const p = await (await browser.createBrowserContext()).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.setViewport(vp);
  await p.evaluateOnNewDocument(t => { localStorage.setItem('territory-token', t); localStorage.setItem('territory-tutorial-done', '1'); }, g.token);
  await p.goto(g.url, { waitUntil: 'networkidle0' });
  await wait(1200);
  await p.evaluate(() => document.getElementById('w-play').click());
  await wait(1800);
  await p.evaluate(() => {
    document.getElementById('coach-skip')?.click();
    for (const x of document.querySelectorAll('button')) if (/^(OK|Next|Got it)$/i.test(x.textContent.trim())) x.click();
    document.head.append(Object.assign(document.createElement('style'), { textContent: '#toast, #popup { visibility: hidden !important; }' }));
  });
  const mobile = !!vp.isMobile, s = mobile ? 32 : 40;
  const view = (c, scale) => p.evaluate(([x, y, k]) => { performance.now = () => 0; scale = k; lookAt(x, y); draw(); }, [c.x, c.y, scale]);
  const tap = async (c, fx = 0.5, fy = 0.5) => {
    const pt = await p.evaluate(([x, y, fx, fy]) => ({ x: ox + (x + fx) * scale, y: oy + (y + fy) * scale }), [c.x, c.y, fx, fy]);
    if (mobile) await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y);
    await wait(400);
  };
  const shot = async v => { await p.evaluate(() => { performance.now = () => 0; draw(); }); await wait(300); await p.screenshot({ path: `${OUT}/loop19-${LABEL}-${name}-${v}.png` }); };
  const mid = g.land[Math.floor(g.land.length / 2)];

  await view(mid, s); await wait(500); await shot('map');
  await p.evaluate(() => document.getElementById('build-btn').click()); await wait(800); await shot('build-menu');
  await p.evaluate(() => { document.getElementById('build-menu').hidden = true; show('market'); }); await wait(1500); await shot('market');
  await p.evaluate(() => show('items')); await wait(1500); await shot('items');
  await p.evaluate(() => show('upgrades')); await wait(1500); await shot('upgrades');
  await p.evaluate(() => closeMenu()); await wait(400);
  await view(g.factory, s); await p.evaluate(([x, y]) => openInspect({ x, y }), [g.factory.x, g.factory.y]); await wait(1200); await shot('factory-card');
  await p.evaluate(() => closeInspect()); await wait(300);
  // Walls: three picked (faint), then built.
  await p.evaluate(() => document.getElementById('build-btn').click()); await wait(800);
  await p.evaluate(() => [...document.querySelectorAll('#build-menu .btn')].find(b => b.innerText.startsWith('Wall'))?.click()); await wait(500);
  await view(g.edge[1], s + 12);
  for (const c of g.edge.slice(0, 3)) await tap(c, 0.5, 0.08);
  await shot('wall-preview');
  await p.evaluate(() => document.getElementById('build-ok').click()); await wait(1500);
  await view(g.edge[1], s + 40); await shot('walls');
  // Demolition: three bought, two blocks picked.
  await p.evaluate(() => ask('buyItem', { item: 'demolition', qty: 3 })); await wait(1200);
  await p.evaluate(() => [...document.querySelectorAll('#itembar .btn')].find(b => b.innerText.includes('Demolition'))?.click()); await wait(500);
  await view(g.edge[1], s + 12);
  await tap(g.edge[0]); await tap(g.edge[1]);
  await shot('demolition');
  await p.evaluate(() => document.getElementById('terra-cancel').click());

  console.log(`${name}: ${errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'ok'}`);
  await p.close();
  child.send('stop');
  await new Promise(r => child.once('exit', r));
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  for (const [name, vp] of Object.entries(DEVICES)) await shoot(browser, name, vp);
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
