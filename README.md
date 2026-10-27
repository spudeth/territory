# Territory

A tiny multiplayer browser game. Everyone shares a map that starts at 32×32. Tap a block 3 times to take it. Your first block can be any empty block. After that you can only take blocks next to your territory, including blocks owned by other players. Every time an empty block is claimed, one new block appears somewhere on the map's edge, so maps keep growing.

## Run

The game stores everything in Neon Postgres. Locally it uses the `dev` branch; Render uses `production`.

```
npm install
neon checkout dev      # once: points .neon and .env.local at the dev branch
npm start
```

Open http://localhost:3030 on your computer. The server also prints a `http://192.168.x.x:3030` address. Open that on your phone (same Wi-Fi). If the phone can't connect, allow Node.js through the Windows firewall on private networks. To use a different port (e.g. if 3030 is taken), run `$env:PORT=3031; npm start` in PowerShell.

The server reads `DATABASE_URL` from the environment, or from `.env.local` / `.env` (never committed). It applies any new migrations at startup, and exits if the database can't be reached rather than run without it.

Each browser is a visitor until its first claim. Then it becomes a guest player with a secret token saved in localStorage. To play as a second player on the same computer, use a private window or a different browser.

Controls: tap or click to hit a block, drag to pan, pinch or mouse wheel to zoom.

## Scripts

- `npm test` runs the tests against the database in `.env.local`, each test file in its own throwaway schema. It refuses to run against `production`.
- `npm run backup` saves every table to `backups/<branch>-<time>.json`. `npm run backup -- --branch production` backs up another Neon branch through the signed-in Neon CLI.

## How the code is organized

- `server.js` starts everything: loads env, connects, migrates, listens.
- `app.js` is the game server. Express serves `public/`, Socket.IO handles players. Postgres is the source of truth. Each map is cached in memory once loaded, and the cache only changes after a database write commits. Claims and wipes on one map run one at a time. The server checks every hit (does the block exist, does it touch the player's territory or is it an empty first block, has the same player hit it 3 times in a row), then broadcasts `hit` (crack progress), `claim`, `grow` and `wipe` to everyone on the map. Crack progress lives in memory only. New guests per IP address are limited.
- `store.js` holds every query. A claim is one transaction: the block changes hands only if it still has the owner the server expected, and a first claim also grows the map and may earn a square.
- `db/index.js` has the connection pool, startup retries and the migration runner. `db/migrations/*.sql` run once each, in name order.
- `names.js` makes guest names and colors.
- `public/game.js` is the whole client, split into sections. *State* comes from the server: a list of blocks, since maps grow into any shape. *Camera* holds the pan/zoom numbers. *Rendering* redraws the canvas only when something changes, with image smoothing off so the pixel art stays sharp. *Input* uses pointer events to tell taps, drags and pinches apart; a touch that moves more than 10px is no longer a tap. *UI* covers the overlay and leaderboard (this map only, by blocks owned), and *Networking* has the socket handlers. `public/index.html` and `public/style.css` hold the overlay markup and styles. `public/tiles/` contains the three grass tiles used from Kenney's [Tiny Town](https://kenney.nl/assets/tiny-town) pack (CC0, license included).

## Database

| Table | What it stores |
| --- | --- |
| `players` | Guests and account holders: name (unique ignoring case, 15 characters max), squares balance, last map, VIP flag, account link |
| `player_tokens` | SHA-256 hashes of guests' secret tokens |
| `maps` | Each board: name, style, type (official, purchased, VIP) and creator |
| `map_cells` | One row per block that exists, with its owner (empty if none) |
| `player_map_settings` | A player's color, skin and coverage on one map, set on their first claim there, plus the wipe floor |
| `map_wipes` | Every wipe and how many blocks were cleared |
| `square_ledger` | Every change to a squares balance |
| `skins`, `player_skins` | The skin catalog and who owns which |

Wipe rule: after a wipe, a first claim on that map earns a square only if the player then owns more blocks there than the wipe floor. The floor is the most blocks they cleared in any wipe on that map, so wiping again never lowers it.

Each player has a secret token (kept in the browser) and a separate public ID (visible to everyone), so other players can't take over your account.
