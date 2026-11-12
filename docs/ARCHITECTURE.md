# Territory: core and plug-ins (Loop 19, Phase 0)

Status: **approved** by Bob and Xoren (2026-11-11), with Q39-Q47 as recommended. Progress: Phase 1 (baseline,
docs/PERF.md) and Phase 2 (the core host) are done; the plug-ins move in Phases 3-7.

**Art (Bob, Xoren approved):** Art density: 1 block = 16 px. Larger things use multiples (e.g. 16x32, 48x48). UI icons 16x16 (buttons/cards), 8x8 (inline). Whole-world detail upgrade, if ever, happens all at once. The renderer draws art of any size scaled to the block, crisp.

**Built in Phase 2:** `plugins.js` (the server host: reads each plugin.json, runs the hooks, starts each server.js
with the api, serves only its browser files and look/), `variables.js` (the core's four variables and each
plug-in's), `upgrades.js` (the upgrade engine, moved from catalog.js, keyed by variable), `public/plugins.js` (the
browser host: Plugins.add, the hooks, loading plug-in code after the first map draw), and the Build menu as a core
piece (`addBuildTool` in `public/build.js`; the factory parts went to `public/factories.js` until Phase 5). The sheet
sync reads the Walls and Factories tabs and the Upgrades tab's Variable column (Q39's names until the column exists).

## The goal in one paragraph

The core game runs alone: a map you tap to claim. Everything else (items, walls, factories, skins, achievements, and
whatever comes later) is a plug-in. A plug-in is one folder built from one template. It talks to the core only through
a short list of hooks and services, never to another plug-in. Deleting a plug-in folder leaves a working game. Adding one
needs no core edits. Players notice nothing except speed. The one exception is item 5 (repair also fixes walls).

## 1. What the core is

| Part | Today | Stays core |
|---|---|---|
| Map, terrain, growth, levels, hardness, pay | `app.js`, `rules.js`, `catalog.js`, `public/terrain.js`, `public/game.js` | yes |
| Tapping, cracks and fading, claiming, repair of blocks | `app.js` (hit handler), `public/game.js` | yes |
| Accounts, guests, names, lives, death and respawn | `auth.js`, `names.js`, `store.js`, `public/account.js` | yes |
| Chat, leaderboard, online dots, profile basics | `chat.js`, `app.js`, `public/chat.js`, `public/profile.js` | yes |
| Land market (players set prices) | `app.js`, `store.js`, `public/land.js` | yes |
| Stats counting (taps, claims, …) | `totals.js`, `stats.js` | yes (achievements and the profile read them) |
| Upgrade engine (steps, tiers, curves, block-level cap) | `catalog.js` | yes, as `upgrades.js` |
| Tutorial, coach tips, welcome screen, menu, settings, sound engine | `public/*.js` | yes |
| Admin tools, economy reset, sync from the sheet | `admin.js`, `scripts/`, `economy.js` | yes (each plug-in adds its own part) |

**Zero plug-ins** means: tap to claim, cracks, levels, pay in squares, growth, terrain, the land market, chat and the
leaderboard all work. There is no Build button, no item bar, no skins (plain colour only), no Awards tile. A test will
start the game with no plug-ins and play a full claim-and-take round.

### Core variables

A **variable** is a named number the game reads whenever it needs it. Each one has a base value. Upgrades, and items
for a while, change what a player gets.

| Variable | Base | Read when |
|---|---|---|
| `clickPower` | 1 | you hit or repair a block or wall (hits per tap) |
| `earnings` | 1 | you mine a brand-new block (pay multiplier) |
| `defense` | 1 | someone attacks your block (hits needed multiplier) |
| `growth` | 1 | you mine a brand-new block (new map blocks) |

A plug-in declares its own variables the same way. Factories, for example, declare `factories.speed` (0.05),
`factories.lifetime` (4) and `factories.yield` (1).

**How a value is worked out:** base, then upgrade steps (capped at the end of tier L on a level-L block, as now), then
any active modifier. For example, Super Click is `clickPower × 10` for 5 seconds. One function does this for every
variable: `value(player, name, blockLevel)`.

## 2. Upgrades (modifiers, not items)

- One upgrade engine in the core (`upgrades.js`, today's step math from `catalog.js`) reads the Upgrades tab.
- An upgrade changes exactly one variable. **Adding an upgrade = one sheet row + the variable's name**, with no code.
  The Upgrades tab gets a **Variable** column (Q39); the Key stays as the name players' bought steps are saved under, so
  nobody's steps change.
- No Enabled column. An upgrade shows only when its variable exists: if the factories plug-in is removed, the three
  factory upgrades disappear from the Upgrades screen. Their rows stay on the sheet, the sync warns, and bought steps
  stay saved.
- Today the list of allowed upgrades is hard-coded (`TIER_KEYS` in `economy.js`). It goes; the check becomes "is this
  variable declared by the core or a loaded plug-in".

## 3. Plug-ins

### The template (every plug-in has these)

```
plugins/<name>/
  plugin.json     name, load order, its sheet tabs, its client files; nothing else
  data.js         reads and checks its sheet tab(s) -> data.json (written by npm run sync-rules)
  data.json       its numbers and rows, synced from the sheet (Items keep their Enabled column)
  server.js       behaviour on the server: module.exports = api => { api.on(...); ... }
  client.js       behaviour in the browser: Plugins.add('<name>', { ...hooks })
  look/           pixel-art PNGs at 16 px per block (multiples for bigger things; icons 16x16 or 8x8),
                  transparent, drawn crisp at any zoom; animations are sprite sheets, and its sounds
  text.js         name, description, info-card texts, "i" popup texts, its Game Guide section
  test/           its own tests (run with the full suite)
  README.md       a few lines: what it does and which hooks it uses
```

### Hooks (what a plug-in can plug into)

**Server**

| Hook | Called when | Used by |
|---|---|---|
| `variables` | at start | factories (speed, lifetime, yield) |
| `welcome(map, viewer)` | someone opens a map: returns this plug-in's part of the welcome | walls, factories, skins |
| `socket(event, handler)` | registers its own events, named `<plug-in>:<event>` | all |
| `hitRefusal(map, pid, x, y)` | before a hit counts: a reason to refuse, or nothing | walls ("Your wall is in the way") |
| `beforeHit(map, pid, x, y)` | before a hit lands: may take the hit instead | walls (the wall is hit first) |
| `ownTap(map, pid, x, y)` | a tap on your own block with no block crack | walls (item 5: repair the most cracked wall) |
| `claimed(map, x, y, from, to)` | a block changes owner or is freed | walls and factories (gone when taken) |
| `transferred(map, blocks, from, to)` | land is sold | factories and walls (go with the land) |
| `tick(map, from, until)`, `live(map, now)` | the 60-second tick; every second on watched maps | factories |
| `blockInfo(map, x, y, viewer)` | the info card asks: returns its section's data | walls, factories |
| `build(kind)` + `buildReason` | Build menu actions on the server | walls, factories |
| `built` provider `{ has, remove, removed }` | anything that sits on a block registers one | walls, factories |
| `stat(pid, name, value)` | a counted stat changes | achievements |
| `wiped`, `reset` | a player wipes their land; the admin economy reset | all with saved data |
| `guide(data)` | the Game Guide is built | all |

**Browser**

| Hook | What it does | Used by |
|---|---|---|
| `welcome(data)` | gets its part of the welcome | all |
| `drawUnder(ctx, view)` / `drawOver(ctx, view)` | draws before or after the territory borders | factories / walls, picking |
| `look(owner)` | how a territory is painted (default: plain colour) | skins |
| `tap(block, x, y)` | takes a map tap while a tool is on (returns true) | build tools, item picking |
| `infoCard(info)` | adds a section to the info card | walls, factories |
| `buildMenu()` | its entries in the Build menu (the button shows only if some plug-in has one) | walls, factories |
| `market()` | a Marketplace tab | items, skins |
| `screen()`, `tile()` | a menu screen, a welcome-screen tile | achievements (Awards) |
| `setup()` | choices on the setup screen | skins (skin and coverage) |
| `info`, `sounds` | "i" texts and sounds it adds | all |

### Core services (what a plug-in may call)

Read a block (owner, level, terrain), set terrain, claim a block for a player (factories mine this way), spend and pay
squares in one transaction, add a modifier to a variable, clear what's built on a block (Demolition uses this, so the
items plug-in never touches walls or factories), bump a stat, send to a map's room or to a player, and the database (its
own tables).

**No plug-in reaches into another.** The two places that do today go through the core:
- Demolition clears what's built: it asks the core to clear a block, and the core asks each registered `built` provider.
- The land market moves factories and walls: it calls the `transferred` hook.

### What moves where

| Plug-in (order) | Server code from | Browser code from | Sheet tab | Database (stays where it is, Q42) |
|---|---|---|---|---|
| **items** | `app.js` items handlers, `store.js` items | `public/items.js`, item bar | Items | `player_items`, `player_inventory`, `item_uses` |
| **walls** | `app.js` walls, `rules.js` wall rules, `store.js` walls | `public/walls.js` | (Economy rows: `wallStrength`, `wallPriceWh`, `maxWallsPerBlock`) | `map_cells.walls` |
| **factories** | `factories.js`, `app.js` factories, `store.js` factories | factory parts of `public/build.js` | (Economy rows: `factory…`) | `factories`, `map_cells.factory_id` |
| **skins** | `app.js` skins and stars, `store.js` skins | skin drawing in `public/game.js`, Skins tab and picker in `public/menu.js`, `public/skins.js` | Skins, Skin Rarity | `skins`, `player_skins`, star columns |
| **achievements** | `achievements.js`, secret checks in `app.js`, `store.js` achievements | Awards screen in `public/menu.js` | Achievements | `player_achievements` |

The Build button and its bar move into a small shared core piece (`build` hooks), because walls and factories both use
them and neither may own them. Plug-in Economy rows move to each plug-in's own data (Q43). Art moves into each
plug-in's `look/` folder as PNG placeholders (16 px per block): factory, factory asleep, wall (Q41), Demolition, Build icon. The 896
skin images move as they are.

### Loading and removing

- The server loads every folder in `plugins/` in `plugin.json` order and gives each the `api`. A folder that's gone is
  simply not loaded.
- The page loads the core first. Then it fetches each plug-in's `client.js` (the server lists the loaded ones),
  **after the map is on screen** (Q44). Plug-in art and sounds load the first time they're drawn or played.
- The sheet sync asks each loaded plug-in for its tabs. A tab no plug-in claims is skipped with a warning.
- A removed plug-in's database rows stay untouched. If it's added back, everything is still there.
- New plug-in tables go in `plugins/<name>/migrations/`, applied after the core's.

## 4. Optimization

### Measuring plan (Phase 1, before any change; again at the end)

All on Xoren's PC against the **dev** database, in one session of about 15 minutes, to spare Neon hours.

| What | How | Numbers logged |
|---|---|---|
| Page load on a phone | Chrome via puppeteer, iPhone 15 size, "Slow 4G" and 4x slower CPU, empty cache, then warm cache | bytes and requests by type; time to first map drawn; JS memory |
| Welcome size | the same, for maps of 400, 10,000 and 50,000 blocks (E) | bytes of the welcome message |
| Server memory and CPU | the game started inside a measuring script; 10 bot players tapping 4 times a second for 2 minutes, with 1 factory | memory (RSS, heap), CPU % per second |
| Database | the measuring script counts every query the game makes (it wraps the pool; no game code changes) | queries per minute idle, per minute under load, per tap |
| Socket.IO | counts every packet sent and received, and bytes | messages and bytes per second, per player |
| Free-tier headroom | the numbers above against Render free (512 MB, 0.1 CPU, sleeps after 15 min idle) and Neon free (100 compute hours a month, shared; suspends after 5 min idle) | % used, and hours a month the database stays awake |
| Screenshots | the loop 17/18 set (map, Build menu, Marketplace, Upgrades, walls, factory, Demolition) on iPhone SE, iPhone 15 and desktop | kept to compare pixel by pixel at the end |

Results go in `docs/PERF.md` (a before/after table) and a short line in CODY-LOG.md.

### First look (from the files, no measuring yet)

These are guesses for Phase 1 to confirm or rule out:
1. **The database never sleeps while the server runs.** The tick writes `server_ticks` and asks for factories every 60
   seconds, even when nothing is due, so Neon can't suspend. It could skip the database when nothing timed is due.
   This is probably the biggest saving in Neon hours.
2. **The welcome sends every block as JSON** (`[x, y, owner, level]`). A 50,000-block map is likely over 1 MB, and the
   default E (431,649) would be about 6 MB. Sending only what the client can't work out itself (owners, levels and shape,
   packed) should cut it to a small fraction.
3. **No compression and no caching for files.** Every file is sent uncompressed with `Cache-Control: no-cache` (about
   310 KB of code, plus art). Fix: gzip, and long caching for files that never change (skins, music, art, tiles).
4. **One message per tap to everyone on the map.** Hits could be gathered and sent about 10 times a second, and crack
   fading could be sent less often.
5. **Every plug-in's code loads before the map shows.** Lazy loading (above) fixes that.

Already fine: drawing is batched to the screen's refresh, stats are saved in batches every 15 seconds, and music loads
only on the first tap.

## 5. Work plan after approval

Each phase: full test suite green, commit, push, one log line.

| Phase | Work |
|---|---|
| 1 | Baseline measurements (scratch scripts only) and baseline screenshots |
| 2 | Core host: plug-in loader (server and browser), hooks, variables, the upgrade engine with the Variable column, the build bar as core. Test: the game with zero plug-ins |
| 3 | items |
| 4 | walls, plus item 5 (repair: block first, then the most cracked wall) |
| 5 | factories |
| 6 | skins |
| 7 | achievements |
| 8 | Optimizations from Phase 1's findings, each measured |
| 9 | Measure again, compare screenshots, write the before/after table and the merge steps for Xoren |

## 6. Questions for Bob (each with Cody's recommendation)

- **Q39 Upgrades → variable.** Add a **Variable** column to the Upgrades tab (e.g. `clickPower`, `factories.speed`) and
  keep Key as the name bought steps are saved under. *Recommend: yes.* The alternative is Key = variable name, but then
  the factory keys must be renamed, which means moving players' saved steps.
- **Q40 Base values.** Whoever owns a variable sets its base (the core for the four core ones, a plug-in for its own),
  and the sync checks that the upgrade's Tier 1 start equals it. *Recommend: yes.* That way the core works even with an
  empty Upgrades tab.
- **Q41 Wall art (stays 16x4, Bob 2026-11-11).** A wall is drawn along a block's side, not as a square. *Recommend:* `wall.png` is 64x64 with
  the wall in its top 16 rows (transparent below), stretched along the side as now. The existing skins (16x16) move as
  they are; new art is 16 px per block.
- **Q42 Database.** Plug-in data already in core tables (`map_cells.walls`, `map_cells.factory_id`, star columns on
  `players`) stays where it is: no data moves, so players see nothing. New plug-in tables go in the plug-in's own
  migrations. *Recommend: yes; moving those columns can be a later loop.*
- **Q43 One data file per plug-in.** The sync writes each plug-in's tab, and its Economy rows (walls, factories), to
  `plugins/<name>/data.json`. That means moving those Economy rows to a Walls tab and a Factories tab on the sheet.
  *Recommend: yes, new tabs.* Until they exist, the sync reads those rows from the Economy tab.
- **Q44 Lazy loading.** Plug-ins load right after the map is drawn, so the Build button and item bar may appear a moment
  later than the map. *Recommend: accept.* If it's noticeable, they load alongside the map instead, still without
  holding it up.
- **Q45 Skins as a plug-in.** Without it the setup screen offers a colour only, and there's no Skins tab. *Recommend: yes.*
- **Q46 Achievements.** Stats counting stays core (the profile uses it). The plug-in only reads stats and awards. The
  secret checks (Castaway, Witching Hour, …) move into it through hooks. *Recommend: yes.*
- **Q47 Removing a plug-in.** Its upgrades and screens vanish, its rows on the sheet are skipped with a warning, and its
  saved data stays untouched. *Recommend: yes.*
- **For Xoren (no rush):** production numbers Cody can't see. From Neon's dashboard: compute hours used this month and
  database size. From Render's: memory and CPU graphs for a busy day. They go in the headroom line.
