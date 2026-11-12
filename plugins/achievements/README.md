# Achievements (plug-in)

Earned once per player, the first time one of their stats reaches its threshold; each pays its reward in squares.
The core counts the stats (totals.js, stats.js); this plug-in only reads them and awards (Q46). Definitions from the
sheet's Achievements tab (`data.json`); the stats they may use are the core's (`economy.STATS`).

- **Server** (`server.js`, `rules.js`): its data is the `player_achievements` table (a core table, Q42). Hooks: `stat`
  (every stat change: check and earn), `connected` (catch up on what was already reached), `profile` (count and latest
  five), `guide`, and for the secrets `claimed`, `poke`, `wiped`, `chat`, `balance` (each counts its own `secret:<name>`
  stat; `visit` holds this connection's own notes). Services: `stats.values/best/bump/changed`, `tx`, `money`,
  `toPlayer`, `store.mapsPlayed`, `options.achievementList` (tests). Sends `achievements:earned`; takes
  `achievements:list`.
- **Browser** (`client.js`, `text.js`): the Achievements screen (`addScreen`), the yellow pop-up, progress bars that
  follow the `stat` hook. The pop-up's markup and the welcome tiles stay in the core page (a tile does nothing
  without this plug-in); the profile shows its rows only when the plug-in sends them.
- **Tests** (`test/`): the definitions and the tab, the guide, earning live (moved from the core's tests).

Remove this folder and nothing is awarded; stats are still counted, and earned achievements stay in the database.
