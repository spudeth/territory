// Renders pixel-art sources to PNG sheets and their info files (Art guide v1). No dependencies.
//   node art/render.js           render every source: any art-src/*.txt under art/ and plugins/
//   node art/render.js --check   write nothing; fail if a PNG or info file is missing or doesn't match its source
//
// A source is art-src/<thing>-<action>.txt. Its PNG and .json go to the plug-in's look/ folder when there is one
// next to art-src/, otherwise next to art-src/ (art/inbox/<thing>/). The format, line by line:
//   # comment                  (anywhere)
//   frame 16 16                one frame's width and height (multiples of 16: 1 block = 16 px)
//   ms 220                     time per frame (animations only)
//   loop true                  true = repeats, false = plays once and stops on the last frame (animations only)
//   anchor 8 15                the pixel that sits on the ground (optional)
//   color o ink                a grid character and a colour name from art/palette.txt ('.' is always clear)
//   --- 1: label               starts a frame; its rows follow, one character per pixel
// The info file is written for animations, for art bigger than 16x16, and for art with an anchor.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

function readPalette() {
  const file = path.join(__dirname, 'palette.txt'), names = {}, seen = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^([a-z0-9-]+)\s+#([0-9a-f]{6}(?:[0-9a-f]{2})?)(?:\s|$)/);
    if (!m) throw new Error(`art/palette.txt line ${i + 1}: expected "name #rrggbb" or "name #rrggbbaa"`);
    const [, name, hex] = m;
    if (names[name]) throw new Error(`art/palette.txt line ${i + 1}: "${name}" is already in the palette`);
    if (seen[hex]) throw new Error(`art/palette.txt line ${i + 1}: #${hex} is already in the palette as "${seen[hex]}"`);
    seen[hex] = name;
    names[name] = [0, 2, 4, 6].map(k => (k < hex.length ? parseInt(hex.slice(k, k + 2), 16) : 255));
  });
  return names;
}

function parse(file, palette) {
  const fail = (n, msg) => { throw new Error(`${rel(file)}${n ? ` line ${n}` : ''}: ${msg}`); };
  const s = { colors: { '.': null }, frames: [] };
  let rows = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1, line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    if (line.startsWith('---')) { s.frames.push(rows = []); return; }
    if (rows) return rows.push({ n, line });
    const [word, ...args] = line.trim().split(/\s+/);
    const ints = () => (args.length === 2 && args.every(a => /^\d+$/.test(a)) ? args.map(Number) : fail(n, `"${word}" takes two whole numbers`));
    if (word === 'frame') s.frame = ints();
    else if (word === 'anchor') s.anchor = ints();
    else if (word === 'ms') s.ms = /^\d+$/.test(args[0]) && args.length === 1 && Number(args[0]) > 0 ? Number(args[0]) : fail(n, '"ms" takes one number above 0');
    else if (word === 'loop') s.loop = args[0] === 'true' ? true : args[0] === 'false' ? false : fail(n, '"loop" is true or false');
    else if (word === 'color') {
      const [ch, name] = args;
      if (args.length !== 2 || [...ch].length !== 1 || ch === '#') fail(n, 'expected "color <one character> <palette name>"');
      if (ch === '.' && name !== 'clear') fail(n, '"." is always clear');
      if (ch !== '.' && !palette[name]) fail(n, `"${name}" isn't in art/palette.txt (add it there in the same commit)`);
      if (ch in s.colors && ch !== '.') fail(n, `"${ch}" already has a colour`);
      s.colors[ch] = ch === '.' ? null : palette[name];
    } else fail(n, `unknown line "${word}"`);
  });
  if (!s.frame) fail(0, 'missing "frame <width> <height>"');
  const [w, h] = s.frame;
  if (!w || !h || w % 16 || h % 16) fail(0, `frame ${w}x${h}: width and height must be multiples of 16 (1 block = 16 px)`);
  if (!s.frames.length) fail(0, 'no frames (each starts with a "---" line)');
  s.frames.forEach((f, k) => {
    if (f.length !== h) fail(f[0]?.n, `frame ${k + 1} has ${f.length} rows, not ${h}`);
    for (const { n, line } of f) {
      if ([...line].length !== w) fail(n, `row is ${[...line].length} pixels wide, not ${w}`);
      for (const ch of line) if (!(ch in s.colors)) fail(n, `"${ch}" has no colour (add "color ${ch} <name>")`);
    }
  });
  if (s.frames.length > 1 && (s.ms === undefined || s.loop === undefined)) fail(0, 'an animation needs "ms" and "loop"');
  if (s.anchor && (s.anchor[0] >= w || s.anchor[1] >= h)) fail(0, `anchor ${s.anchor} is outside the ${w}x${h} frame`);
  return s;
}

// Pixels as PNG rows: each row is a filter byte (0) and then RGBA.
function rows(s) {
  const [w, h] = s.frame, W = w * s.frames.length, raw = Buffer.alloc((W * 4 + 1) * h);
  s.frames.forEach((f, k) => f.forEach(({ line }, y) => [...line].forEach((ch, x) => {
    const c = s.colors[ch];
    if (c) Buffer.from(c).copy(raw, y * (W * 4 + 1) + 1 + (k * w + x) * 4);
  })));
  return { W, h, raw };
}

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png({ W, h, raw }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// The pixel rows inside a PNG this script wrote (so --check doesn't depend on zlib's exact bytes); null if it can't
// be read that way (damaged, or saved by another tool).
function pngRows(buf) {
  try {
    const idat = [];
    for (let p = 8, len; p < buf.length; p += 12 + len) {
      len = buf.readUInt32BE(p);
      if (buf.toString('ascii', p + 4, p + 8) === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    }
    return zlib.inflateSync(Buffer.concat(idat));
  } catch { return null; }
}

function info(s) {
  const [w, h] = s.frame;
  if (s.frames.length === 1 && w === 16 && h === 16 && !s.anchor) return null;
  const o = { frame: [w, h] };
  if (s.frames.length > 1) Object.assign(o, { ms: s.ms, loop: s.loop });
  if (s.anchor) o.anchor = s.anchor;
  return JSON.stringify(o) + '\n';
}

function sources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') sources(p, out);
    else if (e.isFile() && e.name.endsWith('.txt') && path.basename(dir) === 'art-src') out.push(p);
  }
  return out;
}

const check = process.argv.includes('--check');
const palette = readPalette(), problems = [];
const files = [...sources(path.join(ROOT, 'art')), ...sources(path.join(ROOT, 'plugins'))];
for (const file of files) {
  const name = path.basename(file, '.txt');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) { problems.push(`${rel(file)}: name must be lowercase with hyphens only`); continue; }
  const home = path.dirname(path.dirname(file)), look = path.join(home, 'look');
  const outDir = fs.existsSync(look) ? look : home, pngFile = path.join(outDir, name + '.png'), jsonFile = path.join(outDir, name + '.json');
  let s;
  try { s = parse(file, palette); } catch (e) { problems.push(e.message); continue; }
  const pixels = rows(s), json = info(s);
  if (check) {
    const old = fs.existsSync(pngFile) ? fs.readFileSync(pngFile) : null, oldRows = old && pngRows(old);
    if (!oldRows || !oldRows.equals(pixels.raw) || old.readUInt32BE(16) !== pixels.W || old.readUInt32BE(20) !== pixels.h) problems.push(`${rel(pngFile)} is missing or out of date`);
    const oldJson = fs.existsSync(jsonFile) ? fs.readFileSync(jsonFile, 'utf8').replace(/\r\n/g, '\n') : null;   // Windows checkouts
    if (oldJson !== json) problems.push(`${rel(jsonFile)} is ${json === null ? 'not needed' : oldJson === null ? 'missing' : 'out of date'}`);
  } else {
    fs.writeFileSync(pngFile, png(pixels));
    if (json) fs.writeFileSync(jsonFile, json);
    else if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    console.log(`${rel(pngFile)}  ${pixels.W}x${pixels.h}, ${s.frames.length} frame${s.frames.length > 1 ? 's' : ''}${json ? `  + ${name}.json` : ''}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n') + (check ? '\nRun: node art/render.js' : ''));
  process.exit(1);
}
if (check) console.log(files.length === 1 ? '1 source matches its PNG.' : `${files.length} sources match their PNGs.`);
