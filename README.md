# Territory

A multiplayer browser game. Everyone shares a growing map of blocks: tap a block to hit it, take it, and grow your
territory; mining new blocks pays squares, spent on upgrades, skins, items, buildings and land. **Every rule and current
number is in the Game Guide**, built from the game's own data: open `/guide` on the running game (source: `server/guide.js`).

## Where things live

| Folder | What |
|---|---|
| `server/` | the server (`server.js` starts it; `app.js` is the game) |
| `client/` | the browser code (`index.html`, `game.js`, `menu.js`, …) |
| `art/` | everything players see or hear: icons, tiles, music, styles, skins, each plug-in's art. Replace a file with the same name to change it. Alice's art pipeline: `art/README.md`. |
| `plugins/` | walls, factories, items, skins, achievements: each a folder with its code, data and tests |
| `data/` | the core's numbers from the Google Sheet |
| `db/migrations/` | the database, one SQL file per change |
| `scripts/` | admin, backup, create-map, sync-rules |
| `tests/` | the core's tests |
| `docs/` | [ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the core and plug-ins fit together), [ADMIN.md](docs/ADMIN.md) (admin commands) |

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

Logins use Neon's managed Better Auth, enabled on both branches. The browser calls `/api/auth/*` on our own site and `server/auth.js` passes each request on to Neon with Neon's server toolkit (`@neondatabase/auth/server`), so the login cookie belongs to our domain. When the game connection starts, the browser fetches a 15-minute login token from `/api/auth/token` and sends it; the server checks it against Neon's public keys.

- Email and password, with a 6-digit code to verify the email. Password reset is by emailed link, which comes back to `/?reset=1&token=…`.
- Google sign-in returns to `/?neon_auth_session_verifier=…`, which `server/auth.js` swaps for the login cookie.
- The first time an account plays it gets a player named "NewUser" and a number, and may rename straight away. If the browser has just signed up from its own guest profile, the guest becomes that account: it keeps its blocks, squares and settings, its name changes to the NewUser one (shown to everyone at once), and the guest token is deleted. An account that already has a player never takes anything over, so logging in never merges.
- Only accounts can rename (Menu → Settings): 15 characters, plain letters and numbers, unique ignoring case, through the filter in `server/profanity.js`, once every 10 minutes.
- Emails go through Resend, set up as Neon's custom SMTP provider on each branch (the key lives in Neon, not here). Google uses our own OAuth client on production.

## The numbers: Xoren's Google Sheet

Every game number is a row on the sheet: Game Rules and Economy tabs for the core, the Upgrades tab for upgrades, the
Glossary tab for every symbol, and each plug-in's own tabs (Walls, Factories, Items, Skins, Skin Rarity,
Achievements). `npm run sync-rules` checks every tab, names any bad cell, and copies the numbers into
`data/economy.json` and each plug-in's `data.json` (`--check` checks only; a tab the sheet doesn't have keeps what
the file has). Nothing changes for players until those files are merged into main and deployed. The game never reads
the sheet itself.

## Scripts

- `npm test` runs every test (`tests/` and each plug-in's `test/`) against the database in `.env.local`, each test file
  in its own throwaway schema. It refuses to run against `production`. The account tests use the dev branch's real Neon
  Auth with `@example.com` users, which they delete afterwards.
- `npm run admin -- <command>`: admin commands through the live server (dev unless `--prod`). See [docs/ADMIN.md](docs/ADMIN.md).
- `npm run sync-rules`: the sheet into the data files (above).
- `npm run create-map`, `npm run backup`: see docs/ADMIN.md.

## Deploying

Render runs `npm start` (`node server/server.js`) on every merge into main. The server applies any new database
migrations at start and exits rather than run without the database. Art, sounds and code are cached by the browser:
code by fingerprint (a new version gets a new address), art for an hour.

## Credits

Art and music licences: [CREDITS.md](CREDITS.md).
