# Walls (plug-in)

Walls on the outer sides of your blocks: attackers who can only reach a block through walls break a wall first, and
nobody claims across their own wall. Built in batches (Build → Wall), priced by block level and by how many you own;
repaired by tapping your own block (its most cracked wall, when the block itself has no crack). Numbers from the
sheet's Walls tab (`data.json`); words in `text.js`.

- **Server** (`server.js`, `rules.js`): its data is the `map_cells.walls` column (a core table, Q42), kept on the map
  as `map.walls`. Hooks: `mapLoaded`, `welcome`, `ownerChanged`, `blocked` (nothing crosses a wall, factories
  included), `hitRefusal`, `beforeHit` (the wall is hit first), `ownTap` (repair), `blockInfo`, `buildInfo`, `guide`.
  Services: `builders.add('wall')`, `built.add('walls')` (Demolition), `cracks.hit`/`cracks.repair`, `blocks`, `tx`,
  `spend`, `money`, `stats`, `toMap`, `serial`. Sends `walls:changed`.
- **Browser** (`client.js`, `text.js`): the Wall build tool with its half-strength preview, the walls and their
  shadows (`drawOver`), wall cracks (`sideHit`), the info card section, `built` and `damaged`.
- **Look** (`look/wall.png`): 16x16 placeholder, the wall in its top 4 rows (16x4 art per Q41), stretched along a side.
- **Tests** (`test/`): the rules, the Walls tab and the price, building, breaking, batches, repair.

Remove this folder and the game runs without walls; walls already saved stay in the database untouched.
