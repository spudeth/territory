// The factories plug-in's rules (loop 16; a plug-in since loop 19), as pure functions of a map model, so they can be
// tested in memory. A factory mines like a slow player while awake: hits per second = (hitsPerBlock / baseBlockSeconds)
// x the owner's Factory Speed value. Its target is the empty, non-water block touching the owner's land that is
// closest to it (straight-line distance; ties in a fixed seeded order), checked again every step. A target outside its
// home square (factoryAreaSize wide, centred on it) needs extra hits for the distance.
//
// Time runs in one-second steps aligned to the clock (loop 18: so each hit can be shown as it happens), and every
// factory is brought up to date step by step, so a long sleep gives exactly what staying awake would.
//
// catalog, rules: the core's; D: this plug-in's data.json (the Factories tab).
module.exports = function factoryRules(catalog, rules, D) {
  const { E } = catalog;   // the core's numbers: baseBlockSeconds, hitsPerSquare
  const key = (x, y) => x + ',' + y;
  const STEP_MS = () => 1000;
  // The step boundary at or before `ms`.
  const stepFloor = ms => Math.floor(ms / STEP_MS()) * STEP_MS();

  // A fixed, seeded order for ties (the core's): the same factory and block always compare the same way.
  const tieRank = rules.tieRank;

  // The block a factory at (fx, fy) mines next for `owner`, or null: the closest empty, non-water block touching
  // the owner's land. map: { cells: Map "x,y" -> owner|null, terrainAt(x, y), blocked?(x, y, side) }.
  function chooseTarget(map, owner, fx, fy, seed) {
    let best = null;
    const seen = new Set();
    for (const [k, o] of map.cells) {
      if (o !== owner) continue;
      const [x, y] = k.split(',').map(Number);
      for (const [side, [dx, dy]] of Object.entries(rules.SIDES)) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (seen.has(nk) || map.blocked?.(x, y, side)) continue;
        seen.add(nk);
        if (map.cells.get(nk) !== null || map.terrainAt(nx, ny) === 'water') continue;   // missing (undefined) or owned
        const d = (nx - fx) ** 2 + (ny - fy) ** 2, r = tieRank(seed, nx, ny);
        if (!best || d < best.d || (d === best.d && r < best.r)) best = { x: nx, y: ny, d, r };
      }
    }
    return best && { x: best.x, y: best.y };
  }

  // Whether (t.x, t.y) can still be the owner's target: empty, not water, and next to their land across a side
  // nothing blocks (a wall of theirs).
  function stillTarget(map, owner, t) {
    if (map.cells.get(key(t.x, t.y)) !== null || map.terrainAt(t.x, t.y) === 'water') return false;
    for (const [side, [dx, dy]] of Object.entries(rules.SIDES)) {
      const x = t.x - dx, y = t.y - dy;   // the neighbour whose `side` faces t
      if (map.cells.get(key(x, y)) === owner && !map.blocked?.(x, y, side)) return true;
    }
    return false;
  }

  // Blocks a target lies beyond the factory's home square: Chebyshev distance - half the square (0 inside it).
  const beyondHome = (fx, fy, x, y) => Math.max(0, Math.max(Math.abs(x - fx), Math.abs(y - fy)) - Math.floor(D.factoryAreaSize / 2));
  // Hits a factory needs for block (x, y): its hardness, plus d x factoryDistancePenaltyWh x W(L) x hitsPerSquare.
  function hitsFor(map, x, y, fx, fy, L) {
    const H = rules.hardness(map.terrainAt(x, y), map.birth?.get(key(x, y)) ?? 1);
    return H + beyondHome(fx, fy, x, y) * D.factoryDistancePenaltyWh * catalog.W(L) * E.hitsPerSquare;
  }

  // Squares (tenths) a factory earns for a block: its owner's Factory Yield value, never more than the block's
  // normal pay (Earnings doesn't apply).
  function yieldTenths(yieldValue, map, x, y) {
    const terrain = map.terrainAt(x, y), H = rules.hardness(terrain, map.birth?.get(key(x, y)) ?? 1);
    const normal = catalog.payTenths(H, 1, terrain === 'gold' ? rules.GOLD_BONUS_SQUARES : 0);
    return Math.min(catalog.toTenths(yieldValue), normal);
  }

  // Which of an owner's factories on a map work: they may have floor(blocks owned / factoryBlocksPerFactory); if
  // they have more, the newest pause. factories: [{ id, builtAt }]; returns a Set of the ids that are paused.
  function pausedIds(factories, owned) {
    const allowed = Math.floor(owned / D.factoryBlocksPerFactory);
    return new Set([...factories].sort((a, b) => a.builtAt - b.builtAt || a.id - b.id).slice(allowed).map(f => f.id));
  }
  // How many factories a player with `owned` blocks may have.
  const factoryLimit = owned => Math.floor(owned / D.factoryBlocksPerFactory);
  // The price (tenths) of a player's nth factory on a level-L map: P_F x V_F x W(L) x g^(n-1).
  const priceTenths = (L, n) => catalog.toTenths(D.factoryBuildPaybackHours * D.factoryValuePerHour * catalog.W(L) * D.factoryBuildGrowth ** (n - 1));

  return { key, STEP_MS, stepFloor, tieRank, chooseTarget, stillTarget, beyondHome, hitsFor, yieldTenths, pausedIds, factoryLimit, priceTenths,
    hitsPerSecond: speed => (rules.HITS_PER_BLOCK / E.baseBlockSeconds) * speed };
};
