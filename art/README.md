# Art

Not served to players (only `public/` and plug-in `look/` folders are).

- `palette.txt`: the shared palette. Map art uses only these colours.
- `render.js`: turns sources (`art-src/*.txt`, text pixel grids) into PNG sheets and their info files.
  - `node art/render.js` renders everything.
  - `node art/render.js --check` changes nothing and fails if a PNG or info file is missing or doesn't match its source.
  The source format is described at the top of the script.
- `inbox/<thing>/`: art for things that don't have a plug-in folder yet (entities): PNG + JSON, with the source in `art-src/`.

Rules (Art guide v1): 1 block = 16 px, nearest-neighbour only, transparent PNG, one sheet per animation with frames
side by side, names `<thing>-<action>`, lowercase with hyphens.
