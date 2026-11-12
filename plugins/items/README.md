# Items (plug-in)

Super Click, the Terraformer and Demolition: bought in the Marketplace's Items tab, used from the item bar. Numbers and
texts come from the sheet's Items tab (`data.json`, with its Enabled column) and `text.js`.

- **Server** (`server.js`): events `items:list`, `items:buy`, `items:use`; its tables `player_items`,
  `player_inventory`, `item_uses`. Core services used: transactions and `spend`, `money.changed`, `stats.bump`,
  `toPlayer`, `serial`, `modifiers.add` (Super Click multiplies `clickPower`), `blocks` (owner, terrain, `builtOn`,
  `clear`/`cleared` for Demolition, `setTerrain`/`terrainSet` for the Terraformer). Hooks: `accountDeleted`, `reset`,
  `guide`.
- **Browser** (`client.js`, `style.css`, `text.js`): the item bar and picker, the Items tab (`addMarketTab`). Hooks:
  `welcome`, `tap`, `drawOver` (blocks picked for Demolition); it asks every plug-in's `built` hook what's on a block.
- **Look** (`look/`): `demolition.png` (64x64 placeholder).
- **Tests** (`test/`): buying, using, limits, batches; the Items tab's checks.

Remove this folder and the game runs without items: no item bar, no Items tab, Super Click gone; nobody's saved items
are touched.
