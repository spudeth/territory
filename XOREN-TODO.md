# Xoren's checklist: Loops 16-18, the Economy Update

Everything is on the `iterate` branch, one commit per phase, each passing the full test suite. Nothing has been merged
to main, and nothing has touched the production database. Work down the list in order.

## 1. Answer the open questions (in CODY-LOG.md)

- [x] **Q26** Achievements tab: the sheet's Achievements rows are older than the game's (the 50% reward cap). Have Bob copy the game's rows to the sheet before the next full sync, or the old rewards come back.
- [x] **Q27** Block terrain is stored only where it differs from the map seed's. Recommended: keep.
- [x] **Q28** The new achievement rows for tiers (CSV in the log): thresholds and placeholder rewards (5% of a tier's cost). Bob puts them on the sheet.
- [x] **Q29** The new and changed texts: the "i" popups, the tutorial line, GAME-RULES.md and the Game Guide. Read them and tell Cody what to change.
- [ ] **Q30** Placeholder art in `public/art/`: factory, factory asleep, wall, for-sale marker, level shades, Build / Marketplace / Demolition / info card icons. Replace any file with the same name to change it.
- [ ] Earlier ones still open: Q23 (info text, loop 15), Q24 (Mention sound), Q25 (privacy page review).
- [ ] **Q31** (Bob) The "Buy N upgrade steps" achievement rows (CSV in the log): put them on the Achievements tab, or the next sync puts the tier wording back. (Still the old rows on 2026-11-11.)
- [ ] **Q32-Q35, Q37, Q38** (Bob, loop 18): Economy rows (add wallPriceWh, delete stepsPerTier and wallPaybackHours), the Glossary for the new math, Factory Lifetime's level, "walls you own" per map, repair and cracked walls, Demolition's Items text. Each has Cody's recommendation in the log.
- [ ] **Q36** (you) The Upgrades card's new line past tier 1: "In full on level-N+ blocks. On a level-L block, at most the end of tier L (level 1: ×10 hits per tap)." Approve or reword.

## 2. The sheet (done by Bob, synced and checked clean on 2026-11-11)

- [x] Delete the old tabs the sync no longer reads: Inputs, Summary, Click Power, Defense, Earnings, Growth.
- [x] On Game Rules, delete the rows `squaresPerFirstClaim` and `newMapBlocks` (retired; the sync warns until they're gone).
- [x] On Game Rules, add `mailingAddress` = 2212 W 5th Ave, Gary, IN 46404 (from loop 15; the sync refuses without it).
- [x] Put the tier achievement rows (Q28) on the Achievements tab, and fix Q26.
- [x] Then `npm run sync-rules -- --check` should say there are no problems.

## 3. Merge (GitHub)

- [ ] Open one pull request `iterate` → `main` and merge it (it holds Loop 15 Phase 7, Loop 16 Phases 1-9, Loop 17 and Loop 18). Loop 18 adds no database changes. Render deploys and applies the database changes 018-024 by itself on start.
- [ ] Watch the Render log for "Applied migrations: … 024_upgrade_steps.sql" and no errors.

## 4. Render settings

- [ ] Nothing new is required for loop 16. (Loop 15's email: RESEND_API_KEY, RESEND_AUDIENCE_ID, RESEND_FROM, if not done yet.)
- [ ] The free server sleeps; factories catch up when it wakes. If you want factories to run on time while nobody plays, a paid "always on" instance does that (optional).

## 5. The economy reset (you run it, once, right after the merge)

Old upgrade levels mean nothing in the tier system, so reset straight after the deploy:

- [ ] `npm run admin -- economy-reset --prod` — read the preview (each map: seed and E), type `CONFIRM`. It takes a backup first and logs it.
- [ ] It clears owners, levels, squares, upgrade steps, items, factories, walls and listings, and makes each official map again from its seed and E. It keeps accounts, names, owned skins, stars and achievements.
- [ ] Check the preview's E for White Plains says 200 x 200 (it was made before maps remembered their size, so its rectangle is worked out from its blocks).

## 6. Test on your phone (iPhone Safari; Cody could only test Chrome's phone mode)

- [ ] Tap the Build button: its menu opens (it used to let the tap through to the map, which gave the error).
- [ ] With fewer than 20 blocks, Build → Factory says "You need 20 blocks for your first factory (you have N)." and nothing is placed.
- [ ] While a Build tool is on, tapping the map only moves the ghost: no attacks, no claim messages.
- [ ] Tap one of your own blocks: nothing happens (no message, no sound).
- [ ] The map looks sharp; the cards and menus are smaller; the map starts further out. Buttons are still easy to tap.
- [ ] A balance over 100,000 shows short (e.g. 4.99M); tap it for the full number.
- [ ] The page never zooms: double-tap the menu, tap into chat, rotate the phone.
- [ ] Music: load, tap once (it starts); switch to another app and back (it resumes); lock and unlock (it resumes, at the latest on your next tap). The sound button always shows whether music is playing.
- [ ] Upgrades tile: its own screen. A card shows "Tier 1 · step 0/90", the value now → after the next step, Buy and Buy max.
- [ ] Marketplace tile: tabs Skins, Items, Land (no Upgrades).
- [ ] Squares show as whole numbers; Settings → Show tenths shows one decimal.
- [ ] The top-left card shows the map's level and a bar.
- [ ] Press and hold a block: the info card opens (a quick tap still attacks).
- [ ] Build → Factory with 20+ blocks → tap your block → green ghost → ✓. Watch it: its target cracks one hit every 6 seconds (about a block a minute at the start).
- [ ] Press and hold the factory: the card shows Output (new blocks an hour) and Wake up. The Build menu has no Wake up any more.
- [ ] Build → Wall: tap several edges of your land: each shows a faint wall; tap one again and it goes; tapping an inside edge shows nothing. The bar shows the count and total; ✓ builds them all.
- [ ] Built walls look solid, sit over the border, and have a thin dark shadow on their inner side. The territory border is thinner than before on the phone.
- [ ] Let someone crack one of your blocks, then tap it: the crack shrinks with each tap, for free.
- [ ] Build → Sell land (needs an account 3+ days old): pick connected blocks, set a price, ✓; a for-sale marker appears.
- [ ] The Game Guide link next to Privacy and Terms opens /guide.
- [ ] Items tab: Demolition has − / +; buy 3 at once. Item bar → Demolition: tap your blocks (they turn red; tap again to drop), ✓: their walls and factories are gone, one Demolition per block that had something.
- [ ] Music after switching apps and after locking: it comes back by itself, or at the latest on your next tap.
