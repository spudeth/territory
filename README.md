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

The server reads its settings from the environment, or from `.env.local` / `.env` (never committed). It applies any new migrations at startup, and exits if the database can't be reached rather than run without it.

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The Neon branch's Postgres address. Written to `.env.local` by `neon checkout`. |
| `NEON_AUTH_BASE_URL` | The branch's Auth address. Written to `.env.local` by `neon deploy` / `neon env pull`. Without it, accounts are off and everyone plays as a guest. |
| `NEON_AUTH_COOKIE_SECRET` | 32+ random characters, used to sign the login cache cookie. Not from Neon: generate one (Render's **Generate** button, or `openssl rand -base64 32`). |
| `PUBLIC_URL` | The site's address, `https://territory.sarl`. Requests for any other host (www, the onrender.com address) are redirected there. Leave unset locally. |

Each browser is a visitor until its first claim. Then it becomes a guest player with a secret token saved in localStorage. To play as a second player on the same computer, use a private window or a different browser.

## Accounts

Logins use Neon's managed Better Auth, enabled on both branches. The browser calls `/api/auth/*` on our own site and `auth.js` passes each request on to Neon with Neon's server toolkit (`@neondatabase/auth/server`), so the login cookie belongs to our domain. When the game connection starts, the browser fetches a 15-minute login token from `/api/auth/token` and sends it; the server checks it against Neon's public keys.

- Email and password, with a 6-digit code to verify the email. Password reset is by emailed link, which comes back to `/?reset=1&token=…`.
- Google sign-in returns to `/?neon_auth_session_verifier=…`, which `auth.js` swaps for the login cookie.
- The first time an account plays it gets a player named "NewUser" and a number, unless the browser has just signed up from its own guest profile: then the guest becomes the account, keeping its blocks, squares, settings and name, and the guest token is deleted. An account that already has a player never takes anything over, so logging in never merges.
- Only accounts can rename (Menu → Settings): 15 characters, plain letters and numbers, unique ignoring case, through the filter in `profanity.js`, once every 10 minutes.
- Emails go through Resend, set up as Neon's custom SMTP provider on each branch (the key lives in Neon, not here). Google uses our own OAuth client on production.

## Game settings

`rules.js` holds the numbers that are easy to change: taps to take a block, crack fade time (60 seconds per level), squares per first claim, the guest limit and the rename wait. Click power, defense and earnings upgrades will later change `hitsToTake` and `squaresForFirstClaim` there, which already receive the players involved.

Controls: tap or click to hit a block, drag to pan, pinch or mouse wheel to zoom.

## Scripts

- `npm test` runs the tests against the database in `.env.local`, each test file in its own throwaway schema. It refuses to run against `production`. The account tests use the dev branch's real Neon Auth with `@example.com` users, which they delete afterwards. Neon limits login requests per address, so those tests sometimes pause to wait it out.
- `npm run backup` saves every table to `backups/<branch>-<time>.json`. `npm run backup -- --branch production` backs up another Neon branch through the signed-in Neon CLI.

## How the code is organized

- `server.js` starts everything: loads env, connects, migrates, sets up accounts, listens.
- `auth.js` connects the site to Neon Auth (see Accounts). `rules.js` holds the game settings.
- `names.js` and `profanity.js` make guest and NewUser names and check names players type.
- `public/account.js` is the menu: log in, sign up, verify, reset password, settings, log out. `public/privacy.html` and `public/terms.html` are placeholder legal pages, served at `/privacy` and `/terms`.
- `/api/ip` shows the IP address the server sees for you, to check the guest limit behind the domain.
- `app.js` is the game server. Express serves `public/`, Socket.IO handles players. Postgres is the source of truth. Each map is cached in memory once loaded, and the cache only changes after a database write commits. Claims and wipes on one map run one at a time. The server checks every hit (does the block exist, does it touch the player's territory or is it an empty first block, has the same player hit it 3 times in a row), then broadcasts `hit` (crack progress), `claim`, `grow` and `wipe` to everyone on the map. Crack progress lives in memory only and fades one level per minute without hits. New guests per IP address are limited.
- `store.js` holds every query. A claim is one transaction: the block changes hands only if it still has the owner the server expected, and a first claim also grows the map and may earn a square.
- `db/index.js` has the connection pool, startup retries and the migration runner. `db/migrations/*.sql` run once each, in name order.
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
