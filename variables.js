// The game's variables (loop 19): named numbers with a base value, read whenever the game needs them. The core
// declares its four; each plug-in declares its own in its plugin.json ("variables"). Upgrades change them
// (upgrades.js: base, then steps capped by the block's level); items may multiply them for a while (app.js).
const plugins = require('./plugins');

const CORE = { clickPower: 1, earnings: 1, defense: 1, growth: 1 };
// Still in the core until their plug-in moves into plugins/ (loop 19, Phase 5).
const BUILT_IN = { 'factories.speed': 0.05, 'factories.lifetime': 4, 'factories.yield': 1 };

// Every variable with its base, for the core plus these plug-ins (default: every folder in plugins/).
function declared(list = plugins.list()) {
  const out = { ...CORE, ...BUILT_IN };
  for (const p of list) Object.assign(out, p.variables);
  return out;
}
const ALL = declared();
// A variable's base value (0 for one nobody declares).
const base = name => ALL[name] ?? 0;

// The variable each upgrade changed before the Upgrades tab had a Variable column (the names agreed in Q39).
const LEGACY_UPGRADE_VARIABLE = { factorySpeed: 'factories.speed', factoryLifetime: 'factories.lifetime', factoryYield: 'factories.yield' };

module.exports = { CORE, BUILT_IN, LEGACY_UPGRADE_VARIABLE, declared, base };
