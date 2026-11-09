#!/usr/bin/env python3
"""Paints the hair hidden behind her tail, so a swinging tail reveals hair instead of a bite.

Dev-only; run after build_rig.py. Needs Pillow, numpy, opencv-python-headless and onnxruntime, plus
the LaMa model from https://huggingface.co/Carve/LaMa-ONNX (lama_fp32.onnx, Apache-2.0):

  python tools/inpaint_under.py --model path/to/lama_fp32.onnx

The model only ever chooses colors. Where paint may go is decided here, and is limited to pixels
the tail fully covers, so with the tail at rest the image cannot change. --check proves that from
the saved files: body, under layer and tail composited together must equal the original pose.

To refine the paint with an anime diffusion model on a GPU, send the crops to tools/colab_inpaint.ipynb
and bring the results back. Importing rewrites under layers only, within the pixels already painted:

  python tools/inpaint_under.py --release-outlines
  python tools/inpaint_under.py --export crops.zip [--only pose,pose]
  python tools/inpaint_under.py --import results.zip --variant s050_a [--only pose,pose] [--clean recolor]
"""
import argparse
import io
import json
import zipfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'sidecars' / 'pet' / 'art'
INK = np.array([46, 38, 104], dtype=np.float32)
HAIR_REACH = 40  # How wide a bite in her silhouette may be closed, in pixels.
RIM_REACH = 6  # How far the tail's outline extends onto the hair, in pixels.
HALO = 2  # The light fringe beside that outline, which would otherwise stay behind as a dashed line.
CONTEXT = 72  # How much surrounding art the model sees.
WORTH_REFINING = 150  # Below this many painted pixels, the paint is too small for a diffusion pass to matter.
SPECK = 12  # Painted islands smaller than this float in open space, so they are dropped.


def luma(rgba):
    return 0.3 * rgba[..., 0] + 0.59 * rgba[..., 1] + 0.11 * rgba[..., 2]


def disk(radius):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))


def grow(mask, radius=1):
    return cv2.dilate(mask.astype(np.uint8), disk(radius), borderType=cv2.BORDER_REPLICATE) > 0


def touching(pieces, target):
    """Only the connected pieces of `pieces` that touch `target`."""
    count, labels = cv2.connectedComponents(pieces.astype(np.uint8), connectivity=8)
    keep = np.unique(labels[grow(target, 2) & pieces])
    return np.isin(labels, keep[keep > 0])


def is_hair(rgb):
    top, low = rgb.max(axis=-1), rgb.min(axis=-1)
    saturation = (top - low) / np.maximum(top, 1)
    return (saturation > 0.22) & (rgb[..., 2] > rgb[..., 0] - 12)


def mostly_against_hair(paint, body, original):
    """Keeps pieces that continue her hair. Ones wedged against a charm or cable have no business here."""
    count, labels = cv2.connectedComponents(paint.astype(np.uint8), connectivity=8)
    near = cv2.dilate(labels.astype(np.float32), disk(7)).astype(np.int32)
    contact = body & ~paint & (near > 0) & (luma(original) > 95)
    hair = is_hair(original[..., :3])
    keep = np.zeros(paint.shape, dtype=bool)
    for label in range(1, count):
        where = contact & (near == label)
        if where.sum() >= 12 and hair[where].mean() >= 0.5:
            keep |= labels == label
    return keep


def load_layers(pose, entry):
    original = np.asarray(Image.open(ART / f'{pose}.webp').convert('RGBA')).astype(np.float32)
    x, y, w, h = entry['tailRect']
    tail = np.zeros_like(original)
    tail[y:y + h, x:x + w] = np.asarray(Image.open(ART / 'tail' / f'{pose}.webp').convert('RGBA'))
    removed = np.zeros(original.shape[:2], dtype=bool)
    removed[y:y + h, x:x + w] = np.asarray(Image.open(ART / 'cut' / f'{pose}.webp').convert('RGBA'))[..., 3] > 0
    return original, tail, removed


def plan_paint(original, tail, removed):
    """Decides where hair goes: the bites in her silhouette, and the tail outline lying on them."""
    solid = original[..., 3] >= 255
    covered = (tail[..., 3] > 0) & solid
    body = (original[..., 3] > 128) & ~removed
    closed = cv2.morphologyEx(body.astype(np.uint8), cv2.MORPH_CLOSE, disk(HAIR_REACH), borderType=cv2.BORDER_REPLICATE) > 0
    paint = mostly_against_hair(touching(closed & covered, body), body, original)
    # The ink between tail and hair is the tail's outline. Left on the body it would stay behind as
    # a ghost of the tail, so it moves to the tail layer, which leaves the resting image unchanged.
    level = luma(original)
    dark = (level < 70) & solid & ~removed
    rim = np.zeros_like(dark)
    front = paint
    for _ in range(RIM_REACH):
        front = grow(front) & dark & ~rim
        rim |= front
    rim |= grow(rim) & (level < 115) & solid & ~removed
    # Moving these to the tail too leaves the resting image exactly as it was.
    rim |= grow(paint | rim, HALO) & solid & ~removed
    return paint | rim, rim


def charm_pixels(original, removed):
    """Gems, sleeves and other pale details still on the body, without thin lines drawn on fabric."""
    detail = (original[..., 3] > 200) & ~removed & ~is_hair(original[..., :3]) & (luma(original) > 110)
    return cv2.morphologyEx(detail.astype(np.uint8), cv2.MORPH_OPEN, disk(1)) > 0


def charm_outline(original, removed):
    """The ink a gem or sleeve shares with the tail. It belongs to the gem, so it stays when the tail moves."""
    detail = charm_pixels(original, removed)
    # Only fully opaque pixels: a soft edge drawn on both layers would no longer composite to the original.
    solid = removed & (original[..., 3] >= 254)
    # The whole band up to the tail's fur: the gem's pale rim, its soft edge and its ink. Fur is saturated and bright.
    band = solid & grow(detail, 5) & (~is_hair(original[..., :3]) | (luma(original) < 115))
    keep = touching(band, detail)
    closed = cv2.morphologyEx((keep | detail).astype(np.uint8), cv2.MORPH_CLOSE, disk(1)) > 0
    keep |= solid & closed
    # Crumbs of the cut left inside or against that band would show as dots on the gem.
    count, labels, stats, _ = cv2.connectedComponentsWithStats((solid & ~keep).astype(np.uint8), connectivity=8)
    crumbs = [label for label in range(1, count) if stats[label, cv2.CC_STAT_AREA] < SPECK]
    return keep | (np.isin(labels, crumbs) & grow(keep | detail, 2))


def extend_colors(original, known):
    """Fills everything unknown with the nearest known color, so white never steers the model."""
    _, labels = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(known)
    table = np.zeros((labels.max() + 1, 3), dtype=np.float32)
    table[labels[ys, xs]] = original[ys, xs, :3]
    return table[labels]


def run_lama(session, rgb, hole, box):
    x0, y0, x1, y1 = box
    side = max(x1 - x0, y1 - y0) + CONTEXT * 2
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    left, top = cx - side // 2, cy - side // 2
    margin = side
    padded = cv2.copyMakeBorder(rgb, margin, margin, margin, margin, cv2.BORDER_REPLICATE)
    held = cv2.copyMakeBorder(hole.astype(np.uint8), margin, margin, margin, margin, cv2.BORDER_CONSTANT, value=0)
    tile = padded[top + margin:top + margin + side, left + margin:left + margin + side]
    tile_hole = held[top + margin:top + margin + side, left + margin:left + margin + side]
    size = (512, 512)
    small = cv2.resize(tile, size, interpolation=cv2.INTER_AREA if side > 512 else cv2.INTER_CUBIC).astype(np.float32) / 255
    small_hole = (cv2.resize(tile_hole, size, interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)
    out = session.run(None, {'image': small.transpose(2, 0, 1)[None], 'mask': small_hole[None, None]})[0][0].transpose(1, 2, 0)
    if out.max() <= 1.5:
        out = out * 255
    back = cv2.resize(np.clip(out, 0, 255).astype(np.float32), (side, side), interpolation=cv2.INTER_CUBIC)
    result = rgb.copy()
    y_lo, y_hi, x_lo, x_hi = max(0, top), min(rgb.shape[0], top + side), max(0, left), min(rgb.shape[1], left + side)
    result[y_lo:y_hi, x_lo:x_hi] = back[y_lo - top:y_hi - top, x_lo - left:x_hi - left]
    return result


def paint_under(session, original, removed, paint, rim):
    gone = removed | rim
    known = (original[..., 3] > 200) & ~gone & (luma(original) > 95)
    rgb = extend_colors(original, known)
    keep = (original[..., 3] > 200) & ~gone
    rgb[keep] = original[keep, :3]
    ys, xs = np.nonzero(paint)
    filled = run_lama(session, rgb, grow(gone, 2), (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    # The model sometimes drifts into muddy grey, or picks up gold from a charm. Hidden hair is
    # only ever hair, so those pixels are repainted from the good ones around them.
    stray = paint & ~(is_hair(filled) & (luma(filled) > 60))
    if stray.any():
        filled = cv2.inpaint(np.clip(filled, 0, 255).astype(np.uint8), stray.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA).astype(np.float32)
    return finish_under(original, gone, paint, filled)


def smooth_depth(silhouette):
    """Distance from open space, measured on a smoothed outline so pixel stairs do not become beads."""
    scale = 4
    padded = cv2.copyMakeBorder(silhouette.astype(np.uint8), 2, 2, 2, 2, cv2.BORDER_REPLICATE)
    big = cv2.resize(padded * 255, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    big = cv2.GaussianBlur(big, (0, 0), 1.5 * scale) > 127
    depth = cv2.distanceTransform(big.astype(np.uint8), cv2.DIST_L2, 5) / scale
    small = cv2.resize(depth, (padded.shape[1], padded.shape[0]), interpolation=cv2.INTER_AREA)
    return small[2:-2, 2:-2]


def nearest_color(colors, good):
    _, labels = cv2.distanceTransformWithLabels((~good).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(good)
    table = np.zeros((labels.max() + 1, colors.shape[-1]), dtype=np.float32)
    table[labels[ys, xs]] = colors[ys, xs]
    return table[labels]


def without_edge_flecks(filled, paint, inside):
    """The white around her shows through at the mask edge as specks. Nothing on her outer edge is white."""
    top, low = filled.max(axis=-1), filled.min(axis=-1)
    fleck = paint & (inside < 8) & (top > 205) & ((top - low) / np.maximum(top, 1) < 0.16)
    good = paint & ~grow(fleck, 1)
    if not fleck.any() or not good.any():
        return filled
    result = filled.copy()
    result[fleck] = nearest_color(filled, good)[fleck]
    return result


def recolored(filled, paint, original, removed):
    """Keeps the painted shading, and takes color from nearby hair for grey or dark clumps."""
    def to_lab(rgb):
        return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    near = grow(paint, 40) & ~removed & (original[..., 3] > 200) & is_hair(original[..., :3]) & (luma(original) > 70)
    if not near.any():
        return filled
    source, painted = to_lab(original[..., :3]), to_lab(filled)
    context = source[near]
    chroma = np.hypot(painted[..., 1] - 128, painted[..., 2] - 128)
    floor = 0.75 * np.percentile(np.hypot(context[:, 1] - 128, context[:, 2] - 128), 5)
    grey = cv2.morphologyEx((paint & (chroma < floor)).astype(np.uint8), cv2.MORPH_OPEN, disk(1)) > 0
    dark = cv2.morphologyEx((paint & (painted[..., 0] < 55)).astype(np.uint8), cv2.MORPH_OPEN, disk(4)) > 0
    stray = paint & grow(grey | dark, 2)
    if not stray.any():
        return filled
    good = (paint & ~stray) | near
    reference = painted.copy()
    reference[near & ~paint] = source[near & ~paint]
    nearest = nearest_color(reference, good)
    low, high = np.percentile(context[:, 0], [5, 95])
    out = painted.copy()
    out[stray, 0] = np.clip(0.5 * painted[stray, 0] + 0.5 * nearest[stray, 0], low, high)
    out[stray, 1:] = nearest[stray, 1:]
    weight = cv2.GaussianBlur(stray.astype(np.float32), (0, 0), 1.2)[..., None]
    out = out * (1 - weight) + cv2.GaussianBlur(out, (0, 0), 1.6) * weight
    rgb = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)
    result = filled.copy()
    result[paint] = rgb[paint]
    return result


def without_specks(paint, body):
    """Tiny islands floating in open space read as dirt. Ones enclosed by her body are needed, or they become holes."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(paint.astype(np.uint8), connectivity=8)
    result = paint.copy()
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= SPECK:
            continue
        island = labels == label
        ring = grow(island, 1) & ~island
        if (~body[ring]).mean() > 0.3:
            result[island] = False
    return result


def finish_under(original, gone, paint, filled):
    """Keeps only the painted pixels, with a crisp, inked edge where new hair meets open space."""
    paint = without_specks(paint, (original[..., 3] > 128) & ~gone)
    silhouette = ((original[..., 3] > 128) & ~gone) | paint
    inside = smooth_depth(silhouette)
    filled = without_edge_flecks(filled, paint, inside)
    ink = np.clip(1 - (inside - 2.2) / 1.2, 0, 1)[..., None]
    out = np.zeros_like(original)
    out[..., :3] = filled * (1 - ink) + INK * ink
    out[..., 3] = np.clip(inside / 1.2, 0, 1) * 255
    out[~paint] = 0
    return out


def save_layers(pose, entry, original, tail, removed, under, rim):
    """Writes the three layers, growing the rectangle if the outline reaches past it."""
    # Straight from the pose, not the earlier lossy copy, so at rest the tail is exactly what it was.
    new_tail = np.zeros_like(original)
    owned = (tail[..., 3] > 0) | rim
    new_tail[owned] = original[owned]
    gone = removed | rim
    ys, xs = np.nonzero(gone)
    x0, y0 = max(0, xs.min() - 1), max(0, ys.min() - 1)
    x1, y1 = min(original.shape[1], xs.max() + 2), min(original.shape[0], ys.max() + 2)
    x, y, w, h = entry['tailRect']
    x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x + w), max(y1, y + h)
    box = (int(x0), int(y0), int(x1), int(y1))
    to_image = lambda data: Image.fromarray(np.clip(data, 0, 255).astype(np.uint8), 'RGBA').crop(box)
    # Lossless, so at rest the tail is exactly the pixels it was cut from.
    to_image(new_tail).save(ART / 'tail' / f'{pose}.webp', 'WEBP', lossless=True, method=6, exact=True)
    cut = np.zeros_like(original)
    cut[..., 3] = gone * 255
    to_image(cut).save(ART / 'cut' / f'{pose}.webp', 'WEBP', lossless=True, method=6)
    to_image(under).save(ART / 'under' / f'{pose}.webp', 'WEBP', quality=90, method=6, alpha_quality=100, exact=True)
    entry['tailRect'] = [box[0], box[1], box[2] - box[0], box[3] - box[1]]


def load_under(pose, entry, shape):
    x, y, w, h = entry['tailRect']
    under = np.zeros(shape, dtype=np.float32)
    under[y:y + h, x:x + w] = np.asarray(Image.open(ART / 'under' / f'{pose}.webp').convert('RGBA'))
    return under


def png_bytes(array, mode):
    buffer = io.BytesIO()
    Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), mode).save(buffer, 'PNG')
    return buffer.getvalue()


def export_crops(poses, rig, path):
    """Packs what a diffusion model needs for each pose: the tail-free image and where it may paint."""
    manifest = {}
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for pose in poses:
            original, _, removed = load_layers(pose, rig[pose])
            under = load_under(pose, rig[pose], original.shape)
            paint = under[..., 3] > 0
            if paint.sum() < WORTH_REFINING:
                continue
            ys, xs = np.nonzero(paint)
            height, width = paint.shape
            x0, y0, x1, y1 = xs.min() - CONTEXT, ys.min() - CONTEXT, xs.max() + 1 + CONTEXT, ys.max() + 1 + CONTEXT
            x0, y0, x1, y1 = int(max(0, x0)), int(max(0, y0)), int(min(width, x1)), int(min(height, y1))
            # The art was painted on white, which is what the model expects to see around it.
            body_alpha = np.where(removed, 0, original[..., 3])[..., None] / 255
            image = original[..., :3] * body_alpha + 255 * (1 - body_alpha)
            under_alpha = under[..., 3:] / 255
            image = under[..., :3] * under_alpha + image * (1 - under_alpha)
            archive.writestr(f'{pose}/init.png', png_bytes(image[y0:y1, x0:x1], 'RGB'))
            # Room to blend into the hair around the hole, but never over outlines and gems the model should only see.
            fixed = (original[..., 3] > 200) & ~removed & ((luma(original) < 110) | ~is_hair(original[..., :3]))
            mask = paint | (grow(paint, 3) & ~fixed)
            archive.writestr(f'{pose}/mask.png', png_bytes(mask[y0:y1, x0:x1] * 255, 'L'))
            manifest[pose] = {'box': [x0, y0, x1, y1], 'painted': int(paint.sum())}
        archive.writestr('manifest.json', json.dumps(manifest, indent=1))
    print(f'exported {len(manifest)} of {len(poses)} poses to {path}')


def release_outlines(poses, rig):
    """Gives shared ink back to gems and sleeves. At rest nothing changes, since the tail still draws over it."""
    for pose in poses:
        original, _, removed = load_layers(pose, rig[pose])
        keep = charm_outline(original, removed)
        if not keep.any():
            continue
        under = load_under(pose, rig[pose], original.shape)
        under[keep] = 0
        cut = np.zeros_like(original)
        cut[..., 3] = (removed & ~keep) * 255
        x, y, w, h = rig[pose]['tailRect']
        box = (x, y, x + w, y + h)
        Image.fromarray(cut.astype(np.uint8), 'RGBA').crop(box).save(ART / 'cut' / f'{pose}.webp', 'WEBP', lossless=True, method=6)
        Image.fromarray(np.clip(under, 0, 255).astype(np.uint8), 'RGBA').crop(box).save(ART / 'under' / f'{pose}.webp', 'WEBP', quality=90, method=6, alpha_quality=100, exact=True)
        print(f'{pose:18} {int(keep.sum())} outline pixels returned to the body')


def import_results(poses, rig, path, variant, clean='none'):
    """Takes new colors for already painted pixels. Tail, cut and rig stay as they are."""
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        for pose in poses:
            name = f'{pose}/{variant}.png'
            if pose not in manifest or name not in archive.namelist():
                continue
            original, _, removed = load_layers(pose, rig[pose])
            under = load_under(pose, rig[pose], original.shape)
            paint = under[..., 3] > 0
            x0, y0, x1, y1 = manifest[pose]['box']
            filled = under[..., :3].copy()
            filled[y0:y1, x0:x1] = np.asarray(Image.open(io.BytesIO(archive.read(name))).convert('RGB'), dtype=np.float32)
            # Hidden art is skirt and trim as well as hair, so nothing is filtered unless asked for.
            if clean == 'recolor':
                filled = recolored(filled, paint, original, removed)
            elif clean == 'smear':
                stray = paint & ~is_hair(filled)
                if stray.any():
                    filled = cv2.inpaint(np.clip(filled, 0, 255).astype(np.uint8), stray.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA).astype(np.float32)
            result = finish_under(original, removed, paint, filled)
            x, y, w, h = rig[pose]['tailRect']
            layer = Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), 'RGBA').crop((x, y, x + w, y + h))
            layer.save(ART / 'under' / f'{pose}.webp', 'WEBP', quality=90, method=6, alpha_quality=100, exact=True)
            print(f'{pose:18} under layer replaced from {variant}, cleaned with {clean}')


def rest_difference(pose, entry):
    """Largest channel difference from the original pose with the tail at rest, ignoring pockets."""
    original, tail, removed = load_layers(pose, entry)
    under = load_under(pose, entry, original.shape)
    pockets = removed & (tail[..., 3] == 0)
    body = original.copy()
    body[removed, 3] = 0

    def over(top, bottom):
        ta, ba = top[..., 3:] / 255, bottom[..., 3:] / 255
        alpha = ta + ba * (1 - ta)
        rgb = (top[..., :3] * ta + bottom[..., :3] * ba * (1 - ta)) / np.maximum(alpha, 1e-6)
        return np.concatenate([rgb, alpha * 255], axis=2)

    composite = over(tail, over(under, body))
    visible = (original[..., 3] > 0) | (composite[..., 3] > 0)
    # Color means nothing where a pixel is nearly transparent, so weigh it by opacity.
    color = np.abs(composite[..., :3] * composite[..., 3:] - original[..., :3] * original[..., 3:]).max(axis=2) / 255
    alpha = np.abs(composite[..., 3] - original[..., 3])
    difference = np.maximum(color, alpha)
    difference[pockets | ~visible] = 0
    return float(difference.max()), int((difference > 2).sum())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', help='path to lama_fp32.onnx')
    parser.add_argument('--only', help='comma-separated poses')
    parser.add_argument('--check', action='store_true', help='only verify the saved layers')
    parser.add_argument('--export', help='write crops for tools/colab_inpaint.ipynb to this zip')
    parser.add_argument('--import', dest='results', help='take new colors from this results zip')
    parser.add_argument('--variant', default='s055', help='which results to import, such as s055 or s075')
    parser.add_argument('--clean', default='none', choices=['none', 'recolor', 'smear'], help='how to treat non-hair colors on import')
    parser.add_argument('--release-outlines', action='store_true', help='give ink shared with gems back to the body')
    parser.add_argument('--art', help='work on a copy of the art folder instead')
    args = parser.parse_args()
    if args.art:
        global ART
        ART = Path(args.art)
    rig_file = ART / 'rig.json'
    rig = json.loads(rig_file.read_text(encoding='utf-8'))
    poses = [pose for pose, entry in rig.items() if 'tailRect' in entry and (not args.only or pose in args.only.split(','))]
    if args.export:
        export_crops(poses, rig, args.export)
        return
    if args.release_outlines:
        release_outlines(poses, rig)
    elif args.results:
        import_results(poses, rig, args.results, args.variant, args.clean)
    elif not args.check:
        import onnxruntime
        session = onnxruntime.InferenceSession(args.model, providers=['CPUExecutionProvider'])
        for pose in poses:
            entry = rig[pose]
            original, tail, removed = load_layers(pose, entry)
            paint, rim = plan_paint(original, tail, removed)
            kept = charm_outline(original, removed | rim)
            removed, rim, paint = removed & ~kept, rim & ~kept, paint & ~kept
            under = paint_under(session, original, removed, paint, rim) if paint.any() else np.zeros_like(original)
            save_layers(pose, entry, original, tail, removed, under, rim)
            print(f'{pose:18} painted {int(paint.sum())}px, outline moved {int(rim.sum())}px')
        rig_file.write_text(json.dumps(rig, ensure_ascii=False, indent=0), encoding='utf-8')
    worst = 0.0
    for pose in poses:
        peak, count = rest_difference(pose, rig[pose])
        worst = max(worst, peak)
        if count:
            print(f'{pose:18} at rest differs by up to {peak:.1f}/255 on {count}px')
    print(f'checked {len(poses)} poses; largest difference at rest {worst:.1f}/255')


if __name__ == '__main__':
    main()
