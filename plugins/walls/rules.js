// The walls plug-in's rules (loop 16; split out in loop 19 so they can be tested in memory). Pure functions of a map
// model: { cells: Map "x,y" -> owner|null, counts, walls: Map "x,y" -> [{ side, hits }], listings? }.
// core: the core's rules.js (sides and adjacency); max: maxWallsPerBlock.
function wallRules(core, max) {
  const { SIDES, OPPOSITE } = core;
  const key = (x, y) => x + ',' + y;
  const hasWall = (map, x, y, side) => !!map.walls?.get(key(x, y))?.some(w => w.side === side);
  // The sides of (x, y) touching `pid`'s land that aren't behind `pid`'s own wall: nobody crosses their own wall.
  const openSides = (map, pid, x, y) => core.adjacentSides(map, pid, x, y).filter(s => !hasWall(map, x + SIDES[s][0], y + SIDES[s][1], OPPOSITE[s]));
  // When every way `pid` can reach (x, y) runs through the owner's walls, their hit goes to a wall first: its side.
  function wallFirst(map, pid, x, y) {
    const open = openSides(map, pid, x, y);
    return open.length && open.every(s => hasWall(map, x, y, s)) ? open[0] : null;
  }
  // Why `pid` can't hit (x, y) because of their own wall, or null (the core checks everything else).
  const hitRefusal = (map, pid, x, y) =>
    (pid && map.counts.get(pid) && core.adjacentSides(map, pid, x, y).length && !openSides(map, pid, x, y).length ? 'Your wall is in the way' : null);
  // Where a wall can go: a side of your block facing a square you don't own (outer sides only). A refusal, or null.
  function refusal(map, pid, x, y, side) {
    if (!(side in SIDES)) return 'Pick a side';
    if (map.cells.get(key(x, y)) !== pid) return 'Only on your own land';
    if (map.cells.get(key(x + SIDES[side][0], y + SIDES[side][1])) === pid) return 'Walls go on the edge of your land';
    const walls = map.walls?.get(key(x, y)) ?? [];
    if (walls.some(w => w.side === side)) return 'There is a wall there already';
    if (walls.length >= max) return `At most ${max} walls on one block`;
    if (map.listings?.has(key(x, y))) return 'Not on land for sale';
    return null;
  }
  return { hasWall, openSides, wallFirst, hitRefusal, refusal };
}

// A wall's price in tenths on a level-L block, for someone owning `owned` walls on the map before the batch:
// wallPriceWh x W(L) x max(1, sqrt(owned) / 2). catalog: the core's catalog.js; D: data.json.
const priceTenths = (catalog, D, L, owned) => catalog.toTenths(D.wallPriceWh * catalog.W(L) * Math.max(1, Math.sqrt(Math.max(0, owned)) / 2));

module.exports = { wallRules, priceTenths };
