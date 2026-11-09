#!/usr/bin/env python3
"""Finds rig landmarks in every pose in sidecars/pet/art/ and cuts blink patches.

Dev-only (the plugin never runs this); needs Pillow and numpy. Writes:
  sidecars/pet/art/rig.json            per-pose landmarks and blink patch placement
  sidecars/pet/art/blink/<pose>.webp   closed-eye patch, painted from the art itself
  sidecars/pet/art/tail/<pose>.webp    the tail, cut out along its ink so it can move alone
  sidecars/pet/art/under/<pose>.webp   a thin seam beneath the tail (inpaint_under.py replaces this)
  sidecars/pet/art/cut/<pose>.webp     what to remove from the body: the tail and its white pockets

Eyes are found by color (her irises are the only strong magenta and amber on her head),
then tools/landmarks.json supplies what a pose needs by hand: tails and closed-eye poses.
"""
import colorsys
import heapq
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


def morph(mask, *steps):
    """Grows (positive size) or shrinks (negative) a boolean mask, in order.

    Pads with the image's own edge first, so a tail clipped by the canvas is not eroded along
    that side.
    """
    pad = sum(abs(size) for size in steps) // 2 + 2
    image = Image.fromarray((np.pad(mask, pad, mode='edge') * 255).astype(np.uint8), 'L')
    for size in steps:
        image = image.filter((ImageFilter.MaxFilter if size > 0 else ImageFilter.MinFilter)(abs(size)))
    return (np.asarray(image) > 127)[pad:-pad, pad:-pad]


def marked_not_tail(manual, shape):
    keep = np.zeros(shape, dtype=bool)
    for x, y in manual.get('notTail', []):
        keep[max(0, y - 5):y + 5, max(0, x - 5):x + 5] = True
    return keep


def cut_tail(image, entry, manual):
    """Separates the tail by flooding outward from seeds; the floods meet on the ink lines.

    Marker-based watershed over darkness: a seed inside the tail and seeds on the body rise like
    water and stop where they touch, which lands on the outline drawn between them. Each side
    keeps half of that line, so hair and tail both still look inked when they move apart.
    """
    rgba = np.asarray(image, dtype=np.float32)
    height, width = rgba.shape[:2]
    opaque = rgba[..., 3] > 110
    darkness = 255 - (0.3 * rgba[..., 0] + 0.59 * rgba[..., 1] + 0.11 * rgba[..., 2])
    (lx, ly), (rx, ry) = entry['eyes']
    mx, gap = (lx + rx) / 2, max(50.0, rx - lx)
    neck_y = (ly + ry) / 2 + gap * 0.78
    tail = entry['tail']
    side = 1 if tail[1][0] >= mx else -1
    top = min(p[1] for p in [*tail, *manual.get('tailSeeds', [])])

    labels = np.zeros((height, width), dtype=np.int8)
    TAIL, OTHER = 1, 2
    yy, xx = np.mgrid[0:height, 0:width]
    along = (xx - mx) * side
    other = (along < gap * manual.get('bodyBand', 0.5)) & (yy > neck_y)           # body, skirt, legs
    other |= (xx - mx) ** 2 + (yy - (ly + ry) / 2 + gap * 0.5) ** 2 < (gap * 1.1) ** 2  # head
    other |= along < -gap * 0.2                                                  # the far side
    other |= (along < gap * 1.25) & (yy < top - 12)                              # hair above the tail
    other |= yy < top - 40                                                       # nothing up here is tail
    other |= (along < gap * manual.get('hairBand', 1.45)) & (yy < tail[0][1] - 35)  # hair beside the body
    # Her fur is always saturated, so anything pale or gold is clothing or a charm hanging nearby.
    top_channel = rgba[..., :3].max(axis=2)
    saturation = (top_channel - rgba[..., :3].min(axis=2)) / np.maximum(top_channel, 1)
    interior = morph(rgba[..., 3] > 200, -9)
    other |= interior & (saturation < 0.2) & (top_channel > 140)
    other |= interior & (rgba[..., 0] > rgba[..., 2] + 18) & (top_channel > 120)  # gold, skin, red ribbons
    if 'tailTop' in manual:
        other |= yy < manual['tailTop']
    other |= marked_not_tail(manual, (height, width))
    labels[other & opaque] = OTHER
    # Hand-placed seeds can land just off the tail, so each snaps to the nearest solid fur.
    solid = morph(opaque, -13) & (darkness < 170) & ~other
    seeds = list(manual.get('tailSeeds', [])) or list(tail[1:])
    seed_points = []
    for x, y in seeds:
        distance = (xx - x) ** 2 + (yy - y) ** 2
        distance = np.where(solid, distance, 1e12)
        nearest = np.unravel_index(np.argmin(distance), distance.shape)
        if distance[nearest] > 70 ** 2:
            continue
        seed_points.append((int(nearest[0]), int(nearest[1])))
        patch = (xx - nearest[1]) ** 2 + (yy - nearest[0]) ** 2 < 25
        labels[patch & opaque] = TAIL
    if not (labels == TAIL).any():
        return np.zeros((height, width), dtype=bool)

    heap, order = [], 0
    unlabeled = opaque & (labels == 0)
    touching = np.zeros_like(unlabeled)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        touching |= np.roll(np.roll(labels != 0, dy, 0), dx, 1)
    for y, x in zip(*np.nonzero(unlabeled & touching)):
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < height and 0 <= nx < width and labels[ny, nx]:
                order += 1
                heapq.heappush(heap, (float(darkness[y, x]), order, int(y), int(x), int(labels[ny, nx])))
    # Plain lists: this loop touches every pixel, and numpy scalars would make it far slower.
    labels_view, opaque_view, darkness_view = labels.tolist(), opaque.tolist(), darkness.tolist()
    while heap:
        level, _, y, x, label = heapq.heappop(heap)
        if labels_view[y][x]:
            continue
        labels_view[y][x] = label
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < height and 0 <= nx < width and opaque_view[ny][nx] and not labels_view[ny][nx]:
                order += 1
                heapq.heappush(heap, (max(level, darkness_view[ny][nx]), order, ny, nx, label))
    labels = np.array(labels_view, dtype=np.int8)

    # Faint edge pixels below the opacity cutoff follow the nearest label, then smooth specks away.
    mask = morph(labels == TAIL, 3, -3, -3, 3)
    # Ribbons and cables that touch the tail are thin: an opening removes them, and the regrowth
    # brings back the fur tips close to the body of the tail but not anything long and thin.
    tail_mask = largest_component(mask & morph(mask, -9, 9, 11), seed_points)
    visible = rgba[..., 3] > 0
    tail_mask = tail_mask | (morph(tail_mask, 9) & visible & (labels == 0))
    return adopt_fragments(tail_mask, visible, manual.get('notTail', []))


def components(mask):
    """Yields each 4-connected region of a boolean mask as a list of (y, x)."""
    height, width = mask.shape
    view = mask.tolist()
    seen = [[False] * width for _ in range(height)]
    for y0 in range(height):
        for x0 in range(width):
            if not view[y0][x0] or seen[y0][x0]:
                continue
            stack, cells = [(y0, x0)], []
            seen[y0][x0] = True
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < height and 0 <= nx < width and view[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((ny, nx))
            yield cells


def paint_cells(shape_like, groups):
    out = np.zeros_like(shape_like)
    for cells in groups:
        for y, x in cells:
            out[y, x] = True
    return out


def adopt_fragments(tail_mask, visible, keep_out, max_area=900):
    """Scraps of body left stranded next to the tail would stay behind as a ghost outline."""
    near = morph(tail_mask, 5).tolist()
    marked = {(y, x) for x, y in keep_out}
    scraps = [cells for cells in components(visible & ~tail_mask)
              if len(cells) <= max_area and any(near[y][x] for y, x in cells) and not marked.intersection(cells)]
    return tail_mask | paint_cells(tail_mask, scraps)


def largest_component(mask, seeds=()):
    """The biggest region, plus any region a hand-placed seed landed in."""
    seed_set, best, kept = set(seeds), [], []
    for cells in components(mask):
        if seed_set.intersection(cells):
            kept.append(cells)
        if len(cells) > len(best):
            best = cells
    return paint_cells(mask, [best, *kept])


def paint_under(rgba, tail_mask, seam=3):
    """A thin seam under the tail so its cut edge never shows, grown from whatever it touches.

    Nothing wider: each side of the cut keeps half of the ink line between them, so the hair
    already has a finished edge when the tail swings away.
    """
    ys, xs = np.nonzero(tail_mask)
    pad = seam + 2
    y0, y1 = max(0, ys.min() - pad), min(tail_mask.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(tail_mask.shape[1], xs.max() + pad)
    # An empty border stops np.roll wrapping color across when the tail touches the canvas edge.
    crop = np.pad(rgba[y0:y1, x0:x1], ((1, 1), (1, 1), (0, 0)))
    mask = np.pad(tail_mask[y0:y1, x0:x1], 1)
    filled = (~mask) & (crop[..., 3] > 200)
    color = np.where(filled[..., None], crop[..., :3], 0.0)
    depth = np.full(mask.shape, 9999, dtype=np.int32)
    depth[filled] = 0
    for step in range(1, seam + 1):
        total = np.zeros_like(color)
        count = np.zeros(mask.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            near = np.roll(np.roll(filled, dy, 0), dx, 1)
            total += np.roll(np.roll(color, dy, 0), dx, 1) * near[..., None]
            count += near
        grow = mask & ~filled & (count > 0)
        color[grow] = total[grow] / count[grow][..., None]
        depth[grow] = step
        filled |= grow
    out = np.zeros((*tail_mask.shape, 4), dtype=np.uint8)
    alpha = np.clip((seam + 1 - depth) / 2.0, 0, 1) * 255
    alpha[~mask | ~filled] = 0
    out[y0:y1, x0:x1, :3] = np.clip(color[1:-1, 1:-1], 0, 255).astype(np.uint8)
    out[y0:y1, x0:x1, 3] = alpha[1:-1, 1:-1].astype(np.uint8)
    return out


def white_pockets(rgba, tail_mask, keep):
    """Finds leftover background in the gaps the tail encloses against her hair and body.

    Her sleeves and socks are the same flat white, so color alone cannot tell them apart. What
    does is position: a true pocket has the tail along a good share of its edge, and clothing
    does not. A swinging tail would otherwise uncover these as bright patches on a dark theme.
    """
    height, width = tail_mask.shape
    low = rgba[..., :3].min(axis=2)
    near_tail = morph(tail_mask, 13)
    pockets = []
    for cells in components((low >= 245) & (rgba[..., 3] > 200)):
        if len(cells) < 15 or any(keep[y, x] for y, x in cells):
            continue
        ys, xs = zip(*cells)
        y_lo, y_hi = max(0, min(ys) - 5), min(height, max(ys) + 6)
        x_lo, x_hi = max(0, min(xs) - 5), min(width, max(xs) + 6)
        blob = np.zeros((y_hi - y_lo, x_hi - x_lo), dtype=bool)
        for y, x in cells:
            blob[y - y_lo, x - x_lo] = True
        edge = morph(blob, 5) & ~blob
        if edge.any() and near_tail[y_lo:y_hi, x_lo:x_hi][edge].mean() >= 0.3:
            pockets.append(cells)
    out = paint_cells(tail_mask, pockets)
    # Take the soft pale fringe with it, so no halo survives on a dark background.
    return out | (morph(out, 5) & ~tail_mask & (low > 150)) if out.any() else out


def make_tail(image, entry, manual):
    tail_mask = cut_tail(image, entry, manual)
    if tail_mask.sum() < 400:
        return None
    rgba = np.asarray(image, dtype=np.float32)
    keep = marked_not_tail(manual, tail_mask.shape)
    pockets = white_pockets(rgba, tail_mask, keep)
    # Ink that only bordered the tail or a pocket is a few pixels wide. Left on the body it would
    # hang in the air as a ghost outline once the tail swings; anything really part of her is thick.
    visible = (rgba[..., 3] > 0) & ~pockets
    thin = visible & ~tail_mask & ~morph(visible & ~tail_mask, -7, 9)
    tail_mask = tail_mask | (thin & morph(tail_mask | pockets, 13) & ~morph(keep, 5))
    # The pale rim a pocket leaves along the tail would travel with it as a white edge.
    rim = tail_mask & morph(pockets, 7) & (rgba[..., :3].min(axis=2) > 200)
    tail_mask = tail_mask & ~rim
    pockets = pockets | rim
    removed = tail_mask | pockets
    ys, xs = np.nonzero(removed)
    x0, y0, x1, y1 = max(0, xs.min() - 1), max(0, ys.min() - 1), min(image.width, xs.max() + 2), min(image.height, ys.max() + 2)
    box = (int(x0), int(y0), int(x1), int(y1))
    layer = np.asarray(image).copy()
    layer[..., 3] = np.where(tail_mask, layer[..., 3], 0)
    # The seam must grow from what stays on the body, never from the white being taken away.
    under = paint_under(np.where(pockets[..., None], 0, rgba), tail_mask)
    under[pockets, 3] = 0
    cut = np.zeros((*tail_mask.shape, 4), dtype=np.uint8)
    cut[..., 3] = np.where(removed, 255, 0)
    to_image = lambda data: Image.fromarray(data, 'RGBA').crop(box)
    return to_image(layer), to_image(under), to_image(cut), [int(x0), int(y0)], tail_mask, int(pockets.sum())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    blink_dir, tail_dir, under_dir, cut_dir = OUT / 'blink', OUT / 'tail', OUT / 'under', OUT / 'cut'
    tails_only = '--tails-only' in sys.argv
    previous = json.loads((OUT / 'rig.json').read_text(encoding='utf-8')) if tails_only else {}
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    for folder in () if only else (tail_dir, under_dir, cut_dir) if tails_only else (blink_dir, tail_dir, under_dir, cut_dir):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir()
    masks = {}
    art, donor = closed_eye_art()
    rig = dict(previous) if only else {}
    report = []
    for path in sorted(POSES.glob('*.webp')):
        name = path.stem
        if only and name not in only:
            continue
        image = Image.open(path).convert('RGBA')
        manual = OVERRIDES['poses'].get(name, {})
        eyes = find_eyes(image)
        if manual.get('eyes'):
            eyes = tuple(tuple(e) for e in manual['eyes'])
        entry = {'size': list(image.size)}
        if eyes:
            entry['eyes'] = [list(eyes[0]), list(eyes[1])]
            entry.update(find_crown(image, eyes))
        if 'tail' in manual:
            entry['tail'] = manual['tail']
        if tails_only:
            if 'blink' in previous.get(name, {}):
                entry['blink'] = previous[name]['blink']
        elif eyes and not manual.get('noBlink'):
            patch, at = make_blink(image, eyes, art, donor)
            patch.save(blink_dir / f'{name}.webp', 'WEBP', quality=90, method=6)
            entry['blink'] = at
        if eyes and 'tail' in entry and not manual.get('noTail'):
            cut = make_tail(image, entry, manual)
            if cut:
                tail_image, under_image, cut_image, origin, masks[name], pocket_pixels = cut
                tail_image.save(tail_dir / f'{name}.webp', 'WEBP', quality=92, method=6, alpha_quality=100, exact=True)
                under_image.save(under_dir / f'{name}.webp', 'WEBP', quality=80, method=6, alpha_quality=100, exact=True)
                cut_image.save(cut_dir / f'{name}.webp', 'WEBP', lossless=True, method=6)
                entry['tailRect'] = [*origin, tail_image.width, tail_image.height]
                if pocket_pixels:
                    report.append(f'{name:18} white pocket removed: {pocket_pixels}px')
        rig[name] = entry
        report.append(f"{name:18} eyes={'auto' if eyes and not manual.get('eyes') else ('manual' if eyes else 'MISSING'):7} blink={'yes' if 'blink' in entry else 'no'} tail={'yes' if 'tail' in entry else 'no'}")
    (OUT / 'rig.json').write_text(json.dumps(rig, ensure_ascii=False, indent=0), encoding='utf-8')
    print('\n'.join(report))
    if '--debug' in sys.argv:
        debug_sheet(rig, Path(sys.argv[sys.argv.index('--debug') + 1]), masks)


def debug_sheet(rig, out, masks):
    """Overlays the landmarks on each pose so they can be checked by eye."""
    names = list(masks) if len(masks) < len(rig) - 5 else list(rig)
    per = 12
    for page in range(0, len(names), per):
        chunk = names[page:page + per]
        sheet = Image.new('RGB', (6 * 300, 2 * 380), (232, 228, 245))
        draw = ImageDraw.Draw(sheet)
        for index, name in enumerate(chunk):
            image = Image.open(POSES / f'{name}.webp').convert('RGBA')
            if name in masks:
                # Tail tinted, so a bad cut is obvious at a glance.
                tinted = np.asarray(image).copy()
                tinted[masks[name], 0] = 255
                tinted[masks[name], 1] = (tinted[masks[name], 1] * 0.75).astype(np.uint8)
                tinted[masks[name], 2] = (tinted[masks[name], 2] * 0.15).astype(np.uint8)
                image = Image.fromarray(tinted, 'RGBA')
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
                for index_point, p in enumerate(entry['tail']):
                    x, y = point(p)
                    color = 'white' if index_point == 0 else 'cyan'
                    draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline=color, width=2)
            # Grid every 100 source pixels for reading coordinates.
            for gx in range(0, image.width, 100):
                draw.line((ox + gx * k, oy + 10, ox + gx * k, oy + 10 + image.height * k), fill=(90, 90, 200), width=1)
            for gy in range(0, image.height, 100):
                draw.line((ox, oy + 10 + gy * k, ox + image.width * k, oy + 10 + gy * k), fill=(90, 90, 200), width=1)
            draw.text((ox + 3, oy + 1), f'{name} {image.width}x{image.height} k={k:.2f}', fill=(120, 0, 60))
        sheet.save(out / f'landmarks-{page // per}.png')


if __name__ == '__main__':
    main()
