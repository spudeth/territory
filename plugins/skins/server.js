// Skins, on the server (loop 15; a plug-in since loop 19). The Skins tab's catalog (data.json): patterns drawn in the
// owner's color, art drawn as it is; bought with squares (the rarity's work-hours x W(L), flags are Rare), kept on
// every map. A player picks one, and its coverage, on the setup screen before their first claim on a map; it locks
// there with their color. One pattern and one Rare-or-better art skin can be starred (shown on their profile).
// Its data: the skins and player_skins tables, and the star columns on players (core tables: Q42); the look a
// player picked is in player_map_settings (core). Without this plug-in everyone has the plain look.
// Events taken: skins:list, skins:buy { skin }, skins:star { skin, on }.
const text = require('./text');

module.exports = api => {
  const { pool, catalog } = api;
  const D = api.plugin.data;   // { skins: [{ id, name, kind, rarity, price, collection, enabled }], skinRarity: { rarity: hours } }
  const SKINS = D.skins ?? [];
  // A skin's price in tenths: its rarity's hours x W(L). Flags are Rare.
  const hours = rarity => D.skinRarity?.[rarity] ?? 0;
  const priceTenths = (skin, L) => catalog.toTenths(hours(skin.id?.startsWith('flag-') ? 'Rare' : skin.rarity) * catalog.W(L));

  // The skin catalog (data.json, from the Skins tab) with what this player owns: [{ id, name, kind, rarity, price,
  // collection, owned }], the free plain look first. Skins taken out of the shop still show for their owners.
  // Prices are in squares at map level L: the rarity's work-hours x W(L) (flags are Rare).
  // Which star slot a skin goes in: a Common pattern, or art that is Rare or better (flags too); null for others.
  const starSlot = s => (s.kind === 'pattern' && s.rarity === 'Common' ? 'star_pattern' : s.kind === 'art' && s.rarity !== 'Common' ? 'star_art' : null);
  // Stars one owned skin in its slot (replacing the old one), or clears that slot when `on` is false.
  async function starSkin(playerId, skin, on) {
    const slot = starSlot(skin);
    if (!slot) return { error: 'Only patterns and Rare or better art skins can be starred' };
    if (on && !(await pool.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [playerId, skin.id])).rowCount) return { error: "You don't own that skin" };
    await pool.query(`UPDATE players SET ${slot} = CASE WHEN $3 THEN $2 END WHERE id = $1 AND ($3 OR ${slot} = $2)`, [playerId, skin.id, on]);
    return { ok: true };
  }
  async function skinsFor(playerId, L = 1) {
    const stars = playerId ? (await pool.query('SELECT star_pattern, star_art FROM players WHERE id = $1', [playerId])).rows[0] ?? {} : {};
    const owned = new Set(playerId ? (await pool.query('SELECT skin_id FROM player_skins WHERE player_id = $1', [playerId])).rows.map(r => r.skin_id) : []);
    return [{ id: 'default', name: 'Default', kind: 'default', rarity: 'Common', price: 0, collection: 'Basic', owned: true },
      ...SKINS.filter(s => s.enabled || owned.has(s.id)).map(({ enabled, price: sheetPrice, ...s }) => ({ ...s, price: catalog.fromTenths(priceTenths(s, L)), owned: owned.has(s.id),
        starrable: !!starSlot(s), starred: owned.has(s.id) && (stars.star_pattern === s.id || stars.star_art === s.id) }))
        // Bob (loop 15): flags after every other skin, and within each group by price, then name.
        .sort((a, b) => (a.collection === 'Flags') - (b.collection === 'Flags') || a.price - b.price || a.name.localeCompare(b.name))];
  }

  // Buys a skin with squares, in one transaction: the player row is locked, so a double tap or two devices can
  // never pay twice. skin: a catalog entry { id, name }; price: tenths (priceTenths at the map's level).
  // Returns { squares, price } (tenths), or { error } with `need` (tenths short) when there aren't enough.
  function buySkin(playerId, skin, price) {
    return api.tx(async c => {
      const { rows: [p] } = await c.query('SELECT squares FROM players WHERE id = $1 FOR UPDATE', [playerId]);
      if (!p) return { error: 'Claim a block first' };
      if ((await c.query('SELECT 1 FROM player_skins WHERE player_id = $1 AND skin_id = $2', [playerId, skin.id])).rowCount) return { error: 'You already own this skin' };
      await c.query(`INSERT INTO skins (id, name, image, price_squares) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_squares = EXCLUDED.price_squares`, [skin.id, skin.name, skin.id + '.png', Math.max(1, catalog.wholeSquares(price))]);
      const paid = await api.spend(c, playerId, price, 'skin:' + skin.id);
      if (paid.error) return paid;
      await c.query("INSERT INTO player_skins (player_id, skin_id, source) VALUES ($1, $2, 'squares')", [playerId, skin.id]);
      return { squares: paid.squares, price };
    });
  }


  // How each skin is drawn, for the browser: its kind, and which are animated (Legendary: <id>-anim.png).
  api.on('welcome', () => ({ kinds: Object.fromEntries(SKINS.map(s => [s.id, s.kind])), animated: SKINS.filter(s => s.rarity === 'Legendary').map(s => s.id) }));
  // The setup screen: a skin may be picked only if the player owns it (the plain look is everyone's).
  api.on('skinRefusal', (pid, id) => skinsFor(pid).then(list => (list.some(s => s.id === id && s.owned) ? null : "You don't own that skin"),
    () => 'Could not check your skins. Try again.'));
  // The profile: their starred pattern and art skin.
  api.on('profile', p => ({ stars: { pattern: p.star_pattern, art: p.star_art } }));

  // The catalog for the Skins tab and the setup screen: [{ id, name, kind, rarity, price, collection, owned, … }].
  api.socket('list', async ({ me, map }, ...args) => {
    const reply = args.at(-1);   // with or without an argument before it
    if (typeof reply !== 'function') return;
    try { reply(await skinsFor(me.pid, map.level())); } catch { reply([]); }
  });
  // Stars an owned skin ({ skin, on }): one pattern and one Rare-or-better art skin per player.
  api.socket('star', async ({ me }, p, reply) => {
    if (typeof reply !== 'function') return;
    if (!me.pid) return reply({ error: 'Claim a block first' });
    const skin = SKINS.find(s => s.id === p?.skin);
    if (!skin) return reply({ error: 'Unknown skin' });
    try { reply(await starSkin(me.pid, skin, !!p.on)); } catch { reply({ error: 'Could not save that. Try again.' }); }
  });
  // Buys a skin with squares: { skin: id }. Answers { squares, balance } or { error, need }. Owned skins work on
  // every map; a guest's carry over when they make an account (it's the same player).
  const buying = new WeakSet();   // sockets with a purchase under way: one at a time
  api.socket('buy', async ({ socket, me, map }, p, reply) => {
    if (typeof reply !== 'function') return;
    if (!me.pid) return reply({ error: 'Claim a block first' });
    const skin = SKINS.find(s => s.id === p?.skin && s.enabled);
    if (!skin) return reply({ error: 'That skin is not for sale' });
    if (buying.has(socket)) return reply({ error: 'One purchase at a time' });
    buying.add(socket);
    try {
      const r = await buySkin(me.pid, skin, priceTenths(skin, map.level()));
      if (r.error) return reply({ ...r, ...(r.need !== undefined ? { need: catalog.fromTenths(r.need) } : {}) });
      api.money.changed(me.pid, r.squares);
      api.stats.bump(me.pid, 'squaresSpent', catalog.fromTenths(r.price));
      reply({ squares: catalog.fromTenths(r.squares), balance: catalog.fromTenths(r.squares) });
    } catch (err) {
      console.error(`SKIN PURCHASE FAILED (player ${me.pid}, ${p?.skin}): ${err.message}`);
      reply({ error: 'Could not buy that. Try again.' });
    } finally { buying.delete(socket); }
  });

  // ---------- The Game Guide ----------
  api.on('guide', ({ n, table, esc }) => {
    const rarities = Object.entries(D.skinRarity ?? {});
    return { id: 'skins', title: text.name, html: `<h2 id="skins">${text.name}</h2>
    <p>A skin costs its rarity's work-hours × W(L). Flags are Rare.</p>`
    + table(['Rarity', 'Work-hours', 'Price at level 1'], rarities.map(([r, h]) => [r, n(h, 4), n(catalog.fromTenths(catalog.toTenths(h * catalog.W(1))), 1)]))
    + rarities.map(([r]) => {
      const list = SKINS.filter(s => s.enabled && (s.id.startsWith('flag-') ? 'Rare' : s.rarity) === r);
      return list.length ? `<h3>${esc(r)} (${list.length})</h3><div class="gallery">${list.map(s =>
        `<figure><img src="art/skins/${esc(s.id)}.png" alt="" width="40" height="40" loading="lazy"><figcaption>${esc(s.name)}</figcaption></figure>`).join('')}</div>` : '';
    }).join('') };
  });
};
