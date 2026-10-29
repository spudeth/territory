# Cody log

One line per iteration, newest at the bottom. Questions are marked OPEN until answered through Xoren.

#1 | 2026-10-28 09:54 | rules.js now holds every game number plus the core rules as pure functions (who may hit a block, crack fading, the wipe rule); the server uses them | tests: pass (rules 4/4 in memory, server 15/15)
#2 | 2026-10-28 09:57 | upgrade plumbing: each player has Click Power, Defense and Earnings levels (database migration 003, all 0); rules.js turns levels into effects through dial tables that default to no effect; nothing can buy them yet | tests: pass (rules 5/5, server 16/16, store 12/12)
QUESTION Q1: how should upgrades combine and round? | A: (base hits - Click Power) x Defense, rounded up, min 1 hit; Earnings rounded down / B: base x Defense first, then minus Click Power / C: something else | built A (Click Power can't erase Defense entirely, and no free fractional squares); one line in rules.js to change | ANSWERED: replaced by the new hit system (loop order 2): 10 hits per block, Click Power multiplies each click, Defense multiplies hits needed
#3 | 2026-10-28 10:00 | stats per player per map: blocks owned, most ever owned, first claims, retakes, blocks lost, largest solid square, longest line; updated with each claim, saved (migration 004), rebuilt from the map on load, and sent as a "stat" event | tests: pass (stats 5/5 in memory incl. brute-force checks, server 17/17, store 12/12)
QUESTION Q2: square and line stats: record ever reached, or what you own right now? | A: record (never goes down) / B: current (drops when blocks are lost) / C: both | built A, since achievements fire once on reaching a size; blocks lost counts only blocks other players take, not wipes | ANSWERED: A (record) (kept as built)
#4 | 2026-10-28 10:02 | achievement engine: achievements are data in achievements.js (id, name, stat, threshold; 8 placeholders), checked on every stat event, saved once per player (migration 005), then sent as an "achievement" event; no UI | tests: pass (achievements 3/3 in memory, server 18/18)
QUESTION Q3: are achievements earned once per player, or once per map? | A: once per player, on any map / B: once per map (can earn "10 by 10" again on a new map) | built A (records which map it happened on, so B is a small change) | ANSWERED: A (once per player) (kept as built)
#5 | 2026-10-28 10:05 | multi-map backend: players can list maps and switch (the server resends the whole map, so today's page already copes); the last map is remembered across devices; claims queued on a map you just left are dropped; new maps only via `npm run create-map -- --name … --style grass|white --width … --height …`; no UI | tests: pass (server 19/19)
#6 | 2026-10-28 10:06 | name-label logic: public/labels.js says which owners cover at least 25% of the view (counting blocks cut by the screen edge by the part showing) and where the middle of their visible blocks is; same file works in the browser and on the server; not drawn yet | tests: pass (labels 3/3, rules 5/5, in memory)
QUESTION Q4: does "25% of the screen" mean the whole screen, or only the part of the screen the map covers? | A: whole screen (zoomed far out, names disappear) / B: only the map's part of the screen | built A, as written; it's one line to change | ANSWERED: A (whole screen) (kept as built)
#7 | 2026-10-28 10:10 | large maps: growth used to scan the whole map on every first claim (550 ms at 100,000 blocks, and claims on a map run one at a time); it now picks from a kept list of edge spots (migration 006), so a first claim costs the same on a 100,000-block map as on a 32x32 one; loading that map takes 0.7 s, stats 0.3 s, and sends 1.4 MB to each new player | tests: pass (store 13/13 incl. new edge check, server 19/19)
#8 | 2026-10-28 10:12 | large maps: big messages are now compressed (fast setting), so joining a 100,000-block map sends about 320 KB instead of 1.4 MB; small messages like hits are unchanged | tests: pass (server 19/19; compression confirmed on a live connection)
#9 | 2026-10-28 10:13 | reconnects: a visitor whose connection drops while their first claim is saving no longer leaves a block owned by an unreachable guest; tested that cracks survive a reconnect and that a restarted server carries on stats and doesn't re-award achievements | tests: pass (server 20/20)
#10 | 2026-10-28 10:15 | more tests: four players playing randomly on their own map, then checking that the database, the server and every player's screen agree, that the map grew exactly once per first claim, and that the edge list is exact; and the database's wipe rule matched against rules.js over a random run of claims and wipes | tests: pass (server 21/21, store 14/14)
#11 | 2026-10-28 10:20 | README updated for the new files and the create-map script; full suite run | tests: 63 pass, 1 timed out (the "server exits when the database is unreachable" test: 77 s in a run where this computer was slow, 210 s total vs the usual 65 s; it passes alone in 10 s; nothing it covers changed)

## Summary (queue done, stopping)
- Done: 1 rules file with pure functions; 2 upgrade plumbing (no effect by default); 3 stats with "stat" events; 4 achievement engine with placeholders; 5 multi-map backend and create-map script; 6 name-label logic; 7 hardening (growth no longer slows down on big maps, big messages compressed, reconnect guard, randomized tests).
- New database migrations 003-006 on this branch (upgrade levels, stats, achievements, edge spots); all add tables or columns and apply on top of what is live. Not merged: main is untouched.
- Waiting on you: Q1 upgrade formula, Q2 record vs current squares/lines, Q3 achievements per player or per map, Q4 what "25% of the screen" means. Each is a small change once answered.
- Not built (off-limits or needs your design): buying upgrades, the real achievement list, the map picker, wipe confirmation and coverage picker in the menu, drawing name labels. Also noted: when upgrades can be bought, the server's cached levels must be refreshed at the moment of purchase.

## Loop order 2: new hit system

#12 | 2026-10-28 | new hit system: every block takes HITS_PER_BLOCK = 10; a click counts as Click Power hits (multiplier, fractions kept); Defense multiplies the hits needed; cracks fade 1 hit per 60 s; browsers get progress as a share (p) and the 2 existing crack stages split it evenly; balances keep fractions (migration 007, numeric to 6 places), players see the rounded-down number; Q1-Q4 marked answered | tests: pass (rules 6/6, store + server 35/35)
#13 | 2026-10-28 | GAME-RULES.md: every rule in plain English with each number and where it lives; README updated for 10 hits | tests: n/a (docs only)

#14 | 2026-10-28 | achievement draft posted as Q5 (30 achievements on existing stats); not added to the game | tests: n/a
QUESTION Q5: approve this achievement list (30, replaces the 8 placeholders; each earned once per player)?
  Empty blocks claimed: First Block 1, Settler 10, Pioneer 50, Homesteader 250, Frontier 1,000, Founder 5,000
  Blocks owned at once: Plot 10, Field 50, Estate 100, Domain 500, Province 1,000, Kingdom 5,000, Empire 10,000
  Largest solid square: Little Square 3x3, Courtyard 5x5, 10 by 10, 25 by 25, 50 by 50, 100 by 100
  Longest straight line: Fence 5, Line of 10, Wall 25, Long Wall 50, Line of 100
  Blocks taken from others: First Raid 1, Raider 10, Conqueror 100, Warlord 1,000
  Blocks lost to others: Under Attack 1, Battle-Scarred 100
  | A: approve as is / B: change names or numbers (say which) / C: also add shapes or counts that need new stats (e.g. hollow ring, cross, maps played on) | pick A: uses only stats already tracked, so adding it is a data-only change in achievements.js; C can come later | OPEN

#15 | 2026-10-28 | merge readiness: full suite run; iterate is ahead of main with no conflicts (main has nothing iterate lacks); merge steps below | tests: pass (65/65, 118 s)

## Merge steps for Xoren (iterate -> main)

Before you start: this changes live gameplay. Blocks take 10 hits instead of 3. Any half-cracked blocks reset when the server restarts, as on every deploy. Blocks, names and squares balances are kept.

1. Backup (optional, recommended): Neon console -> project -> Branches -> production. Note the time now. If anything goes wrong, Restore on that page can put production back to that time, within the restore window it shows.
2. Go to github.com/spudeth/territory -> Pull requests -> New pull request.
3. Set base: main and compare: iterate. It should say "Able to merge". -> Create pull request -> Create pull request again.
4. Click Merge pull request -> Confirm merge. Leave the iterate branch; don't delete it.
5. Render dashboard -> the territory service -> Events. Wait for the new deploy to say Live (a few minutes).
6. Render -> Logs. You should see "Applied migrations: 003_upgrades.sql, 004_player_map_stats.sql, 005_achievements.sql, 006_map_edges.sql, 007_fractional_squares.sql", then "Accounts are on." If you see "Startup failed", stop and send me that line. The old version keeps running until a new one starts.

Then check on territory.sarl (a private window is fine):
- The map loads, with everyone's blocks where they were.
- Tap an empty block: the crack shows from the first tap, gets bigger past half way, and the block is taken on the 10th tap.
- Stop half way and wait 1 minute: the crack fades a little (1 hit per minute).
- Retake a block next to yours from another player (a second browser works): also 10 taps.
- Log in on an existing account: same name, same blocks.
- Menu -> Settings -> rename still works.
- Tell me if anything looks off. Squares aren't shown on screen yet, so there's nothing to check there.

## Summary (loop order 2 done, stopping)
Built the 10-hit system (one setting; Click Power, Defense and Earnings are multipliers, all 1.0), fractional squares balances (migration 007), and crack art driven by progress share. Added GAME-RULES.md. Achievement draft is Q5, OPEN. Full suite 65/65. Ready to merge with the steps above.

## Loop order 3: the menu from the design

#16 | 2026-10-28 | wipe unlocks color, skin and coverage on that map only (migration 008: unlocked column, trigger allows one change while unlocked; next claim locks again); setup event replaces coverage (8 colors in rules.COLORS, owned skins, coverage); welcome now carries squares (whole), wipe floor and the choices; GAME-RULES.md updated | tests: pass (server 22/22)
#17 | 2026-10-28 | HUD restyle from the design: fonts, palette, 3px borders, pixel shadows and icons; player card with color, name, blocks and whole squares; leaderboard; yellow MENU button bottom-left | tests: checked in Chrome, phone and desktop
#18 | 2026-10-28 | menu hub: account card (GUEST / ACCOUNT / VISITOR tag, map, squares), Log in / Sign up for guests, tiles (Upgrades, Get squares, VIP marked SOON), Settings, legal links; desktop shows it as a centered card with 3 columns | tests: checked in Chrome
#19 | 2026-10-28 | account screens: Log in / Sign up tabs, Google, email and password, 6-digit code, forgot and reset password, wired to the existing login | tests: checked in Chrome (no real sign-up run, to spare Neon's login limit)
#20 | 2026-10-28 | settings: rename with counter, rules text and cooldown message; this map's locked choices; wipe button; log out (accounts only) | tests: checked in Chrome
#21 | 2026-10-28 | wipe dialog: real block count and floor, type WIPE to confirm, wired to the wipe; afterwards the setup screen opens | tests: checked in Chrome (wipe then setup)
#22 | 2026-10-28 | maps: playing now (thumbnail of the real map, your blocks and rank, map size), map list with switching, Buy / Create as SOON | tests: server 23/23 (new menu data test), checked in Chrome
#23 | 2026-10-28 | setup screen: 8 colors, Default skin plus 4 locked, Per block / Full area, the lock warning, Spawn; shown on entering a map unlocked and after a wipe; choices resent if the connection restarts | tests: checked in Chrome
#24 | 2026-10-28 | skins: catalog with Default owned and the design's other skins locked, prices as SOON | tests: checked in Chrome
#25 | 2026-10-28 | upgrades: each level and its effect from rules.js (one level each today), buttons say SOON | tests: checked in Chrome
#26 | 2026-10-28 | achievements: the 8 placeholders with real progress (best on any map) and the map each was earned on, All / Earned / Locked filter, yellow pop-up with the description; name labels drawn on the map (white pixel letters, dark shadow) | tests: checked in Chrome

QUESTION Q6: what should SPAWN do on the setup screen? | A: save the choices and close, then you tap your own first block (built) / B: also claim a random empty block for you straight away | built A: it changes no game rule; B would be a new rule (where, how many hits) | OPEN
#27 | 2026-10-28 | merge readiness: full suite run; iterate merges into main with no conflicts (main's only extra commit is Xoren's merge of loop order 2) | tests: pass (67/67, 111 s)

## Merge steps for Xoren (iterate -> main), loop order 3

Before you start: the whole screen look changes (new HUD, menu, setup screen). Players' blocks, names, squares and colors are kept. Only one database change runs: 008, which lets a wipe unlock color, skin and coverage. Half-cracked blocks reset on restart, as on every deploy.

1. Optional backup: Neon console -> project -> Branches -> production. Note the time. Restore on that page can put production back to that time.
2. github.com/spudeth/territory -> Pull requests -> New pull request.
3. base: main, compare: iterate. It should say "Able to merge". -> Create pull request -> Create pull request.
4. Merge pull request -> Confirm merge. Keep the iterate branch.
5. Render -> the territory service -> Events: wait for the new deploy to say Live.
6. Render -> Logs: "Applied migrations: 008_unlock_after_wipe.sql", then "Accounts are on." If you see "Startup failed", stop and send me that line.

## Live checklist (territory.sarl, phone and computer)

- [ ] New visitor (private window): the setup screen opens first. Pick a color and Full area, press SPAWN.
- [ ] Tap an empty block 10 times: it turns your color; a yellow "First Block" pop-up shows; the top-left card says 1 block and 1 square.
- [ ] Menu (bottom left): your name, GUEST tag, map name, squares; tiles; Upgrades, Get squares and VIP marked SOON.
- [ ] Maps: Grass with your blocks and rank, the map list; switching works if there's a second map.
- [ ] Skins: Default owned, the rest locked with SOON. Upgrades: Level 0 and its effect for all three. Achievements: First Block earned, the rest with progress bars; the filter tabs work.
- [ ] Settings: your color, skin and coverage with a lock. Wipe: shows your real block count, the button only works after typing WIPE; afterwards the setup screen opens again and a new color sticks after your next block.
- [ ] Log in / Sign up: both tabs, Google, the 6-digit code, forgot password still work (as before).
- [ ] Logged in: Settings rename shows the counter and, after a rename, the "change it again at" message.
- [ ] An existing player who joined before today keeps their old color until they wipe.
- [ ] Zoomed in on a big territory: the owner's name shows on it.

#28 | 2026-10-28 | readability: bold text (buttons, names, titles in Pixelify Sans) from weight 700 to 600; 700 closes up the letters at 14-18px | tests: n/a (style only; checked in Chrome)

## Summary (loop order 3 done, stopping)
Wipe now unlocks a map's color, skin and coverage (migration 008, trigger updated, GAME-RULES.md updated). Built the HUD and every menu screen from the approved design, wired to the real login, rename, wipe, maps, stats and achievements; prices show as SOON; the 8 placeholder achievements stay until Q5 is answered. Checked every screen in Chrome at phone and desktop sizes. Full suite 67/67. Open: Q5 (achievement list), Q6 (what Spawn does). Ready to merge with the steps above.

## Loop order 4: sounds, music and the tutorial

#29 | 2026-10-28 | Part 1: sound test page for Xoren: https://claude.ai/artifact/ArEFRCP9bmyiDKH5QQt6EL (private to Xoren's account; opens on a phone). 11 events, 31 options generated in code (public/sfx.js, also used by the game), Tap repeats at the same pitch with a "10 taps" button; 3 CC0 music loops with play, stop and loop; a "your picks" line to copy and send. CREDITS.md lists each track's source, author and license. All three tracks are CC0: no credit line is needed in the game | tests: every option rendered once in Node; page published

QUESTION Q7: which sounds and which music? | open the page above, tick one option per sound and one track, press "Copy my picks" and send the line (e.g. "Tap A, Claim B, …, Music C") | until then the game uses option A of each and Music A | ANSWERED: Tap B, Claim B, Taken A, Grow A, Achievement B, Menu open B, Menu close B, Not allowed B, Wipe A, Spawn C, Music A (Button not picked: stays A)
#30 | 2026-10-28 | Part 2: sounds in the game with Xoren's picks (Q7); own sounds full volume; other players' taps, claims and new blocks only near the view, quieter with distance, panned left/right; at most 6 at once; music loops after the first tap at 25%; Settings > Sound: effects and music sliders with mute, saved on the device | tests: in-memory placement tests pass; checked in Chrome (sliders, mute remembered)
#31 | 2026-10-28 | Part 3: tutorial engine (coach.js) runs steps and tips from tutorial.js (data only: id, text, highlight, start, done); 10 steps (goal, claiming with a 3/10 counter, growth with the new block outlined and centred, range, taking, menu tour); Skip; Menu > How to play replays; 4 one-time tips | tests: data checks pass; walked through in Chrome on phone and desktop
#32 | 2026-10-28 | tutorial progress saved per player (migration 009: players.tutorial; existing players marked done), on the device for visitors, moved to the player on their first claim (the same row becomes their account); saves applied in order (a race lost the latest step in testing); a tip counts as seen only once shown; fixed a clash that stopped the map drawing (two scripts both had a global render) | tests: server 24/24 plus a save-order test; reload mid-tutorial resumes at the same step in Chrome

QUESTION Q8: the tutorial and tip wording, for Xoren to edit (send back any line you want changed). {hits} shows as 10.
  Steps:
  1 THE GOAL: Own the most blocks on this map. The leaderboard shows who is winning.
  2 CLAIMING: Tap an empty block {hits} times to claim it. Keep tapping the same block. (shows 3/10 as you tap)
  3 GROWTH: Every brand-new block you claim makes the map grow. This block just appeared on the edge.
  4 RANGE: You can only claim blocks touching your land. Those are lit up.
  5 TAKING: You can take other players' blocks the same way, and they can take yours.
  6 THE MENU: Open the menu.
  7 MAPS: Switch to other maps here.
  8 SKINS: Skins change how your land looks.
  9 ACHIEVEMENTS: Your achievements and how close you are to the next ones.
  10 SETTINGS: Your name, sound and music, and a fresh start on this map. That is everything. Have fun!
  Tips (once each):
  A BLOCK WAS TAKEN: Someone took one of your blocks. Take it back the same way: tap it {hits} times.
  OUT OF RANGE: You can only claim blocks touching your land: up, down, left or right. The lit-up blocks are in range.
  YOUR FIRST SQUARE: You earn squares for claiming brand-new blocks. Soon you can spend them on skins and more.
  YOUR FIRST ACHIEVEMENT: See them all, and what comes next, in Menu > Achievements.
  | A: keep as written / B: send changes | built A | OPEN
#33 | 2026-10-28 | merge readiness: full suite run; iterate merges into main with no conflicts (main already has loop order 3) | tests: pass (72/72, 155 s)

## Merge steps for Xoren (iterate -> main), loop order 4

Before you start: this adds sounds, music, the sound settings and the tutorial. One database change runs: 009, which stores tutorial progress. Everyone who has already played is marked as having finished the tutorial, so only brand-new players see it. Blocks, names and squares are kept.

1. Optional backup: Neon console -> project -> Branches -> production. Note the time. Restore on that page can put production back to that time.
2. github.com/spudeth/territory -> Pull requests -> New pull request.
3. base: main, compare: iterate. It should say "Able to merge". -> Create pull request -> Create pull request.
4. Merge pull request -> Confirm merge. Keep the iterate branch.
5. Render -> the territory service -> Events: wait for the new deploy to say Live.
6. Render -> Logs: "Applied migrations: 009_tutorial.sql", then "Accounts are on." If you see "Startup failed", stop and send me that line.

## Live checklist (territory.sarl): do it once on a phone and once on a computer

Sound (phone: silent switch off)
- [ ] Open the site in a private window. Nothing plays until you tap. On the first tap the music starts, quietly.
- [ ] Tapping a block plays the tap sound (Tap B), the same pitch every time. Claiming plays Claim B.
- [ ] Opening and closing the menu play Menu open B and Menu close B. Buttons inside it click.
- [ ] Tapping a block that doesn't touch your land plays Not allowed B.
- [ ] Spawn plays Spawn C. Wipe plays Wipe A. A new achievement plays Achievement B with the yellow pop-up.
- [ ] With a second device on the same map: its taps and claims are quieter and come from the left or right depending on where they are on your screen; scroll far away and they go silent. If the second device takes one of your blocks, you hear Taken A at full volume.

Sliders
- [ ] Menu > Settings > Sound: moving each slider changes that volume; each mute button silences only its own sound, and turns red.
- [ ] Reload the page: the sliders and mutes are as you left them.

Tutorial (private window, so you're brand new)
- [ ] After SPAWN, "HOW TO PLAY 1/10 – THE GOAL" shows, with a blinking yellow frame around the leaderboard.
- [ ] Next -> CLAIMING: tap one empty block; the counter goes 1/10, 2/10, … and the step moves on when the block is yours.
- [ ] GROWTH: the map moves to a new block on its edge, outlined in yellow.
- [ ] RANGE: the blocks touching yours are outlined. TAKING: other players' blocks are outlined, if there are any.
- [ ] THE MENU: the Menu button is framed; opening the menu moves on. MAPS, SKINS, ACHIEVEMENTS, SETTINGS each get a frame; the last button says Done.
- [ ] Reload partway through (after claiming): it comes back at the same step.
- [ ] Skip ends it for good. Menu > How to play starts it again from step 1.
- [ ] Tips (once each, ever): tap a block far from your land ("OUT OF RANGE"), your first square, your first achievement, and the first time someone takes one of your blocks.
- [ ] Sign up from a guest who is partway through: the tutorial continues where it was on the account.
- [ ] Log in on an account that played before today: no tutorial appears.

## Summary (loop order 4 done, stopping)
Sound test page published and answered (Q7). Sounds wired with Xoren's picks; spatial sound for other players with a 6-sound cap; looping CC0 music (no credit needed; CREDITS.md); Settings > Sound sliders and mutes saved per device. Tutorial built from data (tutorial.js) with a small engine (coach.js), saved per player (migration 009), with Skip, How to play and 4 one-time tips; walked through in Chrome on phone and desktop. Full suite 72/72. Open: Q5 (achievements), Q6 (Spawn), Q8 (tutorial wording). Ready to merge with the steps above.

## Loop order 5: game rules from Xoren's Google Sheet

#34 | 2026-10-28 | read the sheet (public CSV): Inputs, Summary, Click Power (70 levels), Defense (50), Earnings (100), Growth (5) exist; Game Rules doesn't yet. Note: for a missing tab, Google's export quietly returns the first tab instead, so the sync checks each tab's header row. Game Rules list below for Bob | tests: n/a

### The Game Rules tab (for Bob to add)

Three columns, header row exactly: Key | Value | What it means. Keys must match exactly; the order doesn't matter. Values are plain numbers (commas like 1,000 are fine).

| Key | Value | What it means |
| --- | --- | --- |
| hitsPerBlock | 10 | Hits needed to take any block, empty or owned, before upgrades |
| crackFadeSeconds | 60 | A cracked block fades every this many seconds since it was last hit… |
| crackFadeHits | 1 | …by this many hits |
| squaresPerFirstClaim | 1 | Squares for claiming a brand-new block, before Earnings (and only beyond the wipe floor) |
| guestsPerIp | 5 | New guest players one network can create… |
| guestWindowMinutes | 60 | …in this many minutes |
| renameWaitMinutes | 10 | Minutes to wait between name changes |
| nameMaxLength | 15 | Longest name, in characters (1 to 15; above 15 needs a database change) |
| nameLabelShare | 0.25 | A territory shows its owner's name once it covers this share of the screen (0.25 = a quarter) |
| newMapWidth | 32 | Width in blocks of a new map made with the admin script |
| newMapHeight | 32 | Height in blocks of a new map made with the admin script |
| soundMaxAtOnce | 6 | Most sound effects playing at once |
| soundHearingDistance | 1.2 | How far away other players are heard, in half-screens from the middle |
| soundOthersVolume | 0.6 | Other players' sounds at the middle of the screen, compared with your own (1) |
| defaultEffectsVolume | 0.7 | Sound effects volume for a new device (0 to 1) |
| defaultMusicVolume | 0.25 | Music volume for a new device (0 to 1) |
| achievement.first-block | 1 | First Block: empty blocks claimed |
| achievement.owned-100 | 100 | 100 Blocks: blocks owned at once |
| achievement.owned-1000 | 1000 | 1,000 Blocks: blocks owned at once |
| achievement.square-10 | 10 | 10 by 10: side of the largest solid square |
| achievement.square-50 | 50 | 50 by 50: side of the largest solid square |
| achievement.line-10 | 10 | Line of 10: longest straight line |
| achievement.line-100 | 100 | Line of 100: longest straight line |
| achievement.retakes-10 | 10 | Raider: blocks taken from other players |

The achievement rows are the 8 placeholders; when Q5 is approved the keys change to the new list.
Upgrades are not in this tab: they come from the Click Power, Defense, Earnings and Growth tabs (Level, Value after, Cost (squares)). Level 0 is always "no upgrade" (value 1, free).
Not in the sheet, on purpose (code, not game numbers): the 8 colors, coverages, the 6 decimal places of a squares balance (tied to the database column), tap-vs-drag slop and zoom limits.

Same rows ready to paste into cell A1 of the new tab (comma-separated):
Key,Value,What it means
hitsPerBlock,10,"Hits needed to take any block, empty or owned, before upgrades"
crackFadeSeconds,60,A cracked block fades every this many seconds since it was last hit…
crackFadeHits,1,…by this many hits
squaresPerFirstClaim,1,"Squares for claiming a brand-new block, before Earnings (and only beyond the wipe floor)"
guestsPerIp,5,New guest players one network can create…
guestWindowMinutes,60,…in this many minutes
renameWaitMinutes,10,Minutes to wait between name changes
nameMaxLength,15,"Longest name, in characters (1 to 15; above 15 needs a database change)"
nameLabelShare,0.25,A territory shows its owner's name once it covers this share of the screen (0.25 = a quarter)
newMapWidth,32,Width in blocks of a new map made with the admin script
newMapHeight,32,Height in blocks of a new map made with the admin script
soundMaxAtOnce,6,Most sound effects playing at once
soundHearingDistance,1.2,"How far away other players are heard, in half-screens from the middle"
soundOthersVolume,0.6,"Other players' sounds at the middle of the screen, compared with your own (1)"
defaultEffectsVolume,0.7,Sound effects volume for a new device (0 to 1)
defaultMusicVolume,0.25,Music volume for a new device (0 to 1)
achievement.first-block,1,First Block: empty blocks claimed
achievement.owned-100,100,100 Blocks: blocks owned at once
achievement.owned-1000,1000,"1,000 Blocks: blocks owned at once"
achievement.square-10,10,10 by 10: side of the largest solid square
achievement.square-50,50,50 by 50: side of the largest solid square
achievement.line-10,10,Line of 10: longest straight line
achievement.line-100,100,Line of 100: longest straight line
achievement.retakes-10,10,Raider: blocks taken from other players

QUESTION Q9: the Growth tab doesn't match the order. The sheet has 5 levels with values 1.80, 2.60, 3.40, 4.20, 5.00 (max 5, marked as placeholders); the order says whole numbers 2, 3, 4, 5, 6. | A: change the sheet to 2, 3, 4, 5, 6 (set Growth's max to 6, whole numbers) / B: keep fractions and treat them as chances (1.8 = 1 block plus an 80% chance of a second) / C: something else | built A: the sync accepts only whole Growth values, so it refuses the sheet as it is now and says which cells | ANSWERED: A, whole numbers, Growth 2, 3, 4, 5, 6 over 5 levels (the sheet now has these)
#35 | 2026-10-28 | npm run sync-rules: downloads the 5 tabs (public CSV), checks them (tabs and columns by header, so a missing tab is caught; numbers with commas; no blanks; levels 1, 2, 3…; values and costs only go up; Growth whole numbers; every Game Rules key known, present once and in range) and writes data/economy.json only if everything passes, naming each bad cell; reports changes in plain English and how stored levels will move; --check and --from <saved folder> | tests: economy 9/9, offline from a saved copy in test/fixtures/sheet
#36 | 2026-10-28 | rules.js reads data/economy.json: every game number (hits, fade, squares, guest limit, rename wait, name length, label share, new-map size, sound tuning, achievement thresholds) and the upgrade tables with costs; nothing hard-coded except code constants (6 square decimals, colors, coverages, tap slop, zoom). The browser gets the numbers it needs in the welcome. The first economy.json holds today's values with no upgrade levels, so the game plays the same until the first real sync | tests: pass
#37 | 2026-10-28 | Growth upgrade: players.growth (migration 010); a brand-new claim creates rules.growthBlocks blocks (1 at level 0), each at a random edge spot like the normal one; a Growth card on the Upgrades screen; long level tables show a bar and an "All N levels" list | tests: Growth test (3 new blocks per claim)
#38 | 2026-10-28 | option B remapping: economy_applied records the tables stored levels refer to; at startup, if a merged sync changed them, every stored level moves to the lowest new level at least as strong (top level if none is), in one statement per upgrade so nobody moves twice; each move recorded in level_remaps and printed in the server log; the sync report lists how levels will move | tests: economy 9/9 (remap rules over the real tables), store remap test; affected files 69/70 on one run (the "wipe unlocks" test failed once, not reproduced in 4 runs since; not touched by this loop; watching it)
#39 | 2026-10-28 | real sync attempted (--check): blocked. The sheet has no Game Rules tab yet, and Growth now has 6 levels with fractions (1.83, 2.67, 3.5, 4.33, 5.17, …): Q9. Nothing written. Starting loop order 6 meanwhile; the real sync, change summary and loop 5 merge steps follow once the tab exists and Q9 is answered | tests: n/a

## Loop order 6: squares and buying upgrades

#40 | 2026-10-28 | squares icon saved exactly as public/icons/square.svg and used everywhere squares appear (HUD, menu, shop, prices); the old inline icon removed | tests: checked in Chrome
#41 | 2026-10-28 | buying upgrades: Upgrades screen shows level, "now → next" effect (e.g. 9 → 8 clicks per block), the next cost with the icon, "Need X more" when short, MAX at the top; all four upgrades. Server: one transaction (row lock, exact balance check in SQL, cost taken, ledger row "upgrade:<name>:<level>", level raised); the tapped level must match (double taps refused), one purchase at a time per connection; new levels pushed to every connection and loaded map at once. Guests may buy; their row becomes their account | tests: shop 6/6; checked in Chrome with the saved sheet (30.5 squares, bought Click Power 1 for 22, 8.5 left)
#42 | 2026-10-28 | Purchase sound: 3 options added to the sound test page (same link), option A used until picked | tests: rendered
#43 | 2026-10-28 | tap-rate limit: token bucket per player (rules.tapAllowed), 12 taps a second suggested (people manage about 6-10 a second; bursts allowed up to 12), extra taps ignored; per-minute log of players who went over (tap_limit_log, migration 011, plus the server log); Game Rules key maxTapsPerSecond | tests: limiter unit test; shop test: 10 taps at once with a limit of 5 counts 5, logs 5 ignored, works again a second later

New Game Rules row for Bob (add under renameWaitMinutes):
maxTapsPerSecond,12,"Taps per player per second the server accepts; faster taps are ignored (anti-bot)"

QUESTION Q10: which Purchase sound? | Purchase A / B / C on the sound test page (https://claude.ai/artifact/ArEFRCP9bmyiDKH5QQt6EL) | using A until picked | OPEN
#44 | 2026-10-28 | merge readiness: full suite run. Found and fixed the cause of the occasional "wipe unlocks" failure (#38): a test bug, not the game: the claim on the second map announces the player in a random color, red one time in eight, and the test could read that old announcement instead of the new one; it now clears old events first (3/3 alone, then the full suite) | tests: pass (90/90, 119 s)

## Merge steps for Xoren (iterate -> main), loops 5 and 6

What this merge does: game numbers come from data/economy.json (today's values, so play is the same); the Growth upgrade; buying upgrades; the squares icon; the tap-rate limit (12 taps a second). Two database changes run: 010 (Growth, level-move records) and 011 (tap-limit log). Blocks, names, squares and settings are kept.
Important: the upgrade levels and prices aren't in economy.json yet (the sheet needs the Game Rules tab and whole-number Growth values, Q9). Until a real sync is merged, the Upgrades screen says "No levels yet" and nothing can be bought. You can merge now (everything else works), or wait and merge once the sync is in, so buying launches with it.

1. Optional backup: Neon console -> project -> Branches -> production. Note the time. Restore on that page can put production back to that time.
2. github.com/spudeth/territory -> Pull requests -> New pull request. base: main, compare: iterate. "Able to merge" -> Create pull request -> Create pull request.
3. Merge pull request -> Confirm merge. Keep the iterate branch.
4. Render -> the territory service -> Events: wait for Live.
5. Render -> Logs: "Applied migrations: 010_growth_and_remaps.sql, 011_tap_limit_log.sql", then "Accounts are on." No "Upgrade levels moved" lines are expected this time. If you see "Startup failed", stop and send me that line.

## Live checklist (territory.sarl), phone and computer

- [ ] The HUD, the menu card and the Upgrades screen show the new square icon (a white square with a dark pixel outline).
- [ ] Play as before: 10 taps take a block, the map grows by one block per brand-new block.
- [ ] Tap one block as fast as you can: it still works at a normal fast pace. (Only more than 12 taps a second are ignored.)
- [ ] Menu > Upgrades: four cards (Click Power, Defense, Earnings, Growth). Until the sync is merged they say "No levels yet".
After a real sync is merged (I'll post its own steps):
- [ ] Each card shows Level 0 of N, "now → next" (e.g. 10 → 9 clicks per block) and the cost with the icon; short of squares it says "Need X more".
- [ ] Buy one you can afford: the purchase sound plays, the squares in the top-left drop by the cost, the level goes up, and the next tap on a block uses it.
- [ ] Tap Upgrade twice very fast: only one level is bought.
- [ ] As a guest: buy something, then sign up from that guest: the level is still there.

## Summary (loop order 6 done)
Squares icon in place; buying all four upgrades with squares (one transaction, exact fractions, double taps and two devices can't spend twice, instant effect everywhere, guests included and kept on sign-up); Purchase sound (Q10 open); tap-rate limit with a per-minute log. Full suite 90/90. Still open: Q5, Q6, Q8, Q9, Q10; the real sync (loop 5's last step) waits for the Game Rules tab and Q9. Next: loop order 7 (admin commands).
#45 | 2026-10-28 | real sync after Bob's update: Growth now passes (2, 3, 4, 5, 6) and the Game Rules tab's 24 rows all pass, but one row is missing: maxTapsPerSecond, added in loop 6 (#43), so the sync refused and wrote nothing. Bob: please add the row below, then I sync. Preview with that row added locally (nothing written): Click Power 0 → 70 levels (level 1 costs 22, top value 10); Defense 0 → 50 levels (124; ×3); Earnings 0 → 100 levels (9; ×10); Growth 0 → 5 levels (1,161; 6 blocks). All 24 rule values match today's game, so play doesn't change apart from upgrades becoming buyable. No stored levels move (everyone is at level 0) | tests: n/a

Row to add to the Game Rules tab (anywhere):
maxTapsPerSecond | 12 | Taps per player per second the server accepts; faster taps are ignored (anti-bot)
#46 | 2026-10-28 | real sync done (Bob added maxTapsPerSecond): data/economy.json written from the sheet. Change summary: Click Power 0 → 70 levels (level 1 costs 22, top value 10); Defense 0 → 50 levels (124; top ×3); Earnings 0 → 100 levels (9; top ×10); Growth 0 → 5 levels (1,161; top 6 blocks); every Game Rules value unchanged; no stored levels move (everyone is at level 0). Also: one test assumed upgrades did nothing at any level (updated), and the "database unreachable" startup test once saw Node itself crash on exit (0xC0000409): the server now closes its database pool before exiting | tests: pass (90/90, 118 s)

## Merge steps for Xoren (iterate -> main): the first real sync (with loops 5 and 6)

This merge turns on buying upgrades, with the levels and prices from your sheet. It also includes everything in loops 5 and 6 (#44 above). Database changes 010 and 011 run on start. Blocks, names and squares are kept.

1. Optional backup: Neon console -> project -> Branches -> production. Note the time. Restore on that page can put production back to that time.
2. github.com/spudeth/territory -> Pull requests -> New pull request. base: main, compare: iterate. "Able to merge" -> Create pull request -> Create pull request.
3. Merge pull request -> Confirm merge. Keep the iterate branch.
4. Render -> the territory service -> Events: wait for Live.
5. Render -> Logs: "Applied migrations: 010_growth_and_remaps.sql, 011_tap_limit_log.sql", then "Accounts are on." There should be no "Upgrade levels moved" lines (nobody has levels yet). If you see "Startup failed", stop and send me that line.

## Live checklist (territory.sarl), phone and computer

- [ ] Menu > Upgrades shows four cards: Click Power "Level 0 of 70", Defense "of 50", Earnings "of 100", Growth "of 5".
- [ ] Click Power says "10 → 9 clicks per block"; its button shows the square icon and 22.
- [ ] With fewer squares than a price, that button is greyed out and says "Need X more".
- [ ] Earn 22 squares (claim 22 brand-new blocks), then buy Click Power: the purchase sound plays, your squares drop by 22, the card says Level 1 of 70 and "9 → 8 clicks per block", and an empty block now takes 9 taps.
- [ ] Tap the Upgrade button twice very fast: only one level is bought.
- [ ] Open the game on a second device as the same player: after buying on one, the other shows the new squares straight away.
- [ ] Do the same as a guest, then sign up from that guest: the upgrade is still there.
- [ ] "All 70 levels" opens the full list with each level's effect and cost.


## Loop order 7: admin commands

#47 | 2026-10-28 | database for admin (migration 012): admin_log, bans, player_links (an account and a guest seen in one browser), players.deleted_at; the backup's table dump moved into db/index.js and a matching restore added (all tables in one transaction, ids kept, id counters continue, refuses a backup from a different database version) | tests: covered below
#48 | 2026-10-28 | server side (admin.js at /admin): ADMIN_KEY checked on every request (wrong or missing: refused, logged, slowed); production only with --prod and --prod only on production; preview, then run; destructive commands refused without a backup taken through the server in the last 10 minutes; every change logged. Commands: player, map, kick, give-squares, take-squares, wipe-player, wipe-map [--reset-size], wipe-all-maps, ban [--reason --days --wipe-blocks], unban, delete-account (Neon Auth user, sessions and email codes erased too), create-map, backup, restore. Changes reach players at once (maps reloaded and resent, players disconnected with a message). Connecting checks bans for the account and the browser's guest, and records the link | tests: admin 10/10
#49 | 2026-10-28 | npm run admin (scripts/admin.js): help in plain English; dev by default, --prod for the live game; shows the preview, asks for the name (or ALL MAPS / RESTORE) to be typed, saves the backup on this computer (backups/<dev|prod>-<time>-before-<command>.json), then runs; --yes skips only the typing. Players see "You've been banned" (with the reason), "Disconnected", "Account deleted" or "Game restored" instead of "reconnecting" | tests: admin 10/10
#50 | 2026-10-28 | ADMIN.md for Xoren: one-time setup (making the key, .env.admin, Render), opening a terminal, every command with an example and what it shows, what to do when something goes wrong, restoring (from a backup file, or Neon's restore); README and GAME-RULES.md updated. npm run create-map and npm run backup still work; the same things are now admin commands too | tests: pass (100/100, 149 s)
#51 | 2026-10-28 | Reset all progress (Xoren): Settings > ALL PROGRESS, type RESET. Empties their blocks on every map; squares, upgrades, stats, achievements, unlocked skins and looks back to new; keeps name, login, tutorial and paid skins; ledger "progress reset"; their other devices reload | tests: shop 7/7
#52 | 2026-10-28 | Music stations (Xoren): Heavenly Loop, Calm Ambient 1 and Outer Space Loop added beside the current track; "Change station" text button bottom right of the Sound box picks another track at random (short fade); CREDITS.md | checked in headless Chrome
#53 | 2026-10-28 | Text chat (Xoren): one chat per map, bottom right; guests chat once they have a player (first claim); bad-word filter (chat.js, disguises undone), 120 characters, 1 message per 2 s; tap a name to mute on this device, Unmute all; last 30 per map kept in memory only (no database); phones show a dot instead of messages while closed | tests: chat 3/3; checked in headless Chrome
#54 | 2026-10-28 | Square pop (Xoren, mockup PXtXotyzsRZayFM6m3pBXh): when the shown squares go up, the square icon rises off the top grid line of the block just claimed, 35% of a block, fast then slow with a matching fade; Xoren's picks: 28%, 1.15 blocks, 1350 ms, power 4.5, sits on the line | checked in headless Chrome
#55 | 2026-10-28 | Fix (Xoren, live): after Reset all progress, no squares on a map where they had no blocks left (taken by others): the server kept their old map record in memory, so it never stored a fresh one. The reset now reloads every map they played. The next deploy also restarts the server, which clears it for anyone already affected | tests: shop 8/8
#56 | 2026-10-28 | Name tags (Xoren: "we just need to see who's who"): every territory in view gets a tag on its deepest visible block, dark with the owner's color, yours gold and first; overlapping tags wait for zoom. Replaces Q4's 25%-of-screen rule. OPEN Q11 (Bob): the nameLabelShare row is now unused; remove it from the sheet, or should it come back as a minimum? | tests: labels 4/4; checked in headless Chrome

## Xoren's one-time setup for admin commands (details in ADMIN.md, section 1)

1. Open a terminal in the game folder (VS Code: Terminal -> New Terminal).
2. Make a key: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" -> copy what it prints. Don't paste it anywhere else.
3. Make the file .env.admin in the game folder with one line: ADMIN_KEY=<the key>. Save. (Git ignores it.)
4. Render -> territory -> Environment -> Add Environment Variable: ADMIN_KEY = the same key -> Save Changes.
5. After the merge below, check: npm run admin -- map Grass --prod prints the Grass map.

## Merge steps for Xoren (iterate -> main): loops 5, 6 and 7 with the first real sync

This merge brings: game numbers from your sheet with buyable upgrades (#46), Growth, the squares icon, the tap-rate limit, and the admin commands. Database changes 010, 011 and 012 run on start. Blocks, names, squares and settings are kept.

1. Do the one-time setup above first (at least step 4, so Render has ADMIN_KEY).
2. Optional backup: Neon console -> project -> Branches -> production. Note the time.
3. github.com/spudeth/territory -> Pull requests -> New pull request. base: main, compare: iterate. "Able to merge" -> Create pull request -> Create pull request.
4. Merge pull request -> Confirm merge. Keep the iterate branch.
5. Render -> territory -> Events: wait for Live.
6. Render -> Logs: "Applied migrations: 010_growth_and_remaps.sql, 011_tap_limit_log.sql, 012_admin.sql", "Accounts are on." and "Admin commands are on." If you see "Startup failed", stop and send me that line.

## Live checklist (territory.sarl)

Upgrades: the checklist under #46 above.
Admin (on your computer, with the setup done):
- [ ] npm run admin -- help lists the commands.
- [ ] npm run admin -- map Grass --prod shows Grass's size, claimed blocks and top players.
- [ ] npm run admin -- player "<your own name>" --prod shows you, with your squares and blocks.
- [ ] npm run admin -- backup --prod saves a file in the backups folder.
- [ ] npm run admin -- map Grass (without --prod, the dev server not running) says it can't reach the dev server: nothing went to the live game by accident.
- [ ] With a second browser as a throwaway guest: npm run admin -- kick "<that guest's name>" --prod -> that browser shows "DISCONNECTED"; Reload gets them back in.
- [ ] npm run admin -- ban "<that guest>" --reason test --days 1 --prod -> type the name -> a backup is saved, the browser shows "YOU'VE BEEN BANNED … Reason: test", and reloading doesn't let them in. Then unban "<that guest>" --prod -> they can play again.
- [ ] npm run admin -- give-squares "<that guest>" 5 --prod -> the squares in their top-left corner go up straight away.

## Summary (loop order 7 done, stopping)
Admin commands through the live server with a secret key, dev by default and --prod for the live game; previews, typed confirmation, a backup before every destructive command, and a log of everything; bans covering linked guests; account deletion that erases Neon Auth data; ADMIN.md for Xoren. Full suite 100/100. Open: Q5 (achievements), Q6 (Spawn), Q8 (tutorial wording), Q10 (Purchase sound).
#57 | 2026-10-28 | Loop 8: welcome screen (welcome.js) from Welcome.dc.html / WelcomeDesktop.dc.html: logo (placeholder in #logo) over the card, sound toggle top right, Privacy · Terms; card with name, color, GUEST/ACCOUNT, squares, map picker (arrows, live thumbnail, name, stats on two lines, dots), PLAY, Skins/Awards/Upgrades/Settings, Log in / Sign up for guests. Placeholder maps in PLACEHOLDER_MAPS (welcome.js) show COMING SOON. Server: 'maps' now answers each map's size and the player's blocks, rank and played (store.mapsFor) | tests: server maps test extended
#58 | 2026-10-28 | Loop 8: background = the live map, blurred 7px, dimmed 50%, drawn at 0.4-0.6 resolution; zooms out over 20 s then drifts (CSS only, paused when the tab is hidden); picker switches cross-fade it. PLAY: card fades and drops, blur clears, 1.2 s zoom to their territory (or a random open patch for players with no blocks there), HUD fades in at the end; new or wiped look -> setup, then the tutorial. MENU reverses it. Reduce motion: cross-fade only | checked in headless Chrome (below)
#59 | 2026-10-28 | Loop 8: MENU button now opens the welcome screen; menu screens' back buttons return to it; the old hub's How to play moved into Settings; the old hub's Get squares / VIP "soon" tiles and the Maps screen are no longer reachable (the picker replaces Maps). Tutorial menu tour points at the welcome screen (one line added: "Press PLAY to get back to your land."; Q8 wording still open). A tip showing when the welcome screen opens waits for the game | tests: tutorial test passes with the new highlights
#60 | 2026-10-28 | Loop 8 checks in headless Chrome, desktop 1440x900 and phone 390x844: new visitor opens on welcome; COMING SOON map; PLAY -> setup -> Spawn -> tutorial; claim; MENU back with "You: 1 block · #1"; Upgrades opens and returns; reload -> PLAY goes straight in, centred on their block; wipe -> setup; reduce motion (no zoom, no drift); phone with a 4x slower CPU: 61 fps on the welcome screen. Not checked: a logged-in account (needs an email code; only the tag and the hidden login button differ), switching between two real maps (dev has only Grass; covered by the server test) | full suite 106/106

#61 | 2026-10-28 | Bob fix 1: welcome screen on phones. Sizes scale with clamp() (logo, map preview, gaps, buttons) with minimums (text 14px, buttons 44px, preview 96px); padding 16-24px plus safe-area insets; height in dvh; centred only when it all fits, otherwise scrolls from the top; Privacy · Terms in the flow below the card | checked: iPhone SE 375x667 (scrolls), iPhone 15 393x852 (fits), large Android 412x915 (fits), all three in landscape (scroll), desktop: no overlaps, no sideways scroll, every minimum met
#62 | 2026-10-28 | Bob fix 2: slur variants. profanity.js hasSlur(): squeezes doubled letters and matches vowel and letter swaps (i/e/y, g/q/b, k/c) and -a/-ah/-uh/-er/-ur endings and plurals ("Nibba", "Niqqa", "Nibber", "Fagget", "Trannie", "Kyke"); names and chat both use it. Ordinary names still pass (Nigel, Nigeria, Nibble, Niblet, Tardis, Pakistan, Chinook…). New read-only admin command `bad-names` lists every existing name the filter blocks; renames nobody. Dev scan: 23 names, none blocked. Production: OPEN for Xoren after the deploy (the live server needs the new filter): `npm run admin -- bad-names --prod`, then rename or ban with the admin commands | tests: full suite 108/108

## Merge steps (loop 8, plus #53-#56 since Xoren's last merge)
1. On GitHub: open a pull request from `iterate` into `main` (it merges cleanly) and merge it.
2. Render deploys by itself. No database changes this time.
3. Logs should end with `Territory running on …`.

## Live checklist (after the deploy)
- Open the site: it opens on the welcome screen, over a blurred map that slowly zooms out.
- ◀ ▶: White Plains and ??? show COMING SOON; PLAY turns grey.
- PLAY: the card drops away and the map zooms in. On your own account you land on your territory.
- MENU: zooms back out to the welcome screen. Skins, Awards, Upgrades and Settings open and close back to it.
- In a private window (a brand-new guest): PLAY -> pick a look -> Spawn -> the tutorial starts.
- The sound button top right mutes and unmutes everything.
- Names: every territory shows a dark name tag on its own land.
- Mine a brand-new block: a square rises off it.
- Settings > Reset all progress on a test account, then mine again: squares come in.
- On a phone: the welcome screen fits (or scrolls) with nothing cut off or overlapping; Privacy · Terms sit below the card.
- After the deploy: `npm run admin -- bad-names --prod` lists names to deal with (the "Nibba" account should be there). Rename or ban them; nothing is renamed automatically.
- Try renaming an account to "Nibba" or "Niqqa": "That name isn't allowed".

Loop order 8 done. Open: Q5 (achievements), Q6 (Spawn), Q8 (tutorial wording), Q10 (Purchase sound), Q11 (nameLabelShare row). Stopping.

#63 | 2026-10-28 | Loop 9: public/terrain.js, one seeded algorithm shared by server and browser (integer hashing and plain arithmetic, so all engines agree): value-noise terrain for an endless world, a seeded connected starting island, and growthPick for the n-th growth. maps.seed and maps.grown (migration 013). Maps without a seed (today's Grass) stay all grass and grow at random | tests: terrain (same seed, same map; shares; connected 10,240-block island)
#64 | 2026-10-28 | Loop 9: terrain rules: water refused ("Water can't be claimed"), hits × sandHits / forestHits / stoneHits / goldHits (multiplies with Defense), gold pays goldBonusSquares on a first claim. 12 new Game Rules keys (below). wipe-map --reset-size gives a seeded map its starting island back and restarts its growth | tests: each terrain on a real map over sockets
#65 | 2026-10-28 | Loop 9: art. Kenney's site refused the download from here (403, bot check), so the terrain tiles are drawn for this game in the Tiny Town grass style (scratchpad script, colors from the grass tiles): sand, water in two frames (redrawn every 0.7 s only while water is on screen), forest tree, stone, gold nuggets on stone. Owned blocks keep the color tint. If Xoren downloads the Tiny Town pack, any tile can be swapped by replacing public/tiles/terrain-*.png | checked in headless Chrome
#66 | 2026-10-28 | Loop 9: `npm run admin -- create-map <name> [--seed <text>]` (random 8-character seed if none; --width/--height for a rectangle); `map <name>` shows the seed. Made "Seed Test" (seed "loop nine") on dev with it: 10,240 blocks, water 16%, sand 11%, grass 38%, forest 22%, stone 12%, gold 0.8%. Screenshots: docs/screenshots/loop9-overview.png (the whole island), loop9-closeup.png (a claimed patch by a lake, gold on the right), loop9-welcome.png (the welcome screen on it) | full suite 115/115

OPEN Q12 (Xoren): add these rows to the Game Rules tab, or `npm run sync-rules` will refuse (it checks every row is there):
newMapBlocks 10240 · terrainScale 28 · waterShare 0.12 · sandShare 0.07 · forestShare 0.18 · stoneShare 0.08 · goldShare 0.01 · sandHits 0.5 · forestHits 1.5 · stoneHits 3 · goldHits 1 · goldBonusSquares 5
(The values are my starting points: Bob's order set the rules, not the numbers.)

## Merge steps (loop 9)
1. Add the 12 Game Rules rows above to the sheet (not needed for the merge itself; the game uses data/economy.json).
2. On GitHub: pull request from `iterate` into `main`, merge. Render deploys.
3. Logs should show `Applied migrations: 013_seeds.sql`. The live Grass map is unchanged (no seed: all grass).

## Live checklist (loop 9)
- `npm run admin -- create-map "<name>" --seed "<text>" --prod` makes the first seeded map; `map "<name>" --prod` shows its seed.
- On the welcome screen, ▶ to the new map: the background shows lakes, sand, forest and stone; PLAY.
- Tap water: "Water can't be claimed". Sand takes 5 taps, forest 15, stone 30; a gold block pays 6 squares (1 + 5).
- Water ripples gently; claimed blocks show your color over the terrain.

#67 | 2026-10-28 | Sounds (Xoren): new "steal" sound when you take another player's block (three options on the sound test page, A until picked: OPEN Q14); PLAY on the welcome screen now plays the plain button click instead of the loud Spawn sound
Loop order 9 done. Open: Q5, Q6, Q8, Q10, Q11, Q12. Stopping.

#68 | 2026-10-28 | Loop 10: 300 achievements (generator in the scratchpad: ladders sized so each top tier is about 1,000 hours at 144 new blocks an hour; reward = 10 squares per hour of effort, at least 5; all 300 = about 30,000 hours, 571,508 squares). The 8 placeholder ids are kept, so earned ones still count | tests: list (300, secrets, rewards)
#69 | 2026-10-28 | Loop 10: Achievements tab in the sync (Key, Name, Category, Stat, Threshold, Secret, Description, Reward; every cell checked by name; known stats only); data/economy.json carries it; the 8 achievement.* rows left Game Rules. New Game Rules: rankMinPlayers 10, rankMinBlocks 100 | tests: economy (bad rows named by cell, missing tab)
#70 | 2026-10-28 | Loop 10: lifetime totals (totals.js, player_totals, migration 014 fills them from past play); earning pays the reward in the same transaction; checks per player in parallel; catch-up on connecting; secrets hidden ("???") until earned. Fixed on the way: a deadlock between a claim and an achievement save (the save no longer touches the map row), and a rank exploit found in the browser (ties counted as the better rank, so 1 block among beginners earned "#2"; now ties count against you and ranks need rankMinBlocks) | tests: achievements-live (fire once and pay once; secrets hidden then shown; catch-up; taps and squares counted)
#71 | 2026-10-28 | Loop 10: Awards screen grouped by category: next tier, reward, progress bar, tier pips, total out of 300, secrets as ???; the pop-up shows the reward. Browsers now always check for new game files (Cache-Control: no-cache), after Xoren's first seeded map showed all grass from cached old code | full suite 121/121; checked in headless Chrome

QUESTION Q13 (Bob's order named it Q11, which was already taken by nameLabelShare): the 300-achievement draft for the new **Achievements** tab, for Xoren's review. Paste the CSV below into a new tab named exactly `Achievements` (File > Import > Replace current sheet, or paste and split by comma). I added a **Reward** column after Description (squares paid; Bob's reward rule needs it in the sheet). Hours behind each reward: scratchpad `achievements-hours.txt`; ask if you want it as a column.
Also on Game Rules: add `rankMinPlayers` 10 and `rankMinBlocks` 100, and delete the 8 `achievement.*` rows, or `npm run sync-rules` will refuse.
Secrets (fun, fair, each cheap to spot): Castaway (a block with water on all 4 sides), Witching Hour (claim between 3:00 and 3:59 UTC), Leet (exactly 1,337 squares), Revenge (take a block back from whoever took it, within a minute), Poke Poke (tap your own blocks 50 times in one visit), Tree Hugger (25 forest claims in a row), Speed Run (10 empty blocks in a minute), Comeback Kid (lose every block on a map, then own 100 there again without wiping), Hello World (say it in chat), Wiped Out (wipe 1,000+ blocks).

```csv
Key,Name,Category,Stat,Threshold,Secret,Description,Reward
first-block,First Block,Claiming,claims,1,,Claim 1 empty block,0.5
claims-5,Homesteader,Claiming,claims,10,,Claim 10 empty blocks,4.5
claims-10,Settler,Claiming,claims,25,,Claim 25 empty blocks,7.5
claims-25,Pioneer,Claiming,claims,50,,Claim 50 empty blocks,10
claims-50,Trailblazer,Claiming,claims,100,,Claim 100 empty blocks,25
claims-100,Centurion,Claiming,claims,250,,Claim 250 empty blocks,75
claims-250,Land Baron,Claiming,claims,500,,Claim 500 empty blocks,100
claims-500,Frontier Lord,Claiming,claims,1000,,"Claim 1,000 empty blocks",250
claims-1k,Kilo Claimer,Claiming,claims,2500,,"Claim 2,500 empty blocks",750
claims-2500,Map Maker,Claiming,claims,5000,,"Claim 5,000 empty blocks",1000
claims-5k,Empire Builder,Claiming,claims,10000,,"Claim 10,000 empty blocks",2500
claims-10k,Ten Thousand Flags,Claiming,claims,25000,,"Claim 25,000 empty blocks",7500
claims-25k,Continental,Claiming,claims,50000,,"Claim 50,000 empty blocks",10000
claims-50k,Worldshaper,Claiming,claims,75000,,"Claim 75,000 empty blocks",10000
claims-100k,The Endless Frontier,Claiming,claims,100000,,"Claim 100,000 empty blocks",10000
owned-10,Plot Holder,Holding,owned,10,,Own 10 blocks at once on one map,0.3
owned-25,Small Holding,Holding,owned,25,,Own 25 blocks at once on one map,0.8
owned-50,Big Backyard,Holding,owned,50,,Own 50 blocks at once on one map,2
owned-100,Hundred Acres,Holding,owned,100,,Own 100 blocks at once on one map,5
owned-250,Estate,Holding,owned,250,,Own 250 blocks at once on one map,15
owned-500,Duchy,Holding,owned,500,,Own 500 blocks at once on one map,40
owned-1000,Kingdom of 1K,Holding,owned,1000,,"Own 1,000 blocks at once on one map",100
owned-2500,Superpower,Holding,owned,2500,,"Own 2,500 blocks at once on one map",300
owned-5000,Hegemon,Holding,owned,5000,,"Own 5,000 blocks at once on one map",800
owned-10k,Ten Thousand Strong,Holding,owned,10000,,"Own 10,000 blocks at once on one map",2000
square-2,Two by Two,Squares,bestSquare,3,,Own a solid 3 by 3 square of blocks,1.8
square-3,Tic-Tac-Toe,Squares,bestSquare,4,,Own a solid 4 by 4 square of blocks,3.6
square-4,Four Square,Squares,bestSquare,5,,Own a solid 5 by 5 square of blocks,6.3
square-5,High Five,Squares,bestSquare,7,,Own a solid 7 by 7 square of blocks,15
square-10,Perfect Ten,Squares,bestSquare,10,,Own a solid 10 by 10 square of blocks,40
square-15,Fifteen Square,Squares,bestSquare,15,,Own a solid 15 by 15 square of blocks,100
square-20,Scoreboard,Squares,bestSquare,20,,Own a solid 20 by 20 square of blocks,200
square-25,Quarter Century,Squares,bestSquare,25,,Own a solid 25 by 25 square of blocks,400
square-30,Thirty by Thirty,Squares,bestSquare,30,,Own a solid 30 by 30 square of blocks,600
square-40,Forty Fort,Squares,bestSquare,40,,Own a solid 40 by 40 square of blocks,1000
square-50,Half Century,Squares,bestSquare,50,,Own a solid 50 by 50 square of blocks,2000
line-3,Three in a Row,Lines,bestLine,5,,Own a straight line of 5 blocks,2.2
line-5,Five Alive,Lines,bestLine,8,,Own a straight line of 8 blocks,5.7
line-10,Ruler,Lines,bestLine,10,,Own a straight line of 10 blocks,8.9
line-15,Long Jump,Lines,bestLine,15,,Own a straight line of 15 blocks,20
line-20,Road Trip,Lines,bestLine,20,,Own a straight line of 20 blocks,40
line-25,Highway,Lines,bestLine,25,,Own a straight line of 25 blocks,60
line-50,Great Wall,Lines,bestLine,50,,Own a straight line of 50 blocks,200
line-75,Express Line,Lines,bestLine,75,,Own a straight line of 75 blocks,500
line-100,Century Line,Lines,bestLine,100,,Own a straight line of 100 blocks,800
line-150,Horizon Line,Lines,bestLine,150,,Own a straight line of 150 blocks,2000
taken-1,First Strike,Taking,taken,1,,Take 1 block from other players,0.1
taken-5,Pickpocket,Taking,taken,5,,Take 5 blocks from other players,0.4
retakes-10,Raider,Taking,taken,10,,Take 10 blocks from other players,0.8
taken-25,Bandit,Taking,taken,25,,Take 25 blocks from other players,2
taken-50,Marauder,Taking,taken,50,,Take 50 blocks from other players,4
taken-100,Pirate King,Taking,taken,100,,Take 100 blocks from other players,8
taken-250,Warlord,Taking,taken,250,,Take 250 blocks from other players,20
taken-500,Conqueror,Taking,taken,500,,Take 500 blocks from other players,40
taken-1k,Invader,Taking,taken,1000,,"Take 1,000 blocks from other players",80
taken-2500,Siege Engine,Taking,taken,2500,,"Take 2,500 blocks from other players",200
taken-5k,Juggernaut,Taking,taken,5000,,"Take 5,000 blocks from other players",400
taken-10k,Overlord,Taking,taken,10000,,"Take 10,000 blocks from other players",800
taken-25k,Unstoppable,Taking,taken,25000,,"Take 25,000 blocks from other players",2000
lost-1,Ouch,Losing,lost,1,,Lose 1 block to other players,0.1
lost-5,Bruised,Losing,lost,5,,Lose 5 blocks to other players,0.4
lost-10,Battle Scarred,Losing,lost,10,,Lose 10 blocks to other players,0.8
lost-25,Dented Armor,Losing,lost,25,,Lose 25 blocks to other players,2
lost-50,Thick Skin,Losing,lost,50,,Lose 50 blocks to other players,4
lost-100,Comeback Material,Losing,lost,100,,Lose 100 blocks to other players,8
lost-500,Punching Bag,Losing,lost,500,,Lose 500 blocks to other players,40
lost-1k,Unbothered,Losing,lost,1000,,"Lose 1,000 blocks to other players",80
lost-5k,Phoenix,Losing,lost,5000,,"Lose 5,000 blocks to other players",400
lost-10k,Unbreakable Spirit,Losing,lost,10000,,"Lose 10,000 blocks to other players",800
lost-25k,Eternal Optimist,Losing,lost,25000,,"Lose 25,000 blocks to other players",2000
taps-10,Tap Tap,Tapping,taps,1000,,"Tap blocks 1,000 times",1
taps-25,Double Digits,Tapping,taps,2500,,"Tap blocks 2,500 times",2.5
taps-100,Button Masher,Tapping,taps,5000,,"Tap blocks 5,000 times",5
taps-500,Clicker,Tapping,taps,10000,,"Tap blocks 10,000 times",10
taps-1k,Finger Workout,Tapping,taps,25000,,"Tap blocks 25,000 times",25
taps-5k,Rapid Fire,Tapping,taps,50000,,"Tap blocks 50,000 times",50
taps-10k,Turbo Button,Tapping,taps,100000,,"Tap blocks 100,000 times",100
taps-50k,Tap Dancer,Tapping,taps,250000,,"Tap blocks 250,000 times",250
taps-100k,Machine Gun Finger,Tapping,taps,500000,,"Tap blocks 500,000 times",500
taps-250k,Quarter Million,Tapping,taps,750000,,"Tap blocks 750,000 times",750
taps-500k,Half Million Hits,Tapping,taps,1000000,,"Tap blocks 1,000,000 times",1000
taps-1m,Million Tap Club,Tapping,taps,1500000,,"Tap blocks 1,500,000 times",1500
taps-2m,Tapocalypse,Tapping,taps,2000000,,"Tap blocks 2,000,000 times",2000
earned-1,Pocket Change,Earning,squaresEarned,25,,Earn 25 squares by claiming blocks,0.1
earned-10,Piggy Bank,Earning,squaresEarned,50,,Earn 50 squares by claiming blocks,0.2
earned-50,Coin Purse,Earning,squaresEarned,100,,Earn 100 squares by claiming blocks,0.4
earned-100,Savings Jar,Earning,squaresEarned,250,,Earn 250 squares by claiming blocks,1
earned-500,Treasure Chest,Earning,squaresEarned,500,,Earn 500 squares by claiming blocks,2
earned-1k,Vault Keeper,Earning,squaresEarned,1000,,"Earn 1,000 squares by claiming blocks",4
earned-5k,Gold Reserve,Earning,squaresEarned,5000,,"Earn 5,000 squares by claiming blocks",20
earned-10k,Square Mint,Earning,squaresEarned,10000,,"Earn 10,000 squares by claiming blocks",40
earned-50k,Treasury,Earning,squaresEarned,50000,,"Earn 50,000 squares by claiming blocks",200
earned-100k,Square Tycoon,Earning,squaresEarned,100000,,"Earn 100,000 squares by claiming blocks",400
earned-250k,Mega Mogul,Earning,squaresEarned,250000,,"Earn 250,000 squares by claiming blocks",1000
earned-500k,Infinite Wallet,Earning,squaresEarned,500000,,"Earn 500,000 squares by claiming blocks",2000
spent-10,Window Shopper,Spending,squaresSpent,10,,Spend 10 squares on upgrades,0.1
spent-100,First Splurge,Spending,squaresSpent,100,,Spend 100 squares on upgrades,0.4
spent-500,Shopaholic,Spending,squaresSpent,500,,Spend 500 squares on upgrades,2
spent-1k,Big Spender,Spending,squaresSpent,1000,,"Spend 1,000 squares on upgrades",4
spent-5k,High Roller,Spending,squaresSpent,5000,,"Spend 5,000 squares on upgrades",20
spent-10k,Spree,Spending,squaresSpent,10000,,"Spend 10,000 squares on upgrades",40
spent-50k,Splurge Lord,Spending,squaresSpent,50000,,"Spend 50,000 squares on upgrades",200
spent-100k,Bottomless Pockets,Spending,squaresSpent,100000,,"Spend 100,000 squares on upgrades",400
spent-500k,Market Maker,Spending,squaresSpent,500000,,"Spend 500,000 squares on upgrades",2000
spent-1m,All In,Spending,squaresSpent,1000000,,"Spend 1,000,000 squares on upgrades",4000
bought-1,First Upgrade,Upgrades,purchases,1,,Buy 1 upgrade level,0.1
bought-5,Tinkerer,Upgrades,purchases,5,,Buy 5 upgrade levels,0.5
bought-10,Mechanic,Upgrades,purchases,10,,Buy 10 upgrade levels,2.1
bought-25,Engineer,Upgrades,purchases,25,,Buy 25 upgrade levels,15
bought-50,Inventor,Upgrades,purchases,50,,Buy 50 upgrade levels,75
bought-100,Mad Scientist,Upgrades,purchases,100,,Buy 100 upgrade levels,300
bought-150,Overclocked,Upgrades,purchases,150,,Buy 150 upgrade levels,800
bought-200,Nearly Maxed,Upgrades,purchases,200,,Buy 200 upgrade levels,1500
bought-225,Fully Loaded,Upgrades,purchases,225,,Buy 225 upgrade levels,2000
clickpower-1,Stronger Taps,Upgrade levels,level:clickPower,1,,Reach Click Power level 1,0.1
clickpower-5,Iron Finger,Upgrade levels,level:clickPower,5,,Reach Click Power level 5,0.5
clickpower-10,Steel Finger,Upgrade levels,level:clickPower,10,,Reach Click Power level 10,1.4
clickpower-25,Diamond Finger,Upgrade levels,level:clickPower,25,,Reach Click Power level 25,8.5
clickpower-50,Thunder Finger,Upgrade levels,level:clickPower,50,,Reach Click Power level 50,100
clickpower-70,Max Power,Upgrade levels,level:clickPower,70,,Reach Click Power level 70,750
defense-1,Fence Builder,Upgrade levels,level:defense,1,,Reach Defense level 1,0.5
defense-5,Wall Raiser,Upgrade levels,level:defense,5,,Reach Defense level 5,3
defense-10,Fortified,Upgrade levels,level:defense,10,,Reach Defense level 10,7.9
defense-25,Bastion,Upgrade levels,level:defense,25,,Reach Defense level 25,50
defense-50,Impenetrable,Upgrade levels,level:defense,50,,Reach Defense level 50,600
earnings-1,Side Hustle,Upgrade levels,level:earnings,1,,Reach Earnings level 1,0.1
earnings-5,Day Trader,Upgrade levels,level:earnings,5,,Reach Earnings level 5,0.2
earnings-10,Investor,Upgrade levels,level:earnings,10,,Reach Earnings level 10,0.6
earnings-25,Banker,Upgrade levels,level:earnings,25,,Reach Earnings level 25,3.6
earnings-50,Tycoon,Upgrade levels,level:earnings,50,,Reach Earnings level 50,40
earnings-100,Golden Goose,Upgrade levels,level:earnings,100,,Reach Earnings level 100,5000
growth-1,Green Thumb,Upgrade levels,level:growth,1,,Reach Growth level 1,4.6
growth-2,Gardener,Upgrade levels,level:growth,2,,Reach Growth level 2,15
growth-3,Landscaper,Upgrade levels,level:growth,3,,Reach Growth level 3,30
growth-4,Terraformer,Upgrade levels,level:growth,4,,Reach Growth level 4,75
growth-5,World Grower,Upgrade levels,level:growth,5,,Reach Growth level 5,150
sand-1,Beachcomber,Terrain,terrain:sand,1,,Claim 1 sand block,0.2
sand-5,Sandcastle,Terrain,terrain:sand,5,,Claim 5 sand blocks,1
sand-10,Dune Walker,Terrain,terrain:sand,10,,Claim 10 sand blocks,2
sand-25,Sun Tan,Terrain,terrain:sand,25,,Claim 25 sand blocks,5
sand-50,Desert Rat,Terrain,terrain:sand,50,,Claim 50 sand blocks,10
sand-100,Sand Baron,Terrain,terrain:sand,100,,Claim 100 sand blocks,20
sand-250,Oasis Seeker,Terrain,terrain:sand,250,,Claim 250 sand blocks,50
sand-500,Dune King,Terrain,terrain:sand,500,,Claim 500 sand blocks,100
sand-1000,Sandstorm,Terrain,terrain:sand,1000,,"Claim 1,000 sand blocks",200
sand-2500,Sea of Sand,Terrain,terrain:sand,2500,,"Claim 2,500 sand blocks",500
sand-5000,Desert Emperor,Terrain,terrain:sand,5000,,"Claim 5,000 sand blocks",1000
sand-10000,Hourglass,Terrain,terrain:sand,10000,,"Claim 10,000 sand blocks",2000
forest-1,Woodland Walk,Terrain,terrain:forest,1,,Claim 1 forest block,0.1
forest-5,Lumberjack,Terrain,terrain:forest,5,,Claim 5 forest blocks,0.4
forest-10,Grove Keeper,Terrain,terrain:forest,10,,Claim 10 forest blocks,0.8
forest-25,Forester,Terrain,terrain:forest,25,,Claim 25 forest blocks,1.9
forest-50,Park Ranger,Terrain,terrain:forest,50,,Claim 50 forest blocks,3.8
forest-100,Timberland,Terrain,terrain:forest,100,,Claim 100 forest blocks,7.7
forest-250,Old Growth,Terrain,terrain:forest,250,,Claim 250 forest blocks,20
forest-500,Deep Woods,Terrain,terrain:forest,500,,Claim 500 forest blocks,40
forest-1000,Canopy King,Terrain,terrain:forest,1000,,"Claim 1,000 forest blocks",75
forest-2500,Evergreen,Terrain,terrain:forest,2500,,"Claim 2,500 forest blocks",200
forest-5000,Wildwood,Terrain,terrain:forest,5000,,"Claim 5,000 forest blocks",400
forest-10000,Ancient Forest,Terrain,terrain:forest,10000,,"Claim 10,000 forest blocks",750
forest-25000,Green Planet,Terrain,terrain:forest,25000,,"Claim 25,000 forest blocks",2000
stone-1,Rock Bottom,Terrain,terrain:stone,1,,Claim 1 stone block,0.2
stone-5,Pebble Pusher,Terrain,terrain:stone,5,,Claim 5 stone blocks,0.9
stone-10,Stone Mason,Terrain,terrain:stone,10,,Claim 10 stone blocks,1.7
stone-25,Quarry Worker,Terrain,terrain:stone,25,,Claim 25 stone blocks,4.3
stone-50,Cave Dweller,Terrain,terrain:stone,50,,Claim 50 stone blocks,8.7
stone-100,Boulder Basher,Terrain,terrain:stone,100,,Claim 100 stone blocks,15
stone-250,Rock Solid,Terrain,terrain:stone,250,,Claim 250 stone blocks,40
stone-500,Mountain Mover,Terrain,terrain:stone,500,,Claim 500 stone blocks,80
stone-1000,Granite Grip,Terrain,terrain:stone,1000,,"Claim 1,000 stone blocks",150
stone-2500,Stone Age,Terrain,terrain:stone,2500,,"Claim 2,500 stone blocks",400
stone-5000,Bedrock,Terrain,terrain:stone,5000,,"Claim 5,000 stone blocks",800
stone-10000,Mountain King,Terrain,terrain:stone,10000,,"Claim 10,000 stone blocks",1500
gold-1,Struck Gold,Terrain,terrain:gold,1,,Claim 1 gold block,1.4
gold-5,Nugget Hunter,Terrain,terrain:gold,5,,Claim 5 gold blocks,6.9
gold-10,Gold Panner,Terrain,terrain:gold,10,,Claim 10 gold blocks,15
gold-25,Gold Fever,Terrain,terrain:gold,25,,Claim 25 gold blocks,30
gold-50,Golden Touch,Terrain,terrain:gold,50,,Claim 50 gold blocks,75
gold-100,Mother Lode,Terrain,terrain:gold,100,,Claim 100 gold blocks,150
gold-250,El Dorado,Terrain,terrain:gold,250,,Claim 250 gold blocks,300
gold-500,Golden Age,Terrain,terrain:gold,500,,Claim 500 gold blocks,750
gold-1000,Gold Standard,Terrain,terrain:gold,1000,,"Claim 1,000 gold blocks",1500
maps-1,Tourist,Exploring,mapsPlayed,2,,Play on 2 maps,10
maps-2,Traveler,Exploring,mapsPlayed,3,,Play on 3 maps,20
maps-3,Globetrotter,Exploring,mapsPlayed,5,,Play on 5 maps,30
maps-5,Explorer,Exploring,mapsPlayed,10,,Play on 10 maps,60
maps-10,Cartographer,Exploring,mapsPlayed,20,,Play on 20 maps,100
days-1,Day One,Days,daysPlayed,2,,Play on 2 different days,8
days-5,Regular,Days,daysPlayed,5,,Play on 5 different days,20
days-10,Ten Day Trek,Days,daysPlayed,10,,Play on 10 different days,40
days-25,Familiar Face,Days,daysPlayed,25,,Play on 25 different days,100
days-50,Fifty Days,Days,daysPlayed,50,,Play on 50 different days,200
days-100,Old Timer,Days,daysPlayed,100,,Play on 100 different days,400
days-250,Veteran,Days,daysPlayed,250,,Play on 250 different days,1000
days-365,Year One,Days,daysPlayed,365,,Play on 365 different days,1500
days-500,Lifer,Days,daysPlayed,500,,Play on 500 different days,2000
streak-2,Back Again,Streaks,bestStreak,2,,Play 2 days in a row,10
streak-3,Hat Trick,Streaks,bestStreak,3,,Play 3 days in a row,15
streak-5,Workweek,Streaks,bestStreak,5,,Play 5 days in a row,25
streak-7,Full Week,Streaks,bestStreak,7,,Play 7 days in a row,40
streak-14,Fortnight,Streaks,bestStreak,14,,Play 14 days in a row,75
streak-30,Monthly,Streaks,bestStreak,30,,Play 30 days in a row,150
streak-60,Two Months Strong,Streaks,bestStreak,60,,Play 60 days in a row,300
streak-100,Hundred Day Combo,Streaks,bestStreak,100,,Play 100 days in a row,500
streak-180,Half Year,Streaks,bestStreak,180,,Play 180 days in a row,1000
streak-365,Year-Round,Streaks,bestStreak,365,,Play 365 days in a row,2000
rank-10,Top Ten,Rank,bestRank,10,,Reach the top 10 on a busy map,10
rank-5,Top Five,Rank,bestRank,5,,Reach the top 5 on a busy map,50
rank-3,Podium,Rank,bestRank,3,,Reach the top 3 on a busy map,200
rank-2,Runner-Up,Rank,bestRank,2,,Reach the top 2 on a busy map,600
rank-1,King of the Hill,Rank,bestRank,1,,Reach #1 on a busy map,2000
reign-1,Crowned,Reign,reignMinutes,1,,Spend 1 minute at #1 on a busy map,0.1
reign-10,Brief Reign,Reign,reignMinutes,10,,Spend 10 minutes at #1 on a busy map,0.7
reign-60,Hour on the Throne,Reign,reignMinutes,60,,Spend 60 minutes at #1 on a busy map,4
reign-300,Long Reign,Reign,reignMinutes,300,,Spend 300 minutes at #1 on a busy map,20
reign-1000,Dynasty,Reign,reignMinutes,1000,,"Spend 1,000 minutes at #1 on a busy map",60
reign-5000,Golden Era,Reign,reignMinutes,5000,,"Spend 5,000 minutes at #1 on a busy map",300
reign-10k,Empire Eternal,Reign,reignMinutes,10000,,"Spend 10,000 minutes at #1 on a busy map",600
reign-30k,Legendary Ruler,Reign,reignMinutes,30000,,"Spend 30,000 minutes at #1 on a busy map",2000
wipes-1,Clean Slate,Wipes,wipes,1,,Wipe your territory 1 time,4
wipes-5,Fresh Start,Wipes,wipes,5,,Wipe your territory 5 times,20
wipes-10,Spring Cleaning,Wipes,wipes,10,,Wipe your territory 10 times,40
wipes-25,Serial Restarter,Wipes,wipes,25,,Wipe your territory 25 times,100
wipes-50,Eraser Head,Wipes,wipes,50,,Wipe your territory 50 times,200
wipes-100,Eraser Champion,Wipes,wipes,100,,Wipe your territory 100 times,400
hours-1,Warm Up,Time,hoursPlayed,1,,Play actively for 1 hour,2
hours-5,Getting Into It,Time,hoursPlayed,5,,Play actively for 5 hours,10
hours-10,Hooked,Time,hoursPlayed,10,,Play actively for 10 hours,20
hours-25,Dedicated,Time,hoursPlayed,25,,Play actively for 25 hours,50
hours-50,Committed,Time,hoursPlayed,50,,Play actively for 50 hours,100
hours-100,Hundred Hours,Time,hoursPlayed,100,,Play actively for 100 hours,200
hours-250,Marathoner,Time,hoursPlayed,250,,Play actively for 250 hours,500
hours-500,Five Hundred Club,Time,hoursPlayed,500,,Play actively for 500 hours,1000
hours-1000,Thousand Hour Legend,Time,hoursPlayed,1000,,"Play actively for 1,000 hours",2000
session-10,Quick Run,Sessions,sessionClaims,25,,Claim 25 empty blocks in one visit,0.5
session-25,Session Grinder,Sessions,sessionClaims,50,,Claim 50 empty blocks in one visit,1
session-50,Binge,Sessions,sessionClaims,75,,Claim 75 empty blocks in one visit,1.6
session-100,Lost Track of Time,Sessions,sessionClaims,100,,Claim 100 empty blocks in one visit,2.1
session-250,All-Nighter,Sessions,sessionClaims,250,,Claim 250 empty blocks in one visit,5.2
session-500,Iron Will,Sessions,sessionClaims,500,,Claim 500 empty blocks in one visit,10
session-1000,No Sleep Club,Sessions,sessionClaims,1000,,"Claim 1,000 empty blocks in one visit",20
day-50,Productive Day,Big days,bestDayClaims,50,,Claim 50 empty blocks in one day,0.9
day-100,Big Day,Big days,bestDayClaims,100,,Claim 100 empty blocks in one day,1.8
day-250,Huge Day,Big days,bestDayClaims,250,,Claim 250 empty blocks in one day,4.5
day-500,Monster Day,Big days,bestDayClaims,500,,Claim 500 empty blocks in one day,9
day-1000,Legendary Day,Big days,bestDayClaims,1000,,"Claim 1,000 empty blocks in one day",20
chat-1,Hello There,Chat,chatMessages,1,,Send 1 chat message,0.1
chat-10,Chatty,Chat,chatMessages,10,,Send 10 chat messages,0.3
chat-25,Chatterbox,Chat,chatMessages,25,,Send 25 chat messages,0.8
chat-50,Talker,Chat,chatMessages,50,,Send 50 chat messages,1.7
chat-100,Social Butterfly,Chat,chatMessages,100,,Send 100 chat messages,3.3
chat-500,Town Crier,Chat,chatMessages,500,,Send 500 chat messages,15
chat-1000,Radio Host,Chat,chatMessages,1000,,"Send 1,000 chat messages",30
chat-5000,Voice of the Map,Chat,chatMessages,5000,,"Send 5,000 chat messages",150
held-10,Saver,Saving,squaresHeld,100,,Have 100 squares at once,0.7
held-50,Stash,Saving,squaresHeld,250,,Have 250 squares at once,1.7
held-100,Nest Egg,Saving,squaresHeld,500,,Have 500 squares at once,3.3
held-500,Hoarder,Saving,squaresHeld,1000,,"Have 1,000 squares at once",6.7
held-1000,Dragon Hoard,Saving,squaresHeld,2500,,"Have 2,500 squares at once",15
held-5000,Bank Vault,Saving,squaresHeld,5000,,"Have 5,000 squares at once",30
held-10k,Money Bin,Saving,squaresHeld,10000,,"Have 10,000 squares at once",60
held-50k,Sea of Squares,Saving,squaresHeld,50000,,"Have 50,000 squares at once",300
held-100k,Square Mountain,Saving,squaresHeld,100000,,"Have 100,000 squares at once",600
held-250k,Scrooge Mode,Saving,squaresHeld,250000,,"Have 250,000 squares at once",1500
growth-blocks-1,Sprout,Growth,growthBlocks,1,,Make 1 extra block appear with the Growth upgrade,0.1
growth-blocks-10,Budding,Growth,growthBlocks,10,,Make 10 extra blocks appear with the Growth upgrade,0.1
growth-blocks-100,Blooming,Growth,growthBlocks,100,,Make 100 extra blocks appear with the Growth upgrade,0.4
growth-blocks-1k,Overgrowth,Growth,growthBlocks,1000,,"Make 1,000 extra blocks appear with the Growth upgrade",4
growth-blocks-10k,Jungle Maker,Growth,growthBlocks,10000,,"Make 10,000 extra blocks appear with the Growth upgrade",40
growth-blocks-100k,Big Bang,Growth,growthBlocks,100000,,"Make 100,000 extra blocks appear with the Growth upgrade",400
grown-10,Edge Pusher,Map growth,mapGrown,10,,Make the map grow by 10 blocks,0.1
grown-100,Border Breaker,Map growth,mapGrown,100,,Make the map grow by 100 blocks,0.7
grown-1k,Land Raiser,Map growth,mapGrown,1000,,"Make the map grow by 1,000 blocks",6.9
grown-10k,Continent Maker,Map growth,mapGrown,10000,,"Make the map grow by 10,000 blocks",75
grown-100k,New World,Map growth,mapGrown,100000,,"Make the map grow by 100,000 blocks",750
grown-250k,Universe Builder,Map growth,mapGrown,250000,,"Make the map grow by 250,000 blocks",1500
renamed,New Me,Firsts,renames,1,,Choose your own name,0.2
account,Made It Official,Firsts,account,1,,Make an account,0.2
graduate,Graduate,Firsts,tutorialDone,1,,Finish the tutorial,0.4
meta-10,Collector,Collector,achievements,20,,Earn 20 achievements,50
meta-25,Badge Hunter,Collector,achievements,25,,Earn 25 achievements,75
meta-50,Trophy Case,Collector,achievements,50,,Earn 50 achievements,300
meta-100,Hall of Fame,Collector,achievements,100,,Earn 100 achievements,1000
meta-150,Legend,Collector,achievements,150,,Earn 150 achievements,2500
meta-200,Mythic,Collector,achievements,200,,Earn 200 achievements,5000
meta-250,Ascended,Collector,achievements,250,,Earn 250 achievements,7500
meta-290,Almost Everything,Collector,achievements,290,,Earn 290 achievements,10000
secrets-1,Snoop,Collector,secrets,1,,Find 1 secret achievement,40
secrets-5,Detective,Collector,secrets,5,,Find 5 secret achievements,200
secrets-10,Know-It-All,Collector,secrets,10,,Find 10 secret achievements,400
secret-castaway,Castaway,Secrets,secret:castaway,1,yes,Claim a block with water on all four sides,50
secret-witching,Witching Hour,Secrets,secret:witching,1,yes,Claim a block between 3:00 and 3:59 in the morning (UTC),20
secret-leet,Leet,Secrets,secret:leet,1,yes,"Have exactly 1,337 squares",100
secret-revenge,Revenge,Secrets,secret:revenge,1,yes,"Take a block back from the player who took it, within a minute",30
secret-poke,Poke Poke,Secrets,secret:poke,1,yes,Tap your own blocks 50 times in one visit,10
secret-treehugger,Tree Hugger,Secrets,secret:treehugger,1,yes,"Claim 25 forest blocks in a row, nothing else in between",80
secret-speedrun,Speed Run,Secrets,secret:speedrun,1,yes,Claim 10 empty blocks within one minute,40
secret-comeback,Comeback Kid,Secrets,secret:comeback,1,yes,"Lose every block on a map, then own 100 there again without wiping",100
secret-helloworld,Hello World,Secrets,secret:helloworld,1,yes,"Say ""hello world"" in the chat",10
secret-wipedout,Wiped Out,Secrets,secret:wipedout,1,yes,"Wipe a territory of 1,000 blocks or more",150
```

## Merge steps (loop 10)
1. Not needed for the merge, but before the next `npm run sync-rules`: the Achievements tab and the Game Rules changes above.
2. GitHub: pull request `iterate` -> `main`, merge. Render deploys and applies `014_totals.sql` (fills lifetime totals from past play).
3. Expect a burst on the first connect after the deploy: players are credited for what they already did (blocks, wipes, purchases, renames), with rewards. Biggest realistic case: a few thousand squares for a long-time player.

## Live checklist (loop 10)
- Menu (welcome screen) > Awards: categories with progress bars, "x / 300", a Secrets card with ??? rows.
- Claim a block on a fresh guest: First Block pops up with "+5 squares"; squares go up.
- Say "hello world" in chat: a secret appears, then shows its name on the Awards screen.

#72 | 2026-10-29 | Fix (Xoren): a single crack appeared on a just-claimed block about a minute later. Taps still in flight while a claim was being saved started a new crack on it, which the fade timer later showed. Taps on a block mid-claim are now ignored, and a claim clears any crack on its block | tests: regression test fails without the fix, passes with it
#73 | 2026-10-29 | Xoren: one rising square per square a claim mines (the server sends "mined" with the count; staggered 150 ms); achievement rewards no longer animate. Achievement pop-up shows the name and what was done, with "+N [square]" below
#74 | 2026-10-29 | Xoren: achievement rewards scaled to a fifth: base 1 square (was 5), 2 squares per hour of effort, so a 1,000-hour top tier pays about 2,000 (was 10,000). Overrides Bob's 'at least 10,000 for 1,000 hours'; the CSV above (Q13) is updated | tests updated

Loop order 10 done. Open: Q6, Q8, Q10, Q11, Q12, Q13, Q14. Stopping.

#75 | 2026-10-29 | Loop 11: scripts/skins/draw_skins.py draws every skin in code: 6 patterns (checker, stripes, brick, dots, plus rows and diamond) in two greys, tinted with the owner's color in the game; 199 flags (all 193 UN members plus EU, England, Scotland, Wales, Puerto Rico, Greenland) from their real colors and proportions, simplified to 16x16; each at 16x16 and a large version (patterns 64x64, flags 96 wide in their own proportions). Contact sheet: docs/screenshots/loop11-flags.png
#76 | 2026-10-29 | Loop 11: Skins tab in the sync (Key, Name, Kind, Rarity, Price, Collection, Enabled; every cell checked; each skin must have public/skins/<key>.png and <key>-large.png). data/economy.json carries the 205 skins. Collections are just a column, so a new one (Emoji) is: art files in public/skins/, rows in the tab | tests: sync validation
#77 | 2026-10-29 | Loop 11: buying skins: one transaction locking the player row (no double spend), ledger 'skin:<key>', the Purchase sound, counted as squares spent. Owned skins work on every map (same player row, so a guest's skins carry over to their account). Skins screen: collection tabs (All, Basic, Patterns, Flags, Owned), search, Buy with price and square icon, "Need X more", Owned. Setup screen: owned skins first, then the four cheapest locked ones with their price (tap opens the Skins screen); the "locked for this map" note stays | tests: exact price, one short, double tap and two devices, every map
#78 | 2026-10-29 | Loop 11: the map draws skins: per block (pattern tinted, or the art) or Full area (one large image per territory, scaled to cover its bounding box without stretching, clipped to its blocks). Art skins get a 2-texel border in the owner's color (patterns and the plain look keep 1). public/skins.js holds both rules | tests: border and cover fit; screenshots docs/screenshots/loop11-flag-per-block.png (Japan), loop11-flag-full-area.png (Brazil), loop11-skins-screen.png | full suite 128/128

QUESTION Q15 (Bob, Xoren): the Skins tab draft, ready to paste into a new tab named exactly `Skins`. Starting prices: patterns 100-300 (checker and stripes 100, brick and dots 150, rows 200, diamond 300), every flag 1,000 (Rare, one price). No Legendary skins yet. Questions inside it:
- Flags cover the 193 UN members. I left out the two UN observer states (Palestine, Vatican City) and disputed territories, to stay clear of politics; say if you want them.
- Afghanistan uses the flag the UN still seats (black, red, green); Syria uses the flag adopted in 2025 (green, white, black, three red stars).
- Coats of arms and emblems are simplified to a shape in their main color at 16x16.

```csv
Key,Name,Kind,Rarity,Price,Collection,Enabled
checker,Checker,pattern,Common,100,Patterns,yes
stripes,Stripes,pattern,Common,100,Patterns,yes
brick,Brick,pattern,Common,150,Patterns,yes
dots,Dots,pattern,Common,150,Patterns,yes
rows,Rows,pattern,Common,200,Patterns,yes
diamond,Diamond,pattern,Common,300,Patterns,yes
flag-af,Afghanistan,art,Rare,1000,Flags,yes
flag-al,Albania,art,Rare,1000,Flags,yes
flag-dz,Algeria,art,Rare,1000,Flags,yes
flag-ad,Andorra,art,Rare,1000,Flags,yes
flag-ao,Angola,art,Rare,1000,Flags,yes
flag-ag,Antigua and Barbuda,art,Rare,1000,Flags,yes
flag-ar,Argentina,art,Rare,1000,Flags,yes
flag-am,Armenia,art,Rare,1000,Flags,yes
flag-au,Australia,art,Rare,1000,Flags,yes
flag-at,Austria,art,Rare,1000,Flags,yes
flag-az,Azerbaijan,art,Rare,1000,Flags,yes
flag-bs,Bahamas,art,Rare,1000,Flags,yes
flag-bh,Bahrain,art,Rare,1000,Flags,yes
flag-bd,Bangladesh,art,Rare,1000,Flags,yes
flag-bb,Barbados,art,Rare,1000,Flags,yes
flag-by,Belarus,art,Rare,1000,Flags,yes
flag-be,Belgium,art,Rare,1000,Flags,yes
flag-bz,Belize,art,Rare,1000,Flags,yes
flag-bj,Benin,art,Rare,1000,Flags,yes
flag-bt,Bhutan,art,Rare,1000,Flags,yes
flag-bo,Bolivia,art,Rare,1000,Flags,yes
flag-ba,Bosnia and Herzegovina,art,Rare,1000,Flags,yes
flag-bw,Botswana,art,Rare,1000,Flags,yes
flag-br,Brazil,art,Rare,1000,Flags,yes
flag-bn,Brunei,art,Rare,1000,Flags,yes
flag-bg,Bulgaria,art,Rare,1000,Flags,yes
flag-bf,Burkina Faso,art,Rare,1000,Flags,yes
flag-bi,Burundi,art,Rare,1000,Flags,yes
flag-cv,Cabo Verde,art,Rare,1000,Flags,yes
flag-kh,Cambodia,art,Rare,1000,Flags,yes
flag-cm,Cameroon,art,Rare,1000,Flags,yes
flag-ca,Canada,art,Rare,1000,Flags,yes
flag-cf,Central African Republic,art,Rare,1000,Flags,yes
flag-td,Chad,art,Rare,1000,Flags,yes
flag-cl,Chile,art,Rare,1000,Flags,yes
flag-cn,China,art,Rare,1000,Flags,yes
flag-co,Colombia,art,Rare,1000,Flags,yes
flag-km,Comoros,art,Rare,1000,Flags,yes
flag-cg,Congo,art,Rare,1000,Flags,yes
flag-cr,Costa Rica,art,Rare,1000,Flags,yes
flag-ci,Cote d'Ivoire,art,Rare,1000,Flags,yes
flag-hr,Croatia,art,Rare,1000,Flags,yes
flag-cu,Cuba,art,Rare,1000,Flags,yes
flag-cy,Cyprus,art,Rare,1000,Flags,yes
flag-cz,Czechia,art,Rare,1000,Flags,yes
flag-cd,DR Congo,art,Rare,1000,Flags,yes
flag-dk,Denmark,art,Rare,1000,Flags,yes
flag-dj,Djibouti,art,Rare,1000,Flags,yes
flag-dm,Dominica,art,Rare,1000,Flags,yes
flag-do,Dominican Republic,art,Rare,1000,Flags,yes
flag-ec,Ecuador,art,Rare,1000,Flags,yes
flag-eg,Egypt,art,Rare,1000,Flags,yes
flag-sv,El Salvador,art,Rare,1000,Flags,yes
flag-gq,Equatorial Guinea,art,Rare,1000,Flags,yes
flag-er,Eritrea,art,Rare,1000,Flags,yes
flag-ee,Estonia,art,Rare,1000,Flags,yes
flag-sz,Eswatini,art,Rare,1000,Flags,yes
flag-et,Ethiopia,art,Rare,1000,Flags,yes
flag-fj,Fiji,art,Rare,1000,Flags,yes
flag-fi,Finland,art,Rare,1000,Flags,yes
flag-fr,France,art,Rare,1000,Flags,yes
flag-ga,Gabon,art,Rare,1000,Flags,yes
flag-gm,Gambia,art,Rare,1000,Flags,yes
flag-ge,Georgia,art,Rare,1000,Flags,yes
flag-de,Germany,art,Rare,1000,Flags,yes
flag-gh,Ghana,art,Rare,1000,Flags,yes
flag-gr,Greece,art,Rare,1000,Flags,yes
flag-gd,Grenada,art,Rare,1000,Flags,yes
flag-gt,Guatemala,art,Rare,1000,Flags,yes
flag-gn,Guinea,art,Rare,1000,Flags,yes
flag-gw,Guinea-Bissau,art,Rare,1000,Flags,yes
flag-gy,Guyana,art,Rare,1000,Flags,yes
flag-ht,Haiti,art,Rare,1000,Flags,yes
flag-hn,Honduras,art,Rare,1000,Flags,yes
flag-hu,Hungary,art,Rare,1000,Flags,yes
flag-is,Iceland,art,Rare,1000,Flags,yes
flag-in,India,art,Rare,1000,Flags,yes
flag-id,Indonesia,art,Rare,1000,Flags,yes
flag-ir,Iran,art,Rare,1000,Flags,yes
flag-iq,Iraq,art,Rare,1000,Flags,yes
flag-ie,Ireland,art,Rare,1000,Flags,yes
flag-il,Israel,art,Rare,1000,Flags,yes
flag-it,Italy,art,Rare,1000,Flags,yes
flag-jm,Jamaica,art,Rare,1000,Flags,yes
flag-jp,Japan,art,Rare,1000,Flags,yes
flag-jo,Jordan,art,Rare,1000,Flags,yes
flag-kz,Kazakhstan,art,Rare,1000,Flags,yes
flag-ke,Kenya,art,Rare,1000,Flags,yes
flag-ki,Kiribati,art,Rare,1000,Flags,yes
flag-kp,North Korea,art,Rare,1000,Flags,yes
flag-kr,South Korea,art,Rare,1000,Flags,yes
flag-kw,Kuwait,art,Rare,1000,Flags,yes
flag-kg,Kyrgyzstan,art,Rare,1000,Flags,yes
flag-la,Laos,art,Rare,1000,Flags,yes
flag-lv,Latvia,art,Rare,1000,Flags,yes
flag-lb,Lebanon,art,Rare,1000,Flags,yes
flag-ls,Lesotho,art,Rare,1000,Flags,yes
flag-lr,Liberia,art,Rare,1000,Flags,yes
flag-ly,Libya,art,Rare,1000,Flags,yes
flag-li,Liechtenstein,art,Rare,1000,Flags,yes
flag-lt,Lithuania,art,Rare,1000,Flags,yes
flag-lu,Luxembourg,art,Rare,1000,Flags,yes
flag-mg,Madagascar,art,Rare,1000,Flags,yes
flag-mw,Malawi,art,Rare,1000,Flags,yes
flag-my,Malaysia,art,Rare,1000,Flags,yes
flag-mv,Maldives,art,Rare,1000,Flags,yes
flag-ml,Mali,art,Rare,1000,Flags,yes
flag-mt,Malta,art,Rare,1000,Flags,yes
flag-mh,Marshall Islands,art,Rare,1000,Flags,yes
flag-mr,Mauritania,art,Rare,1000,Flags,yes
flag-mu,Mauritius,art,Rare,1000,Flags,yes
flag-mx,Mexico,art,Rare,1000,Flags,yes
flag-fm,Micronesia,art,Rare,1000,Flags,yes
flag-md,Moldova,art,Rare,1000,Flags,yes
flag-mc,Monaco,art,Rare,1000,Flags,yes
flag-mn,Mongolia,art,Rare,1000,Flags,yes
flag-me,Montenegro,art,Rare,1000,Flags,yes
flag-ma,Morocco,art,Rare,1000,Flags,yes
flag-mz,Mozambique,art,Rare,1000,Flags,yes
flag-mm,Myanmar,art,Rare,1000,Flags,yes
flag-na,Namibia,art,Rare,1000,Flags,yes
flag-nr,Nauru,art,Rare,1000,Flags,yes
flag-np,Nepal,art,Rare,1000,Flags,yes
flag-nl,Netherlands,art,Rare,1000,Flags,yes
flag-nz,New Zealand,art,Rare,1000,Flags,yes
flag-ni,Nicaragua,art,Rare,1000,Flags,yes
flag-ne,Niger,art,Rare,1000,Flags,yes
flag-ng,Nigeria,art,Rare,1000,Flags,yes
flag-mk,North Macedonia,art,Rare,1000,Flags,yes
flag-no,Norway,art,Rare,1000,Flags,yes
flag-om,Oman,art,Rare,1000,Flags,yes
flag-pk,Pakistan,art,Rare,1000,Flags,yes
flag-pw,Palau,art,Rare,1000,Flags,yes
flag-pa,Panama,art,Rare,1000,Flags,yes
flag-pg,Papua New Guinea,art,Rare,1000,Flags,yes
flag-py,Paraguay,art,Rare,1000,Flags,yes
flag-pe,Peru,art,Rare,1000,Flags,yes
flag-ph,Philippines,art,Rare,1000,Flags,yes
flag-pl,Poland,art,Rare,1000,Flags,yes
flag-pt,Portugal,art,Rare,1000,Flags,yes
flag-qa,Qatar,art,Rare,1000,Flags,yes
flag-ro,Romania,art,Rare,1000,Flags,yes
flag-ru,Russia,art,Rare,1000,Flags,yes
flag-rw,Rwanda,art,Rare,1000,Flags,yes
flag-kn,Saint Kitts and Nevis,art,Rare,1000,Flags,yes
flag-lc,Saint Lucia,art,Rare,1000,Flags,yes
flag-vc,Saint Vincent and the Grenadines,art,Rare,1000,Flags,yes
flag-ws,Samoa,art,Rare,1000,Flags,yes
flag-sm,San Marino,art,Rare,1000,Flags,yes
flag-st,Sao Tome and Principe,art,Rare,1000,Flags,yes
flag-sa,Saudi Arabia,art,Rare,1000,Flags,yes
flag-sn,Senegal,art,Rare,1000,Flags,yes
flag-rs,Serbia,art,Rare,1000,Flags,yes
flag-sc,Seychelles,art,Rare,1000,Flags,yes
flag-sl,Sierra Leone,art,Rare,1000,Flags,yes
flag-sg,Singapore,art,Rare,1000,Flags,yes
flag-sk,Slovakia,art,Rare,1000,Flags,yes
flag-si,Slovenia,art,Rare,1000,Flags,yes
flag-sb,Solomon Islands,art,Rare,1000,Flags,yes
flag-so,Somalia,art,Rare,1000,Flags,yes
flag-za,South Africa,art,Rare,1000,Flags,yes
flag-ss,South Sudan,art,Rare,1000,Flags,yes
flag-es,Spain,art,Rare,1000,Flags,yes
flag-lk,Sri Lanka,art,Rare,1000,Flags,yes
flag-sd,Sudan,art,Rare,1000,Flags,yes
flag-sr,Suriname,art,Rare,1000,Flags,yes
flag-se,Sweden,art,Rare,1000,Flags,yes
flag-ch,Switzerland,art,Rare,1000,Flags,yes
flag-sy,Syria,art,Rare,1000,Flags,yes
flag-tj,Tajikistan,art,Rare,1000,Flags,yes
flag-tz,Tanzania,art,Rare,1000,Flags,yes
flag-th,Thailand,art,Rare,1000,Flags,yes
flag-tl,Timor-Leste,art,Rare,1000,Flags,yes
flag-tg,Togo,art,Rare,1000,Flags,yes
flag-to,Tonga,art,Rare,1000,Flags,yes
flag-tt,Trinidad and Tobago,art,Rare,1000,Flags,yes
flag-tn,Tunisia,art,Rare,1000,Flags,yes
flag-tr,Turkiye,art,Rare,1000,Flags,yes
flag-tm,Turkmenistan,art,Rare,1000,Flags,yes
flag-tv,Tuvalu,art,Rare,1000,Flags,yes
flag-ug,Uganda,art,Rare,1000,Flags,yes
flag-ua,Ukraine,art,Rare,1000,Flags,yes
flag-ae,United Arab Emirates,art,Rare,1000,Flags,yes
flag-gb,United Kingdom,art,Rare,1000,Flags,yes
flag-us,United States,art,Rare,1000,Flags,yes
flag-uy,Uruguay,art,Rare,1000,Flags,yes
flag-uz,Uzbekistan,art,Rare,1000,Flags,yes
flag-vu,Vanuatu,art,Rare,1000,Flags,yes
flag-ve,Venezuela,art,Rare,1000,Flags,yes
flag-vn,Viet Nam,art,Rare,1000,Flags,yes
flag-ye,Yemen,art,Rare,1000,Flags,yes
flag-zm,Zambia,art,Rare,1000,Flags,yes
flag-zw,Zimbabwe,art,Rare,1000,Flags,yes
flag-eu,European Union,art,Rare,1000,Flags,yes
flag-england,England,art,Rare,1000,Flags,yes
flag-scotland,Scotland,art,Rare,1000,Flags,yes
flag-wales,Wales,art,Rare,1000,Flags,yes
flag-pr,Puerto Rico,art,Rare,1000,Flags,yes
flag-gl,Greenland,art,Rare,1000,Flags,yes
```

## Merge steps (loop 11)
1. Before the next `npm run sync-rules`: add the Skins tab from the CSV above (plus the earlier Q12/Q13 sheet changes).
2. GitHub: pull request `iterate` -> `main`, merge. Render deploys. No database changes this time (skins are added to the skins table when first bought).

## Live checklist (loop 11)
- Welcome > Skins: tabs, search "japan", prices with the square icon; "Need X more" when short.
- Buy a pattern: Purchase sound, squares go down, Owned.
- Wipe a map (or start a new one): the setup screen shows owned skins first; pick a flag with "Full area", claim a few blocks: one big flag over the territory, owner's color as the border. "Per block": a flag on every block.

Loop order 11 done. Open: Q6, Q8, Q10, Q11, Q12, Q13, Q14, Q15. Stopping.

#79 | 2026-10-29 | Loop 12 (partial, out of budget): sync keeps the current skins while the sheet has no Skins tab; nameLabelShare dropped from the code (Bob removed the row); ran the real sync: 300 achievements, 205 skins kept, 30 rules | tests: economy, achievements pass

Map commands for Xoren (production; the server must be on loop 9 or later):
  npm run admin -- create-map "White Plains" --style white --width 200 --height 200 --prod   (Xoren: a 200 x 200 white plain, no texture, no terrain; grows as usual)
  npm run admin -- create-map Pangea --seed Pangea --prod
(White Plains: a plain white rectangle with no terrain, since --width/--height give an unseeded rectangle. Pangea: a 10,240-block island with terrain.)
NOT DONE from loop 12, still to do: (1 Awards filter tabs: done, #80) 2 floating island background, 3 white-style check, 4 setup-before-welcome flow fix, 5 Click Power percentages and carry-over, 6 online dot, 7 the 205 new skins. OPEN Q16: loop 12 continues next session.
#80 | 2026-10-29 | Loop 12: Awards filter tabs back (All / Pending / Claimed) on top of the category grouping; Pending hides finished categories, Claimed shows categories with at least one earned
#81 | 2026-10-29 | Loop 12 (5a): upgrade cards show the real change as a percentage ("+40% → +50% more powerful clicks"; Defense and Earnings the same; Growth stays a block count), never rounded click counts. Still to do: 5b carry-over, 2, 3, 4, 6, 7
#82 | 2026-10-29 | Loop 12 (5b): hit power left over from the tap that takes a block counts toward the next block the player hits (any block: once taken, "the same block" is theirs), so higher Click Power never wastes power over time; GAME-RULES.md updated. Bob's 17-click example is now 16 when spare carries over (test updated) | tests: upgrades, stray-crack pass. Still to do: 2 background, 3 white style, 4 flow fix, 6 online dot, 7 the 205 new skins
#83 | 2026-10-29 | Loop 12 (6): online dots. Browsers report when their tab is shown or hidden; the server sends each map who has it open and visible ("online"), at once on hide, show, close, switch or a new guest. A small green dot sits at the corner of their name tag and after their leaderboard name | tests: online dots (show, hide, show, close). Still to do: 2 background, 3 white style, 4 flow fix, 7 the 205 new skins
#84 | 2026-10-29 | Loop 12 (3): the white style draws clean white blocks (#f7f8fa) with the soft grey grid; owned blocks are filled with the owner color (the grass recolor would leave white white). Map commands for Xoren are in #79. "???" stays COMING SOON (welcome.js PLACEHOLDER_MAPS). Not yet checked in a browser
#85 | 2026-10-29 | Fix (Xoren): create-map --style white came out textured: with no --seed, the admin command asked for a random seed even for a rectangle, and the seed gave it terrain. Now no --seed on a rectangle means no seed, white maps never get a seed, and server and browser ignore any seed on a white map, so the live White Plains (made with a random seed) becomes a plain white map after the next deploy, with nothing to recreate | tests: white maps never have terrain
#86 | 2026-10-29 | Xoren: far fewer achievements early (3 blocks had earned 11). The first tiers of claiming, taps, squares earned and held, lines, squares, maps, days, visits and Collector start much higher (e.g. taps 1,000, squares earned 25, held 100, maps 2, days 2, a line of 5, a 3 x 3 square); keys unchanged, so earned ones still count; still 300. OPEN for Xoren/Bob: the sheet's Achievements tab must get the updated CSV (Q13 block above), or the next sync puts the old thresholds back
#87 | 2026-10-29 | Xoren: an achievement never pays more than half the squares mining paid for the work since its tier before (144 blocks an hour, 1 square each). Claiming is the steady backbone, paying exactly that half (First Block 0.5, 10 blocks 4.5, 25 blocks 7.5, 50 blocks 10, 100 blocks 25, 250 blocks 75 ...); every other achievement is 2 squares per hour of effort capped at that half (no more minimum of 1; fractions allowed). The CSV in Q13 is updated: the sheet needs it before the next sync
