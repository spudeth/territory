# The 205 new skin proposals (loop 12): 150 Common patterns, 35 Rare, 15 Ultra Rare, 5 Legendary (animated),
# all drawn in code at 16x16. Writes a review page: python new_skins.py <out.html>
import base64, io, math, random, sys
from PIL import Image, ImageDraw

L, D = (200, 200, 200), (110, 110, 110)
TINT = (194, 155, 255)   # previews show patterns in a sample player color

def tint(im):   # grey pattern -> the sample color, keeping light and dark
    out = Image.new('RGB', im.size)
    for p in [(x, y) for x in range(16) for y in range(16)]:
        k = im.getpixel(p)[0] / 200
        out.putpixel(p, tuple(int(c * k) for c in TINT))
    return out

# ---------- Common: patterns, f(u, v) -> dark? ----------
FAMILIES = []
def fam(name, f, params): FAMILIES.extend((name, f, p) for p in params)
fam('Stripes', lambda u, v, p: ((u * p[0] + v * p[1]) // p[2]) % 2 == 0, [(1, 0, 2), (1, 0, 4), (0, 1, 2), (0, 1, 4), (1, 1, 2), (1, 1, 4), (1, -1, 2), (1, -1, 4), (1, 2, 3), (2, 1, 3), (1, 0, 1), (1, 1, 1)])
fam('Checks', lambda u, v, p: (u // p[0] + v // p[1]) % 2 == 0, [(1, 1), (2, 2), (4, 4), (8, 8), (2, 4), (4, 2), (8, 4), (4, 8)])
fam('Dots', lambda u, v, p: (u % p[0] - p[0] // 2) ** 2 + (v % p[0] - p[0] // 2) ** 2 <= p[1], [(4, 0), (4, 1), (8, 2), (8, 5), (8, 9), (16, 20)])
fam('Waves', lambda u, v, p: (v + round(p[0] * math.sin(u * 2 * math.pi / p[1]))) % p[2] < p[2] // 2, [(1, 8, 4), (2, 8, 4), (2, 16, 8), (3, 16, 8), (1, 4, 4), (4, 16, 8)])
fam('Zigzag', lambda u, v, p: (v + abs(u % p[1] - p[1] // 2) * p[0]) % p[2] < p[2] // 2, [(1, 4, 4), (1, 8, 4), (1, 8, 8), (2, 4, 8), (1, 16, 8), (2, 8, 8)])
fam('Plaid', lambda u, v, p: (u % p[0] < p[1]) or (v % p[0] < p[1]), [(4, 1), (8, 1), (8, 2), (8, 3), (16, 2), (16, 4)])
fam('Crosshatch', lambda u, v, p: (u + v) % p == 0 or (u - v) % p == 0, [3, 4, 6, 8])
fam('Diamonds', lambda u, v, p: abs(u % p[0] - p[0] / 2 + .5) + abs(v % p[0] - p[0] / 2 + .5) < p[1], [(4, 2), (8, 3), (8, 4), (16, 6), (16, 8), (8, 2)])
fam('Rings', lambda u, v, p: int(math.hypot(u % p[0] - p[0] / 2 + .5, v % p[0] - p[0] / 2 + .5)) % p[1] == 0, [(16, 2), (16, 3), (8, 2), (16, 4)])
fam('Bricks', lambda u, v, p: v % p[1] == 0 or (u + (p[0] // 2 if (v // p[1]) % 2 else 0)) % p[0] == 0, [(8, 4), (4, 2), (8, 2), (16, 4), (6, 3)])
fam('Scales', lambda u, v, p: math.hypot(u % p - p / 2, v % p) < p / 2 + .5 and ((u // p + v // p) % 2 == 0), [4, 8, 16])
fam('Grid', lambda u, v, p: u % p[0] < p[1] and v % p[0] < 16 or (v % p[0] < p[1]), [(4, 1), (8, 1), (16, 1), (8, 2)])
fam('Pluses', lambda u, v, p: (u % p == p // 2 and abs(v % p - p // 2) <= p // 4) or (v % p == p // 2 and abs(u % p - p // 2) <= p // 4), [4, 8, 16])
fam('Triangles', lambda u, v, p: (u % p[0]) <= (v % p[0]) if p[1] else (u % p[0]) >= (p[0] - 1 - v % p[0]), [(4, 1), (8, 1), (16, 1), (4, 0), (8, 0), (16, 0)])
fam('Chevrons', lambda u, v, p: (v - abs(u % p[0] - p[0] // 2)) % p[1] < p[1] // 2, [(8, 4), (8, 8), (16, 8), (4, 4)])
fam('Herringbone', lambda u, v, p: ((u // p) % 2 == 0 and (u + v) % p < p // 2) or ((u // p) % 2 == 1 and (u - v) % p < p // 2), [4, 8])
fam('Stipple', lambda u, v, p: random.Random(p[0] * 999 + u * 31 + v).random() < p[1], [(s, d) for s in range(5) for d in (.15, .35)])
fam('Mosaic', lambda u, v, p: random.Random(p * 7919 + (u // 2) * 17 + v // 2).random() < .5, list(range(8)))
fam('Spiral', lambda u, v, p: int(math.atan2(v - 7.5, u - 7.5) / math.pi * p + math.hypot(u - 7.5, v - 7.5) / 2) % 2 == 0, [2, 3, 4])
fam('Greek Key', lambda u, v, p: [0xFFFF, 0x8001, 0xBFFD, 0xA005, 0xA7E5, 0xA425, 0xA5A5, 0xA4A5, 0xA7A5, 0xA025, 0xBFE5, 0x8005, 0xFFFD, 0x0001, 0xFFFF, 0][v] >> (15 - u) & p, [1])
fam('Stars', lambda u, v, p: (u % p, v % p) in {(p // 2, p // 2 - 1), (p // 2 - 1, p // 2), (p // 2, p // 2), (p // 2 + 1, p // 2), (p // 2, p // 2 + 1)}, [4, 8, 16])
fam('Lattice', lambda u, v, p: (u % p == v % p) or (u % p == (p - 1 - v % p)), [4, 8, 16])
fam('Hearts', lambda u, v, p: (lambda a, b: (b in (1, 2) and a in (1, 2, 4, 5)) or (b in (3,) and 1 <= a <= 5) or (b == 4 and 2 <= a <= 4) or (b == 5 and a == 3))(u % p, v % p), [8, 16])
fam('Arches', lambda u, v, p: math.hypot(u % p - p / 2 + .5, v % p) < p / 2 and math.hypot(u % p - p / 2 + .5, v % p) > p / 2 - 2, [8, 16])
ADJ = ['Tiny', 'Bold', 'Soft', 'Sharp', 'Wild', 'Calm', 'Lucky', 'Swift', 'Royal', 'Cozy', 'Funky', 'Neat', 'Lazy', 'Brave', 'Fizzy', 'Dizzy']

def pattern(f, p):
    im = Image.new('RGB', (16, 16), L)
    for u in range(16):
        for v in range(16):
            if f(u, v, p): im.putpixel((u, v), D)
    return im

commons, seen = [], set()
for i, (name, f, p) in enumerate(FAMILIES):
    for invert in (False, True):
        im = pattern(f, p)
        if invert: im = Image.eval(im, lambda c: 310 - c)
        sig = im.tobytes()
        if sig in seen or len(set(im.getdata())) < 2: continue
        seen.add(sig)
        dark = sum(1 for c in im.getdata() if c == D) / 256
        edges = sum(im.getpixel((u, v)) != im.getpixel(((u + 1) % 16, v)) for u in range(16) for v in range(16)) / 256
        commons.append((f'{ADJ[len(commons) % len(ADJ)]} {name}', name, im, 100 + round(min(1, edges * 2) * 200 / 10) * 10))
commons = commons[:150]

# ---------- Full-color art ----------
def art(fn):
    im = Image.new('RGB', (16, 16)); fn(ImageDraw.Draw(im), im); return im
def grad(d, top, bottom, y0=0, y1=16):
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        d.line([(0, y), (15, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
def hexc(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

PALETTES = {'Sunset': ['#2b1055', '#d53369', '#ff8c42', '#ffd166'], 'Ocean': ['#03045e', '#0077b6', '#00b4d8', '#caf0f8'],
            'Forest': ['#1b4332', '#2d6a4f', '#52b788', '#d8f3dc'], 'Candy': ['#ff5d8f', '#ffd6e0', '#7ae7c7', '#fff3b0'],
            'Ember': ['#370617', '#9d0208', '#e85d04', '#ffba08'], 'Arctic': ['#e0fbfc', '#98c1d9', '#3d5a80', '#293241'],
            'Neon': ['#0d0221', '#ff2a6d', '#05d9e8', '#d1f7ff'], 'Desert': ['#6f4518', '#bc8a5f', '#e7bc91', '#ffedd8'],
            'Grape': ['#240046', '#5a189a', '#9d4edd', '#e0aaff']}
def motif_bands(pal): return lambda d, im: [d.rectangle([0, i * 4, 15, i * 4 + 3], fill=pal[i]) for i in range(4)]
def motif_sun(pal): return lambda d, im: (grad(d, hexc(pal[0]), hexc(pal[1])), d.ellipse([4, 6, 11, 13], fill=pal[3]), d.rectangle([0, 12, 15, 15], fill=pal[0]))
def motif_mosaic(pal, seed): return lambda d, im: [d.rectangle([x, y, x + 3, y + 3], fill=random.Random(seed + x * 7 + y).choice(pal)) for x in range(0, 16, 4) for y in range(0, 16, 4)]
def motif_glass(pal, seed):
    pts = [(random.Random(seed + i).randrange(16), random.Random(seed + 50 + i).randrange(16)) for i in range(6)]
    def fn(d, im):
        for x in range(16):
            for y in range(16):
                dist = sorted(((x - a) ** 2 + (y - b) ** 2, i) for i, (a, b) in enumerate(pts))
                im.putpixel((x, y), (20, 20, 20) if dist[1][0] - dist[0][0] < 4 else hexc(pal[dist[0][1] % 4]))
    return fn
def motif_diag(pal): return lambda d, im: [d.line([(i - 16, 16), (i, 0)], fill=pal[(i // 3) % 4], width=3) for i in range(0, 33, 3)]
RARES = []
for name, pal in PALETTES.items():
    RARES += [(f'{name} Bands', motif_bands(pal)), (f'{name} Sun', motif_sun(pal)), (f'{name} Mosaic', motif_mosaic(pal, len(RARES)))]
    RARES += [(f'{name} Glass', motif_glass(pal, len(RARES)))]
RARES = RARES[:30] + [(f'{n} Candy Cane', motif_diag(PALETTES[n])) for n in ('Candy', 'Neon', 'Ember', 'Ocean', 'Grape')]

def mountains(d, im):
    grad(d, (40, 30, 90), (250, 140, 90), 0, 11); d.ellipse([10, 2, 13, 5], fill='#fff4c2')
    d.polygon([(0, 13), (5, 4), (9, 10), (12, 6), (16, 13)], fill='#3a3f5c'); d.polygon([(5, 4), (4, 6), (6, 6)], fill='#fff')
    d.rectangle([0, 13, 15, 15], fill='#26304a')
def starry(d, im):
    grad(d, (5, 10, 40), (30, 40, 110)); [d.point([(random.Random(i).randrange(16), random.Random(i + 9).randrange(11))], fill='#fff') for i in range(14)]
    d.ellipse([10, 2, 14, 6], fill='#fff6c9'); d.ellipse([11, 1, 15, 5], fill=(5, 10, 40)); d.polygon([(0, 16), (0, 12), (6, 10), (11, 13), (16, 11), (16, 16)], fill='#11182e')
def reef(d, im):
    grad(d, (0, 150, 200), (0, 40, 90)); d.rectangle([0, 13, 15, 15], fill='#e9d8a6')
    d.polygon([(2, 13), (3, 8), (4, 13)], fill='#ff6b6b'); d.polygon([(11, 13), (12, 9), (14, 13)], fill='#c77dff')
    d.ellipse([6, 5, 10, 8], fill='#ffb703'); d.polygon([(10, 6), (12, 5), (12, 8)], fill='#ffb703'); d.point([(7, 6)], fill='#000')
def volcano(d, im):
    grad(d, (60, 10, 20), (200, 60, 30)); d.polygon([(1, 16), (6, 6), (10, 6), (15, 16)], fill='#2b1b17')
    d.polygon([(6, 6), (8, 1), (10, 6)], fill='#ff7b00'); d.line([(8, 6), (7, 12)], fill='#ff4800'); d.line([(8, 6), (10, 13)], fill='#ff4800')
def crystal(d, im):
    grad(d, (20, 10, 40), (60, 20, 90)); [d.polygon([(x, 16), (x + 2, 6 + (x % 5)), (x + 4, 16)], fill=c) for x, c in ((0, '#7df9ff'), (5, '#c77dff'), (10, '#80ffdb'))]
def blossom(d, im):
    grad(d, (255, 230, 240), (200, 230, 255)); d.line([(0, 14), (8, 8), (15, 10)], fill='#5e3b2e', width=1)
    [d.ellipse([x, y, x + 2, y + 2], fill='#ff8fab') for x, y in ((2, 9), (6, 6), (9, 7), (12, 8), (4, 11), (13, 11))]
def aurora_mtn(d, im):
    grad(d, (5, 15, 30), (10, 40, 60)); [d.arc([-4, y, 20, y + 10], 180, 360, fill=c) for y, c in ((2, '#38ef7d'), (4, '#11998e'), (6, '#8e2de2'))]
    d.polygon([(0, 16), (4, 10), (8, 14), (12, 9), (16, 16)], fill='#0b1a2b')
def oasis(d, im):
    grad(d, (255, 200, 120), (250, 230, 180)); d.ellipse([3, 11, 13, 15], fill='#2ec4b6'); d.line([(9, 12), (8, 5)], fill='#6b4226')
    [d.line([(8, 5), (8 + dx, 5 + dy)], fill='#2d6a4f') for dx, dy in ((-3, 1), (3, 1), (-2, -1), (2, -1))]
def waterfall(d, im):
    d.rectangle([0, 0, 15, 15], fill='#2d6a4f'); d.rectangle([5, 0, 10, 12], fill='#90e0ef'); [d.line([(x, 0), (x, 12)], fill='#caf0f8') for x in (6, 9)]
    d.ellipse([2, 11, 13, 15], fill='#48cae4')
def castle(d, im):
    grad(d, (255, 160, 120), (120, 80, 160)); d.rectangle([3, 7, 12, 15], fill='#2b2d42'); [d.rectangle([x, 4, x + 2, 15], fill='#2b2d42') for x in (2, 11)]
    [d.point([(x, 3)], fill='#2b2d42') for x in (2, 4, 11, 13)]; d.rectangle([7, 11, 8, 15], fill='#ffd166')
def lighthouse(d, im):
    grad(d, (20, 30, 70), (60, 90, 140)); d.rectangle([0, 13, 15, 15], fill='#1d3557'); d.polygon([(6, 13), (7, 4), (9, 4), (10, 13)], fill='#f1faee')
    d.rectangle([7, 7, 8, 8], fill='#e63946'); d.polygon([(9, 4), (16, 2), (16, 6)], fill='#ffe066')
def village(d, im):
    grad(d, (40, 50, 90), (90, 110, 160)); d.rectangle([0, 12, 15, 15], fill='#f8f9fa')
    for x in (1, 6, 11): d.rectangle([x, 9, x + 3, 12], fill='#6d4c41'); d.polygon([(x - 1, 9), (x + 1.5, 6), (x + 4, 9)], fill='#f8f9fa'); d.point([(x + 1, 10)], fill='#ffd166')
def jungle(d, im):
    d.rectangle([0, 0, 15, 15], fill='#081c15'); [d.ellipse([x, y, x + 6, y + 4], fill=c) for x, y, c in ((-2, 2, '#2d6a4f'), (6, 0, '#40916c'), (9, 7, '#1b4332'), (0, 10, '#52b788'), (5, 12, '#2d6a4f'))]
    d.ellipse([7, 6, 9, 8], fill='#ffb703')
def cyber(d, im):
    d.rectangle([0, 0, 15, 15], fill='#0d0221'); [d.line([(0, y), (15, y)], fill='#ff2a6d') for y in (9, 11, 14)]
    [d.line([(8, 8), (x, 15)], fill='#05d9e8') for x in (-8, 0, 8, 16, 24)]; d.ellipse([5, 2, 11, 8], fill='#ff8c42')
ULTRA = [('Alpenglow', mountains), ('Starry Hills', starry), ('Coral Reef', reef), ('Volcano', volcano), ('Crystal Cave', crystal),
         ('Blossom Branch', blossom), ('Northern Lights', aurora_mtn), ('Oasis', oasis), ('Waterfall', waterfall), ('Dusk Castle', castle),
         ('Lighthouse', lighthouse), ('Snow Village', village), ('Deep Jungle', jungle), ('Synth Horizon', cyber),
         ('Moonlit Sea', lambda d, im: (grad(d, (10, 15, 50), (20, 60, 120)), d.ellipse([6, 2, 10, 6], fill='#fff6c9'), [d.line([(x, 10 + (x % 3)), (x + 3, 10 + (x % 3))], fill='#9bd1ff') for x in range(0, 16, 4)]))]

# ---------- Legendary: 4 frames each ----------
def phoenix(t): return art(lambda d, im: (grad(d, (40, 0, 0), (120, 20, 0)), [d.polygon([(x, 16), (x + 2, 4 + (x * 3 + t * 2) % 6), (x + 4, 16)], fill=c) for x, c in ((0, '#ff4800'), (4, '#ffb703'), (8, '#ff6d00'), (12, '#ffd60a'))]))
def aurora(t): return art(lambda d, im: (grad(d, (2, 8, 25), (5, 20, 45)), [d.arc([-6, y + (t if i % 2 else -t) % 3, 22, y + 12], 180, 360, fill=c, width=2) for i, (y, c) in enumerate(((1, '#38ef7d'), (4, '#00f5d4'), (7, '#9b5de5')))]))
def prism(t): return art(lambda d, im: [d.line([(0, y), (15, y)], fill='hsl({},90%,60%)'.format((y * 22 + t * 90) % 360)) for y in range(16)])
def vortex(t): return art(lambda d, im: [im.putpixel((x, y), (lambda a: (int(120 + 120 * math.sin(a)), 40, int(200 + 50 * math.cos(a))))(math.atan2(y - 7.5, x - 7.5) * 3 + math.hypot(x - 7.5, y - 7.5) * .6 - t * math.pi / 2)) for x in range(16) for y in range(16)])
def storm(t): return art(lambda d, im: (grad(d, (30, 30, 50), (70, 70, 100)), d.ellipse([-2, -2, 18, 6], fill='#2b2d42'), t == 2 and d.line([(9, 4), (6, 9), (9, 9), (6, 15)], fill='#fff27a', width=1)))
LEGEND = [('Phoenix Flame', phoenix), ('Aurora Veil', aurora), ('Prism', prism), ('Cosmic Vortex', vortex), ('Thunderhead', storm)]

# ---------- The review page ----------
def uri(im, gif=None):
    buf = io.BytesIO()
    if gif: gif[0].save(buf, 'GIF', save_all=True, append_images=gif[1:], duration=220, loop=0)
    else: im.save(buf, 'PNG')
    return f'data:image/{"gif" if gif else "png"};base64,' + base64.b64encode(buf.getvalue()).decode()
cards = []
def card(tier, name, group, src, price):
    key = (tier + '-' + name).lower().replace(' ', '-')
    cards.append(f'<div class="c" data-k="{key}" data-n="{name}" data-t="{tier}"><img src="{src}"><div class="t">' + f'<img src="{src}">' * 9 +
                 f'</div><b>{name}</b><small>{tier} · {group} · {price:,}</small><label><input type="checkbox"> Approve</label><input class="cm" placeholder="Comment"></div>')
for name, group, im, price in commons: card('Common', name, group, uri(tint(im)), price)
for i, (name, fn) in enumerate(RARES): card('Rare', name, name.split()[-1], uri(art(fn)), 1000 + (i % 5) * 500)
for i, (name, fn) in enumerate(ULTRA): card('Ultra Rare', name, 'Scenes', uri(art(fn)), 4000 + (i % 5) * 1000)
for i, (name, fn) in enumerate(LEGEND): card('Legendary', name, 'Showpieces', uri(None, [fn(t).resize((16, 16)) for t in range(4)]), [25000, 20000, 15000, 12500, 10000][i])
page = """<!doctype html><meta charset="utf-8"><title>New Skins Review</title><style>body{background:#0f131a;color:#f2f4f8;font:15px system-ui;margin:20px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}.c{background:#1b2230;border:3px solid #0a0d12;padding:8px;display:flex;flex-direction:column;gap:4px}
.c>img{width:100%;aspect-ratio:1;image-rendering:pixelated}.t{display:grid;grid-template-columns:repeat(3,1fr)}.t img{width:100%;image-rendering:pixelated;display:block}
small{color:#a9b3c4}.cm{background:#0f131a;color:#fff;border:1px solid #333;padding:4px}.c.on{border-color:#f7c948}#bar{position:sticky;top:0;background:#0f131a;padding:8px 0;z-index:1}
button{background:#f7c948;border:0;padding:8px 12px;font-weight:700;cursor:pointer}textarea{width:100%;height:120px;margin-top:8px}</style>
<div id="bar"><b>205 new skins.</b> Tick Approve and add comments, then <button id="copy">Copy my picks</button> and paste them to Cody. <span id="n"></span>
<textarea id="out" hidden></textarea></div><div class="g">""" + ''.join(cards) + """</div><script>
const cs=[...document.querySelectorAll('.c')],k='skins-review';let s={};try{s=JSON.parse(localStorage.getItem(k)||'{}')}catch{}
function save(){try{localStorage.setItem(k,JSON.stringify(s))}catch{}document.getElementById('n').textContent=Object.values(s).filter(v=>v.a).length+' approved'}
for(const c of cs){const v=s[c.dataset.k]||{},cb=c.querySelector('[type=checkbox]'),cm=c.querySelector('.cm');cb.checked=!!v.a;cm.value=v.c||'';c.classList.toggle('on',cb.checked);
const up=()=>{s[c.dataset.k]={a:cb.checked,c:cm.value};c.classList.toggle('on',cb.checked);save()};cb.onchange=up;cm.oninput=up}
save();document.getElementById('copy').onclick=()=>{const o=document.getElementById('out');o.hidden=false;
o.value='Approved: '+cs.filter(c=>s[c.dataset.k]?.a).map(c=>c.dataset.t+' '+c.dataset.n).join(', ')+'\\nComments:\\n'+cs.filter(c=>s[c.dataset.k]?.c).map(c=>c.dataset.n+': '+s[c.dataset.k].c).join('\\n');
o.select();navigator.clipboard?.writeText(o.value).catch(()=>{})}</script>"""
open(sys.argv[1], 'w', encoding='utf8').write(page)
print(len(commons), 'common', len(RARES), 'rare', len(ULTRA), 'ultra', len(LEGEND), 'legendary')
