# Regenerates public/chairs/*.png from the chair sheets in "Tandem Works/TheRoom/Graphics - Chairs".
# Requires Python with pillow, numpy, scipy and rembg==2.0.50 (+ onnxruntime). Usage:
#   python cut_chairs.py "Chairs B C And D with 8 angles for each.jpg" BCD public/chairs
#   python cut_chairs.py "Chairs E, F, G and 8 angles each.jpeg" EFG public/chairs
#   python cut_chairs.py "Chair A 8 angles.jpg" A public/chairs
"""Cut chair sprites out of sheets with a painted-in checkerboard background."""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from rembg import new_session, remove

SESSION = new_session("isnet-general-use")
SCALE = 3

src, letters, out = sys.argv[1], sys.argv[2], sys.argv[3]
ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]
img = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
h, w, _ = img.shape
L = img.mean(axis=2)
chroma = img.max(axis=2) - img.min(axis=2)
neutral = chroma < 14

# 1. Background = neutral light/grey pixels connected to the border (checker + painted shadows).
cand = neutral & (L >= 150)
lab, n = ndi.label(cand)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
# 2. Enclosed checker pockets (e.g. between legs): both checker tones present.
for i in range(1, n + 1):
    if i in border:
        continue
    m = lab == i
    area = m.sum()
    if area < 40:
        continue
    vals = L[m]
    light = (vals >= 243).mean()
    dark = ((vals >= 225) & (vals < 238)).mean()
    if light > 0.15 and dark > 0.15:
        bg |= m
fg = ~bg
fg = ndi.binary_opening(fg, iterations=1)

# 3. Find chair blobs; drop text labels (short, wide components below chairs).
blobs, nb = ndi.label(ndi.binary_dilation(fg, iterations=6))
boxes = ndi.find_objects(blobs)
chairs = []
for i, sl in enumerate(boxes, 1):
    ys, xs = sl
    bh, bw = ys.stop - ys.start, xs.stop - xs.start
    if bh < 45 or (fg[sl] & (blobs[sl] == i)).sum() < 400:
        continue
    chairs.append((ys.start, xs.start, sl, i))
if len(chairs) != 8 * len(letters):
    sys.exit(f"{src}: found {len(chairs)} chairs, expected {8 * len(letters)}")

# Sort into rows (top-to-bottom), then left-to-right.
chairs.sort(key=lambda c: c[0])
rows = [chairs[r * 8:(r + 1) * 8] for r in range(len(letters))] if len(letters) > 1 else None
if len(letters) == 1:  # single chair laid out as 2 rows x 4
    chairs.sort(key=lambda c: c[0]); top, bottom = sorted(chairs[:4], key=lambda c: c[1]), sorted(chairs[4:], key=lambda c: c[1])
    rows = [top + bottom]
os.makedirs(out, exist_ok=True)
for letter, row in zip(letters, rows):
    row = sorted(row, key=lambda c: c[1]) if len(letters) > 1 else row
    for angle, (_, _, sl, i) in zip(ANGLES, row):
        ys, xs = sl
        pad = 10
        y0, y1 = max(ys.start - pad, 0), min(ys.stop + pad, h)
        x0, x1 = max(xs.start - pad, 0), min(xs.stop + pad, w)
        crop = Image.fromarray(img[y0:y1, x0:x1].clip(0, 255).astype(np.uint8))
        big = crop.resize((crop.width * SCALE, crop.height * SCALE), Image.LANCZOS)
        cut = remove(big, session=SESSION, post_process_mask=True)
        alpha = np.asarray(cut)[:, :, 3].astype(float)
        # The model sometimes drops thin legs: restore thin dark strokes and coloured wood
        # that the checker flood-fill (first pass) already identified as chair.
        sub = img[y0:y1, x0:x1]
        Ls = sub.mean(axis=2); chroma_s = sub.max(axis=2) - sub.min(axis=2)
        cand_s = (chroma_s < 14) & (Ls >= 150)
        lab_s, _ = ndi.label(cand_s)
        edge = set(np.unique(np.concatenate([lab_s[0], lab_s[-1], lab_s[:, 0], lab_s[:, -1]]))) - {0}
        fg1 = ~np.isin(lab_s, list(edge))
        dark = Ls < 175
        thin_dark = dark & ~ndi.binary_opening(dark, iterations=2)
        legs = fg1 & (thin_dark | (chroma_s >= 24)) & (np.arange(fg1.shape[0])[:, None] > fg1.shape[0] * 0.45)
        legs_big = np.kron(legs, np.ones((SCALE, SCALE))) * 255
        alpha = np.maximum(alpha, ndi.gaussian_filter(legs_big, 0.8))
        # Drop painted checker pockets the model kept (both checker tones, neutral, light).
        rgb = np.asarray(big).astype(np.int16)
        Lb = rgb.mean(axis=2); neutral_b = (rgb.max(axis=2) - rgb.min(axis=2)) < 14
        light = neutral_b & (Lb >= 224)
        lab, n = ndi.label(light & (alpha > 0))
        for k in range(1, n + 1):
            m = lab == k
            if m.sum() < 60 * SCALE:
                continue
            vals = Lb[m]
            if (vals >= 243).mean() > 0.15 and ((vals >= 224) & (vals < 238)).mean() > 0.15:
                alpha[m] = 0
        # Keep only the largest connected piece (the chair) plus pieces near it.
        solid = alpha > 32
        lab, n = ndi.label(ndi.binary_dilation(solid, iterations=4 * SCALE))
        if n > 1:
            sizes = ndi.sum(solid, lab, range(1, n + 1))
            alpha[lab != (int(np.argmax(sizes)) + 1)] = 0
        sprite = Image.fromarray(np.dstack([np.asarray(big), alpha.clip(0, 255).astype(np.uint8)]))
        sprite = sprite.crop(sprite.getbbox())
        sprite = sprite.resize((max(1, sprite.width * 2 // SCALE), max(1, sprite.height * 2 // SCALE)), Image.LANCZOS)
        sprite.save(f"{out}/chair-{letter.lower()}-{angle}.webp", "WEBP", quality=86, method=6)
print(src, "ok", len(chairs))
