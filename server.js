const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');

const SIZE = 32;          // map is SIZE x SIZE blocks
const HITS = 3;           // clicks needed to take a block
const FILE = __dirname + '/state.json';
const PORT = process.env.PORT || 3030;

// Persistent state:
//   players: publicId -> { name, color }   (sent to everyone)
//   tokens:  secret token -> publicId       (kept on server, stored in the player's localStorage)
//   owners:  array of SIZE*SIZE publicIds (or null)
let state = { players: {}, tokens: {}, owners: Array(SIZE * SIZE).fill(null) };
try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(FILE, JSON.stringify(state));

// Crack progress is temporary, so it lives in memory only: cell -> { by, n }
const hits = {};

const ADJ = ['Swift', 'Brave', 'Lucky', 'Quiet', 'Bold', 'Sly', 'Happy', 'Wild', 'Tiny', 'Grand'];
const ANIMALS = ['Fox', 'Owl', 'Bear', 'Wolf', 'Hare', 'Lynx', 'Crow', 'Elk', 'Toad', 'Moth'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const newPlayer = () => ({
  name: pick(ADJ) + ' ' + pick(ANIMALS),
  color: `hsl(${(165 + Math.floor(Math.random() * 270)) % 360}, 75%, 55%)`,   // any hue except grass green (75-165)
});

// Returns an error message, or null if `pid` may hit cell `i`.
function checkHit(pid, i) {
  if (!Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return 'Invalid block';
  if (state.owners[i] === pid) return 'You already own this block';
  if (!state.owners.includes(pid)) {
    return state.owners[i] ? 'Your first block must be unclaimed' : null;
  }
  const x = i % SIZE, y = Math.floor(i / SIZE);
  const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && state.owners[ny * SIZE + nx] === pid);
  return near ? null : 'You can only take blocks next to your territory';
}

const app = express();
app.use(express.static(__dirname + '/public'));
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', socket => {
  // Recognise returning players by their secret token, otherwise create a new account.
  let token = socket.handshake.auth.token;
  let pid = state.tokens[token];
  if (!pid) {
    token = crypto.randomUUID();
    pid = crypto.randomBytes(4).toString('hex');
    state.tokens[token] = pid;
    state.players[pid] = newPlayer();
    save();
    socket.broadcast.emit('player', { pid, ...state.players[pid] });
  }

  socket.emit('welcome', { token, pid, size: SIZE, players: state.players, owners: state.owners, hits });

  socket.on('hit', i => {
    const error = checkHit(pid, i);
    if (error) return socket.emit('denied', error);

    // Progress only counts while the same player keeps hitting the block.
    if (hits[i]?.by !== pid) hits[i] = { by: pid, n: 0 };
    if (++hits[i].n < HITS) return io.emit('hit', { i, n: hits[i].n });

    delete hits[i];
    state.owners[i] = pid;
    save();
    io.emit('claim', { i, pid });
  });
});

server.on('error', err => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use by another program. Try another port, e.g.:  $env:PORT=3031; npm start`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Territory running on http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  on your network: http://${n.address}:${PORT}`);
    }
  }
});
