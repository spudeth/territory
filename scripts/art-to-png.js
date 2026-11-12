// Art standard (loop 19): node scripts/art-to-png.js <in.svg> <out.png> [size=64]
// Draws an SVG into a size x size transparent PNG, crisp (no smoothing), with Chrome. For moving the placeholder art
// into the plug-ins' look/ folders.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const [input, output, size = '64'] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node scripts/art-to-png.js <in.svg> <out.png> [size]'); process.exit(1); }
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const svg = 'data:image/svg+xml;base64,' + fs.readFileSync(input).toString('base64');
  const data = await page.evaluate(async (src, n) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: n, height: n });
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const k = Math.min(n / img.width, n / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
    ctx.drawImage(img, Math.floor((n - w) / 2), Math.floor((n - h) / 2), w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, svg, Number(size));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(data, 'base64'));
  await browser.close();
  console.log(`Wrote ${output} (${size}x${size})`);
})().catch(err => { console.error(err.message); process.exit(1); });
