# Draws every skin image in code: public/skins/<key>.png (16x16, one block) and <key>-large.png (Full area).
#   Patterns: two shades of grey; the game tints them with the owner's color, like the plain look.
#   Flags: full color, from each flag's real colors and proportions, simplified to read at 16x16.
# Usage: python scripts/skins/draw_skins.py            (writes public/skins/, prints the Skins tab rows)
#        python scripts/skins/draw_skins.py --sheet <png>   also writes a contact sheet of every flag
# Needs Pillow. Run it again after changing a design; the PNGs are committed.
import os, sys
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'public', 'skins')

# ---------- Patterns: light (owner's color) and dark (a shade of it) ----------
L, D = (200, 200, 200, 255), (110, 110, 110, 255)

def pattern(kind, size):
    im = Image.new('RGBA', (size, size), L)
    px, s = im.load(), size / 16
    for y in range(size):
        for x in range(size):
            u, v = int(x / s), int(y / s)   # position in 16ths, so the large one is the same pattern, bigger
            dark = {
                'checker': (u // 4 + v // 4) % 2 == 1,
                'stripes': (u + v) % 8 < 4,
                'brick': v % 8 == 7 or (u % 8 == 7 if v % 16 < 8 else u % 8 == 3),
                'dots': (u % 8 in (2, 3, 4)) and (v % 8 in (2, 3, 4)) and not (u % 8 in (2, 4) and v % 8 in (2, 4)),
                'rows': v % 8 < 3,
                'diamond': abs(u % 8 - 3.5) + abs(v % 8 - 3.5) < 3,
            }[kind]
            if dark: px[x, y] = D
    return im

PATTERNS = [('checker', 'Checker', 100), ('stripes', 'Stripes', 100), ('brick', 'Brick', 150), ('dots', 'Dots', 150),
            ('rows', 'Rows', 200), ('diamond', 'Diamond', 300)]

# ---------- Flags ----------
# Each flag: (key, name, width/height, ops). Ops use fractions of the width (x) and height (y), so the same
# design draws the 16x16 tile (squashed to a square) and the large one (its real proportions).
R, W, K, G, B, Y = '#d52b1e', '#ffffff', '#000000', '#009a44', '#0033a0', '#fcd116'
NAVY, SKY, GOLD, ORANGE, MAROON, DKG, LB = '#012169', '#75aadb', '#ffcc00', '#ff8200', '#8d1b3d', '#006a4e', '#3a75c4'

def flag_ops(d, w, h, ops):
    def X(f): return round(f * w)
    def Yp(f): return round(f * h)
    def band(n, i, total, horizontal):
        a, b = round(i / total * (h if horizontal else w)), round((i + n) / total * (h if horizontal else w))
        return a, b
    for op in ops:
        t = op[0]
        if t in ('h', 'v'):
            colors, weights = op[1], op[2] if len(op) > 2 else [1] * len(op[1])
            total, at = sum(weights), 0
            for c, n in zip(colors, weights):
                a, b = band(n, at, total, t == 'h')
                if b > a:
                    d.rectangle([0, a, w - 1, b - 1] if t == 'h' else [a, 0, b - 1, h - 1], fill=c)
                at += n
        elif t == 'rect':
            _, x0, y0, x1, y1, c = op
            d.rectangle([X(x0), Yp(y0), max(X(x0), X(x1) - 1), max(Yp(y0), Yp(y1) - 1)], fill=c)
        elif t == 'circ':
            _, cx, cy, r, c = op
            rr = max(1, r * h)
            d.ellipse([cx * w - rr, cy * h - rr, cx * w + rr - 1, cy * h + rr - 1], fill=c)
        elif t == 'pie':   # part of a circle, angles in degrees clockwise from 3 o'clock
            _, cx, cy, r, a0, a1, c = op
            rr = max(1, r * h)
            d.pieslice([cx * w - rr, cy * h - rr, cx * w + rr - 1, cy * h + rr - 1], a0, a1, fill=c)
        elif t == 'poly':
            d.polygon([(X(a), Yp(b)) for a, b in op[1]], fill=op[2])
        elif t == 'tri':   # a triangle from the hoist, reaching `depth` of the width
            d.polygon([(0, 0), (X(op[1]), h / 2), (0, h)], fill=op[2])
        elif t == 'nordic':   # cross with its upright at `cx` of the width
            _, c, cx, width = op
            t2 = max(1, round(width * h / 2))
            d.rectangle([0, h / 2 - t2, w, h / 2 + t2 - 1], fill=c)
            d.rectangle([cx * w - t2, 0, cx * w + t2 - 1, h], fill=c)
        elif t == 'cross':
            _, c, width = op
            t2 = max(1, round(width * h / 2))
            d.rectangle([0, h / 2 - t2, w, h / 2 + t2 - 1], fill=c)
            d.rectangle([w / 2 - t2, 0, w / 2 + t2 - 1, h], fill=c)
        elif t == 'salt':
            _, c, width = op
            k = max(1, width * h)
            d.line([(0, 0), (w, h)], fill=c, width=round(k))
            d.line([(0, h), (w, 0)], fill=c, width=round(k))
        elif t == 'line':   # a band from (x0, y0) to (x1, y1)
            _, x0, y0, x1, y1, width, c = op
            d.line([(X(x0), Yp(y0)), (X(x1), Yp(y1))], fill=c, width=max(1, round(width * h)))
        elif t == 'star':   # five points
            import math
            _, cx, cy, r, c = op
            rr, pts = max(1.2, r * h), []
            for i in range(10):
                a = -math.pi / 2 + i * math.pi / 5
                k = rr if i % 2 == 0 else rr * 0.45
                pts.append((cx * w + k * math.cos(a), cy * h + k * math.sin(a)))
            d.polygon(pts, fill=c)
        elif t == 'cres':   # crescent: a circle, then a circle in the background color, shifted right
            _, cx, cy, r, c, bg = op
            rr = max(1.5, r * h)
            d.ellipse([cx * w - rr, cy * h - rr, cx * w + rr, cy * h + rr], fill=c)
            d.ellipse([cx * w - rr * 0.55, cy * h - rr * 0.8, cx * w + rr * 1.05, cy * h + rr * 0.8], fill=bg)
        elif t == 'union':   # the Union Flag in a rectangle
            _, x0, y0, x1, y1 = op
            sub = Image.new('RGBA', (max(2, X(x1) - X(x0)), max(2, Yp(y1) - Yp(y0))))
            flag_ops(ImageDraw.Draw(sub), sub.width, sub.height, UNION)
            d._image.paste(sub, (X(x0), Yp(y0)))
        elif t == 'stripes':   # n alternating bands of two colors
            _, n, a, b = op
            flag_ops(d, w, h, [('h', [a if i % 2 == 0 else b for i in range(n)])])

UNION = [('h', [NAVY]), ('salt', W, 0.2), ('salt', '#c8102e', 0.07), ('cross', W, 0.34), ('cross', '#c8102e', 0.2)]

FLAGS = [
    ('af', 'Afghanistan', 1.5, [('v', [K, '#d32011', '#007a36']), ('circ', .5, .5, .16, W)]),
    ('al', 'Albania', 1.4, [('h', ['#e41e20']), ('circ', .5, .5, .28, K)]),
    ('dz', 'Algeria', 1.5, [('v', ['#006233', W]), ('cres', .5, .5, .24, '#d21034', W), ('star', .56, .5, .08, '#d21034')]),
    ('ad', 'Andorra', 1.43, [('v', ['#10069f', '#fedd00', '#d50032']), ('circ', .5, .5, .14, '#c7a34b')]),
    ('ao', 'Angola', 1.5, [('h', ['#cc092f', K]), ('circ', .5, .5, .16, '#ffcb00')]),
    ('ag', 'Antigua and Barbuda', 1.5, [('h', ['#ce1126']), ('poly', [(0, 0), (1, 0), (.5, 1)], K), ('poly', [(.2, .6), (.8, .6), (.5, 1)], '#0072c6'),
        ('poly', [(.32, .78), (.68, .78), (.5, 1)], W), ('circ', .5, .4, .14, '#fcd116')]),
    ('ar', 'Argentina', 1.6, [('h', ['#74acdf', W, '#74acdf']), ('circ', .5, .5, .1, '#f6b40e')]),
    ('am', 'Armenia', 2, [('h', ['#d90012', '#0033a0', '#f2a800'])]),
    ('au', 'Australia', 2, [('h', [NAVY]), ('union', 0, 0, .5, .5), ('star', .25, .75, .12, W), ('star', .75, .3, .07, W), ('star', .82, .7, .07, W)]),
    ('at', 'Austria', 1.5, [('h', ['#ed2939', W, '#ed2939'])]),
    ('az', 'Azerbaijan', 2, [('h', ['#00b5e2', '#ef3340', '#509e2f']), ('cres', .48, .5, .14, W, '#ef3340'), ('star', .56, .5, .05, W)]),
    ('bs', 'Bahamas', 2, [('h', ['#00778b', '#ffc72c', '#00778b']), ('tri', .4, K)]),
    ('bh', 'Bahrain', 5 / 3, [('v', [W, '#ce1126'], [1, 3])]),
    ('bd', 'Bangladesh', 5 / 3, [('h', ['#006a4e']), ('circ', .45, .5, .3, '#f42a41')]),
    ('bb', 'Barbados', 1.5, [('v', ['#00267f', '#ffc726', '#00267f']), ('rect', .45, .3, .55, .7, K)]),
    ('by', 'Belarus', 2, [('h', ['#c8313e', '#4aa657'], [2, 1]), ('rect', 0, 0, .1, 1, W)]),
    ('be', 'Belgium', 15 / 13, [('v', [K, '#fdda24', '#ef3340'])]),
    ('bz', 'Belize', 1.5, [('h', ['#ce1126', '#003f87', '#ce1126'], [1, 8, 1]), ('circ', .5, .5, .26, W)]),
    ('bj', 'Benin', 1.5, [('h', ['#fcd116', '#e8112d']), ('rect', 0, 0, .4, 1, '#008751')]),
    ('bt', 'Bhutan', 1.5, [('h', ['#ff4e12']), ('poly', [(0, 0), (1, 0), (0, 1)], '#ffd520'), ('circ', .5, .5, .18, W)]),
    ('bo', 'Bolivia', 1.47, [('h', ['#d52b1e', '#f9e300', '#007934'])]),
    ('ba', 'Bosnia and Herzegovina', 2, [('h', ['#002395']), ('poly', [(.27, 0), (.73, 0), (.73, 1)], '#fecb00'), ('line', .2, 0, .66, 1, .06, W)]),
    ('bw', 'Botswana', 1.5, [('h', ['#6da9d2', W, K, W, '#6da9d2'], [9, 1, 4, 1, 9])]),
    ('br', 'Brazil', 10 / 7, [('h', ['#009c3b']), ('poly', [(.08, .5), (.5, .08), (.92, .5), (.5, .92)], '#ffdf00'), ('circ', .5, .5, .25, '#002776')]),
    ('bn', 'Brunei', 2, [('h', ['#f7e017']), ('line', 0, .22, 1, .62, .16, W), ('line', 0, .36, 1, .76, .14, K), ('circ', .5, .5, .16, '#cf1126')]),
    ('bg', 'Bulgaria', 5 / 3, [('h', [W, '#00966e', '#d62612'])]),
    ('bf', 'Burkina Faso', 1.5, [('h', ['#ef2b2d', '#009e49']), ('star', .5, .5, .16, '#fcd116')]),
    ('bi', 'Burundi', 5 / 3, [('h', ['#ce1126']), ('poly', [(0, 0), (.5, .5), (0, 1)], '#1eb53a'), ('poly', [(1, 0), (.5, .5), (1, 1)], '#1eb53a'),
        ('salt', W, .14), ('circ', .5, .5, .24, W)]),
    ('cv', 'Cabo Verde', 5 / 3, [('h', ['#003893', W, '#cf2027', W, '#003893'], [6, 1, 1, 1, 3]), ('circ', .38, .62, .12, '#f7d116')]),
    ('kh', 'Cambodia', 1.56, [('h', ['#032ea1', '#e00025', '#032ea1'], [1, 2, 1]), ('rect', .38, .36, .62, .64, W)]),
    ('cm', 'Cameroon', 1.5, [('v', ['#007a5e', '#ce1126', '#fcd116']), ('star', .5, .5, .14, '#fcd116')]),
    ('ca', 'Canada', 2, [('v', ['#d80621', W, '#d80621'], [1, 2, 1]), ('star', .5, .5, .26, '#d80621')]),
    ('cf', 'Central African Republic', 5 / 3, [('h', ['#003082', W, '#289728', '#ffce00']), ('rect', .43, 0, .57, 1, '#d21034'), ('star', .15, .12, .1, '#ffce00')]),
    ('td', 'Chad', 1.5, [('v', ['#002664', '#fecb00', '#c60c30'])]),
    ('cl', 'Chile', 1.5, [('h', [W, '#d52b1e']), ('rect', 0, 0, .33, .5, '#0039a6'), ('star', .17, .25, .12, W)]),
    ('cn', 'China', 1.5, [('h', ['#ee1c25']), ('star', .17, .25, .17, '#ffff00'), ('star', .33, .1, .05, '#ffff00'), ('star', .4, .2, .05, '#ffff00'),
        ('star', .4, .35, .05, '#ffff00'), ('star', .33, .45, .05, '#ffff00')]),
    ('co', 'Colombia', 1.5, [('h', ['#fcd116', '#003893', '#ce1126'], [2, 1, 1])]),
    ('km', 'Comoros', 5 / 3, [('h', ['#ffc61e', W, '#ce1126', '#3a75c4']), ('tri', .5, '#3d8e33'), ('cres', .15, .5, .18, W, '#3d8e33')]),
    ('cg', 'Congo', 1.5, [('h', ['#fbde4a']), ('poly', [(0, 0), (.7, 0), (0, 1)], '#009543'), ('poly', [(1, 0), (1, 1), (.3, 1)], '#dc241f')]),
    ('cr', 'Costa Rica', 5 / 3, [('h', ['#002b7f', W, '#ce1126', W, '#002b7f'], [1, 1, 2, 1, 1])]),
    ('ci', "Cote d'Ivoire", 1.5, [('v', ['#f77f00', W, '#009e60'])]),
    ('hr', 'Croatia', 2, [('h', ['#ff0000', W, '#171796']), ('rect', .42, .25, .58, .62, '#ff0000'), ('rect', .46, .3, .5, .38, W), ('rect', .5, .38, .54, .46, W)]),
    ('cu', 'Cuba', 2, [('stripes', 5, '#002a8f', W), ('tri', .43, '#cf142b'), ('star', .15, .5, .12, W)]),
    ('cy', 'Cyprus', 1.5, [('h', [W]), ('poly', [(.25, .45), (.5, .3), (.75, .3), (.6, .5), (.35, .55)], '#d57800'), ('rect', .4, .65, .6, .72, '#4e5b31')]),
    ('cz', 'Czechia', 1.5, [('h', [W, '#d7141a']), ('tri', .5, '#11457e')]),
    ('cd', 'DR Congo', 4 / 3, [('h', ['#007fff']), ('line', 0, 1, 1, 0, .34, '#f7d618'), ('line', 0, 1, 1, 0, .24, '#ce1021'), ('star', .17, .2, .14, '#f7d618')]),
    ('dk', 'Denmark', 37 / 28, [('h', ['#c8102e']), ('nordic', W, .37, .14)]),
    ('dj', 'Djibouti', 1.5, [('h', ['#6ab2e7', '#12ad2b']), ('tri', .5, W), ('star', .17, .5, .1, '#d7141a')]),
    ('dm', 'Dominica', 2, [('h', ['#006b3f']), ('cross', '#fcd116', .2), ('cross', K, .12), ('cross', W, .05), ('circ', .5, .5, .24, '#d41c30')]),
    ('do', 'Dominican Republic', 5 / 3, [('h', ['#002d62']), ('rect', .5, 0, 1, .5, '#ce1126'), ('rect', 0, .5, .5, 1, '#ce1126'), ('cross', W, .16)]),
    ('ec', 'Ecuador', 1.5, [('h', ['#ffdd00', '#034ea2', '#ed1c24'], [2, 1, 1]), ('circ', .5, .5, .14, '#8c6c2f')]),
    ('eg', 'Egypt', 1.5, [('h', ['#ce1126', W, K]), ('rect', .45, .38, .55, .62, '#c09300')]),
    ('sv', 'El Salvador', 5 / 3, [('h', ['#0047ab', W, '#0047ab']), ('circ', .5, .5, .12, '#d9b900')]),
    ('gq', 'Equatorial Guinea', 5 / 3, [('h', ['#3e9a00', W, '#e32118']), ('tri', .2, '#0073ce')]),
    ('er', 'Eritrea', 2, [('h', ['#12ad2b', '#4189dd']), ('poly', [(0, 0), (1, .5), (0, 1)], '#ea0437'), ('circ', .25, .5, .18, '#ffc726')]),
    ('ee', 'Estonia', 11 / 7, [('h', ['#0072ce', K, W])]),
    ('sz', 'Eswatini', 1.5, [('h', ['#3e5eb9', '#ffd900', '#b10c0c', '#ffd900', '#3e5eb9'], [3, 1, 6, 1, 3]), ('circ', .5, .5, .16, W)]),
    ('et', 'Ethiopia', 2, [('h', ['#078930', '#fcdd09', '#da121a']), ('circ', .5, .5, .26, '#0f47af'), ('star', .5, .5, .16, '#fcdd09')]),
    ('fj', 'Fiji', 2, [('h', ['#68bfe5']), ('union', 0, 0, .5, .5), ('rect', .64, .3, .86, .72, W), ('rect', .64, .3, .86, .42, '#ce1126')]),
    ('fi', 'Finland', 18 / 11, [('h', [W]), ('nordic', '#002f6c', .36, .27)]),
    ('fr', 'France', 1.5, [('v', ['#002395', W, '#ed2939'])]),
    ('ga', 'Gabon', 4 / 3, [('h', ['#009e60', '#fcd116', '#3a75c4'])]),
    ('gm', 'Gambia', 1.5, [('h', ['#ce1126', W, '#0c1c8c', W, '#3a7728'], [6, 1, 4, 1, 6])]),
    ('ge', 'Georgia', 1.5, [('h', [W]), ('cross', '#ff0000', .2), ('rect', .17, .15, .27, .3, '#ff0000'), ('rect', .73, .15, .83, .3, '#ff0000'),
        ('rect', .17, .7, .27, .85, '#ff0000'), ('rect', .73, .7, .83, .85, '#ff0000')]),
    ('de', 'Germany', 5 / 3, [('h', [K, '#dd0000', '#ffce00'])]),
    ('gh', 'Ghana', 1.5, [('h', ['#ce1126', '#fcd116', '#006b3f']), ('star', .5, .5, .15, K)]),
    ('gr', 'Greece', 1.5, [('stripes', 9, '#0d5eaf', W), ('rect', 0, 0, .37, 5 / 9, '#0d5eaf'), ('rect', .148, 0, .222, 5 / 9, W), ('rect', 0, 2 / 9, .37, 3 / 9, W)]),
    ('gd', 'Grenada', 5 / 3, [('h', ['#ce1126']), ('rect', .1, .14, .9, .86, '#fcd116'), ('poly', [(.1, .14), (.5, .5), (.1, .86)], '#007a5e'),
        ('poly', [(.9, .14), (.5, .5), (.9, .86)], '#007a5e'), ('circ', .5, .5, .12, '#ce1126')]),
    ('gt', 'Guatemala', 1.6, [('v', ['#4997d0', W, '#4997d0']), ('circ', .5, .5, .14, '#6ab04c')]),
    ('gn', 'Guinea', 1.5, [('v', ['#ce1126', '#fcd116', '#009460'])]),
    ('gw', 'Guinea-Bissau', 2, [('h', ['#fcd116', '#009e49']), ('rect', 0, 0, .33, 1, '#ce1126'), ('star', .17, .5, .14, K)]),
    ('gy', 'Guyana', 5 / 3, [('h', ['#009e49']), ('poly', [(0, 0), (1, .5), (0, 1)], W), ('poly', [(0, .04), (.94, .5), (0, .96)], '#fcd116'),
        ('poly', [(0, 0), (.5, .5), (0, 1)], K), ('poly', [(0, .06), (.44, .5), (0, .94)], '#ce1126')]),
    ('ht', 'Haiti', 5 / 3, [('h', ['#00209f', '#d21034']), ('rect', .38, .32, .62, .68, W)]),
    ('hn', 'Honduras', 2, [('h', ['#0073cf', W, '#0073cf']), ('star', .5, .5, .07, '#0073cf'), ('star', .38, .42, .06, '#0073cf'), ('star', .62, .58, .06, '#0073cf')]),
    ('hu', 'Hungary', 2, [('h', ['#ce2939', W, '#477050'])]),
    ('is', 'Iceland', 1.39, [('h', ['#02529c']), ('nordic', W, .36, .22), ('nordic', '#dc1e35', .36, .11)]),
    ('in', 'India', 1.5, [('h', ['#ff9933', W, '#138808']), ('circ', .5, .5, .13, '#000080'), ('circ', .5, .5, .07, W)]),
    ('id', 'Indonesia', 1.5, [('h', ['#ce1126', W])]),
    ('ir', 'Iran', 7 / 4, [('h', ['#239f40', W, '#da0000']), ('circ', .5, .5, .1, '#da0000')]),
    ('iq', 'Iraq', 1.5, [('h', ['#ce1126', W, K]), ('rect', .3, .44, .7, .56, '#007a3d')]),
    ('ie', 'Ireland', 2, [('v', ['#169b62', W, '#ff883e'])]),
    ('il', 'Israel', 11 / 8, [('h', [W, '#0038b8', W, W, W, W, '#0038b8', W], [1, 1.2, 1, 1, 1, 1, 1.2, 1]), ('poly', [(.5, .3), (.62, .58), (.38, .58)], '#0038b8'),
        ('poly', [(.5, .7), (.62, .42), (.38, .42)], '#0038b8'), ('poly', [(.5, .38), (.56, .52), (.44, .52)], W)]),
    ('it', 'Italy', 1.5, [('v', ['#009246', W, '#ce2b37'])]),
    ('jm', 'Jamaica', 2, [('h', ['#009b3a']), ('poly', [(0, 0), (.5, .5), (0, 1)], K), ('poly', [(1, 0), (.5, .5), (1, 1)], K), ('salt', '#fed100', .16)]),
    ('jp', 'Japan', 1.5, [('h', [W]), ('circ', .5, .5, .3, '#bc002d')]),
    ('jo', 'Jordan', 2, [('h', [K, W, '#007a3d']), ('tri', .5, '#ce1126'), ('star', .16, .5, .08, W)]),
    ('kz', 'Kazakhstan', 2, [('h', ['#00afca']), ('circ', .5, .45, .2, '#fec50c'), ('rect', .06, 0, .1, 1, '#fec50c')]),
    ('ke', 'Kenya', 1.5, [('h', [K, W, '#bb0000', W, '#006600'], [6, 1, 6, 1, 6]), ('poly', [(.5, .2), (.6, .5), (.5, .8), (.4, .5)], '#bb0000'),
        ('rect', .47, .35, .53, .65, K)]),
    ('ki', 'Kiribati', 2, [('h', ['#ce1126', W, '#003f87', W, '#003f87', W, '#003f87'], [10, 1, 1, 1, 1, 1, 1]), ('circ', .5, .55, .16, '#fcd116')]),
    ('kp', 'North Korea', 2, [('h', ['#024fa2', W, '#ed1c27', W, '#024fa2'], [6, 1, 16, 1, 6]), ('circ', .35, .5, .2, W), ('star', .35, .5, .17, '#ed1c27')]),
    ('kr', 'South Korea', 1.5, [('h', [W]), ('pie', .5, .5, .25, 0, 180, '#0047a0'), ('pie', .5, .5, .25, 180, 360, '#cd2e3a'),
        ('rect', .12, .15, .2, .3, K), ('rect', .8, .7, .88, .85, K), ('rect', .8, .15, .88, .3, K), ('rect', .12, .7, .2, .85, K)]),
    ('kw', 'Kuwait', 2, [('h', ['#007a3d', W, '#ce1126']), ('poly', [(0, 0), (.25, .33), (.25, .67), (0, 1)], K)]),
    ('kg', 'Kyrgyzstan', 5 / 3, [('h', ['#e8112d']), ('circ', .5, .5, .26, '#ffef00'), ('circ', .5, .5, .13, '#e8112d')]),
    ('la', 'Laos', 1.5, [('h', ['#ce1126', '#002868', '#ce1126'], [1, 2, 1]), ('circ', .5, .5, .2, W)]),
    ('lv', 'Latvia', 2, [('h', ['#9e3039', W, '#9e3039'], [2, 1, 2])]),
    ('lb', 'Lebanon', 1.5, [('h', ['#ed1c24', W, '#ed1c24'], [1, 2, 1]), ('poly', [(.5, .28), (.64, .72), (.36, .72)], '#00a651')]),
    ('ls', 'Lesotho', 1.5, [('h', ['#00209f', W, '#009543'], [3, 4, 3]), ('poly', [(.5, .32), (.6, .62), (.4, .62)], K)]),
    ('lr', 'Liberia', 19 / 10, [('stripes', 11, '#bf0a30', W), ('rect', 0, 0, .3, 5 / 11, '#002868'), ('star', .15, .23, .14, W)]),
    ('ly', 'Libya', 2, [('h', ['#e70013', K, '#239e46'], [1, 2, 1]), ('cres', .48, .5, .16, W, K), ('star', .56, .5, .06, W)]),
    ('li', 'Liechtenstein', 5 / 3, [('h', ['#002b7f', '#ce1126']), ('circ', .25, .27, .1, '#ffd83d')]),
    ('lt', 'Lithuania', 5 / 3, [('h', ['#fdb913', '#006a44', '#c1272d'])]),
    ('lu', 'Luxembourg', 5 / 3, [('h', ['#ed2939', W, '#00a1de'])]),
    ('mg', 'Madagascar', 1.5, [('h', ['#fc3d32', '#007e3a']), ('rect', 0, 0, .33, 1, W)]),
    ('mw', 'Malawi', 1.5, [('h', [K, '#ce1126', '#339e35']), ('circ', .5, .3, .14, '#ce1126')]),
    ('my', 'Malaysia', 2, [('stripes', 14, '#cc0001', W), ('rect', 0, 0, .5, 8 / 14, '#010066'), ('cres', .2, .29, .17, '#ffcc00', '#010066'), ('star', .32, .29, .09, '#ffcc00')]),
    ('mv', 'Maldives', 1.5, [('h', ['#d21034']), ('rect', .25, .25, .75, .75, '#007e3a'), ('cres', .5, .5, .15, W, '#007e3a')]),
    ('ml', 'Mali', 1.5, [('v', ['#14b53a', '#fcd116', '#ce1126'])]),
    ('mt', 'Malta', 1.5, [('v', [W, '#cf142b']), ('rect', .08, .08, .16, .2, '#a0a0a0')]),
    ('mh', 'Marshall Islands', 19 / 10, [('h', ['#003893']), ('line', 0, 1, 1, .2, .14, '#dd7500'), ('line', 0, .9, 1, .06, .1, W), ('star', .2, .28, .16, W)]),
    ('mr', 'Mauritania', 1.5, [('h', ['#d01c1f', '#00a95c', '#d01c1f'], [1, 6, 1]), ('cres', .5, .42, .26, '#ffd700', '#00a95c'), ('star', .5, .38, .09, '#ffd700')]),
    ('mu', 'Mauritius', 1.5, [('h', ['#ea2839', '#1a206d', '#ffd500', '#00a551'])]),
    ('mx', 'Mexico', 7 / 4, [('v', ['#006847', W, '#ce1126']), ('circ', .5, .5, .13, '#8b4513')]),
    ('fm', 'Micronesia', 19 / 10, [('h', ['#75b2dd']), ('star', .5, .22, .1, W), ('star', .5, .78, .1, W), ('star', .35, .5, .1, W), ('star', .65, .5, .1, W)]),
    ('md', 'Moldova', 2, [('v', ['#0046ae', '#ffd200', '#cc092f']), ('circ', .5, .5, .16, '#a87b35')]),
    ('mc', 'Monaco', 5 / 4, [('h', ['#ce1126', W])]),
    ('mn', 'Mongolia', 2, [('v', ['#c4272f', '#015197', '#c4272f']), ('rect', .12, .22, .2, .78, '#f9cf02')]),
    ('me', 'Montenegro', 2, [('h', ['#c4a63c']), ('rect', .04, .07, .96, .93, '#d3001b'), ('circ', .5, .5, .2, '#c4a63c')]),
    ('ma', 'Morocco', 1.5, [('h', ['#c1272d']), ('star', .5, .5, .24, '#006233')]),
    ('mz', 'Mozambique', 1.5, [('h', ['#007168', W, K, W, '#fce100'], [6, 1, 6, 1, 6]), ('tri', .5, '#d21034'), ('star', .17, .5, .14, '#fce100')]),
    ('mm', 'Myanmar', 1.5, [('h', ['#fecb00', '#34b233', '#ea2839']), ('star', .5, .55, .32, W)]),
    ('na', 'Namibia', 1.5, [('h', ['#009543']), ('poly', [(0, 0), (1, 0), (0, 1)], '#003580'), ('line', 0, 1, 1, 0, .34, W), ('line', 0, 1, 1, 0, .24, '#d21034'),
        ('circ', .2, .22, .12, '#ffce00')]),
    ('nr', 'Nauru', 2, [('h', ['#002b7f', '#ffc61e', '#002b7f'], [11, 1, 12]), ('star', .25, .73, .12, W)]),
    ('np', 'Nepal', 0.82, [('poly', [(0, 0), (1, .5), (.35, .5), (1, 1), (0, 1)], '#003893'), ('poly', [(.06, .06), (.84, .47), (.25, .47), (.88, .95), (.06, .95)], '#dc143c'),
        ('circ', .25, .32, .07, W), ('circ', .25, .74, .09, W)]),
    ('nl', 'Netherlands', 1.5, [('h', ['#ae1c28', W, '#21468b'])]),
    ('nz', 'New Zealand', 2, [('h', [NAVY]), ('union', 0, 0, .5, .5), ('star', .75, .25, .07, '#c8102e'), ('star', .68, .5, .07, '#c8102e'),
        ('star', .82, .48, .07, '#c8102e'), ('star', .75, .8, .08, '#c8102e')]),
    ('ni', 'Nicaragua', 5 / 3, [('h', ['#0067c6', W, '#0067c6']), ('circ', .5, .5, .1, '#4db3d6')]),
    ('ne', 'Niger', 7 / 6, [('h', ['#e05206', W, '#0db02b']), ('circ', .5, .5, .12, '#e05206')]),
    ('ng', 'Nigeria', 2, [('v', ['#008751', W, '#008751'])]),
    ('mk', 'North Macedonia', 2, [('h', ['#d20000']), ('line', 0, 0, 1, 1, .1, '#ffe600'), ('line', 0, 1, 1, 0, .1, '#ffe600'), ('cross', '#ffe600', .12),
        ('circ', .5, .5, .22, '#ffe600')]),
    ('no', 'Norway', 11 / 8, [('h', ['#ba0c2f']), ('nordic', W, .36, .25), ('nordic', '#00205b', .36, .12)]),
    ('om', 'Oman', 2, [('h', [W, '#db161b', '#008000']), ('rect', 0, 0, .3, 1, '#db161b'), ('rect', .06, .06, .16, .22, W)]),
    ('pk', 'Pakistan', 1.5, [('v', [W, '#01411c'], [1, 3]), ('cres', .6, .5, .26, W, '#01411c'), ('star', .7, .42, .08, W)]),
    ('pw', 'Palau', 8 / 5, [('h', ['#4aadd6']), ('circ', .45, .5, .3, '#ffde00')]),
    ('pa', 'Panama', 1.5, [('h', [W]), ('rect', .5, 0, 1, .5, '#d21034'), ('rect', 0, .5, .5, 1, '#005293'), ('star', .25, .25, .12, '#005293'),
        ('star', .75, .75, .12, '#d21034')]),
    ('pg', 'Papua New Guinea', 4 / 3, [('h', [K]), ('poly', [(0, 0), (1, 0), (1, 1)], '#ce1126'), ('circ', .7, .3, .12, '#fcd116'), ('star', .25, .65, .07, W),
        ('star', .35, .8, .07, W), ('star', .18, .82, .06, W)]),
    ('py', 'Paraguay', 5 / 3, [('h', ['#d52b1e', W, '#0038a8']), ('circ', .5, .5, .12, '#0038a8')]),
    ('pe', 'Peru', 1.5, [('v', ['#d91023', W, '#d91023'])]),
    ('ph', 'Philippines', 2, [('h', ['#0038a8', '#ce1126']), ('tri', .43, W), ('circ', .16, .5, .1, '#fcd116')]),
    ('pl', 'Poland', 8 / 5, [('h', [W, '#dc143c'])]),
    ('pt', 'Portugal', 1.5, [('v', ['#006600', '#ff0000'], [2, 3]), ('circ', .4, .5, .2, '#ffe800'), ('circ', .4, .5, .12, '#ff0000')]),
    ('qa', 'Qatar', 28 / 11, [('v', [W, '#8a1538'], [3, 8]), ('poly', [(.27, 0), (.33, .1), (.27, .2), (.33, .3), (.27, .4), (.33, .5), (.27, .6), (.33, .7),
        (.27, .8), (.33, .9), (.27, 1)], W)]),
    ('ro', 'Romania', 1.5, [('v', ['#002b7f', '#fcd116', '#ce1126'])]),
    ('ru', 'Russia', 1.5, [('h', [W, '#0039a6', '#d52b1e'])]),
    ('rw', 'Rwanda', 1.5, [('h', ['#00a1de', '#fad201', '#20603d'], [2, 1, 1]), ('circ', .8, .25, .1, '#e5be01')]),
    ('kn', 'Saint Kitts and Nevis', 1.5, [('h', ['#ce1126']), ('poly', [(0, 0), (1, 0), (0, 1)], '#009e49'), ('line', 0, 1, 1, 0, .36, '#fcd116'),
        ('line', 0, 1, 1, 0, .26, K), ('star', .38, .6, .07, W), ('star', .62, .4, .07, W)]),
    ('lc', 'Saint Lucia', 2, [('h', ['#65cfff']), ('poly', [(.5, .1), (.72, .9), (.28, .9)], W), ('poly', [(.5, .2), (.68, .9), (.32, .9)], K),
        ('poly', [(.5, .5), (.64, .9), (.36, .9)], '#fcd116')]),
    ('vc', 'Saint Vincent and the Grenadines', 1.5, [('v', ['#002674', '#fcd022', '#009e60'], [1, 2, 1]), ('poly', [(.5, .3), (.56, .5), (.5, .7), (.44, .5)], '#009e60')]),
    ('ws', 'Samoa', 2, [('h', ['#ce1126']), ('rect', 0, 0, .5, .5, '#002b7f'), ('star', .25, .15, .07, W), ('star', .17, .3, .06, W), ('star', .33, .3, .06, W),
        ('star', .25, .42, .07, W)]),
    ('sm', 'San Marino', 4 / 3, [('h', [W, '#5eb6e4']), ('circ', .5, .5, .14, '#f1bf31')]),
    ('st', 'Sao Tome and Principe', 2, [('h', ['#12ad2b', '#ffce00', '#12ad2b'], [2, 3, 2]), ('tri', .25, '#d21034'), ('star', .45, .5, .1, K), ('star', .7, .5, .1, K)]),
    ('sa', 'Saudi Arabia', 1.5, [('h', ['#006c35']), ('rect', .2, .3, .8, .5, W), ('rect', .25, .62, .75, .68, W)]),
    ('sn', 'Senegal', 1.5, [('v', ['#00853f', '#fdef42', '#e31b23']), ('star', .5, .5, .14, '#00853f')]),
    ('rs', 'Serbia', 1.5, [('h', ['#c6363c', '#0c4076', W]), ('rect', .26, .26, .38, .62, '#c6363c')]),
    ('sc', 'Seychelles', 2, [('h', ['#007a3d']), ('poly', [(0, 1), (0, 0), (.33, 0)], '#003f87'), ('poly', [(0, 1), (.33, 0), (.67, 0)], '#fcd856'),
        ('poly', [(0, 1), (.67, 0), (1, 0), (1, .33)], '#d62828'), ('poly', [(0, 1), (1, .33), (1, .67)], W)]),
    ('sl', 'Sierra Leone', 1.5, [('h', ['#1eb53a', W, '#0072c6'])]),
    ('sg', 'Singapore', 1.5, [('h', ['#ef3340', W]), ('cres', .17, .25, .17, W, '#ef3340'), ('star', .3, .18, .04, W), ('star', .36, .26, .04, W),
        ('star', .27, .32, .04, W)]),
    ('sk', 'Slovakia', 1.5, [('h', [W, '#0b4ea2', '#ee1c25']), ('rect', .22, .25, .36, .72, W), ('rect', .24, .27, .34, .7, '#ee1c25')]),
    ('si', 'Slovenia', 2, [('h', [W, '#005ce5', '#ed1c24']), ('poly', [(.2, .18), (.34, .18), (.34, .45), (.27, .55), (.2, .45)], '#005ce5')]),
    ('sb', 'Solomon Islands', 2, [('h', ['#215b33']), ('poly', [(0, 0), (1, 0), (0, 1)], '#0051ba'), ('line', 0, 1, 1, 0, .12, '#fcd116'),
        ('star', .1, .15, .06, W), ('star', .25, .15, .06, W), ('star', .17, .3, .06, W)]),
    ('so', 'Somalia', 1.5, [('h', ['#4189dd']), ('star', .5, .5, .26, W)]),
    ('za', 'South Africa', 1.5, [('h', ['#e03c31', '#001489']), ('poly', [(0, 0), (.42, .5), (0, 1)], K), ('poly', [(0, 0), (.15, 0), (.5, .38), (1, .38),
        (1, .62), (.5, .62), (.15, 1), (0, 1), (0, .86), (.36, .5), (0, .14)], '#007749'), ('poly', [(0, .14), (.36, .5), (0, .86)], '#ffb81c'),
        ('poly', [(0, .22), (.29, .5), (0, .78)], K)]),
    ('ss', 'South Sudan', 2, [('h', [K, W, '#da121a', W, '#078930'], [6, 1, 6, 1, 6]), ('tri', .3, '#0f47af'), ('star', .1, .5, .1, '#fcdd09')]),
    ('es', 'Spain', 1.5, [('h', ['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1]), ('rect', .27, .38, .37, .62, '#aa151b')]),
    ('lk', 'Sri Lanka', 2, [('h', ['#ffbe29']), ('rect', .04, .07, .16, .93, '#005f56'), ('rect', .16, .07, .28, .93, '#ff7f00'), ('rect', .32, .07, .96, .93, '#8d153a'),
        ('rect', .52, .3, .76, .7, '#ffbe29')]),
    ('sd', 'Sudan', 2, [('h', ['#d21034', W, K]), ('tri', .33, '#007229')]),
    ('sr', 'Suriname', 1.5, [('h', ['#377e3f', W, '#b40a2d', W, '#377e3f'], [2, 1, 4, 1, 2]), ('star', .5, .5, .16, '#ecc81d')]),
    ('se', 'Sweden', 1.6, [('h', ['#006aa7']), ('nordic', '#fecc00', .37, .2)]),
    ('ch', 'Switzerland', 1, [('h', ['#da291c']), ('rect', .4, .19, .6, .81, W), ('rect', .19, .4, .81, .6, W)]),
    ('sy', 'Syria', 1.5, [('h', ['#007a3d', W, K]), ('star', .3, .5, .09, '#ce1126'), ('star', .5, .5, .09, '#ce1126'), ('star', .7, .5, .09, '#ce1126')]),
    ('tj', 'Tajikistan', 2, [('h', ['#cc0000', W, '#006600'], [2, 3, 2]), ('circ', .5, .5, .12, '#f8c300')]),
    ('tz', 'Tanzania', 1.5, [('h', ['#00a3dd']), ('poly', [(0, 0), (1, 0), (0, 1)], '#1eb53a'), ('line', 0, 1, 1, 0, .34, '#fcd116'), ('line', 0, 1, 1, 0, .24, K)]),
    ('th', 'Thailand', 1.5, [('h', ['#a51931', W, '#2d2a4a', W, '#a51931'], [1, 1, 2, 1, 1])]),
    ('tl', 'Timor-Leste', 2, [('h', ['#dc241f']), ('tri', .5, '#ffc726'), ('tri', .33, K), ('star', .12, .5, .1, W)]),
    ('tg', 'Togo', 1.62, [('stripes', 5, '#006a4e', '#ffce00'), ('rect', 0, 0, .4, .6, '#d21034'), ('star', .2, .3, .17, W)]),
    ('to', 'Tonga', 2, [('h', ['#c10000']), ('rect', 0, 0, .4, .5, W), ('rect', .16, .08, .24, .42, '#c10000'), ('rect', .08, .21, .32, .29, '#c10000')]),
    ('tt', 'Trinidad and Tobago', 5 / 3, [('h', ['#ce1126']), ('line', 0, 0, 1, 1, .4, W), ('line', 0, 0, 1, 1, .28, K)]),
    ('tn', 'Tunisia', 1.5, [('h', ['#e70013']), ('circ', .5, .5, .26, W), ('cres', .48, .5, .18, '#e70013', W), ('star', .55, .5, .08, '#e70013')]),
    ('tr', 'Turkiye', 1.5, [('h', ['#e30a17']), ('cres', .38, .5, .25, W, '#e30a17'), ('star', .54, .5, .1, W)]),
    ('tm', 'Turkmenistan', 1.5, [('h', ['#00843d']), ('rect', .1, 0, .26, 1, '#d22630'), ('cres', .45, .3, .14, W, '#00843d')]),
    ('tv', 'Tuvalu', 2, [('h', ['#5b97b1']), ('union', 0, 0, .5, .5), ('star', .6, .7, .06, '#ffce00'), ('star', .75, .3, .06, '#ffce00'),
        ('star', .9, .5, .06, '#ffce00'), ('star', .8, .8, .06, '#ffce00')]),
    ('ug', 'Uganda', 1.5, [('h', [K, '#fcdc04', '#d90000', K, '#fcdc04', '#d90000']), ('circ', .5, .5, .2, W)]),
    ('ua', 'Ukraine', 1.5, [('h', ['#0057b7', '#ffd700'])]),
    ('ae', 'United Arab Emirates', 2, [('h', ['#00732f', W, K]), ('rect', 0, 0, .25, 1, '#ff0000')]),
    ('gb', 'United Kingdom', 2, UNION),
    ('us', 'United States', 1.9, [('stripes', 13, '#b22234', W), ('rect', 0, 0, .4, 7 / 13, '#3c3b6e'), ('rect', .08, .12, .12, .18, W),
        ('rect', .2, .12, .24, .18, W), ('rect', .32, .12, .36, .18, W), ('rect', .14, .26, .18, .32, W), ('rect', .26, .26, .3, .32, W),
        ('rect', .08, .4, .12, .46, W), ('rect', .2, .4, .24, .46, W), ('rect', .32, .4, .36, .46, W)]),
    ('uy', 'Uruguay', 1.5, [('stripes', 9, W, '#0038a8'), ('rect', 0, 0, .37, 5 / 9, W), ('circ', .18, .28, .14, '#fcd116')]),
    ('uz', 'Uzbekistan', 2, [('h', ['#0099b5', '#ce1126', W, '#ce1126', '#1eb53a'], [10, 1, 8, 1, 10]), ('cres', .15, .17, .12, W, '#0099b5')]),
    ('vu', 'Vanuatu', 5 / 3, [('h', ['#d21034', '#009543']), ('poly', [(0, 0), (.5, .5), (0, 1)], '#fdce12'), ('poly', [(0, .1), (.42, .5), (0, .9)], K),
        ('rect', .45, .45, 1, .55, '#fdce12')]),
    ('ve', 'Venezuela', 1.5, [('h', ['#ffcc00', '#00247d', '#cf142b']), ('star', .35, .48, .06, W), ('star', .5, .4, .06, W), ('star', .65, .48, .06, W)]),
    ('vn', 'Viet Nam', 1.5, [('h', ['#da251d']), ('star', .5, .5, .3, '#ffff00')]),
    ('ye', 'Yemen', 1.5, [('h', ['#ce1126', W, K])]),
    ('zm', 'Zambia', 1.5, [('h', ['#198a00']), ('rect', .62, .45, .75, 1, '#de2010'), ('rect', .75, .45, .88, 1, K), ('rect', .88, .45, 1, 1, '#ef7d00'),
        ('circ', .8, .25, .1, '#ef7d00')]),
    ('zw', 'Zimbabwe', 2, [('h', ['#319208', '#ffd200', '#de2010', K, '#de2010', '#ffd200', '#319208']), ('poly', [(0, 0), (.45, .5), (0, 1)], W),
        ('poly', [(0, .07), (.38, .5), (0, .93)], K), ('star', .13, .5, .1, '#de2010')]),
    # Regions
    ('eu', 'European Union', 1.5, [('h', ['#003399']), *[('star', .5 + .26 * c, .5 + .38 * s, .05, '#ffcc00') for c, s in
        [(1, 0), (.87, .5), (.5, .87), (0, 1), (-.5, .87), (-.87, .5), (-1, 0), (-.87, -.5), (-.5, -.87), (0, -1), (.5, -.87), (.87, -.5)]]]),
    ('england', 'England', 5 / 3, [('h', [W]), ('cross', '#ce1124', .2)]),
    ('scotland', 'Scotland', 5 / 3, [('h', ['#005eb8']), ('salt', W, .2)]),
    ('wales', 'Wales', 5 / 3, [('h', [W, '#00b140']), ('poly', [(.3, .3), (.65, .25), (.75, .45), (.6, .7), (.35, .7), (.25, .5)], '#d30731')]),
    ('pr', 'Puerto Rico', 1.5, [('stripes', 5, '#ed0000', W), ('tri', .5, '#0050f0'), ('star', .17, .5, .12, W)]),
    ('gl', 'Greenland', 1.5, [('h', [W, '#c8102e']), ('poly', [(.15, .5), (.65, .5), (.62, .32), (.52, .2), (.4, .17), (.28, .2), (.18, .32)], '#c8102e'),
        ('poly', [(.15, .5), (.65, .5), (.62, .68), (.52, .8), (.4, .83), (.28, .8), (.18, .68)], W)]),
]

def draw_flag(spec, w, h):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    flag_ops(ImageDraw.Draw(im), w, h, spec[3])
    return im

def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for key, name, price in PATTERNS:
        pattern(key, 16).save(os.path.join(OUT, f'{key}.png'))
        pattern(key, 64).save(os.path.join(OUT, f'{key}-large.png'))
        rows.append((key, name, 'pattern', 'Common', price, 'Patterns'))
    for spec in FLAGS:
        key, name, ratio = 'flag-' + spec[0], spec[1], spec[2]
        draw_flag(spec, 16, 16).save(os.path.join(OUT, f'{key}.png'))
        lw = 96 if ratio >= 1 else round(96 * ratio)
        draw_flag(spec, lw, round(lw / ratio)).save(os.path.join(OUT, f'{key}-large.png'))
        rows.append((key, name, 'art', 'Rare', 1000, 'Flags'))
    print('Key,Name,Kind,Rarity,Price,Collection,Enabled')
    for r in rows:
        print(','.join('"' + str(v) + '"' if ',' in str(v) else str(v) for v in r) + ',yes')
    if '--sheet' in sys.argv:   # every flag, large, on one picture
        cols, cw, ch = 12, 100, 70
        sheet = Image.new('RGBA', (cols * cw, ((len(FLAGS) + cols - 1) // cols) * ch), (20, 24, 31, 255))
        for i, spec in enumerate(FLAGS):
            im = Image.open(os.path.join(OUT, f'flag-{spec[0]}-large.png'))
            im.thumbnail((88, 58))
            sheet.paste(im, ((i % cols) * cw + (cw - im.width) // 2, (i // cols) * ch + (ch - im.height) // 2), im)
        sheet.save(sys.argv[sys.argv.index('--sheet') + 1])
    print(f'{len(PATTERNS)} patterns, {len(FLAGS)} flags', file=sys.stderr)

if __name__ == '__main__':
    main()
