# Territory: the game rules

Every rule in the game, in plain English. This file is updated whenever a rule changes.

**Where the numbers live:** Xoren's Google Sheet. Every game number is a row on its Game Rules tab (written below as `Game Rules: hitsPerBlock`), and upgrade levels and costs come from the Click Power, Defense, Earnings and Growth tabs. `npm run sync-rules` copies them into `data/economy.json` after checking them; nothing changes for players until that file is merged into main and deployed. The game never reads the sheet itself. The numbers quoted below are the current ones in `data/economy.json`.

## The map

- Everyone on a map plays on the same board. A new map starts as a rectangle, 32 × 32 blocks unless chosen otherwise (`scripts/create-map.js`, `--width` and `--height`).
- Maps grow. Every time an empty block is claimed, one new empty block appears at a random spot touching the edge of the map. So maps slowly take any shape. (`store.js`, `growMap`)
- Taking a block from another player does not grow the map.
- There can be many maps. A player can switch between them, and the game remembers the last map they were on, on every device. Only an admin can make a new map (`npm run create-map`). Map looks: `grass` or `white` (`store.js`, `STYLES`).

## Taking blocks

- **Every block takes 10 hits to take**, empty or owned. (Game Rules: `hitsPerBlock`)
- One click counts as 1 hit, times your Click Power (see Upgrades). With no upgrades, 10 clicks take a block.
- **Your first block** on a map must be an empty block. It can be anywhere.
- **After that**, you can only hit blocks that touch your territory up, down, left or right. Diagonal doesn't count. Those blocks can be empty or owned by someone else.
- You can't hit your own blocks.
- **Only one player's progress counts.** Progress on a block only counts while the same player keeps hitting it. If someone else hits it, their hits start over from zero and yours are gone.
- **Cracks fade.** A cracked block loses 1 hit of progress for every 60 seconds since it was last hit, down to zero. (Game Rules: `crackFadeSeconds` and `crackFadeHits`)
- Progress is kept as a fraction (for example 7.2 hits out of 10). It's never saved, so a server restart clears all cracks.
- **What players see:** the crack drawing shows progress as a share of the hits needed. The existing art has 2 stages. The first shows from the first hit up to half way, and the second from just past half way. The block also darkens a little with every hit, up to 30% dark just before it's taken. (`public/game.js`, `CRACK_STAGES = 2`)
- **Tap-rate limit (anti-bot):** the server counts at most 12 taps a second from one player, in short bursts of up to 12; faster taps are ignored. Players who go over are logged each minute (table `tap_limit_log` and the server log) to spot bots later. No bans. (Game Rules: `maxTapsPerSecond`)
- If two players finish the same block at almost the same moment, the first one saved wins, and the other sees "Someone got there first".

## Squares (the currency)

- Claiming an **empty** block earns 1 square, times your Earnings (see Upgrades). (Game Rules: `squaresPerFirstClaim`)
- Taking a block from another player earns nothing.
- **Fractions are kept.** With Earnings ×1.5, every empty block earns 1.5 squares. The exact balance is stored, to 6 decimal places. (a code constant, `rules.js` `SQUARE_DECIMALS`, matching the database columns from `db/migrations/007_fractional_squares.sql`)
- **Players always see the whole number, rounded down.** A balance of 2.5 shows as 2. (`rules.js`, `shownSquares`)
- Every change to a balance is written to a ledger, with the exact amount, the new balance, and the map and block it came from.
- There's no way to spend squares yet.

## The wipe rule (anti-farming)

- A player can wipe (clear) all their blocks on a map (Menu → Settings → Wipe and restart this map, then type WIPE).
- A wipe also unlocks their color, skin and coverage on that map (see below).
- After a wipe, claiming empty blocks on that map earns squares only once the player owns **more** blocks there than they had when they wiped. Before that, the map still grows, but no squares are earned.
- If a player wipes more than once, the highest count from any wipe is the one that counts. Wiping again never lowers it. (`rules.js`, `earnsSquares` and `wipeFloorAfterWipe`)

## Upgrades

Each player has a level for four upgrades, which count on every map. Everyone starts at level 0, which is "no upgrade". Each upgrade's tab in the sheet lists its levels with the value after buying each one and its cost in squares (columns Level, Value after, Cost (squares)); the game uses them exactly as written. A level past the end of a table uses its last entry.

**Current levels (first sync, 2026-10-28):**

| Upgrade | Levels | Level 1 costs | Top value |
| --- | --- | --- | --- |
| Click Power | 70 | 22 squares | ×10 (1 hit per click → 10) |
| Defense | 50 | 124 squares | ×3 (10 hits → 30) |
| Earnings | 100 | 9 squares | ×10 squares per new block |
| Growth | 5 | 1,161 squares | 6 new map blocks per new block |

Every level's value and cost is in `data/economy.json`, exactly as in the sheet.

**Buying:** Menu > Upgrades. Each upgrade shows its level, what it does now and after the next level (e.g. "9 → 8 clicks per block"), and a button with the next level's cost from the sheet. Without enough squares the button says how many more are needed; at the top level it says MAX.
- Guests can buy too (after their first block); upgrades work on every map and stay with the guest when they make an account from their guest profile.
- A purchase is one database transaction: the exact balance (fractions included) is checked, the cost taken and written to the ledger, and the level raised. Taps at the same moment, from one device or several, take turns, and a tap for a level already bought is refused, so nobody can spend the same squares twice.
- The new level counts from the very next tap, on every device and map.

- **Click Power:** how many hits one click counts as. ×1.2 means each click counts as 1.2 hits.
- **Defense:** multiplies the hits other players need to take your blocks. ×2 means 20 hits. It never applies to empty blocks.
- **Earnings:** multiplies the squares you earn per empty block, with fractions kept.
- **Growth:** how many new map blocks each brand-new block you claim creates (1 with no upgrade). Whole numbers only. Each extra block appears at a random spot on the map's edge, exactly like the normal one.
- **Example:** with Click Power ×1.2 against Defense ×2, the block needs 10 × 2 = 20 hits. 16 clicks make 19.2 hits, which isn't enough, so it takes 17 clicks.
- **When the sheet changes the levels, nobody gets weaker.** At the next server start after a merge, each player's level moves to the lowest new level whose value is at least what they had (if no new level is that strong, the top level). Every move is recorded (table `level_remaps`) and listed in the server log. The sync report shows how levels will move.

## Your look on each map

- Before your first claim on a map, the setup screen asks for:
  - a **color**, from 8 free colors: Blue, Pink, Orange, Yellow, Teal, Purple, Red, White. One is picked at random until you choose. (`rules.js`, `COLORS`)
  - a **skin**. Only Default exists so far; the others show as locked.
  - a **coverage**: Per block (`tile`, the default: the skin repeats on each block) or Full area (`stretch`: one big image over the whole territory). (`rules.js`, `COVERAGES`)
- **Your first claim locks them on that map.** The database refuses any change while they're locked.
- **A wipe unlocks them**, on that map only. Your next claim there shows the setup screen again, and the new choices lock until your next wipe. (`db/migrations/008_unlock_after_wipe.sql`)
- You can have a different look on each map. Players who joined before the 8 colors keep their old color until they wipe.

## Players, guests and accounts

- **Visitors** can look at the map and start hitting. They become a **guest** on their first claim. A guest gets a random name like "Sly Wolf", which nobody else is using. (`names.js`)
- **Guest limit:** one network (IP address) can create at most 5 new guests per 60 minutes. (Game Rules: `guestsPerIp` and `guestWindowMinutes`)
- A guest is remembered by a secret token in their browser. Clearing the browser loses the guest.
- **Accounts** sign up with email and password (a 6-digit email code checks the address) or with Google.
  - A new account gets a name like "NewUser4821" and can rename straight away.
  - If a guest signs up from their own guest profile, the account takes over that guest. It keeps its blocks, squares and settings, and its name changes to a NewUser name.
  - Logging into an account that already has a player never merges anything.
- **Renaming** is for accounts only (Menu → Settings).
  - At most 15 characters (Game Rules: `nameMaxLength`; the database allows no more than 15): letters, numbers, spaces, `-`, `_` and `.`, starting with a letter or number. (`names.js`, `checkName`)
  - Names must be unique, ignoring capital letters.
  - Names are run through the bad-word filter (`profanity.js`).
  - Some names are reserved: admin, mod, staff, support, official, territory, NewUser… and others.
  - After a rename, you wait 10 minutes before renaming again. (Game Rules: `renameWaitMinutes`)
  - A new name shows to everyone at once.

## Stats

Kept for each player on each map, updated on every claim (`stats.js`):

- **Blocks owned now**, and the **most ever owned at once**
- **First claims**: empty blocks claimed
- **Retakes**: blocks taken from other players
- **Blocks lost**: blocks other players took from you. Wipes don't count.
- **Largest square** ever owned: a 10 means a solid 10 × 10
- **Longest line** ever owned: a straight row or column

The largest square and the longest line are **records**. Losing blocks never lowers them. (Q2: answered A)

## Achievements

- Each achievement is earned once per player, on whichever map they first reach it. (Q3: answered A)
- They're checked on every stat change. The current 8 are placeholders until the real list is approved (see Q5 in `CODY-LOG.md`): First Block (1 first claim), 100 Blocks, 1,000 Blocks (owned at once), 10 by 10, 50 by 50 (largest square), Line of 10, Line of 100, Raider (10 retakes). (names in `achievements.js`; thresholds on Game Rules: `achievement.<id>`)
- Menu → Achievements lists them, with progress toward each (your best on any map), and an All / Earned / Locked filter. A yellow pop-up shows when you earn one.

## Name labels

- An owner's name shows on their territory once it covers at least 25% of the **whole screen**. When you're zoomed far out, names disappear. (Game Rules: `nameLabelShare`; Q4: answered A)
- Names are drawn in the middle of the territory's part of the screen, in white pixel letters with a dark shadow.

## Sound and music

- Every sound effect is made in code (`public/sfx.js`); Xoren picked one option per sound on the sound test page (`public/audio.js`, `PICKS`).
- Your own sounds always play at full volume. Another player's taps, claims and new blocks play only when they're near what you're looking at: quieter further from the middle of the screen, silent past about one screen away, and coming from the left or right speaker by where they are. (Game Rules: `soundHearingDistance` and `soundOthersVolume`)
- At most 6 sounds play at once; other players' sounds are skipped past that, your own never are. (Game Rules: `soundMaxAtOnce`)
- Music: "Keep your dream alive!" (CC0, see CREDITS.md) loops quietly once you first tap or click; browsers don't allow sound before that. Default volumes: sound effects 70%, music 25%. (Game Rules: `defaultEffectsVolume` and `defaultMusicVolume`)
- Menu > Settings > Sound has a slider and a mute button for each, saved on that device.

## Tutorial and tips

- Brand-new players get a short guided first game right after the setup screen: the goal, claiming (with a tap counter), growth, range, taking, and a quick tour of the menu. Skip ends it; Menu > How to play starts it again.
- Steps and tips are listed in `public/tutorial.js`; adding a step is adding one entry there.
- Progress is saved for each player (the database, `players.tutorial`), and on the device for visitors who haven't claimed yet. It picks up where you left off, and moves to your account if you sign up from your guest profile. Players from before the tutorial count as having finished it.
- Four tips show once each, ever: the first time one of your blocks is taken, a tap out of range, your first square, and your first achievement.

## Controls

- Tap or click a block to hit it. Drag to move around. Pinch or use the mouse wheel to zoom.
- The Menu button (bottom left) opens the menu: your account, Maps, Skins, Achievements, Upgrades, Settings. Get squares, VIP, buying skins, buying or creating maps, and buying upgrades show as SOON.
- A touch that moves more than 10 pixels counts as a drag, not a tap. (`public/game.js`)
