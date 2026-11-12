# Xoren's checklist: Loop 19 (plug-ins and speed)

Loops 16-18: all done (2026-11-11). Loop 19 is on `iterate`, one commit per phase, each passing the full test suite
(196 tests). Nothing is merged to main and nothing has touched the production database.

## 1. Merge (GitHub)

Main already has Loop 19 Phases 0-3 (PR #29) and the ghost art (PR #30); `iterate` adds Phases 4-9. Main has no file
changes that `iterate` lacks, so the merge is clean.

- [ ] Open one pull request `iterate` → `main` and merge it.
- [ ] No database changes this time. One new package (`compression`): Render installs it by itself on deploy.
- [ ] No new Render settings.
- [ ] After the deploy, open the game once on your phone: the map, Build, the item bar, the Marketplace's Skins tab,
  Achievements, a factory's card. Everything should look as before, just faster.

## 2. Worth knowing

- The database now rests whenever nobody is connected (PERF.md). Neon hours should follow playing time from here.
- Factories catch up the moment someone connects, exactly as if the server had ticked all along.
- The `--prod` economy reset and anything else on production is still yours to run; nothing in Loop 19 needs one.
