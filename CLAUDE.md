# CLAUDE.md

Read `README.md` first — it's the map (folders, run/deploy, accounts, the Sheet). Don't re-derive what it already says.

## Token efficiency
- Don't read whole files when a `Grep`/targeted `Read` with offset+limit will do.
- `art/README.md` has the pixel-art rules (16px/block, palette-only, naming). Read it only when touching art, not every session.
- `docs/ARCHITECTURE.md` explains core/plug-in wiring — read on demand, not proactively.
- Game numbers live in `data/economy.json` and each plugin's `data.json`, sourced from Xoren's Sheet via `npm run sync-rules`. Never hand-edit numbers that look sheet-sourced; ask instead.

## Before committing
`npm test` must pass (refuses to run against `production`; uses `.env.local`'s dev branch). A pre-commit hook runs it automatically (see `.claude/settings.json`) and blocks the commit on failure — fix the test, don't bypass with `--no-verify`.

## Conventions
- Art replaces files in place under `art/` by filename; after editing a pixel-art source, run `node art/render.js --check`.
- Plugin folders (`plugins/<name>/`) are self-contained: code + `data.json` + `test/`.
