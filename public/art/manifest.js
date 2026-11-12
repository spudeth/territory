// ---------- Art manifest (loop 16) ----------
// Every graphic added in the economy update lives in public/art/ and is named only here. To change one, replace
// its file (same name and size ratio); no code changes. All are placeholders in the game's pixel style.
//   factory          a factory on its block (awake)
//   factoryAsleep    a factory that has run out of time ("Zzz", greyed)
//   wall             a wall along one side of a block (drawn stretched along the side; 16 x 4)
//   forSale          the marker on a listed block
//   levelShades      10 pixels in a row: the tint over a level-1 to level-10 block (colour and opacity)
//   build, marketplace, demolition, infoCard   icons (drawn in the current text colour where shown inline)
const ART = {
  factory: 'art/factory.svg',
  factoryAsleep: 'art/factory-asleep.svg',
  forSale: 'art/for-sale.svg',
  levelShades: 'art/level-shades.svg',
  build: 'art/build.svg',
  marketplace: 'art/marketplace.svg',
  infoCard: 'art/info-card.svg',
};

// Loaded images, by name; drawing code checks `.complete` before using one.
const artImages = {};
function artImage(name, onload) {
  if (!artImages[name]) artImages[name] = Object.assign(new Image(), { src: ART[name], onload: () => onload?.() });
  return artImages[name];
}

// The level tints, read once from levelShades: index 1-10 -> a CSS colour (with alpha), '' for none.
let levelShadeColors = null;
function levelShade(level) {
  if (!levelShadeColors) {
    const img = artImage('levelShades', () => { levelShadeColors = null; typeof draw === 'function' && draw(); });
    if (!img.complete || !img.naturalWidth) return '';
    const c = document.createElement('canvas');
    c.width = 10; c.height = 1;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 10, 1);
    const d = g.getImageData(0, 0, 10, 1).data;
    levelShadeColors = Array.from({ length: 10 }, (_, i) => d[i * 4 + 3] ? `rgba(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]},${(d[i * 4 + 3] / 255).toFixed(3)})` : '');
  }
  return levelShadeColors[Math.min(10, Math.max(1, level)) - 1];
}
