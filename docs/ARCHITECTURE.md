# Territory: the core and its plug-ins

The **core** is the game on its own: a map you tap to claim, cracks, levels, pay in squares, growth, terrain, accounts,
chat, the leaderboard, the land market and the upgrade engine. Everything else is a **plug-in** in `plugins/<name>/`:
walls, factories, items, skins and achievements. A plug-in talks to the core only through the hooks and services
below, never to another plug-in. Without any plug-ins the game still plays (a test checks this).

## Where things live

| Folder | What |
|---|---|
| `server/` | the server: `server.js` starts it, `app.js` is the game (sockets, maps, hits, claims), `store.js` the database, `rules.js` / `catalog.js` / `upgrades.js` the rules and numbers, `plugins.js` the plug-in host, `guide.js` the Game Guide |
| `client/` | the browser code: `index.html`, `game.js` (drawing and input), `menu.js`, `plugins.js` (the browser's plug-in host), … |
| `art/` | everything players see or hear: `icons/`, `tiles/`, `music/`, `styles/`, `skins/`, and each plug-in's art (`walls/`, `factories/`, `items/`). Served at `/art/`. Replace a file with the same name to change it. |
| `plugins/` | one folder per plug-in (below) |
| `data/` | `economy.json`: the core's numbers, copied from the Google Sheet by `npm run sync-rules` |
| `db/migrations/` | the database, one numbered SQL file per change, applied at start |
| `scripts/` | admin, backup, create-map, sync-rules |
| `tests/` | the core's tests (each plug-in has its own `test/`) |

## Variables and upgrades

A **variable** is a named number with a base value: the core declares `clickPower`, `earnings`, `defense`, `growth`;
a plug-in declares its own in `plugin.json` (factories: `factories.speed`, `.lifetime`, `.yield`). An upgrade (a row
on the sheet's Upgrades tab) changes one variable, and shows only when that variable exists. A value is worked out as
base, then the player's upgrade steps (capped at the end of tier L on a level-L block), then any running modifier
(Super Click: `clickPower` × 10 for 5 seconds). `server/variables.js`, `server/upgrades.js`.

## A plug-in

```
plugins/<name>/
  plugin.json   { order, tabs: [its sheet tabs], client: [browser files], art: "art/<name>", variables: { name: base } }
  server.js     module.exports = api => { api.on('<hook>', fn); api.socket('<event>', fn); … }
  client.js     Plugins.add('<name>', { <browser hooks> })
  text.js       its words (names, "i" texts), for the browser and the server
  data.js       reads and checks its sheet tab(s) into data.json (npm run sync-rules)
  data.json     its numbers, from the sheet
  test/         its tests (run with the full suite)
  README.md     what it does and which hooks it uses
```

Its art is in `art/<name>/` (named by `"art"` in `plugin.json`). A `client` entry starting with `/` is a site address
as it is (the items plug-in's stylesheet, `/art/styles/items.css`). Its socket events are named `<name>:<event>`.
Plug-in tables stay in the core's database (no data moved when they became plug-ins).

### Server hooks (`api.on`)

| Hook | When |
|---|---|
| `mapLoaded(map, rows)` | a map is loaded (may be async: factories load their rows) |
| `welcome(map, pid)` | someone opens a map: its part of the welcome |
| `blocked(map, x, y, side)`, `hitRefusal`, `beforeHit`, `ownTap` | hits: walls block, refuse, take the hit first, repair |
| `ownerChanged(map, key, from, to)`, `transferred(map, blocks, from, to)` | a block changes hands; land is sold |
| `claimed`, `poke`, `wiped`, `chat`, `balance`, `stat`, `connected`, `progressReset` | what players do (achievements and their secrets) |
| `live(map, now)` | every second on maps someone is watching (factories) |
| `blockInfo`, `buildInfo`, `profile`, `guide` | its part of the info card, Build menu, profile, Game Guide |
| `skinRefusal(pid, skin)` | the setup screen: may this skin be picked |
| `accountDeleted`, `reset` | admin: an account deleted; the economy reset |

### Core services (the `api`)

`tx` and `spend` (a database transaction; spend squares in it), `serial(map, fn)` (one change at a time per map),
`money.changed`, `stats.bump/best/values/changed`, `toPlayer`, `toMap`, `builders.add` (a Build tool), `built.add`
(something on a block that Demolition can clear), `cracks.hit/repair/share/show`, `values(map, pid, L)` (variable
values), `modifiers.add/factor`, `blocks.*` (owner, terrain, level, claim, clear, listed, set terrain), `getMap`,
`ticker.on/wake` (the catch-up tick; return `'idle'` when there's nothing to do so the database can rest), and `pool`,
`store`, `catalog`, `rules`, `upgrades`, `variables`, `options`.

### Browser hooks (`Plugins.add`)

`welcome(part)`, `drawUnder` / `drawOver(ctx, view)`, `tap(block)`, `infoCard(info)`, `built(key)`, `damaged(key)`,
`sideHit`, `look(player)` (how a territory is drawn), `setupOpen` / `setup` (setup-screen choices), `profile(player)`,
`stat`. Helpers: `addBuildTool`, `BUILD_KINDS`, `addMarketTab`, `addScreen`, `INFO` (the "i" texts).

## Loading

The server loads every folder in `plugins/` in `order` (walls 10, factories 20, items 30, skins 40, achievements 50).
The browser loads each plug-in's files right after the map is first drawn, so plug-ins never hold the map up. Code is
served by fingerprint (`game.js?v=<hash>`, kept a year); the page is always checked; art is kept an hour
(`server/assets.js`). The sheet sync runs each plug-in's `data.js` on its own tabs; a tab no plug-in reads is skipped.
