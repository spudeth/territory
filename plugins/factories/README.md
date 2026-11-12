# Factories (plug-in)

Factories mine for their owner: Build → Factory on your own land, and it takes the closest empty block touching your
land, on its own, while awake (Factory Lifetime hours after waking), paying Factory Yield per block. One per
`factoryBlocksPerFactory` blocks owned; the newest pause when land shrinks. Numbers from the sheet's Factories tab
(`data.json`); its variables `factories.speed`, `factories.lifetime`, `factories.yield` (plugin.json, so their
upgrades show only with this plug-in); words in `text.js`.

- **Server** (`server.js`, `rules.js`): its data is the `factories` table and `map_cells.factory_id` (core tables,
  Q42), kept on the map as `map.factories`. Hooks: `mapLoaded` (loads its rows), `welcome`, `ownerChanged` (gone when
  the block is taken or freed), `transferred` (goes with sold land), `blockInfo`, `buildInfo`, `live` (every second
  on watched maps, so each hit shows), `guide`. Services: `builders.add('factory')`, `built.add('factory')`
  (Demolition), `ticker.on` (catch-up and save), `blocks.claim` (a first claim for the owner), `blocks.levelAt`,
  `blocks.listed`, `values`, `cracks.share`, `getMap`, `tx`, `spend`, `money`, `stats`, `toMap`, `serial`.
  Sends `factories:changed`; takes `factories:wake`.
- **Browser** (`client.js`, `text.js`): the Factory build tool, the factories on the map (`drawUnder`), the info card
  section with Wake up (`infoCard`), `built`, and the "i" texts for Factories and its three upgrades.
- **Look** (`look/factory.png`, `look/factory-asleep.png`): 16x16 placeholders (16 px per block).
- **Tests** (`test/`): the rules, the Factories tab and the price, the guide section, building, mining on the tick,
  catch-up, lifetime and waking, taken and Demolition, live hits.

Remove this folder and the game runs without factories (and without their three upgrades); factories already saved
stay in the database untouched.
