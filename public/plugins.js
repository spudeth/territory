// ---------- The plug-in host in the browser (loop 19) ----------
// Each plug-in's client.js calls Plugins.add('<name>', { hook: fn, … }); the core calls the hooks (docs/ARCHITECTURE.md):
//   welcome(part, data)   its part of the welcome (data.pluginData[name]) and the whole message; also replayed to a
//                         plug-in that loads after the welcome arrived
//   drawUnder(ctx, view)  draw before the territory borders; drawOver(ctx, view) after them
//   tap(block, sx, sy)    take a map tap while one of its tools is on (return true)
//   infoCard(info)        a section for the info card (an element, or null)
// Plug-in code loads after the map is first drawn, so it never holds the map up (Q44).
const Plugins = (() => {
  const all = [];          // [{ name, …hooks }] in the order they were added
  const files = new Set(); // scripts already asked for
  let last = null;         // the latest welcome, for plug-ins that load after it
  const safe = (p, hook, args) => { try { return p[hook](...args); } catch (err) { console.error(`plug-in ${p.name}, ${hook}: ${err.message}`); return null; } };
  const has = hook => all.filter(p => typeof p[hook] === 'function');
  return {
    add(name, hooks) {
      const p = { name, ...hooks };
      all.push(p);
      if (last && p.welcome) safe(p, 'welcome', [last.pluginData?.[name] ?? null, last]);
      if (typeof draw === 'function') draw();
    },
    names: () => all.map(p => p.name),
    run(hook, ...args) { for (const p of has(hook)) safe(p, hook, args); },
    first(hook, ...args) { for (const p of has(hook)) { const r = safe(p, hook, args); if (r !== null && r !== undefined && r !== false) return r; } return null; },
    collect: (hook, ...args) => has(hook).map(p => safe(p, hook, args)).filter(r => r !== null && r !== undefined),
    welcome(data) {
      last = data;
      for (const p of has('welcome')) safe(p, 'welcome', [data.pluginData?.[p.name] ?? null, data]);
    },
    // Loads each plug-in the server lists, once, in order (not blocking anything: they arrive after the map).
    load(list) {
      for (const p of list ?? []) for (const f of p.files) {
        if (files.has(f)) continue;
        files.add(f);
        document.body.append(Object.assign(document.createElement('script'), { src: f, async: false }));
      }
    },
  };
})();
