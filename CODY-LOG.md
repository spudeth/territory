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
