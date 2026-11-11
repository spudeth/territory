# Territory: the game rules

Every rule in the game, in plain English. This file is updated whenever a rule changes. The public Game Guide (`/guide`) shows the same rules with every current number, built from the data.

**Where the numbers live:** Xoren's Google Sheet. Game numbers are rows on its Game Rules and Economy tabs (written below as `Economy: tickSeconds`); upgrades come from the Upgrades tab, items from the Items tab, skin prices from the Skin Rarity tab, and the Glossary tab explains every symbol. `npm run sync-rules` copies them into `data/economy.json` after checking them (a tab the sheet doesn't have keeps what the file has); nothing changes for players until that file is merged into main and deployed. The game never reads the sheet itself. The formulas come from the doc "Territory economy: core equations".

## The map

- Every map has a **seed** (any text; random if none is given). The seed decides everything about the map: the terrain at every block of an endless world, its starting shape, and where each new block appears as it grows. The same seed and the same claims always give the same map. (`public/terrain.js`)
- Every map has **E**, its base blocks: it starts with exactly E blocks, and E never changes. `npm run admin -- create-map <name> --seed <text> --base <E>` (default `Economy: defaultBaseBlocks`, 431,649; the live game refuses E above `maxBaseBlocksOnline` until the database is upgraded). `--width` and `--height` make a rectangle instead (E = width × height). Maps from before loop 16 have E = their starting size.
- Maps grow. Every time an empty block is claimed, one new block (more with Growth) appears touching the edge of the map. On a seeded map the n-th growth's spot comes from the seed. Water counts as map, so growth can reveal it. (`store.js`, `growMap`)
- **Levels.** A map's level comes from how many blocks have been mined there (first claims by players and factories; Growth's extra blocks don't count) and E: L = 1 + floor(log2(mined ÷ E + 1)), at most `maxLevel` (10). So level 2 starts at E blocks mined, level 3 at 3E, level 4 at 7E, level L at (2^(L−1) − 1) × E. The level is worked out each time, never stored. The top of the screen shows the map's level and a bar to the next. (`catalog.js`)
- New blocks are **born at the map's current level** and keep that level forever. Each level tints its blocks a little darker; zoomed in, blocks above level 1 show their level number.
- There can be many maps. A player can switch between them, and the game remembers the last map they were on, on every device. Only an admin can make a new map. Map looks: `grass` or `white` (`store.js`, `STYLES`).

## Terrain

| Terrain | Factor t (Game Rules tab) |
|---|---|
| Grass | 1 |
| Sand | `sandHits` (0.5) |
| Forest | `forestHits` (1.5) |
| Stone | `stoneHits` (3) |
| Water | can't be claimed; a natural border |
| Gold | `goldHits` (1), and `goldBonusSquares` (5) extra squares when first claimed |

- How much of the world each covers: `waterShare`, `sandShare`, `forestShare`, `stoneShare`, `goldShare`; how big features are: `terrainScale`.
- A block's terrain is stored with the block only when it differs from the seed's (the Terraformer).

## Taking blocks

- **Hardness:** a block takes H = `hitsPerBlock` × 2^(birth level − 1) × t hits to mine (10 for a level-1 grass block, 20 at level 2, 5,120 at level 10). An owned block takes H × the owner's Defense, plus any walls in the way.
- One tap counts as your Click Power in hits (see Upgrades).
- **Your first block** on a map must be an empty block. It can be anywhere.
- **After that**, you can only hit blocks that touch your territory up, down, left or right, and never across your own wall. Those blocks can be empty or owned by someone else.
- Tapping your own block does nothing at all: no message, no sound (players often tap once more after a claim).
- **Only one player's progress counts.** If someone else hits a block, their hits start over from zero and yours are gone.
- **Cracks fade:** 1 hit of progress for every 60 seconds since the last hit (Game Rules: `crackFadeSeconds`, `crackFadeHits`). A factory's progress never fades.
- **Nothing is wasted:** hit power to spare from the tap that takes a block counts toward the next block you hit.
- **Tap-rate limit (anti-bot):** at most 12 taps a second from one player (Game Rules: `maxTapsPerSecond`); players who go over are logged.
- **Press and hold** any block (`Economy: inspectHoldMs`, 400 ms; right-click on a computer) to open its info card: coordinates, terrain, level, hardness, its pay if mined or the hits to take it, its owner, walls, factory and listing. A normal tap never opens it.

## Squares (the currency)

- **Squares are counted in tenths** (whole numbers in the database, 64-bit). Every rounding is down. Players see whole squares, rounded down, unless Settings → Show tenths is on (one decimal place everywhere; saved per player).
- **Pay for mining a new block** = H × 10 ÷ `hitsPerSquare` × Earnings tenths, rounded down, plus the gold bonus. Every 10 hits you put into a new block earn 1 square, so income doesn't depend on level or terrain, only on upgrades. Taking a block from another player earns nothing.
- **Prices** come from one unit, the work-hour: W(L) = (3600 ÷ `baseBlockSeconds`) × 2^(L−1) squares (1,200 at level 1). Items, buildings and skins cost a number of work-hours × W(L) at the level of the map you're on (or the map picked on the welcome screen); upgrade tiers have fixed prices.
- Every change to a balance is written to a ledger. Every square spent is destroyed.

## The wipe rule (anti-farming)

- A player can wipe (clear) all their blocks on a map (Settings → Wipe and restart this map, then type WIPE). It also unlocks their look there. Their walls, factories and listings on that map go too.
- After a wipe, claiming empty blocks on that map earns squares only once the player owns **more** blocks there than they had when they wiped. The highest count from any wipe is the one that counts.

## Upgrades (tiers and steps)

Seven upgrades, from the Upgrades tab: Click Power, Earnings, Defense, Growth, Factory Speed, Factory Lifetime, Factory Yield. The Upgrades tile on the welcome screen opens the Upgrades screen.

- **Tiers (loop 18):** each upgrade's row on the Upgrades tab gives its tier 1 start, tier 1 max, multiplier per tier m, number of tiers, steps per tier S, tier cost T (work-hours), price curve c and gain curve g. Tier N runs from lo_N to hi_N: lo_1 = start, lo_N = max1 × m^(N−2) for N ≥ 2, hi_N = max1 × m^(N−1). Everyone starts at the tier 1 start.
- **Steps:** a player owns a number of steps per upgrade; their s-th step is step j = s − (N−1) × S of tier N = ceil(s ÷ S). The value after step j of tier N is lo_N + (hi_N − lo_N) × ln(1 + g·j/S) ÷ ln(1 + g): early steps in a tier give the most. Values can be fractions: Click Power and Defense keep the spare-hit carry-over; for Growth the fractional part is the chance of one more block (1.4 = 1 block and a 40% chance of a second; the roll is seeded by the map, so the same claims grow the same way).
- **Costs:** step j of tier N costs T × W(N) × ln(1 + c·j/S) ÷ Σ(i = 1..S) ln(1 + c·i/S) squares, W(N) = 1,200 × 2^(N−1), so a whole tier costs exactly T × W(N). In tenths, each step is the running total (rounded down) minus the one before, so the tier adds up exactly and no step is off by more than a tenth. Check (Click Power, the Charts tab): step 1 = 9.7, step 90 = 234.5, tier 1 = 14,400, tier 2 step 1 = 19.4; the value after step 10 = 3.709, after step 90 = 10, after tier 2 = 20. Prices are fixed forever.
- **Unlocking:** tier 1 is open from the start. Tier N's steps can be bought once you have first-claimed a block of level N or higher, on any map. Locked steps say "Mine a level-N block to unlock".
- **The cap is the block's level:** anything acting on a level-L block uses each upgrade at most at hi_L, the end of tier L: your Click Power (and Repair) on it, your Earnings and Growth when you mine it, its owner's Defense against you, and a factory's Speed and Yield on its target. A factory's Lifetime uses the level of the block it stands on. The card says so once you're past tier 1.
- **Buying:** each card shows "Tier 1 · step 12/90", the value now → after the next step, **Buy** (that step's price) and **Buy max** (as many steps as you can afford, in one purchase, never past what's unlocked). Each purchase is one transaction with your row locked, so a double tap or two devices never buy twice. It works from the next tap on every device and map. Guests can buy; their steps stay when they make an account.
- **Click Power:** hits per tap. **Earnings:** multiplies pay. **Defense:** multiplies the hits others need for your blocks. **Growth:** new map blocks per brand-new block. **Factory Speed, Lifetime, Yield:** see Factories.
- Super Click multiplies your effective Click Power by 10 for 5 seconds.

## The Marketplace

The welcome screen's tiles are Marketplace, Upgrades (its own screen), Awards and Profile. The Marketplace has tabs: Skins, Items and Land.

- **Skins** cost their rarity's work-hours × W(L) (Skin Rarity tab; flags are Rare). Owning more never changes the price.
- **Items** are priced from the Items tab: `PV` = P × V × W(L), or `Hours` × W(L). Super Click and the Terraformer are bought once and used a few times an hour. **Demolition** is used up: each one bought adds one; use it from the item bar on one of your factories or walls, confirm, and it's gone with no refund. It is the only way to remove a factory or a wall.

## Building

The **Build** button (under the leaderboard) has Factory, Wall, Sell land, and Wake up (only while one of your factories is selected by press and hold). A tool that can't be used now says why as soon as it's picked, before any ghost (for example "You need 20 blocks for your first factory (you have 9)."). While a tool is active, map taps only place: they never attack or claim. Pick a building, tap a block: a see-through ghost shows there (green, or red with the reason), tap another block to move it, ✓ buys, ✗ cancels.

### Factories

- Only on your own non-water block, one per block, not on land for sale. You may have floor(blocks owned ÷ `factoryBlocksPerFactory`) on a map; if your land drops below that, your newest factories pause until you're back above it.
- **Price** of your nth factory (n = how many you have + 1) = `factoryBuildPaybackHours` × `factoryValuePerHour` × W(L) × `factoryBuildGrowth`^(n−1).
- **Mining** happens on the server tick (`tickSeconds`), even while the owner is away, only while the factory is awake: hits per second = (`hitsPerBlock` ÷ `baseBlockSeconds`) × Factory Speed. Its target is the empty, non-water block touching your land closest to it (ties in a fixed seeded order), checked again every step; with none, it idles. Outside its home square (`factoryAreaSize` wide, centred on it) each block of distance adds `factoryDistancePenaltyWh` × W(L) × `hitsPerSquare` hits.
- Factory hits are the same hits and cracks as a player's, but their progress never fades. Your own taps add to it; anyone else's hit resets it.
- A finished block becomes yours, counts toward the map's mined total, grows the map with your Growth, pays you Factory Yield squares (never more than the block's normal pay; Earnings doesn't apply) and can unlock tiers.
- **Lifetime:** after building or waking, a factory works for Factory Lifetime hours, then sleeps (grey, "Zzz"). Wake up is in its info card, or the Build menu while it's selected. There is no wake-all.
- The free server sleeps: every tick catches up on all the time since the last one, in steps aligned to the clock, so factories give the same result whether the server stayed awake or not. A factory is destroyed when its block is taken.

### Walls

- Tap near the edge of your land: the wall snaps to the nearest outer side of one of your blocks (a side facing a square you don't own). At most `maxWallsPerBlock` (2) per block, on different sides, so corners work. Not on land for sale.
- **Price** = `wallPaybackHours` × `wallStrength` × H ÷ `hitsPerSquare` squares.
- An attacker who can only reach a walled block through walled sides hits a **wall first**: it needs `wallStrength` × H hits, cracks and fades like a block, and is destroyed when it breaks.
- You can never claim or attack across your own wall ("Your wall is in the way").
- Walls go when their block is taken; otherwise they stay until Demolition removes them.

## The land market

- **Selling:** Build → Sell land, tap your blocks (they must stay connected side to side), enter a price, ✓. Listed blocks show a for-sale marker and can't get new buildings or walls. Cancel from the info card or the Land tab.
- **Buying:** press and hold a listed block; the card highlights the whole bundle with its price and Buy, then a confirm step. One transaction, so nobody buys it twice. The buyer pays the full price; the seller gets it less `marketFee` (destroyed). Blocks, factories and walls move to the buyer, whose factory limit applies (newest pause). The land needn't touch the buyer's own.
- Accounts only, at least `marketMinAccountDays` old, to sell or buy.
- **Any attack on a listed block ends its listing.**
- The Land tab lists every listing on the map (size, price, seller, levels) with Jump to it.

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

- 300 achievements, from the sheet's **Achievements** tab (Key, Name, Category, Stat, Threshold, Secret, Description, Reward; `npm run sync-rules` checks and imports it). Each is earned once per player, and pays its **Reward** in squares (ledger reason `achievement:<key>`).
- Categories climb nice-number ladders (1, 5, 10, 25, 50, 100, 250…). A category's top tier is about 1,000 hours of dedicated play (144 new blocks an hour); earning all 300 is about 30,000 hours. Rewards are about 2 squares per hour of effort, at least 1 (Xoren, 2026-10-29).
- Stats (`economy.js`, `STATS`): lifetime totals kept per player (`player_totals`: blocks claimed, taken, lost, taps, squares earned by claiming and spent on upgrades, upgrades bought, terrain claimed, days played and the longest daily streak (UTC days), active hours (minutes with a tap), wipes, chat messages, Growth's extra blocks, map growth, most claimed in one visit and in one day, minutes at #1), plus records on any map (most owned at once, largest square, longest line), upgrade levels, maps played, best rank, the balance at its highest, and achievements and secrets found.
- Rank and reign count only on maps where at least `rankMinPlayers` (10) players own blocks, for players with at least `rankMinBlocks` (100) blocks there; ties count against you.
- 10 secret achievements show as "???" until earned.
- Progress from before this list (blocks, wipes, purchases, squares, renames) counts: anything already reached is earned, with its reward, the next time the player connects.
- Menu → Awards groups them by category, with each category's next tier and a progress bar, and the total out of 300. A yellow pop-up shows each one earned and its reward.

## Name labels

- Every territory on screen shows its owner's name on a small dark tag with their color, on the territory's deepest visible block (never on grass or other land). Yours is gold and always shows; where tags would overlap, the bigger territory's shows and the rest appear as you zoom in. (Xoren, 2026-10-28; replaces Q4's 25% rule. The Game Rules row `nameLabelShare` is no longer used.)
- Names are drawn in the middle of the territory's part of the screen, in white pixel letters with a dark shadow.

## Admin actions

Xoren can run these with `npm run admin` (see ADMIN.md). Each is recorded in the `admin_log` table.
- **Bans** stop a player, and every profile linked to them, from connecting: the guest they signed up from, and any guest seen in the same browser as their account. A ban is permanent unless it has an end date; it can be lifted. Banned players are disconnected at once and see "You've been banned" with the reason.
- **Map wipes** empty every block on a map (optionally back to a fresh newMapWidth × newMapHeight rectangle), reset everyone's wipe floor there to 0 and unlock everyone's look there. Squares, upgrades, achievements and accounts are untouched.
- **Player wipes** work exactly like a player's own wipe.
- **Deleting an account** empties the player's blocks everywhere, erases their login and personal data, frees their name, and keeps only an anonymous row for the squares ledger.
- **Squares** given or taken by an admin go through the ledger like any other change; a balance never goes below 0.

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
