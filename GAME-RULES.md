# Territory: the game rules

Every rule in the game, in plain English. Each number says where it lives, so you know which line to change. Most numbers are in `rules.js`. Change a number there, restart the server, and the game uses it. This file is updated whenever a rule changes.

## The map

- Everyone on a map plays on the same board. A new map starts as a rectangle, 32 × 32 blocks unless chosen otherwise (`scripts/create-map.js`, `--width` and `--height`).
- Maps grow. Every time an empty block is claimed, one new empty block appears at a random spot touching the edge of the map. So maps slowly take any shape. (`store.js`, `growMap`)
- Taking a block from another player does not grow the map.
- There can be many maps. A player can switch between them, and the game remembers the last map they were on, on every device. Only an admin can make a new map (`npm run create-map`). Map looks: `grass` or `white` (`store.js`, `STYLES`).

## Taking blocks

- **Every block takes 10 hits to take**, empty or owned. (`rules.js`, `HITS_PER_BLOCK: 10`)
- One click counts as 1 hit, times your Click Power (see Upgrades). With no upgrades, 10 clicks take a block.
- **Your first block** on a map must be an empty block. It can be anywhere.
- **After that**, you can only hit blocks that touch your territory up, down, left or right. Diagonal doesn't count. Those blocks can be empty or owned by someone else.
- You can't hit your own blocks.
- **Only one player's progress counts.** Progress on a block only counts while the same player keeps hitting it. If someone else hits it, their hits start over from zero and yours are gone.
- **Cracks fade.** A cracked block loses 1 hit of progress for every 60 seconds since it was last hit, down to zero. (`rules.js`, `CRACK_DECAY_SECONDS: 60` and `CRACK_DECAY_HITS: 1`)
- Progress is kept as a fraction (for example 7.2 hits out of 10). It's never saved, so a server restart clears all cracks.
- **What players see:** the crack drawing shows progress as a share of the hits needed. The existing art has 2 stages. The first shows from the first hit up to half way, and the second from just past half way. The block also darkens a little with every hit, up to 30% dark just before it's taken. (`public/game.js`, `CRACK_STAGES = 2`)
- If two players finish the same block at almost the same moment, the first one saved wins, and the other sees "Someone got there first".

## Squares (the currency)

- Claiming an **empty** block earns 1 square, times your Earnings (see Upgrades). (`rules.js`, `SQUARES_PER_FIRST_CLAIM: 1`)
- Taking a block from another player earns nothing.
- **Fractions are kept.** With Earnings ×1.5, every empty block earns 1.5 squares. The exact balance is stored, to 6 decimal places. (`rules.js`, `SQUARE_DECIMALS: 6`, and the database columns from `db/migrations/007_fractional_squares.sql`)
- **Players always see the whole number, rounded down.** A balance of 2.5 shows as 2. (`rules.js`, `shownSquares`)
- Every change to a balance is written to a ledger, with the exact amount, the new balance, and the map and block it came from.
- There's no way to spend squares yet.

## The wipe rule (anti-farming)

- A player can wipe (clear) all their blocks on a map. There's no button for it yet.
- After a wipe, claiming empty blocks on that map earns squares only once the player owns **more** blocks there than they had when they wiped. Before that, the map still grows, but no squares are earned.
- If a player wipes more than once, the highest count from any wipe is the one that counts. Wiping again never lowers it. (`rules.js`, `earnsSquares` and `wipeFloorAfterWipe`)

## Upgrades

Each player has a level for three upgrades. Everyone starts at level 0. Each upgrade has a table in `rules.js` giving its effect at each level, starting at level 0. A level past the end of the table uses the last entry.

**Right now every table is `[1]`, so upgrades do nothing at any level.** Levels and prices haven't been decided, and there's no way to buy upgrades yet.

- **Click Power:** how many hits one click counts as. ×1.2 means each click counts as 1.2 hits. (`rules.js`, `CLICK_POWER_MULTIPLIER: [1]`)
- **Defense:** multiplies the hits other players need to take your blocks. ×2 means 20 hits. It never applies to empty blocks. (`rules.js`, `DEFENSE_MULTIPLIER: [1]`)
- **Earnings:** multiplies the squares you earn per empty block, with fractions kept. (`rules.js`, `EARNINGS_MULTIPLIER: [1]`)
- **Example:** with Click Power ×1.2 against Defense ×2, the block needs 10 × 2 = 20 hits. 16 clicks make 19.2 hits, which isn't enough, so it takes 17 clicks.

## Your look on each map

- On your first claim on a map you get a random color (any color except grass green), the default skin, and a coverage: `tile` (the default) or `stretch`. Coverage is how a skin covers your territory. (`rules.js`, `COVERAGES`; colors in `names.js`, `randomColor`)
- **Once set, color, skin and coverage are locked forever on that map.** The database refuses any change.
- You can have a different look on each map.

## Players, guests and accounts

- **Visitors** can look at the map and start hitting. They become a **guest** on their first claim. A guest gets a random name like "Sly Wolf", which nobody else is using. (`names.js`)
- **Guest limit:** one network (IP address) can create at most 5 new guests per 60 minutes. (`rules.js`, `GUESTS_PER_IP: 5` and `GUEST_WINDOW_MINUTES: 60`)
- A guest is remembered by a secret token in their browser. Clearing the browser loses the guest.
- **Accounts** sign up with email and password (a 6-digit email code checks the address) or with Google.
  - A new account gets a name like "NewUser4821" and can rename straight away.
  - If a guest signs up from their own guest profile, the account takes over that guest. It keeps its blocks, squares and settings, and its name changes to a NewUser name.
  - Logging into an account that already has a player never merges anything.
- **Renaming** is for accounts only (Menu → Settings).
  - At most 15 characters: letters, numbers, spaces, `-`, `_` and `.`, starting with a letter or number. (`names.js`, `checkName`)
  - Names must be unique, ignoring capital letters.
  - Names are run through the bad-word filter (`profanity.js`).
  - Some names are reserved: admin, mod, staff, support, official, territory, NewUser… and others.
  - After a rename, you wait 10 minutes before renaming again. (`rules.js`, `RENAME_COOLDOWN_MINUTES: 10`)
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
- They're checked on every stat change. The current 8 are placeholders until the real list is approved (see Q5 in `CODY-LOG.md`): First Block (1 first claim), 100 Blocks, 1,000 Blocks (owned at once), 10 by 10, 50 by 50 (largest square), Line of 10, Line of 100, Raider (10 retakes). (`achievements.js`, `DEFINITIONS`)
- They're not shown on screen yet.

## Name labels

- An owner's name shows on their territory once it covers at least 25% of the **whole screen**. When you're zoomed far out, names disappear. (`public/labels.js`, `NAME_LABEL_SHARE = 0.25`; Q4: answered A)
- The logic is built, but the names aren't drawn yet.

## Controls

- Tap or click a block to hit it. Drag to move around. Pinch or use the mouse wheel to zoom.
- A touch that moves more than 10 pixels counts as a drag, not a tap. (`public/game.js`)
