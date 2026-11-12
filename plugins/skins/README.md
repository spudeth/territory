# Skins (plug-in)

How territories look: the plain colour (no plug-in needed), a pattern in the owner's colour, or art (flags); per block
or one image over the whole area (coverage). Bought with squares in the Marketplace's Skins tab (the rarity's
work-hours x W(L), flags are Rare), picked with the coverage on the setup screen, starred for the profile. Catalog and
prices from the sheet's Skins and Skin Rarity tabs (`data.json`); words in `text.js`.

- **Server** (`server.js`): its data is the `skins` and `player_skins` tables and the star columns on `players`
  (core tables, Q42); the look a player picked stays in `player_map_settings` (core). Hooks: `welcome` (each skin's
  kind, the animated ones), `skinRefusal` (the setup screen: only owned skins), `profile` (stars), `guide`.
  Services: `tx`, `spend`, `money`, `stats`. Takes `skins:list`, `skins:buy`, `skins:star`.
- **Browser** (`client.js`, `text.js`): `look` (how game.js draws each owner), the Skins Marketplace tab
  (`addMarketTab`), the skin and coverage choices (`setupOpen`, `setup`), favorites (`profile`), the "i" texts.
  Its CSS is still in `public/style.css` (so nothing flashes unstyled while it loads).
- **Look** (`look/`): the 896 skin images as they were (16x16 `<id>.png`, `<id>-large.png` for Full area,
  `<id>-anim.png` sprite sheets for Legendary).
- **Tests** (`test/`): the catalog and its images, the tabs, drawing helpers, buying, picking, prices, order, stars.

Remove this folder and every territory shows its plain colour; the setup screen offers a colour only; bought skins
stay in the database untouched.
