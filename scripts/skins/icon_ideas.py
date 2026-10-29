# Skin ideas: 16x16 icons drawn in code, shown large on one page to pick from. Usage: python icon_ideas.py <out.html>
import base64, io, math, sys
from PIL import Image, ImageDraw

def icon(bg, fn):
    im = Image.new('RGBA', (16, 16), bg)
    fn(ImageDraw.Draw(im))
    return im

def star(d, cx, cy, r, c, n=5, k=.45):
    d.polygon([(cx + (r if i % 2 == 0 else r * k) * math.cos(-math.pi / 2 + i * math.pi / n),
                cy + (r if i % 2 == 0 else r * k) * math.sin(-math.pi / 2 + i * math.pi / n)) for i in range(2 * n)], fill=c)

def heart(d, c):
    d.ellipse([2, 3, 8, 9], fill=c); d.ellipse([7, 3, 13, 9], fill=c); d.polygon([(2, 7), (13, 7), (7.5, 13)], fill=c)

ICONS = {
    'Heart': icon('#ffd6e0', lambda d: heart(d, '#e8304a')),
    'Gold Star': icon('#1b2a6b', lambda d: star(d, 8, 8.5, 7, '#ffcc00')),
    'Moon': icon('#0e1638', lambda d: (d.ellipse([3, 2, 13, 12], fill='#f4e6a1'), d.ellipse([6, 1, 15, 10], fill='#0e1638'), d.point([(3, 13), (12, 13), (14, 5)], fill='#fff'))),
    'Sun': icon('#7ec8ff', lambda d: ([d.line([(8, 8), (8 + 7 * math.cos(a), 8 + 7 * math.sin(a))], fill='#ffb300') for a in [i * math.pi / 4 for i in range(8)]], d.ellipse([4, 4, 11, 11], fill='#ffd23f'))),
    'Flame': icon('#2a0d05', lambda d: (d.polygon([(8, 1), (13, 9), (11, 14), (5, 14), (3, 9)], fill='#ff5a1f'), d.polygon([(8, 6), (11, 11), (9, 14), (7, 14), (5, 11)], fill='#ffd23f'))),
    'Wave': icon('#1f6fb2', lambda d: [d.arc([x, y, x + 6, y + 5], 180, 360, fill='#bfe6ff') for y in (2, 7, 12) for x in (-2, 4, 10)]),
    'Diamond': icon('#2b1d4f', lambda d: (d.polygon([(8, 2), (14, 7), (8, 14), (2, 7)], fill='#7fe7ff'), d.polygon([(8, 2), (11, 7), (8, 14)], fill='#c9f6ff'))),
    'Smiley': icon('#ffd23f', lambda d: (d.rectangle([4, 5, 5, 6], fill='#222'), d.rectangle([10, 5, 11, 6], fill='#222'), d.arc([3, 5, 12, 12], 20, 160, fill='#222'))),
    'Cherry': icon('#fff3e0', lambda d: (d.line([(5, 9), (9, 2)], fill='#3a7d2a'), d.line([(11, 10), (9, 2)], fill='#3a7d2a'), d.ellipse([2, 8, 7, 13], fill='#d1122b'), d.ellipse([8, 9, 13, 14], fill='#d1122b'))),
    'Mushroom': icon('#9be27a', lambda d: (d.pieslice([2, 2, 14, 14], 180, 360, fill='#e23b2e'), d.rectangle([6, 8, 9, 14], fill='#f5e6c8'), d.ellipse([4, 4, 6, 6], fill='#fff'), d.ellipse([9, 3, 11, 5], fill='#fff'))),
    'Ghost': icon('#24123d', lambda d: (d.pieslice([3, 2, 13, 12], 180, 360, fill='#f2f2ff'), d.rectangle([3, 7, 12, 13], fill='#f2f2ff'), d.rectangle([5, 6, 6, 8], fill='#222'), d.rectangle([9, 6, 10, 8], fill='#222'))),
    'Lightning': icon('#3b2a6b', lambda d: d.polygon([(9, 1), (4, 9), (8, 9), (6, 15), (12, 6), (8, 6)], fill='#ffe14d')),
    'Snowflake': icon('#9fd8ff', lambda d: [d.line([(8 - 6 * math.cos(a), 8 - 6 * math.sin(a)), (8 + 6 * math.cos(a), 8 + 6 * math.sin(a))], fill='#fff') for a in (0, math.pi / 3, 2 * math.pi / 3)]),
    'Leaf': icon('#e9f7d8', lambda d: (d.ellipse([2, 4, 14, 12], fill='#3fa34d'), d.line([(3, 8), (13, 8)], fill='#1f6b2a'))),
    'Flower': icon('#8fd16a', lambda d: ([d.ellipse([8 + 3.5 * math.cos(a) - 3, 8 + 3.5 * math.sin(a) - 3, 8 + 3.5 * math.cos(a) + 3, 8 + 3.5 * math.sin(a) + 3], fill='#ff8fb8') for a in [i * 2 * math.pi / 5 for i in range(5)]], d.ellipse([6, 6, 10, 10], fill='#ffd23f'))),
    'Crown': icon('#5b1a8c', lambda d: (d.polygon([(2, 12), (2, 5), (5, 8), (8, 3), (11, 8), (14, 5), (14, 12)], fill='#ffcc00'), d.point([(8, 9)], fill='#e8304a'))),
    'Skull': icon('#3a3a3a', lambda d: (d.ellipse([3, 2, 13, 11], fill='#f0f0f0'), d.rectangle([5, 10, 10, 13], fill='#f0f0f0'), d.rectangle([5, 5, 6, 7], fill='#222'), d.rectangle([9, 5, 10, 7], fill='#222'))),
    'Pizza': icon('#ffe8b0', lambda d: (d.polygon([(2, 2), (14, 2), (8, 14)], fill='#f2b134'), d.rectangle([2, 2, 14, 3], fill='#b36b1e'), d.ellipse([6, 5, 8, 7], fill='#c4302b'), d.ellipse([9, 6, 11, 8], fill='#c4302b'))),
    'Donut': icon('#a8e6ff', lambda d: (d.ellipse([2, 2, 14, 14], fill='#ff7eb6'), d.ellipse([6, 6, 10, 10], fill='#a8e6ff'), d.point([(4, 6), (11, 4), (12, 10), (5, 11)], fill='#fff'))),
    'Alien': icon('#16241a', lambda d: (d.ellipse([3, 2, 13, 13], fill='#5ee05e'), d.ellipse([4, 6, 7, 9], fill='#111'), d.ellipse([9, 6, 12, 9], fill='#111'))),
    'Rocket': icon('#0b1026', lambda d: (d.polygon([(8, 1), (11, 6), (11, 11), (5, 11), (5, 6)], fill='#e8e8f0'), d.polygon([(5, 9), (2, 13), (5, 12)], fill='#e8304a'), d.polygon([(11, 9), (14, 13), (11, 12)], fill='#e8304a'), d.polygon([(6, 11), (10, 11), (8, 15)], fill='#ffb300'), d.ellipse([7, 5, 9, 7], fill='#4ab3ff'))),
    'Planet': icon('#0b1026', lambda d: (d.ellipse([4, 4, 12, 12], fill='#ff9f43'), d.line([(1, 11), (15, 5)], fill='#ffe0b0', width=1), d.point([(2, 2), (13, 13), (14, 2)], fill='#fff'))),
    'Cat': icon('#ffd9a8', lambda d: (d.polygon([(3, 5), (4, 1), (7, 4)], fill='#444'), d.polygon([(13, 5), (12, 1), (9, 4)], fill='#444'), d.ellipse([3, 3, 13, 13], fill='#444'), d.point([(6, 7), (10, 7)], fill='#ffe14d'), d.point([(8, 9)], fill='#ff8fb8'))),
    'Fish': icon('#3aa0d8', lambda d: (d.ellipse([3, 5, 12, 11], fill='#ff8c2a'), d.polygon([(11, 8), (15, 5), (15, 11)], fill='#ff8c2a'), d.point([(5, 7)], fill='#111'))),
    'Paw': icon('#f3e7d6', lambda d: (d.ellipse([5, 8, 11, 13], fill='#5a3a22'), [d.ellipse([x, y, x + 3, y + 3], fill='#5a3a22') for x, y in ((2, 5), (5, 2), (9, 2), (12, 5))])),
    'Music': icon('#262a4f', lambda d: (d.line([(6, 3), (6, 11)], fill='#fff'), d.line([(12, 2), (12, 10)], fill='#fff'), d.line([(6, 3), (12, 2)], fill='#fff', width=2), d.ellipse([3, 10, 6, 13], fill='#fff'), d.ellipse([9, 9, 12, 12], fill='#fff'))),
    'Gem Red': icon('#2b0f14', lambda d: (d.polygon([(4, 3), (12, 3), (14, 6), (8, 14), (2, 6)], fill='#e8304a'), d.polygon([(4, 3), (8, 3), (8, 14), (2, 6)], fill='#ff6a7f'))),
    'Clover': icon('#e8f7e0', lambda d: ([d.ellipse([x, y, x + 6, y + 6], fill='#2f9e44') for x, y in ((2, 2), (8, 2), (2, 7), (8, 7))], d.line([(8, 11), (10, 15)], fill='#1f6b2a'))),
    'Rainbow': icon('#bfe9ff', lambda d: [d.arc([1 + i, 4 + i, 15 - i, 18 - i], 180, 360, fill=c, width=1) for i, c in enumerate(['#e8304a', '#ff8c2a', '#ffd23f', '#3fa34d', '#3a75c4', '#7b4bc4'])]),
    'Cactus': icon('#f6d98a', lambda d: (d.rectangle([7, 3, 9, 14], fill='#3f9e4d'), d.rectangle([3, 6, 4, 10], fill='#3f9e4d'), d.rectangle([4, 9, 7, 10], fill='#3f9e4d'), d.rectangle([12, 5, 13, 8], fill='#3f9e4d'), d.rectangle([9, 8, 12, 9], fill='#3f9e4d'))),
    'Anchor': icon('#d9eef7', lambda d: (d.line([(8, 3), (8, 13)], fill='#1d3557', width=2), d.ellipse([6, 1, 10, 5], outline='#1d3557'), d.arc([3, 6, 13, 14], 0, 180, fill='#1d3557', width=2), d.line([(5, 6), (11, 6)], fill='#1d3557'))),
    'Pixel Sword': icon('#2d2d3a', lambda d: (d.line([(3, 13), (13, 3)], fill='#d9e2ec', width=2), d.line([(3, 10), (6, 13)], fill='#c99a3c', width=2), d.point([(2, 14)], fill='#8b5a2b'))),
    'Shield': icon('#cfd8dc', lambda d: (d.polygon([(3, 2), (13, 2), (13, 8), (8, 14), (3, 8)], fill='#1d4ed8'), d.rectangle([7, 3, 8, 12], fill='#ffcc00'), d.rectangle([4, 6, 12, 7], fill='#ffcc00'))),
    'Checker Flag': icon('#fff', lambda d: [d.rectangle([x, y, x + 3, y + 3], fill='#111') for x in range(0, 16, 4) for y in range(0, 16, 4) if (x + y) // 4 % 2]),
    'Galaxy': icon('#14082e', lambda d: ([d.point([(x * 7 % 16, x * 11 % 16)], fill='#fff') for x in range(12)], d.ellipse([5, 6, 11, 10], fill='#b26bff'), d.ellipse([7, 7, 9, 9], fill='#ffe0ff'))),
    'Lava': icon('#5a1105', lambda d: [d.ellipse([x, y, x + 5, y + 4], fill=c) for x, y, c in ((1, 2, '#ff5a1f'), (8, 6, '#ffb300'), (3, 10, '#ff8c2a'), (10, 12, '#ff5a1f'))]),
    'Ice': icon('#bfe9ff', lambda d: (d.polygon([(0, 16), (5, 4), (9, 16)], fill='#e6f7ff'), d.polygon([(7, 16), (12, 7), (16, 16)], fill='#8fd3ff'))),
    'Camo': icon('#6b7f3a', lambda d: [d.ellipse([x, y, x + 6, y + 4], fill=c) for x, y, c in ((0, 1, '#3e4a22'), (8, 3, '#a39461'), (3, 8, '#a39461'), (9, 10, '#3e4a22'), (-2, 12, '#3e4a22'))]),
    'Bubbles': icon('#2f8fd8', lambda d: [d.ellipse([x, y, x + r, y + r], outline='#d6f0ff') for x, y, r in ((2, 9, 4), (8, 3, 5), (10, 10, 3), (4, 3, 2))]),
    'Robot': icon('#b8c1cc', lambda d: (d.rectangle([3, 4, 12, 13], fill='#6b7a8c'), d.rectangle([5, 7, 6, 8], fill='#4af2ff'), d.rectangle([9, 7, 10, 8], fill='#4af2ff'), d.rectangle([6, 11, 9, 11], fill='#222'), d.line([(8, 1), (8, 4)], fill='#6b7a8c'), d.point([(8, 1)], fill='#e8304a'))),
}

# --export: writes them as Common skins (public/skins/icon-<name>.png and a 64x64 -large.png) and prints Skins tab rows.
COLLECTIONS = {'Symbols': 'Heart,Gold Star,Moon,Sun,Lightning,Snowflake,Rainbow,Music,Crown,Shield,Anchor,Pixel Sword,Checker Flag',
  'Nature': 'Leaf,Flower,Clover,Cactus,Mushroom,Wave,Bubbles,Flame,Lava,Ice,Camo,Galaxy,Planet',
  'Critters': 'Smiley,Ghost,Alien,Skull,Robot,Cat,Fish,Paw', 'Snacks & Gems': 'Cherry,Pizza,Donut,Diamond,Gem Red,Rocket'}
if '--export' in sys.argv:
    import os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'skins')
    for col, names in COLLECTIONS.items():
        for name in names.split(','):
            key = 'icon-' + name.lower().replace(' ', '-')
            ICONS[name].save(os.path.join(out, key + '.png'))
            ICONS[name].resize((64, 64), Image.NEAREST).save(os.path.join(out, key + '-large.png'))
            print(f'{key},{name},art,Common,100,{col},yes')
    sys.exit()
html = ['<!doctype html><meta charset="utf-8"><title>Skin Ideas</title><style>body{background:#0f131a;color:#f2f4f8;font:16px system-ui;margin:24px}'
        'h1{font-size:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.c{background:#1b2230;padding:10px;border:3px solid #0a0d12;text-align:center}'
        'img{width:128px;height:128px;image-rendering:pixelated;display:block;margin:0 auto 8px}.t{display:grid;grid-template-columns:repeat(3,32px);width:96px;margin:8px auto 0}'
        '.t img{width:32px;height:32px;margin:0}label{cursor:pointer}</style><h1>Skin ideas: tick the ones you like</h1><div class="g">']
for name, im in ICONS.items():
    buf = io.BytesIO(); im.save(buf, 'PNG')
    src = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
    html.append(f'<div class="c"><img src="{src}" alt="{name}"><label><input type="checkbox"> {name}</label><div class="t">' + f'<img src="{src}" alt="">' * 9 + '</div></div>')
html.append('</div><p>Each shows large, then as 9 blocks side by side.</p>')
open(sys.argv[1], 'w', encoding='utf8').write(''.join(html))
print(len(ICONS), 'icons')
