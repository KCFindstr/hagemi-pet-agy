#!/usr/bin/env python3
"""Turns frames recorded by tools/readme-media.mjs into cropped, transparent animated WebPs.
Usage: readme_media.py <framesDir> <mediaDir> [scene...]   Dev-only; needs Pillow."""
import os
import sys

from PIL import Image

FRAMES, MEDIA = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
FPS, PAD, SCALE = 15, 14, 0.75
STILLS = ('status', 'menu', 'settings')
os.makedirs(MEDIA, exist_ok=True)


def crop_box(paths):
    box = None
    for path in paths:
        with Image.open(path) as im:
            b = im.getchannel('A').getbbox()
            w, h = im.size
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return (max(0, box[0] - PAD), max(0, box[1] - PAD), min(w, box[2] + PAD), min(h, box[3] + PAD))


def shrink(path, box):
    with Image.open(path) as im:
        c = im.convert('RGBA').crop(box)
    return c.resize((round(c.width * SCALE), round(c.height * SCALE)), Image.LANCZOS)


def animation(scene):
    folder = os.path.join(FRAMES, scene)
    items = [(int(f[:-4]), os.path.join(folder, f)) for f in sorted(os.listdir(folder)) if f[:-4].isdigit()]
    # The screencast occasionally opens with one frame painted before the page went transparent.
    items = [(t, p) for t, p in items if Image.open(p).mode == 'RGBA']
    # Resample the uneven screencast to a steady frame rate.
    picks, i = [], 0
    for k in range(int(items[-1][0] / 1000 * FPS) + 1):
        while i + 1 < len(items) and items[i + 1][0] <= k * 1000 / FPS:
            i += 1
        picks.append(items[i][1])
    box = crop_box(sorted(set(picks)))
    cache = {}
    for p in picks:
        if p not in cache:
            cache[p] = shrink(p, box)
    frames = [cache[p] for p in picks]
    target = os.path.join(MEDIA, f'{scene}.webp')
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=1000 // FPS, loop=0, quality=72, alpha_quality=30, method=4)
    print(f'{scene}: {len(frames)} frames {frames[0].size} -> {os.path.getsize(target) / 1e6:.2f} MB')


def still(name):
    path = os.path.join(FRAMES, f'{name}.png')
    target = os.path.join(MEDIA, f'{name}.webp')
    shrink(path, crop_box([path])).save(target, quality=90, alpha_quality=90, method=4)
    print(f'{name}: {os.path.getsize(target) / 1e3:.0f} KB')


for entry in sorted(os.listdir(FRAMES)):
    if os.path.isdir(os.path.join(FRAMES, entry)) and (not ONLY or entry in ONLY):
        animation(entry)
if not ONLY or 'stills' in ONLY:
    for name in STILLS:
        if os.path.exists(os.path.join(FRAMES, f'{name}.png')):
            still(name)
