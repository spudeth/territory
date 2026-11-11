# Xoren's checklist: Loop 16, the Economy Update

Everything is on the `iterate` branch, one commit per phase, each passing the full test suite. Nothing has been merged
to main, and nothing has touched the production database. Work down the list in order.

## 1. Answer the open questions (in CODY-LOG.md)

- [ ] **Q26** Achievements tab: the sheet's Achievements rows are older than the game's (the 50% reward cap). Have Bob copy the game's rows to the sheet before the next full sync, or the old rewards come back.
- [ ] **Q27** Block terrain is stored only where it differs from the map seed's. Recommended: keep.
- [ ] **Q28** The new achievement rows for tiers (CSV in the log): thresholds and placeholder rewards (5% of a tier's cost). Bob puts them on the sheet.
- [ ] **Q29** The new and changed texts: the "i" popups, the tutorial line, GAME-RULES.md and the Game Guide. Read them and tell Cody what to change.
- [ ] **Q30** Placeholder art in `public/art/`: factory, factory asleep, wall, for-sale marker, level shades, Build / Marketplace / Demolition / info card icons. Replace any file with the same name to change it.
- [ ] Earlier ones still open: Q23 (info text, loop 15), Q24 (Mention sound), Q25 (privacy page review).

## 2. The sheet (Bob or you)

- [ ] Delete the old tabs the sync no longer reads: Inputs, Summary, Click Power, Defense, Earnings, Growth.
- [ ] On Game Rules, delete the rows `squaresPerFirstClaim` and `newMapBlocks` (retired; the sync warns until they're gone).
- [ ] On Game Rules, add `mailingAddress` = 2212 W 5th Ave, Gary, IN 46404 (from loop 15; the sync refuses without it).
- [ ] Put the tier achievement rows (Q28) on the Achievements tab, and fix Q26.
- [ ] Then `npm run sync-rules -- --check` should say there are no problems.

## 3. Merge (GitHub)

- [ ] Open one pull request `iterate` → `main` and merge it (it holds Loop 15 Phase 7 and Loop 16 Phases 1-9). Render deploys and applies the database changes 018-023 by itself on start.
- [ ] Watch the Render log for "Applied migrations: … 023_land_market.sql" and no errors.

## 4. Render settings

- [ ] Nothing new is required for loop 16. (Loop 15's email: RESEND_API_KEY, RESEND_AUDIENCE_ID, RESEND_FROM, if not done yet.)
- [ ] The free server sleeps; factories catch up when it wakes. If you want factories to run on time while nobody plays, a paid "always on" instance does that (optional).

## 5. The economy reset (you run it, once, right after the merge)

Old upgrade levels mean nothing in the tier system, so reset straight after the deploy:

- [ ] `npm run admin -- economy-reset --prod` — read the preview (each map: seed and E), type `CONFIRM`. It takes a backup first and logs it.
- [ ] It clears owners, levels, squares, tiers, items, factories, walls and listings, and makes each official map again from its seed and E. It keeps accounts, names, owned skins, stars and achievements.
- [ ] Check the preview's E for White Plains says 200 x 200 (it was made before maps remembered their size, so its rectangle is worked out from its blocks).

## 6. Test on your phone

- [ ] Squares show as whole numbers; Settings → Show tenths shows one decimal.
- [ ] The top-left card shows the map's level and a bar.
- [ ] Press and hold a block: the info card opens (a quick tap still attacks).
- [ ] Marketplace tile: tabs Upgrades, Skins, Items, Land. A tier card shows "Mine a level-2 block to unlock".
- [ ] Build button (under the leaderboard): Factory → tap your block → green ghost → ✓. It mines on its own (about a block a minute at tier 1).
- [ ] Build → Wall near an edge of your land: it snaps to the edge. Two on one corner block.
- [ ] Build → Sell land (needs an account 3+ days old): pick connected blocks, set a price, ✓; a for-sale marker appears.
- [ ] The Game Guide link next to Privacy and Terms opens /guide.
- [ ] Buy a Demolition and remove a factory or a wall from the item bar.
