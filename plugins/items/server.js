// Items, on the server (loop 14; a plug-in since loop 19). From the Items tab (data.json, with its Enabled column):
// Super Click (multiplies Click Power for a few seconds), the Terraformer (changes a block's terrain) and Demolition
// (used up: clears what's built on your blocks). Reusable items are bought once and used a few times an hour, on any
// map; used-up ones are bought singly or in batches. Limits are checked here, per player across every map.
// Its tables: player_items (owned), player_inventory (used-up counts), item_uses (each use, for the limits).
// Events: items:list, items:buy { item, qty? }, items:use { item, … }; it sends items:changed and items:superClick.
const text = require('./text');
const TERRAFORM_TO = ['grass', 'sand', 'forest', 'stone', 'water'];   // never gold
const EFFECTS = { clickMultiplier: true, terraform: true, demolish: true };   // the kinds of effect this plug-in has code for

module.exports = api => {
  const { pool, catalog } = api;
  const ITEMS = api.plugin.data.items ?? [];
  const priceTenths = (item, map) => catalog.priceTenths(item, { L: map.level() });

  // What a player has: each item for sale (or owned), with uses left and when the next frees up.
  async function itemsFor(playerId) {
    const q = (sql) => (playerId ? pool.query(sql, [playerId]).then(r => r.rows) : []);
    const [owned, counts, uses] = await Promise.all([
      q('SELECT item_id FROM player_items WHERE player_id = $1'),
      q('SELECT item_id, count FROM player_inventory WHERE player_id = $1'),
      q("SELECT item_id, used_at FROM item_uses WHERE player_id = $1 AND used_at > now() - interval '1 day' ORDER BY used_at"),
    ]);
    const have = new Set(owned.map(r => r.item_id)), count = new Map(counts.map(r => [r.item_id, r.count]));
    return ITEMS.filter(i => (i.enabled || have.has(i.id) || count.get(i.id)) && i.effect in EFFECTS).map(i => {
      if (i.consumable) return { ...i, count: count.get(i.id) ?? 0, owned: (count.get(i.id) ?? 0) > 0, usesLeft: count.get(i.id) ?? 0, nextAt: null };
      const recent = uses.filter(u => u.item_id === i.id && Date.now() - u.used_at.getTime() < i.perMinutes * 60000);
      return { ...i, owned: have.has(i.id), usesLeft: Math.max(0, i.uses - recent.length), nextAt: recent.length ? recent[0].used_at.getTime() + i.perMinutes * 60000 : null };
    });
  }
  // Buys an item for `price` tenths each (a used-up one may come `qty` at a time), in one transaction with the player
  // row locked (a double tap pays once).
  const buy = (playerId, item, price, qty) => api.tx(async c => {
    const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (!p) return { error: 'Claim a block first' };
    if (!item.consumable && (await c.query('SELECT 1 FROM player_items WHERE player_id = $1 AND item_id = $2', [playerId, item.id])).rowCount) return { error: 'You already own this item' };
    const paid = await api.spend(c, playerId, price * qty, 'item:' + item.id + (qty > 1 ? ` x${qty}` : ''));
    if (paid.error) return paid;
    if (item.consumable) {
      const { rows: [inv] } = await c.query(`INSERT INTO player_inventory (player_id, item_id, count) VALUES ($1, $2, $3)
        ON CONFLICT (player_id, item_id) DO UPDATE SET count = player_inventory.count + $3 RETURNING count`, [playerId, item.id, qty]);
      return { squares: paid.squares, price: price * qty, count: inv.count };
    }
    await c.query('INSERT INTO player_items (player_id, item_id) VALUES ($1, $2)', [playerId, item.id]);
    return { squares: paid.squares, price };
  });
  // Uses an item if a use is free (player row locked, so two devices can't both use the last one). `apply(c)` runs in
  // the same transaction; a refusal from it rolls everything back. `n`: how many of a used-up item this takes.
  const use = (playerId, item, mapId, apply = async () => null, n = 1) => api.tx(async c => {
    await c.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
    if (item.consumable) {
      const { rows: [inv] } = await c.query('UPDATE player_inventory SET count = count - $3 WHERE player_id = $1 AND item_id = $2 AND count >= $3 RETURNING count', [playerId, item.id, n]);
      if (!inv) return { error: n === 1 ? `You have no ${item.name} left` : `Not enough ${item.name}: this needs ${n}` };
      const refused = await apply(c);
      if (refused) throw Object.assign(new Error(refused), { refusal: true });
      await c.query('INSERT INTO item_uses (player_id, item_id, map_id) SELECT $1, $2, $3 FROM generate_series(1, $4)', [playerId, item.id, mapId, n]);
      return { ok: true, count: inv.count, usesLeft: inv.count, nextAt: null };
    }
    if (!(await c.query('SELECT 1 FROM player_items WHERE player_id = $1 AND item_id = $2', [playerId, item.id])).rowCount) return { error: "You don't own this item" };
    const { rows } = await c.query(`SELECT used_at FROM item_uses WHERE player_id = $1 AND item_id = $2 AND used_at > now() - make_interval(mins => $3)
      ORDER BY used_at`, [playerId, item.id, item.perMinutes]);
    if (rows.length >= item.uses) return { error: 'No uses left yet', nextAt: rows[0].used_at.getTime() + item.perMinutes * 60000 };
    const refused = await apply(c);
    if (refused) throw Object.assign(new Error(refused), { refusal: true });
    await c.query('INSERT INTO item_uses (player_id, item_id, map_id) VALUES ($1, $2, $3)', [playerId, item.id, mapId]);
    const used = [...rows.map(r => r.used_at.getTime()), Date.now()];
    return { ok: true, usesLeft: item.uses - used.length, nextAt: used[0] + item.perMinutes * 60000 };
  }).catch(err => { if (err.refusal) return { error: err.message }; throw err; });

  const buying = new WeakSet();   // sockets with a purchase under way: one at a time

  // The list, with what this player owns and how many uses are left.
  api.socket('list', async (ctx, ...args) => {
    const reply = args.at(-1);
    if (typeof reply !== 'function') return;
    try {
      const list = (await itemsFor(ctx.me.pid)).map(i => ({ ...i, price: catalog.fromTenths(priceTenths(i, ctx.map)) }));
      reply({ list, balance: catalog.fromTenths(ctx.me.squares) });
    } catch { reply({ error: 'Could not load items. Try again.' }); }
  });

  // { item, qty }: a used-up item comes singly or in batches of up to 100.
  api.socket('buy', async ({ socket, me, map }, p, reply) => {
    if (typeof reply !== 'function') return;
    if (!me.pid) return reply({ error: 'Claim a block first' });
    const item = ITEMS.find(i => i.id === p?.item && i.enabled && i.effect in EFFECTS);
    if (!item) return reply({ error: 'That item is not for sale' });
    const qty = p.qty === undefined ? 1 : p.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > 100 || (qty > 1 && !item.consumable)) return reply({ error: 'Pick how many, 1 to 100' });
    if (buying.has(socket)) return reply({ error: 'One purchase at a time' });
    buying.add(socket);
    try {
      const r = await buy(me.pid, item, priceTenths(item, map), qty);
      if (r.error) return reply({ error: r.error, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) });
      api.money.changed(me.pid, r.squares);
      api.stats.bump(me.pid, 'squaresSpent', catalog.fromTenths(r.price));
      api.toPlayer(me.pid, 'items:changed');
      reply({ squares: catalog.fromTenths(r.squares), balance: catalog.fromTenths(r.squares), ...(r.count !== undefined ? { count: r.count } : {}) });
    } catch (err) {
      console.error(`ITEM PURCHASE FAILED (player ${me.pid}, ${p?.item}): ${err.message}`);
      reply({ error: 'Could not buy that. Try again.' });
    } finally { buying.delete(socket); }
  });

  // Uses an owned item: { item } for Super Click; { item, x, y, terrain } for the Terraformer; { item, blocks: [[x, y]] }
  // for Demolition (on this map). Answers { ok, usesLeft, nextAt } or { error }.
  api.socket('use', async ({ me, map: here }, p, reply) => {
    if (typeof reply !== 'function') return;
    if (!me.pid) return reply({ error: 'Claim a block first' });
    const item = ITEMS.find(i => i.id === p?.item);
    if (!item) return reply({ error: 'Unknown item' });
    const done = r => { if (r.ok) api.toPlayer(me.pid, 'items:changed'); reply(r); };
    try {
      if (item.effect === 'clickMultiplier') {
        const r = await use(me.pid, item, here.id);
        if (r.ok) {
          const until = Date.now() + item.seconds * 1000;
          api.modifiers.add(me.pid, 'clickPower', item.value, until);
          api.toPlayer(me.pid, 'items:superClick', { until, value: item.value });
        }
        return done(r);
      }
      // Demolition: everything built on each of your blocks goes, no refund. One per block with something on it;
      // blocks with nothing use none. All or nothing.
      if (item.effect === 'demolish') {
        const blocks = Array.isArray(p.blocks) && p.blocks.length <= 500 && p.blocks.every(b => Array.isArray(b) && Number.isInteger(b[0]) && Number.isInteger(b[1])) ? p.blocks : null;
        if (!blocks?.length) return reply({ error: 'Pick blocks of yours to clear' });
        await api.serial(here, async () => {
          const list = [...new Map(blocks.map(([x, y]) => [x + ',' + y, [x, y]])).values()];
          if (list.some(([x, y]) => api.blocks.owner(here, x, y) !== me.pid)) return reply({ error: 'Only your own blocks' });
          const built = list.filter(([x, y]) => api.blocks.builtOn(here, x, y));
          if (!built.length) return reply({ error: 'Nothing is built on those blocks' });
          const r = await use(me.pid, item, here.id, async c => { for (const [x, y] of built) await api.blocks.clear(c, here, x, y); }, built.length);
          if (r.ok) for (const [x, y] of built) api.blocks.cleared(here, x, y);
          done(r.ok ? { ...r, cleared: built.length } : r);
        });
        return;
      }
      if (item.effect === 'terraform') {
        const { x, y, terrain } = p;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !TERRAFORM_TO.includes(terrain)) return reply({ error: 'Pick a block and grass, sand, forest, stone or water' });
        await api.serial(here, async () => {
          const owner = api.blocks.owner(here, x, y);
          if (owner === undefined) return reply({ error: 'That is not a block' });
          const mine = owner === me.pid, nextToMine = owner === null && api.blocks.touches(here, x, y, me.pid);
          if (!mine && !nextToMine) return reply({ error: 'Only your own blocks, or empty ones touching your land' });
          if (api.blocks.terrainAt(here, x, y) === 'gold') return reply({ error: "Gold can't be changed" });
          if (api.blocks.terrainAt(here, x, y) === terrain) return reply({ error: `It's already ${terrain}` });
          const r = await use(me.pid, item, here.id, c => api.blocks.setTerrain(c, here, x, y, terrain));
          if (r.ok) api.blocks.terrainSet(here, x, y, terrain);
          done(r);
        });
        return;
      }
      reply({ error: 'Unknown item' });
    } catch (err) {
      console.error(`ITEM USE FAILED (player ${me.pid}, ${p?.item}): ${err.message}`);
      reply({ error: 'Could not use that. Try again.' });
    }
  });

  // Its saved data: gone with an account; gone in the economy reset.
  api.on('accountDeleted', async (c, playerId) => {
    for (const t of ['player_items', 'player_inventory', 'item_uses']) await c.query(`DELETE FROM ${t} WHERE player_id = $1`, [playerId]);
  });
  api.on('reset', async c => { for (const t of ['player_items', 'player_inventory', 'item_uses']) await c.query(`DELETE FROM ${t}`); });

  // Its Game Guide section.
  api.on('guide', ({ n, table }) => ({ id: 'items', title: text.name, html: `<h2 id="items">${text.name}</h2>`
    + table(['Item', 'What it does', 'Price at level 1', 'Formula'], ITEMS.filter(i => i.enabled).map(i => [i.name, i.description,
      n(catalog.fromTenths(catalog.priceTenths(i, { L: 1 })), 1), i.pricing === 'PV' ? `${n(i.P)} × ${n(i.V, 4)} × W(L)` : `${n(i.hours)} × W(L)`])) }));
};
