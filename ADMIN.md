# Admin commands

You run admin commands on your own computer, by typing one line in a terminal. They go through the game's server, so players see the result straight away: a wiped map empties on everyone's screen, and a banned player is disconnected on the spot.

- Commands go to the **dev** game by default. To change the **live** game, add `--prod` at the end.
- Anything that deletes or takes away shows exactly what will change, asks you to type the map or player name, and saves a backup on your computer first. Everything you run is recorded on the server (the `admin_log` table).

**Never paste the admin key into a chat, an email or GitHub.** It only goes in the two places in step 1.

---

## 1. One-time setup

### Make the key

1. Open a terminal in the game folder (see section 2).
2. Paste this line and press Enter:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
3. It prints a long line of letters and numbers. That's your admin key. Leave the terminal open for the next two steps.

### Put it on your computer

1. In VS Code, with the game folder open: **File → New File…**, type `.env.admin` (with the dot at the start) and press Enter. Save it in the game folder, next to `package.json`.
2. Type `ADMIN_KEY=`, paste the key straight after it with no spaces, and save.
   ```
   ADMIN_KEY=paste-the-key-here
   ```
   Git ignores this file, so it never goes to GitHub.

### Put it on Render (the live game)

1. Go to **dashboard.render.com** → click the **territory** service → **Environment** in the left menu.
2. Click **Add Environment Variable**. Key: `ADMIN_KEY`. Value: paste the same key.
3. Click **Save Changes**. Render restarts the game, which takes a minute or two.
4. Check: **Logs** in the left menu shows `Admin commands are on.`

### Check it works

- Live game: `npm run admin -- map Grass --prod` should print the Grass map's details.
- Dev game: start the dev server first (section 2), then `npm run admin -- map Grass`.

---

## 2. Opening a terminal

1. Open VS Code with the game folder (**File → Open Folder…** → `Block Game`).
2. Menu: **Terminal → New Terminal**. A panel opens at the bottom, already in the game folder.
3. Type a command and press **Enter**.

**For dev commands**, the dev server must be running:
1. Open one terminal and type `npm start`. Leave it running; it says `Territory running on http://localhost:3030`.
2. Click the **+** in the terminal panel to open a second terminal, and type admin commands there.

Live (`--prod`) commands don't need anything running on your computer.

---

## 3. The commands

Every command starts with `npm run admin --`. Put names with spaces in quotes: `"Sly Wolf"`. Names ignore capitals. You can also use an id with a `#`, like `#12`. Add `--prod` to any command to use the live game.

`npm run admin -- help` lists them all.

### Looking (changes nothing)

**player**: everything about one player.
```
npm run admin -- player "Sly Wolf" --prod
```
You'll see:
```
Sly Wolf (#12)
Account: someone@email.com
Joined: 2026-10-20 14:03 UTC
Linked profiles: Bold Hare (#9)
Squares: 41.5
Upgrades: Click Power 3, Defense 0, Earnings 1, Growth 0
Blocks: Grass 48
Achievements: first-block, line-10
Ban: not banned
```
"Linked profiles" are guest profiles seen on the same device as this account.

**map**: one map's size and leaders.
```
npm run admin -- map Grass --prod
```
```
Grass (#1), grass, official
Size: 1,184 blocks, spanning 36 x 35
Claimed: 412 blocks by 23 players
Top: 1. Bold Hare 112, 2. Sly Wolf 60, 3. Zesty Deer 48
```

**backup**: saves the whole game to a file on your computer.
```
npm run admin -- backup --prod
```
```
Backup saved: backups/prod-2026-10-28T19-41-41-657Z.json (3,212 rows)
```

### Small changes (you answer y to go ahead)

**kick**: disconnects someone now. Not a ban: they can reload and play.
```
npm run admin -- kick "Sly Wolf" --prod
```

**give-squares**: adds squares, written to the squares ledger.
```
npm run admin -- give-squares "Sly Wolf" 50 --reason "contest prize" --prod
```
```
This will:
  Give Sly Wolf 50 squares: 41.5 -> 91.5.
Go ahead? (y/N) y
Sly Wolf now has 91.5 squares.
```

**unban**: lifts a ban, for the player and their linked profiles.
```
npm run admin -- unban "Sly Wolf" --prod
```

**create-map**: makes a new map. Style is `grass` or `white`. The size comes from the Game Rules tab unless you give one.
```
npm run admin -- create-map --name Snowfield --style white --prod
npm run admin -- create-map --name "Tiny Isle" --width 16 --height 16 --prod
```

### Big changes (you type the name, and a backup is saved first)

For these, you see the full list of what will change, then type the map or player name exactly as shown. Anything else stops the command and nothing changes. Adding `--yes` skips the typing, but never the backup or the log.

**take-squares**: removes squares (never below 0).
```
npm run admin -- take-squares "Sly Wolf" 20 --reason "refund mistake" --prod
```

**wipe-player**: clears one player's blocks on one map, like their own wipe. Their wipe floor goes up the normal way, and their color, skin and coverage there unlock.
```
npm run admin -- wipe-player "Sly Wolf" Grass --prod
```

**wipe-map**: empties every block on a map. Everyone's wipe floor there goes back to 0, and everyone picks their look again. Squares, upgrades, achievements and accounts stay. Add `--reset-size` to also make it a fresh rectangle (newMapWidth × newMapHeight on the Game Rules tab).
```
npm run admin -- wipe-map Grass --reset-size --prod
```
You'll see:
```
[PRODUCTION: the live game — https://territory.sarl]
This will:
  Empty all 412 claimed blocks on Grass, owned by 23 players (most: Bold Hare 112, Sly Wolf 60, Zesty Deer 48).
  Reset Grass to a fresh 32 x 32 map (now 1,184 blocks).
  Everyone's wipe floor there goes back to 0, and their color, skin and coverage there unlock.
  Squares, upgrades, achievements and accounts are not touched.
Type Grass to go ahead (anything else stops): Grass
Backup saved: backups/prod-2026-10-28T20-02-11-120Z-before-wipe-map.json (3,212 rows)
Grass: emptied 412 blocks of 23 players; the map has 1,024 blocks.
```

**wipe-all-maps**: the same, for every map. To confirm, type `ALL MAPS`.
```
npm run admin -- wipe-all-maps --prod
```

**ban**: blocks a player and every profile linked to them (the guest they signed up from, and guests seen on their devices). They're disconnected at once, and see "You've been banned" with the reason. It's permanent unless you add `--days`. Their blocks stay unless you add `--wipe-blocks`.
```
npm run admin -- ban "Sly Wolf" --reason "using a bot" --days 7 --prod
npm run admin -- ban "Sly Wolf" --reason "cheating" --wipe-blocks --prod
```

**delete-account**: deletes a player for good, for example when someone asks to be removed. Their blocks on every map go empty. Their login, email and personal data are erased, in Neon Auth too, and their name becomes free. Only an anonymous row stays, because the squares ledger refers to it. This can't be undone, except by restoring a backup.
```
npm run admin -- delete-account "Sly Wolf" --prod
```

**restore**: puts the whole game back to a backup file (section 5).

---

## 4. If something goes wrong

| You see | What to do |
| --- | --- |
| `No ADMIN_KEY: put ADMIN_KEY=… in the .env.admin file` | The `.env.admin` file is missing or misnamed. Redo "Put it on your computer". The file must be in the game folder and named exactly `.env.admin`. |
| `Refused: Wrong admin key` | The key on your computer and on Render differ. Copy it again from `.env.admin` into Render (Environment → ADMIN_KEY → Save Changes) and wait for the restart. Wrong attempts are recorded. |
| `Admin commands are off on this server: ADMIN_KEY is not set.` | Render has no ADMIN_KEY (or the dev server wasn't restarted after you made `.env.admin`). Add it, or stop and restart `npm start`. |
| `Could not reach http://localhost:3030. Is the dev server running?` | Start it with `npm start` in another terminal, or add `--prod` if you meant the live game. |
| `This is the production server: add --prod` | You're pointing at the live game without `--prod`. Add it if you really mean the live game. |
| `No player called "…"` / `No map called "…"` | Check the spelling with `player` or `map`, or use the id (`#12`). |
| `Stopped. Nothing was changed.` | The name you typed didn't match exactly. Run it again. |
| `Refused: Something went wrong: …` | Nothing should be half-done (each change is all or nothing), but check with `player` / `map`. Send Cody the whole message. |

---

## 5. Restoring a backup

Every big change saves a backup first, in the `backups` folder of the game, named like `prod-2026-10-28T20-02-11-120Z-before-wipe-map.json`. The time is in UTC.

**To put the game back the way it was in a backup file:**
1. Find the file in the `backups` folder (in VS Code, it's in the file list on the left).
2. Right-click it → **Copy Relative Path**.
3. Type `npm run admin -- restore `, paste the path, then add ` --prod` for the live game:
   ```
   npm run admin -- restore backups/prod-2026-10-28T20-02-11-120Z-before-wipe-map.json --prod
   ```
4. Check the list of what will change, then type `RESTORE`.
5. A fresh backup of the game as it is now is saved first, so you can undo the restore the same way.

Everyone playing is disconnected and sees "Game restored". When they reload, they're in the restored game.

A backup only fits the version of the game it was made with. If the game has had a database change since, the restore refuses and says so. Then use Neon instead:

**Neon's restore (for any moment, including before an update):** Neon console → your project → **Branches** → **production** → **Restore**. Pick a time just before the problem, and follow Neon's steps. This puts back the whole database, including logins. Neon only keeps a limited history; the restore page shows how far back you can go.
