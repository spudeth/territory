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
