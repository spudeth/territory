// Walls, on the server (loop 16; batches loop 18; a plug-in since loop 19). A wall sits on one outer side of a block
// (a side facing a square its owner doesn't own); at most maxWallsPerBlock per block, on different sides. Someone who
// can only reach the block through walls hits a wall first: wallStrength x H hits, cracking and fading like a block.
// Nobody claims or attacks across their own wall. Walls go when their block is taken or freed, or by Demolition.
// Price of each: wallPriceWh x W(its block's level) x max(1, sqrt(walls you own on this map) / 2), counted before
// the batch. Repair (item 5, loop 19): a tap on your own block with no crack on it fixes its most cracked wall.
// Its data: map_cells.walls ([{ side, hits }], a core table: Q42). Its numbers: the Walls tab (data.json).
// Events sent: walls:changed { x, y, walls, broken? }.
const text = require('./text');

module.exports = api => {
  const { pool, catalog, rules } = api;
  const D = api.plugin.data;   // { wallStrength, wallPriceWh, maxWallsPerBlock }
  const MAX = D.maxWallsPerBlock, MAX_BATCH = 200;
  const key = (x, y) => x + ',' + y;
  const { SIDES, OPPOSITE } = rules;

  // ---------- The rules (rules.js) ----------
  const wallsOf = map => (map.walls ??= new Map());   // "x,y" -> [{ side, hits }], kept on the map
  const { hasWall, openSides, wallFirst, hitRefusal, refusal } = require('./rules').wallRules(rules, MAX);
  const wallsOwned = (map, pid) => { let n = 0; for (const [k, list] of wallsOf(map)) if (map.cells.get(k) === pid) n += list.length; return n; };
  const priceTenths = (L, owned) => require('./rules').priceTenths(catalog, D, L, owned);

  // ---------- The map: loading, showing, changes ----------
  api.on('mapLoaded', (map, rows) => { for (const c of rows) if (c.walls?.length) wallsOf(map).set(key(c.x, c.y), c.walls); });
  api.on('welcome', map => ({ walls: [...wallsOf(map)].map(([k, w]) => [...k.split(',').map(Number), w]), maxWallsPerBlock: MAX }));
  // A block changed hands or was freed: its walls are gone (the database cleared them in the same change).
  api.on('ownerChanged', (map, k) => {
    if (!wallsOf(map).has(k)) return;
    wallsOf(map).delete(k);
    const [x, y] = k.split(',').map(Number);
    api.toMap(map, 'walls:changed', { x, y, walls: [] });
  });
  // A wall broke (or was demolished): gone from the block, for everyone.
  function dropWall(map, x, y, side, broken) {
    const k = key(x, y), rest = (wallsOf(map).get(k) ?? []).filter(w => w.side !== side);
    if (rest.length) wallsOf(map).set(k, rest); else wallsOf(map).delete(k);
    map.hits.delete(k + '|' + side);
    api.toMap(map, 'walls:changed', { x, y, walls: rest, ...(broken ? { broken: side } : {}) });
  }

  // ---------- Hits ----------
  // Nothing (a factory included) crosses its owner's wall.
  api.on('blocked', (map, x, y, side) => (hasWall(map, x, y, side) ? true : null));
  api.on('hitRefusal', hitRefusal);
  // The hit goes to the wall when every way in runs through the owner's walls.
  api.on('beforeHit', (map, pid, x, y, power) => {
    const side = pid && wallFirst(map, pid, x, y);
    if (!side) return null;
    const wall = wallsOf(map).get(key(x, y)).find(w => w.side === side);
    if (!api.cracks.hit(map, key(x, y) + '|' + side, pid, power, wall.hits, { x, y, side })) return true;
    api.serial(map, async () => {
      if (!hasWall(map, x, y, side)) return;
      await removeWall(pool, map.id, x, y, side);
      dropWall(map, x, y, side, true);
    }).catch(err => console.error(`WALL BREAK FAILED (map ${map.id}, ${key(x, y)}|${side}): ${err.message}`));
    return true;
  });
  // Repair (item 5): your own block with no crack: the most cracked of its walls loses `power` hits.
  api.on('ownTap', (map, pid, x, y, power) => {
    const cracked = (wallsOf(map).get(key(x, y)) ?? []).map(w => [w.side, map.hits.get(key(x, y) + '|' + w.side)]).filter(([, h]) => h?.n > 0);
    if (!cracked.length) return null;
    const [side] = cracked.sort((a, b) => b[1].n / b[1].need - a[1].n / a[1].need)[0];
    api.cracks.repair(map, key(x, y) + '|' + side, power, { x, y, side });
    return true;
  });

  // ---------- The info card ----------
  api.on('blockInfo', (map, x, y, pid) => {
    const list = wallsOf(map).get(key(x, y)), owner = map.cells.get(key(x, y)), side = pid && owner !== null && String(owner) !== String(pid) ? wallFirst(map, pid, x, y) : null;
    return list || side ? { ...(list ? { walls: list.map(w => ({ ...w })) } : {}), ...(side ? { wallFirst: side } : {}) } : null;
  });

  // ---------- Building (Build → Wall): a batch, all or nothing ----------
  api.builders.add('wall', async (map, pid, p) => {
    const list = Array.isArray(p.walls) ? p.walls : [{ x: p.x, y: p.y, side: p.side }];
    if (!list.length || list.length > MAX_BATCH || !list.every(w => Number.isInteger(w?.x) && Number.isInteger(w?.y) && typeof w.side === 'string')) {
      return { error: 'Pick where the walls go' };
    }
    const seen = new Map();   // "x,y" -> sides in this batch
    for (const w of list) {
      wallsOf(map);
      const why = refusal(map, pid, w.x, w.y, w.side);
      if (why) return { error: why, at: { x: w.x, y: w.y, side: w.side } };
      const k = key(w.x, w.y), sides = seen.get(k) ?? seen.set(k, []).get(k);
      if (sides.includes(w.side)) return { error: 'That wall is in the batch twice', at: { x: w.x, y: w.y, side: w.side } };
      sides.push(w.side);
      if ((wallsOf(map).get(k)?.length ?? 0) + sides.length > MAX) return { error: `At most ${MAX} walls on one block`, at: { x: w.x, y: w.y, side: w.side } };
    }
    const owned = wallsOwned(map, pid);
    let price = 0;
    const walls = list.map(w => {
      const L = api.blocks.levelAt(map, w.x, w.y);
      price += priceTenths(L, owned);
      return { ...w, hits: D.wallStrength * rules.hardness(map.terrainAt(w.x, w.y), L) };
    });
    const r = await buildWalls(pid, map.id, walls, price);
    if (r.error) return { error: r.error, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) };
    for (const c of r.cells) {
      wallsOf(map).set(key(c.x, c.y), c.walls);
      api.toMap(map, 'walls:changed', { x: c.x, y: c.y, walls: c.walls });
    }
    api.money.changed(pid, r.squares);
    api.stats.bump(pid, 'squaresSpent', catalog.fromTenths(price));
    return { ok: true, built: list.length, price: catalog.fromTenths(price), squares: catalog.fromTenths(r.squares) };
  }, (map, pid) => (map.counts.get(pid) ? null : 'Claim a block first: walls go on the edge of your land.'));
  // For the preview: a wall's price here by block level (squares), and the multiplier from the walls owned now.
  api.on('buildInfo', (map, pid) => {
    const owned = wallsOwned(map, pid), levels = new Set([1, ...map.birth.values()]);
    return { walls: { owned, factor: Math.max(1, Math.sqrt(owned) / 2), byLevel: Object.fromEntries([...levels].map(L => [L, catalog.fromTenths(priceTenths(L, owned))])) } };
  });
  // Demolition clears a block's walls through the core.
  api.built.add('walls', {
    has: (map, x, y) => !!wallsOf(map).get(key(x, y))?.length,
    remove: (c, map, x, y) => c.query("UPDATE map_cells SET walls = '[]' WHERE map_id = $1 AND x = $2 AND y = $3", [map.id, x, y]),
    removed: (map, x, y) => { for (const w of [...(wallsOf(map).get(key(x, y)) ?? [])]) dropWall(map, x, y, w.side, false); },
  });

  // ---------- The database ----------
  // A batch of walls for `price` tenths in all, all or nothing (player row and blocks locked).
  const buildWalls = (playerId, mapId, walls, price) => api.tx(async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    const byBlock = new Map();
    for (const w of walls) (byBlock.get(key(w.x, w.y)) ?? byBlock.set(key(w.x, w.y), []).get(key(w.x, w.y))).push(w);
    const cells = [];
    for (const list of byBlock.values()) {
      const { x, y } = list[0];
      const { rows: [cell] } = await c.query('SELECT owner_id, walls, listing_id FROM map_cells WHERE map_id = $1 AND x = $2 AND y = $3 FOR UPDATE', [mapId, x, y]);
      if (!cell || String(cell.owner_id) !== String(playerId)) return { error: 'Only on your own land' };
      if (cell.listing_id) return { error: 'Not on land for sale' };
      if (list.some(w => cell.walls.some(o => o.side === w.side))) return { error: 'There is a wall there already' };
      if (cell.walls.length + list.length > MAX) return { error: `At most ${MAX} walls on one block` };
      cells.push({ x, y, walls: [...cell.walls, ...list.map(w => ({ side: w.side, hits: w.hits }))] });
    }
    const paid = await api.spend(c, playerId, price, walls.length === 1 ? 'build:wall' : `build:wall x${walls.length}`);
    if (paid.error) return paid;
    for (const cell of cells) await c.query('UPDATE map_cells SET walls = $4 WHERE map_id = $1 AND x = $2 AND y = $3', [mapId, cell.x, cell.y, JSON.stringify(cell.walls)]);
    return { cells, squares: paid.squares };
  });
  // One wall gone (broken).
  const removeWall = (db, mapId, x, y, side) => db.query(`UPDATE map_cells SET walls = COALESCE((SELECT jsonb_agg(w) FROM jsonb_array_elements(walls) w
    WHERE w->>'side' <> $4), '[]') WHERE map_id = $1 AND x = $2 AND y = $3`, [mapId, x, y, side]);

  // ---------- The Game Guide ----------
  api.on('guide', ({ n }) => ({ id: 'walls', title: text.name, html: `<h2 id="walls">${text.name}</h2>
    <p>Build → Wall, then tap the outer sides of your blocks where you want walls: each shows faintly until you press ✓, which builds them
      all (tap one again to drop it). At most ${MAX} per block, on different sides. Someone who can only reach that block
      through walls must break a wall first: <b>${n(D.wallStrength)} × H</b> hits. You can't claim across your own wall. Walls last until the
      block is taken or you use Demolition. Tap your own block when one of its walls is cracked to repair the most cracked one.</p>
    <p class="formula">Price of each wall = ${n(D.wallPriceWh)} × W(the block's level) × max(1, √(walls you own on this map) ÷ 2) squares</p>
    <p>The walls you own are counted before the batch, so every wall in one batch has the same multiplier.</p>` }));
};
