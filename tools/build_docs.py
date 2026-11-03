#!/usr/bin/env python3
"""Regenerates assets/logo.png and docs/poses.webp from the pose art. Dev-only; needs Pillow."""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'sidecars' / 'pet' / 'art'
rig = json.loads((ART / 'rig.json').read_text(encoding='utf-8'))


def logo():
    image = Image.open(ART / 'idle.webp').convert('RGBA')
    (lx, ly), (rx, ry) = rig['idle']['eyes']
    cx, cy = (lx + rx) / 2, (ly + ry) / 2 - 50
    half = 195
    canvas = Image.new('RGBA', (half * 2, half * 2), (0, 0, 0, 0))
    canvas.alpha_composite(image, (int(half - cx), int(half - cy)))
    (ROOT / 'assets').mkdir(exist_ok=True)
    canvas.resize((256, 256), Image.LANCZOS).save(ROOT / 'assets' / 'logo.png')


def sheet():
    scenes = [
        ('idle', 'idle'), ('thinking', 'thinking'), ('reading', 'reading files'), ('writing', 'editing'),
        ('running', 'running commands'), ('searching', 'searching'), ('drawing', 'making images'), ('delegating', 'subagents'),
        ('compact', 'compacting'), ('asking', 'needs you'), ('busy_left', '2 sessions'), ('swamped_left', '3+ sessions'),
        ('happy', 'done'), ('proud', 'big job done'), ('oops', 'error'), ('tired', 'low quota'),
        ('update', 'quota refilled'), ('sleeping', 'nobody home'), ('pat', 'head pat'), ('sulk', 'poked too much'),
    ]
    cols, cell_w, cell_h = 5, 236, 300
    rows = (len(scenes) + cols - 1) // cols
    out = Image.new('RGBA', (cols * cell_w, rows * cell_h), (30, 26, 46, 255))
    draw = ImageDraw.Draw(out)
    for index, (pose, label) in enumerate(scenes):
        image = Image.open(ART / f'{pose}.webp').convert('RGBA')
        k = min((cell_w - 16) / image.width, (cell_h - 30) / image.height)
        small = image.resize((int(image.width * k), int(image.height * k)), Image.LANCZOS)
        x = (index % cols) * cell_w + (cell_w - small.width) // 2
        y = (index // cols) * cell_h + 4
        out.alpha_composite(small, (x, y))
        width = draw.textlength(label)
        draw.text(((index % cols) * cell_w + (cell_w - width) / 2, (index // cols) * cell_h + cell_h - 20), label, fill=(226, 218, 255, 255))
    (ROOT / 'docs').mkdir(exist_ok=True)
    out.convert('RGB').save(ROOT / 'docs' / 'poses.webp', quality=86, method=6)


logo()
sheet()
print('wrote assets/logo.png and docs/poses.webp')
