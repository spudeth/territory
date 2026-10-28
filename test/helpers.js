// Test helpers. Each test file gets its own throwaway schema on the dev branch, so tests never touch real data.
const crypto = require('crypto');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createPool, migrate } = require('../db');
const store = require('../store');
const { guestName, guestNames } = require('../names');

for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(path.join(__dirname, '..', f)); } catch {}
}

async function testDb() {
  if (process.env.NEON_BRANCH === 'production') throw new Error('refusing to run tests against the production branch');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; run `neon checkout dev` first');
  const schema = 'test_' + crypto.randomBytes(6).toString('hex');
  const admin = createPool(url, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(url, { max: 8, options: `-c search_path=${schema}` });
  await migrate(pool);
  const mapId = await store.defaultMapId(pool);
  return {
    pool, mapId,
    count: async (sql, params) => Number((await pool.query(sql, params)).rows[0].count),
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

// Creates a guest by having them first-claim the empty block (x, y). Returns the claim result plus the token.
async function newGuest(pool, mapId, x, y, name = guestName()) {
  const token = crypto.randomUUID();
  const r = await store.claimBlock(pool, { mapId, x, y, from: null, playerId: null,
    newGuest: { names: guestNames(name), tokenHash: store.hashToken(token) }, color: 'hsl(200, 75%, 55%)' });
  return { ...r, token };
}

const claim = (pool, mapId, playerId, x, y, from = null) =>
  store.claimBlock(pool, { mapId, x, y, from, playerId, newGuest: null, color: null });

// A player's browser connected to the game at `url`. Each gets its own IP unless told otherwise, so the guest
// limit only bites when meant to. auth is what the browser sends: { token, jwt, upgrade }.
let nextIp = 1;
function connectPlayer(url, { ip = `10.0.${nextIp >> 8}.${nextIp++ & 255}`, ...auth } = {}) {
  const s = connect(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false,
    extraHeaders: { 'cf-connecting-ip': ip, 'x-forwarded-for': '203.0.113.9' } });
  const events = [];
  s.onAny((name, data) => events.push([name, data]));
  s.events = events;
  // Resolves with the first `name` event (already received or still to come) that passes `match`.
  s.next = (name, match = () => true, ms = 15000) => new Promise((resolve, reject) => {
    const hit = events.find(([n, d]) => n === name && match(d));
    if (hit) { events.splice(events.indexOf(hit), 1); return resolve(hit[1]); }
    const timer = setTimeout(() => { s.offAny(on); reject(new Error(`no "${name}" event within ${ms}ms`)); }, ms);
    function on(n, d) {
      if (n !== name || !match(d)) return;
      clearTimeout(timer); s.offAny(on);
      events.splice(events.findIndex(e => e[1] === d), 1);
      resolve(d);
    }
    s.onAny(on);
  });
  s.welcome = s.next('welcome');
  s.hit3 = (x, y) => { for (let i = 0; i < 3; i++) s.emit('hit', { x, y }); };
  s.ask = (event, data) => s.timeout(15000).emitWithAck(event, data);
  return s;
}

// A browser talking to the site's /api/auth: keeps cookies between requests like a real one would.
// Neon limits how many login requests one address may make, and every test request comes from this computer,
// so when Neon says "too many requests" the test waits and tries again.
function browser(url) {
  const jar = new Map();
  async function request(path, opts = {}) {
    for (let tries = 1; ; tries++) {
      const r = await send(path, opts);
      if (r.status !== 429 || tries === 8) return r;
      await new Promise(resolve => setTimeout(resolve, Math.min(2000 * 2 ** tries, 16000)));
    }
  }
  async function send(path, { method = 'GET', body, redirect = 'manual' } = {}) {
    const res = await fetch(url + path, {
      method, redirect,
      headers: { origin: url, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = [pair.slice(0, pair.indexOf('=')).trim(), pair.slice(pair.indexOf('=') + 1)];
      if (!v || attrs.some(a => /max-age=0\b/i.test(a.trim()))) jar.delete(k); else jar.set(k, v);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, text, headers: res.headers };
  }
  return {
    jar, request,
    post: (path, body = {}) => request('/api/auth/' + path, { method: 'POST', body }),
    get: path => request('/api/auth/' + path),
    jwt: async () => (await request('/api/auth/token')).data?.token ?? null,
  };
}

module.exports = { testDb, newGuest, claim, connectPlayer, browser };
