# Territory: speed and free-tier headroom (Loop 19)

How it's measured: `node scripts/perf/measure.js <label>` runs the game on a throwaway schema of the **dev** database
(never production) on Xoren's PC, counts every database round trip and Socket.IO packet, and writes
`scripts/perf/results-<label>.json`. `node scripts/perf/shots.js <label>` takes the comparison screenshots
(`docs/screenshots/loop19-<label>-*.png`). Phase 9 runs both again with the label `after`.

The PC is faster than Render's server, so CPU on Render will be higher than shown here. Treat these numbers as
comparisons, not promises.

## Before and after

| Measure | Before (2026-11-11) | After |
|---|---|---|
| **Phone, first visit** (Slow 4G, 4x slower CPU): data, requests | 356 KB, 63 requests (scripts 235 KB, CSS 46 KB, page 39 KB, fonts 28 KB) | |
| Phone, first visit: map on screen | 4.4 s (page loaded at 2.5 s) | |
| **Phone, next visit**: data, requests | 11 KB, still 63 requests (every file is checked again: `no-cache`) | |
| Phone, next visit: map on screen | 2.9 s | |
| Browser memory (JS) | 8-11 MB | |
| **Welcome message**, 400-block map | 15 KB as JSON, 4 KB sent | |
| Welcome, 10,000 blocks | 149 KB as JSON, 38 KB sent | |
| Welcome, 50,000 blocks | 698 KB as JSON, 183 KB sent | |
| Welcome, 431,649 blocks (the default E, worked out) | about 6 MB as JSON, about 1.6 MB sent | |
| **Server idle** (nobody connected, 1 awake factory): memory, CPU | 87 MB, 0.2% of one core | |
| Server idle: database queries | 31 a minute (the tick, plus the factory's ~2 claims a minute) | |
| **10 players tapping** 4 a second for 2 minutes: memory, CPU | 145 MB, 7% of one core | |
| 10 players: database | 2,502 queries a minute, 1.2 per tap (about 15 per claimed block), 242 transactions a minute | |
| 10 players: Socket.IO sent | 395 messages a second (40 per player), 12.9 KB a second | |
| 10 players: Socket.IO received | 35 messages a second, 0.8 KB a second | |

## Free-tier headroom

**Neon (free plan, 100 compute hours a month, shared).** Production from Nov 1-11 (Xoren): 12.13 CU-hours, a pace of
about 33 a month. Storage 0.09 GB, history 0.01 GB, network 0.11 GB.
- The game queries the database at least once a minute while the server is awake (the tick), so the database never
  suspends while the server is up. At the smallest size (0.25 CU), 12.13 CU-hours means about 48 hours awake in 11
  days, or about 4.4 hours a day: today the database sleeps only because Render's free server sleeps when nobody plays.
- **The limit:** about 13 hours a day of server uptime uses the whole 100 hours a month (0.25 CU x 13.3 h x 30). A
  server with players around the clock would need about 180. Letting the database sleep while nothing is due is the
  biggest saving available.

**Render (free: 512 MB memory, 0.1 CPU, sleeps after 15 minutes without visitors).** Render's graphs to follow from
Xoren.
- Memory is fine: 87 MB idle, 145 MB with 10 players.
- CPU is the limit. 10 players tapping used 7% of one core on this PC, which is 70% of Render's 0.1 CPU, and Render's
  CPU is slower. Messages grow with players squared (every tap goes to everyone on the map: 10 players, 395 messages
  a second), so a few more players fill it. Sending hits in batches is the main fix.

## What the baseline confirms (docs/ARCHITECTURE.md, "First look")

1. The database never sleeps while the server runs: **confirmed** (31 queries a minute idle).
2. The welcome sends every block: **confirmed** (698 KB of JSON for 50,000 blocks; about 6 MB at the default E).
3. No compression, no caching: **confirmed** (356 KB sent uncompressed; a return visit still makes 63 requests).
4. One message per tap to everyone: **confirmed** (395 messages a second with 10 players).
5. All plug-in code before the map: it is all in the 235 KB of scripts loaded before the map shows.

Found while measuring (not part of this loop's changes, OPEN Q48 in the log): every claim that pays a fraction of a
square (sand pays 0.5) fails to save to the player's current "life" ("LIFE FAILED … bigint"), and whole squares are
saved 10 times too small, because the lives table moved to tenths in loop 16 but the claim still sends squares.
