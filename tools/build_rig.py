#!/usr/bin/env python3
"""Finds rig landmarks in every pose in sidecars/pet/art/ and cuts blink patches.

Dev-only (the plugin never runs this); needs Pillow and numpy. Writes:
  sidecars/pet/art/rig.json            per-pose landmarks and blink patch placement
  sidecars/pet/art/blink/<pose>.webp   closed-eye patch, painted from the art itself

Eyes are found by color (her irises are the only strong magenta and amber on her head),
then tools/landmarks.json supplies what a pose needs by hand: tails and closed-eye poses.
"""
import colorsys
import json
import shutil
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
POSES = OUT = ROOT / 'sidecars' / 'pet' / 'art'
OVERRIDES = json.loads((ROOT / 'tools' / 'landmarks.json').read_text(encoding='utf-8'))


def blobs(pixels, width, height, test, box):
    """Connected components of pixels passing `test`, inside `box`."""
    x0, y0, x1, y1 = box
    seen = set()
    found = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if (x, y) in seen or not test(*pixels[x, y]):
                continue
            queue = deque([(x, y)])
            seen.add((x, y))
            cells = []
            while queue:
                cx, cy = queue.popleft()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if x0 <= nx < x1 and y0 <= ny < y1 and (nx, ny) not in seen and test(*pixels[nx, ny]):
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            found.append(cells)
    return found


def hsv(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360, s, v


def is_magenta(r, g, b, a):
    if a < 200:
        return False
    h, s, v = hsv(r, g, b)
    return (312 <= h <= 352) and s > 0.45 and v > 0.45


def is_amber(r, g, b, a):
    if a < 200:
        return False
    h, s, v = hsv(r, g, b)
    return (18 <= h <= 46) and s > 0.55 and v > 0.5


def centre(cells):
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def find_eyes(image):
    width, height = image.size
    pixels = image.load()
    box = (0, int(height * 0.18), width, int(height * 0.6))
    magenta = sorted(blobs(pixels, width, height, is_magenta, box), key=len, reverse=True)
    amber = sorted(blobs(pixels, width, height, is_amber, box), key=len, reverse=True)
    magenta = [b for b in magenta if len(b) > 60]
    amber = [b for b in amber if len(b) > 60]
    if not magenta or not amber:
        return None
    # Eyes sit level and about 70-130px apart; pick the pair that fits best.
    best = None
    for m in magenta[:4]:
        for a in amber[:4]:
            mx, my = centre(m)
            ax, ay = centre(a)
            gap = ax - mx
            if 55 <= gap <= 150 and abs(ay - my) < 42:
                score = len(m) + len(a)
                if not best or score > best[0]:
                    best = (score, (round(mx, 1), round(my, 1)), (round(ax, 1), round(ay, 1)))
    return (best[1], best[2]) if best else None


def top_profile(image):
    alpha = image.getchannel('A').load()
    width, height = image.size
    profile = []
    for x in range(width):
        y = next((y for y in range(height) if alpha[x, y] > 96), height)
        profile.append(y)
    return profile


def find_crown(image, eyes):
    """Ahoge tip and ear tips: local peaks of the silhouette above her head."""
    profile = top_profile(image)
    (lx, ly), (rx, ry) = eyes
    mid = (lx + rx) / 2
    gap = rx - lx
    window = range(max(0, int(mid - gap * 0.75)), min(len(profile), int(mid + gap * 0.75)))
    ahoge_x = min(window, key=lambda x: profile[x])
    left = range(max(0, int(mid - gap * 2.1)), max(1, int(mid - gap * 0.75)))
    right = range(min(len(profile) - 1, int(mid + gap * 0.75)), min(len(profile), int(mid + gap * 2.1)))
    ear_l = min(left, key=lambda x: profile[x])
    ear_r = min(right, key=lambda x: profile[x])
    return {
        'ahoge': [ahoge_x, profile[ahoge_x]],
        'earL': [ear_l, profile[ear_l]],
        'earR': [ear_r, profile[ear_r]],
    }


def fill_from_skin(patch, mask, passes=260):
    """Paints masked pixels from the surrounding skin (damped Laplace fill), returns RGB."""
    rgba = np.asarray(patch, dtype=np.float32)
    r, g, b, a = rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3]
    skin = (a > 200) & (r > 200) & (g > 165) & (b > 145) & (r >= b)
    hole = mask > 8
    color = rgba[..., :3].copy()
    filled = skin & ~hole
    for _ in range(passes):
        total = np.zeros_like(color)
        count = np.zeros_like(r)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            neighbour = np.roll(np.roll(filled, dy, 0), dx, 1)
            total += np.roll(np.roll(color, dy, 0), dx, 1) * neighbour[..., None]
            count += neighbour
        ready = hole & (count > 0)
        average = np.zeros_like(color)
        average[ready] = total[ready] / count[ready][..., None]
        fresh = ready & ~filled
        settled = ready & filled
        # Damping matters: a plain average leaves a checkerboard behind.
        color[fresh] = average[fresh]
        color[settled] = color[settled] * 0.5 + average[settled] * 0.5
        filled = filled | fresh
    return color


def outside_connected(hair, inside):
    """Hair that runs out of the socket is real hair; purple islands inside it are iris."""
    height, width = hair.shape
    keep = np.zeros_like(hair)
    stack = [(y, x) for y, x in zip(*np.nonzero(hair & ~inside))]
    for y, x in stack:
        keep[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < height and 0 <= nx < width and hair[ny, nx] and not keep[ny, nx]:
                keep[ny, nx] = True
                stack.append((ny, nx))
    return keep


def closed_eye_art():
    """Painted closed eyes, cut from the art itself."""
    donor = OVERRIDES['blinkDonor']
    image = Image.open(POSES / f"{donor['pose']}.webp").convert('RGBA')
    pieces = {}
    for side in ('L', 'R'):
        crop = image.crop(donor[side])
        rgba = np.asarray(crop, dtype=np.float32)
        luma = 0.3 * rgba[..., 0] + 0.59 * rgba[..., 1] + 0.11 * rgba[..., 2]
        # Lashes are the dark paint: keep them, let the skin underneath show through.
        rgba[..., 3] = rgba[..., 3] * np.clip((195 - luma) / 80, 0, 1)
        pieces[side] = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
    return pieces, donor


def make_blink(image, eyes, art, donor):
    """A patch that closes both eyes: painted-out sockets plus the donor's real lashes."""
    (lx, ly), (rx, ry) = eyes
    gap = max(40.0, rx - lx)
    k = gap / donor['gap']
    pad = gap * 0.66
    x0, y0 = int(max(0, lx - pad)), int(max(0, min(ly, ry) - pad * 0.78))
    x1, y1 = int(min(image.width, rx + pad)), int(min(image.height, max(ly, ry) + pad * 0.62))
    patch = image.crop((x0, y0, x1, y1))
    mask = Image.new('L', patch.size, 0)
    draw = ImageDraw.Draw(mask)
    for (ex, ey), side in zip(eyes, (-1, 1)):
        cx, cy = ex - x0 + side * gap * 0.05, ey - y0
        draw.ellipse((cx - gap * 0.46, cy - gap * 0.42, cx + gap * 0.46, cy + gap * 0.32), fill=255)
    rgba = np.asarray(patch, dtype=np.float32)
    maximum = rgba[..., :3].max(axis=2)
    minimum = rgba[..., :3].min(axis=2)
    saturation = (maximum - minimum) / np.maximum(maximum, 1)
    # Never paint skin over her hair: lit purple pixels stay as they are.
    hair = (rgba[..., 2] > rgba[..., 0] + 8) & (saturation > 0.22) & (maximum > 110)
    transparent = rgba[..., 3] < 180
    hole = np.asarray(mask, dtype=np.float32)
    hair = outside_connected(hair, hole > 8)
    hole = np.where(hair | transparent, 0, hole)
    color = fill_from_skin(patch, hole)
    soft = np.asarray(Image.fromarray(hole.astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32)
    out = np.zeros((*hole.shape, 4), dtype=np.uint8)
    out[..., :3] = np.clip(color, 0, 255).astype(np.uint8)
    out[..., 3] = soft.astype(np.uint8)
    result = Image.fromarray(out, 'RGBA')
    tilt = np.degrees(np.arctan2(ry - ly, rx - lx))
    for side, (ex, ey) in zip(('L', 'R'), eyes):
        piece = art[side]
        scaled = piece.resize((max(1, int(piece.width * k)), max(1, int(piece.height * k))), Image.LANCZOS)
        rotated = scaled.rotate(donor['tilt'] - tilt, resample=Image.BICUBIC, expand=True)
        at = (int(ex - x0 - rotated.width / 2 + (-1 if side == 'L' else 1) * gap * 0.04), int(ey - y0 - rotated.height / 2 + gap * 0.1))
        layer = Image.new('RGBA', result.size, (0, 0, 0, 0))
        layer.paste(rotated, at, rotated)
        result = Image.alpha_composite(result, layer)
    return result, [x0, y0]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    blink_dir = OUT / 'blink'
    if blink_dir.exists():
        shutil.rmtree(blink_dir)
    blink_dir.mkdir()
    art, donor = closed_eye_art()
    rig = {}
    report = []
    for path in sorted(POSES.glob('*.webp')):
        name = path.stem
        image = Image.open(path).convert('RGBA')
        manual = OVERRIDES['poses'].get(name, {})
        eyes = find_eyes(image)
        if manual.get('eyes'):
            eyes = tuple(tuple(e) for e in manual['eyes'])
        entry = {'size': list(image.size)}
        if eyes:
            entry['eyes'] = [list(eyes[0]), list(eyes[1])]
            entry.update(find_crown(image, eyes))
        entry.update({k: v for k, v in manual.items() if k not in ('eyes', 'noBlink')})
        if eyes and not manual.get('noBlink'):
            patch, at = make_blink(image, eyes, art, donor)
            patch.save(blink_dir / f'{name}.webp', 'WEBP', quality=90, method=6)
            entry['blink'] = at
        rig[name] = entry
        report.append(f"{name:18} eyes={'auto' if eyes and not manual.get('eyes') else ('manual' if eyes else 'MISSING'):7} blink={'yes' if 'blink' in entry else 'no'} tail={'yes' if 'tail' in entry else 'no'}")
    (OUT / 'rig.json').write_text(json.dumps(rig, ensure_ascii=False, indent=0), encoding='utf-8')
    print('\n'.join(report))
    if '--debug' in sys.argv:
        debug_sheet(rig, Path(sys.argv[sys.argv.index('--debug') + 1]))


def debug_sheet(rig, out):
    """Overlays the landmarks on each pose so they can be checked by eye."""
    names = list(rig)
    per = 12
    for page in range(0, len(names), per):
        chunk = names[page:page + per]
        sheet = Image.new('RGB', (6 * 300, 2 * 380), (232, 228, 245))
        draw = ImageDraw.Draw(sheet)
        for index, name in enumerate(chunk):
            image = Image.open(POSES / f'{name}.webp').convert('RGBA')
            k = min(300 / image.width, 370 / image.height)
            small = image.resize((int(image.width * k), int(image.height * k)))
            ox, oy = (index % 6) * 300, (index // 6) * 380
            sheet.paste(small, (ox, oy + 10), small)
            entry = rig[name]
            point = lambda p: (ox + p[0] * k, oy + 10 + p[1] * k)
            for key, color in (('earL', 'lime'), ('earR', 'lime'), ('ahoge', 'cyan')):
                if key in entry:
                    x, y = point(entry[key])
                    draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline=color, width=2)
            for eye in entry.get('eyes', []):
                x, y = point(eye)
                draw.line((x - 6, y, x + 6, y), fill='red', width=2)
                draw.line((x, y - 6, x, y + 6), fill='red', width=2)
            if 'tail' in entry:
                pts = [point(p) for p in entry['tail']]
                draw.line(pts, fill='yellow', width=3)
            # Grid every 100 source pixels for reading coordinates.
            for gx in range(0, image.width, 100):
                draw.line((ox + gx * k, oy + 10, ox + gx * k, oy + 10 + image.height * k), fill=(90, 90, 200), width=1)
            for gy in range(0, image.height, 100):
                draw.line((ox, oy + 10 + gy * k, ox + image.width * k, oy + 10 + gy * k), fill=(90, 90, 200), width=1)
            draw.text((ox + 3, oy + 1), f'{name} {image.width}x{image.height} k={k:.2f}', fill=(120, 0, 60))
        sheet.save(out / f'landmarks-{page // per}.png')


if __name__ == '__main__':
    main()
