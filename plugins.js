// The plug-in host (loop 19). A plug-in is a folder in plugins/ built from one template (docs/ARCHITECTURE.md):
//   plugin.json  { name, order, tabs: [sheet tabs], client: [browser files], variables: { name: base } }
//   server.js    module.exports = api => { api.on('<hook>', fn); … }   (optional)
//   client.js, text.js, look/, data.js, data.json, test/
// The core loads every folder in `order`, and talks to plug-ins only through hooks; no plug-in calls another.
// Removing a folder leaves a working game; adding one needs no core edits.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'plugins');

// Every plug-in folder's plugin.json (sorted by order, then name), or only `names` when given. Read once per folder.
const cache = new Map();
function list({ dir = DIR, names = null } = {}) {
  if (!fs.existsSync(dir)) return [];
  const found = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'plugin.json')))
    .map(d => {
      const at = path.join(dir, d.name);
      if (!cache.has(at)) cache.set(at, { order: 100, tabs: [], client: [], variables: {}, ...JSON.parse(fs.readFileSync(path.join(at, 'plugin.json'), 'utf8')), name: d.name, dir: at });
      return cache.get(at);
    });
  return found.filter(p => !names || names.includes(p.name)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// The hooks: on(name, fn, owner) adds one; run(name, …args) calls them all in plug-in order; first(name, …args)
// returns the first answer that isn't null/undefined; collect(name, …args) returns every answer that isn't;
// collectBy(name, …args) the same as [owner, answer] pairs.
function createHooks() {
  const hooks = new Map();
  const get = name => hooks.get(name) ?? [];
  return {
    on(name, fn, owner = 'core') { fn.owner = owner; (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); },
    has: name => get(name).length > 0,
    async run(name, ...args) { for (const fn of get(name)) await fn(...args); },
    runSync(name, ...args) { for (const fn of get(name)) fn(...args); },
    first(name, ...args) { for (const fn of get(name)) { const r = fn(...args); if (r !== null && r !== undefined) return r; } return null; },
    collect: (name, ...args) => get(name).map(fn => fn(...args)).filter(r => r !== null && r !== undefined),
    collectBy: (name, ...args) => get(name).map(fn => [fn.owner, fn(...args)]).filter(([, r]) => r !== null && r !== undefined),
  };
}

// Starts each plug-in's server.js with the core's api (plus its own name, folder and data).
function start(plugins, api) {
  for (const p of plugins) {
    const file = path.join(p.dir, 'server.js');
    if (!fs.existsSync(file)) continue;
    const dataFile = path.join(p.dir, 'data.json');
    // Its hooks are tagged with its name, and its socket events are named "<plug-in>:<event>".
    require(file)({ ...api, on: (hook, fn) => api.on(hook, fn, p.name), socket: (event, fn) => api.socket(`${p.name}:${event}`, fn), plugin: { name: p.name, dir: p.dir, data: fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {} } });
  }
}

// What the browser loads for each plug-in: [{ name, files: ['/plugins/<name>/client.js', …] }].
const clientList = plugins => plugins.filter(p => p.client.length).map(p => ({ name: p.name, files: p.client.map(f => `/plugins/${p.name}/${f}`) }));

module.exports = { DIR, list, createHooks, start, clientList };
