# Territory

A tiny multiplayer browser game. Everyone shares one 32×32 map. Tap a block 3 times to take it. Your first block can be any empty block. After that you can only take blocks next to your territory, including blocks owned by other players.

## Run

```
npm install
npm start
```

Open http://localhost:3030 on your computer. The server also prints a `http://192.168.x.x:3030` address. Open that on your phone (same Wi-Fi). If the phone can't connect, allow Node.js through the Windows firewall on private networks.

Each browser gets its own anonymous account, saved in localStorage. To play as a second player on the same computer, use a private window or a different browser.

Controls: tap or click to hit a block, drag to pan, pinch or mouse wheel to zoom.

To reset the game, stop the server and delete `state.json`. To use a different port (e.g. if 3030 is taken), run `$env:PORT=3031; npm start` in PowerShell.

## How the code is organized

`server.js` is the whole backend. Express serves the `public/` folder, and Socket.IO handles players. The server is the source of truth. It keeps all players and block owners in memory and writes them to `state.json` after every change. It checks every hit: is it a valid block, does it touch the player's territory (or is it an empty first block), and has the same player hit it 3 times in a row. Then it broadcasts `hit` (crack progress) or `claim` (new owner) to everyone. Crack progress lives in memory only. `public/game.js` is the whole client, split into sections. *State* comes from the server. *Camera* holds the pan/zoom numbers. *Rendering* redraws the canvas only when something changes, with image smoothing off so the pixel art stays sharp. *Input* uses pointer events to tell taps, drags and pinches apart; a touch that moves more than 10px is no longer a tap. *UI* covers the overlay and leaderboard, and *Networking* has the socket handlers. `public/index.html` and `public/style.css` hold the overlay markup and styles. `public/tiles/` contains the three grass tiles used from Kenney's [Tiny Town](https://kenney.nl/assets/tiny-town) pack (CC0, license included).

Each account has a secret token (kept in the browser) and a separate public ID (visible to everyone), so other players can't take over your account.
