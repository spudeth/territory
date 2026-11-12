// Caching the game's files (loop 19, Phase 8). Code (every .js under client/, every .css under art/, and each plug-in's browser
// files) is fingerprinted: the page asks for "game.js?v=<hash of its contents>", worked out when the server starts,
// so a browser may keep it for a year and still gets a new copy the moment the file changes (new hash, new address).
// The page itself is always checked (a quick "not modified" when unchanged); images and sounds are kept for an hour.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const YEAR = 'public, max-age=31536000, immutable';
const HOUR = 'public, max-age=3600';
const CHECK = 'no-cache';
const CODE = /\.(js|css)$/;

// clientDir: the browser code (served at /); artDir: art (served at /art); plugins: [{ name, dir, client: [files] }].
function createAssets(clientDir, artDir, plugins = []) {
  const hashes = new Map();   // "/game.js" -> hash
  const hashOf = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  (function walk(dir, url) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) walk(path.join(dir, d.name), url + d.name + '/');
      else if (CODE.test(d.name)) hashes.set(url + d.name, hashOf(path.join(dir, d.name)));
    }
  })(clientDir, '/');
  (function walk(dir, url) {   // the stylesheets in art/
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) { if (d.name !== 'skins') walk(path.join(dir, d.name), url + d.name + '/'); }
      else if (/\.css$/.test(d.name)) hashes.set(url + d.name, hashOf(path.join(dir, d.name)));
    }
  })(artDir, '/art/');
  for (const p of plugins) for (const f of p.client.filter(f => !f.startsWith('/'))) hashes.set(`/plugins/${p.name}/${f}`, hashOf(path.join(p.dir, f)));

  // A file's fingerprinted address ("/game.js" or "game.js" -> "...?v=hash"); others as they are.
  const v = url => { const h = hashes.get(url.startsWith('/') ? url : '/' + url); return h ? `${url}?v=${h}` : url; };
  // The page with its own scripts and stylesheets fingerprinted.
  const page = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8')
    .replace(/(<script src=")([^"/][^":]*\.js)(")/g, (m, a, u, b) => a + v(u) + b)
    .replace(/(<link rel="stylesheet" href=")([^"/][^":]*\.css)(")/g, (m, a, u, b) => a + v(u) + b);
  // Cache-Control for a file served at `url` (its path) with query ?v= (or none).
  const cacheFor = (url, version) => (version && hashes.get(url) === version ? YEAR : CODE.test(url) || /\.html?$/.test(url) || !path.extname(url) ? CHECK : HOUR);
  return { v, page, cacheFor };
}

module.exports = { createAssets, YEAR, HOUR, CHECK };
