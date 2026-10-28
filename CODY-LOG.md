# Cody log

One line per iteration, newest at the bottom. Questions are marked OPEN until answered through Xoren.

#1 | 2026-10-28 09:54 | rules.js now holds every game number plus the core rules as pure functions (who may hit a block, crack fading, the wipe rule); the server uses them | tests: pass (rules 4/4 in memory, server 15/15)
#2 | 2026-10-28 09:57 | upgrade plumbing: each player has Click Power, Defense and Earnings levels (database migration 003, all 0); rules.js turns levels into effects through dial tables that default to no effect; nothing can buy them yet | tests: pass (rules 5/5, server 16/16, store 12/12)
QUESTION Q1: how should upgrades combine and round? | A: (base hits - Click Power) x Defense, rounded up, min 1 hit; Earnings rounded down / B: base x Defense first, then minus Click Power / C: something else | built A (Click Power can't erase Defense entirely, and no free fractional squares); one line in rules.js to change | OPEN
