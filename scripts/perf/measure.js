// Measuring (loop 19): node scripts/perf/measure.js [label]
// Starts scripts/perf/server.js (the game on a throwaway dev schema), then measures, in about 8 minutes:
//   idle      2 minutes with nobody connected: database queries a minute, memory, CPU
//   page      a phone (iPhone 15 size, Slow 4G, 4x slower CPU) opening the game, empty cache then warm
//   load      10 bot players tapping 4 times a second for 2 minutes, with one factory working
//   welcome   the welcome message's size on maps of 400, 10,000 and 50,000 blocks
// and writes the numbers to scripts/perf/results-<label>.json. Needs Chrome and the dev database (.env.local).
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { fork } = require('child_process');
const puppeteer = require('puppeteer-core');
const { connectPlayer } = require('../../tests/helpers');

const LABEL = process.argv[2] || 'before';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = ms => new Promise(r => setTimeout(r, ms));
const MB = n => Math.round(n / 1048576 * 10) / 10, KB = n => Math.round(n / 1024 * 10) / 10;

async function main() {
  const child = fork(path.join(__dirname, 'server.js'), [], { stdio: 'inherit' });
  const ready = await new Promise((res, rej) => { child.once('message', res); child.once('exit', c => rej(new Error('server exited ' + c))); });
  const sample = () => new Promise(r => { child.once('message', m => r(m.sample)); child.send('sample'); });
  const rates = (a, b) => {
    const s = (b.t - a.t) / 1000;
    return { seconds: Math.round(s), queriesPerMin: Math.round((b.queries - a.queries) / s * 60), txPerMin: Math.round((b.tx - a.tx) / s * 60),
      packetsOutPerSec: Math.round((b.pout - a.pout) / s * 10) / 10, packetsInPerSec: Math.round((b.pin - a.pin) / s * 10) / 10,
      kbOutPerSec: KB((b.bout - a.bout) / s), kbInPerSec: KB((b.bin - a.bin) / s),
      cpuPercent: Math.round((b.cpu - a.cpu) / 1000 / (b.t - a.t) * 1000) / 10, rssMB: MB(b.rss), heapMB: MB(b.heap) };
  };
  const out = { label: LABEL, at: new Date().toISOString(), node: process.version };

  // 1. Idle.
  console.log('idle: 2 minutes');
  const i0 = await sample();
  await wait(120000);
  out.idle = rates(i0, await sample());

  // 2. A phone opening the game.
  console.log('page load');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  out.page = {};
  for (const run of ['cold', 'warm']) {
    const ctx = run === 'cold' ? await browser.createBrowserContext() : out.page._ctx;
    const p = run === 'cold' ? await ctx.newPage() : out.page._page;
    if (run === 'cold') { out.page._ctx = ctx; out.page._page = p; }
    await p.setViewport({ width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const cdp = await p.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const types = new Map(), byType = {};
    let requests = 0, bytes = 0;
    cdp.on('Network.responseReceived', e => types.set(e.requestId, e.type));
    cdp.on('Network.loadingFinished', e => {
      requests++; bytes += e.encodedDataLength;
      const t = types.get(e.requestId) ?? 'Other';
      byType[t] = (byType[t] ?? 0) + e.encodedDataLength;
    });
    const t0 = Date.now();
    await p.goto(ready.url, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction('typeof cells !== "undefined" && cells && cells.size > 0', { polling: 50, timeout: 120000 });
    const mapMs = Date.now() - t0;
    await wait(5000);   // whatever loads just after the map
    const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
    const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 }));
    out.page[run] = { requests, kb: KB(bytes), byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, KB(v)])), ...nav, mapShownMs: mapMs, jsHeapMB: MB(heap.usedSize) };
    await cdp.detach();
  }
  delete out.page._ctx; delete out.page._page;
  await browser.close();

  // 3. Load: 10 bots tapping 4 times a second for 2 minutes on the measured map (its factory works meanwhile).
  console.log('load: 10 bots, 2 minutes');
  const bots = [];
  let taps = 0, claims = 0;
  for (let i = 0; i < 10; i++) {
    const s = connectPlayer(ready.url);
    const w = await s.welcome;
    const cells = new Map(w.cells.map(([x, y, o]) => [x + ',' + y, o]));
    const empty = [...cells].filter(([, o]) => o === null).map(([k]) => k.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const bot = { s, cells, me: null, target: null, tries: 0, bad: new Set(), start: empty[Math.floor((i + 0.5) * empty.length / 10)] };
    s.on('you', d => { bot.me = d.pid; });
    s.on('claim', d => { cells.set(d.x + ',' + d.y, d.pid); if (bot.target && d.x === bot.target[0] && d.y === bot.target[1]) { if (d.pid === bot.me) claims++; bot.target = null; } });
    s.on('grow', d => cells.set(d.x + ',' + d.y, null));
    s.on('denied', () => { if (bot.target) bot.bad.add(bot.target.join(',')); bot.target = null; });
    s.events.length = 0;
    bots.push(bot);
  }
  const pick = bot => {
    if (bot.me === null) return bot.bad.has(bot.start.join(',')) ? null : bot.start;
    for (const [k, o] of bot.cells) {
      if (o !== bot.me) continue;
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nk = (x + dx) + ',' + (y + dy);
        if (bot.cells.get(nk) === null && !bot.bad.has(nk)) return [x + dx, y + dy];
      }
    }
    return null;
  };
  const l0 = await sample();
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    for (const bot of bots) {
      if (!bot.target || bot.tries > 80) { if (bot.target) bot.bad.add(bot.target.join(',')); bot.target = pick(bot); bot.tries = 0; }
      if (!bot.target) continue;
      bot.s.emit('hit', { x: bot.target[0], y: bot.target[1] });
      bot.tries++; taps++;
    }
    for (const bot of bots) bot.s.events.length = 0;
    await wait(250);
  }
  const l1 = await sample();
  out.load = { ...rates(l0, l1), bots: 10, taps, claims, queriesPerTap: Math.round((l1.queries - l0.queries) / taps * 100) / 100 };
  for (const bot of bots) bot.s.disconnect();

  // 4. The welcome's size, as JSON and as sent (Socket.IO compresses messages over 4 KB, level 1).
  console.log('welcome sizes');
  out.welcome = {};
  for (const [name, id] of Object.entries(ready.maps)) {
    const s = connectPlayer(ready.url);
    let w = await s.welcome;
    if (w.map.id !== id) { await s.ask('switchMap', id); w = await s.next('welcome', d => d.map.id === id); }
    const json = Buffer.from(JSON.stringify(w));
    out.welcome[name] = { blocks: w.cells.length, jsonKB: KB(json.length), sentKB: KB(zlib.deflateRawSync(json, { level: 1 }).length) };
    s.disconnect();
  }

  child.send('stop');
  await new Promise(r => child.once('exit', r));
  const file = path.join(__dirname, `results-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
  console.log('Wrote ' + path.relative(process.cwd(), file));
}
main().catch(err => { console.error(err); process.exit(1); });
