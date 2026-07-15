#!/usr/bin/env python3
"""Detect individual trees/bushes from a course's aerial photo and write their
world positions, so the 3D engine renders EVERY visible tree — including lone
specimen trees and scrub out on the open rough that the woods-mask tree source
(game.js buildTrees) misses.

Course-agnostic. Reads the baked aerial + surface mask + affines from
courses/<id>.json, classifies canopy per pixel (green + darker-than-fairway +
textured), and grids it into tree/bush points OUTSIDE the WOODS mask (dense
woods are already covered by getTrees) and off fairway/water. Output:

    courses/trees/<id>.json  ->  {"id","cell", "items":[{ "x","y","h","kind" }]}

x,y world units; h metres; kind "tree"|"bush". Run in the geo env
(numpy + Pillow):  ~/miniconda3/envs/geo/bin/python tools/detect_canopy.py --id <id>

Tunables are CLI flags; --debug writes courses/img/<id>/canopy_debug.png (canopy
tinted over the aerial) to eyeball detection quality.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

# surface-mask palette (matches fetch_course.py MASK_PALETTE)
OB, FAIRWAY, ROUGH, WOODS = 0, 1, 2, 3


def load_course(cid):
    path = os.path.join(os.path.dirname(__file__), "..", "courses", cid + ".json")
    with open(path) as f:
        return json.load(f)


def inv_affine(aff):
    a, b, c, d, e, f = aff
    det = a * e - b * d
    if abs(det) < 1e-18:
        sys.exit("degenerate affine")
    def to_src(wx, wy):          # world -> source px
        u, v = wx - c, wy - f
        return (e * u - b * v) / det, (-d * u + a * v) / det
    return to_src


def integral_boxstd(V, r):
    """Local std-dev over a (2r+1) box via integral images (no scipy)."""
    H, W = V.shape
    S = np.zeros((H + 1, W + 1), np.float64)
    S2 = np.zeros((H + 1, W + 1), np.float64)
    S[1:, 1:] = np.cumsum(np.cumsum(V, 0), 1)
    S2[1:, 1:] = np.cumsum(np.cumsum(V * V, 0), 1)
    y0 = np.clip(np.arange(H) - r, 0, H); y1 = np.clip(np.arange(H) + r + 1, 0, H)
    x0 = np.clip(np.arange(W) - r, 0, W); x1 = np.clip(np.arange(W) + r + 1, 0, W)
    def box(I):
        return (I[y1][:, x1] - I[y0][:, x1] - I[y1][:, x0] + I[y0][:, x0])
    n = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    mean = box(S) / n
    meansq = box(S2) / n
    return np.sqrt(np.maximum(meansq - mean * mean, 0.0)), mean


def main():
    ap = argparse.ArgumentParser(description="Detect trees/bushes from the aerial")
    ap.add_argument("--id", required=True)
    ap.add_argument("--cell", type=float, default=2.4, help="grid cell, world units (~tree crown)")
    ap.add_argument("--exg", type=float, default=12.0, help="excess-green veg threshold")
    ap.add_argument("--dark", type=float, default=118.0, help="max brightness (trees darker than fairway)")
    ap.add_argument("--tex", type=float, default=9.0, help="min local std (texture: trees rough, grass smooth)")
    ap.add_argument("--tree-cov", type=float, default=0.55, help="cell canopy fraction -> tree")
    ap.add_argument("--bush-cov", type=float, default=0.22, help="cell canopy fraction -> bush")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    course = load_course(args.id)
    aerial = course.get("aerial")
    if not aerial:
        sys.exit(f"{args.id}: no aerial to detect from")
    img_path = os.path.join(os.path.dirname(__file__), "..", "courses", aerial["file"])
    im = Image.open(img_path).convert("RGB")
    W, H = im.size
    arr = np.asarray(im, np.float64)
    R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
    V = (R + G + B) / 3.0
    exg = 2 * G - R - B

    # texture radius ~1.2 world units in px
    a_w = aerial["toWorld"]
    world_per_px = math.hypot(a_w[0], a_w[3])           # units per px (north-up: ~|a|)
    if abs(a_w[1]) > 1e-4 or abs(a_w[3]) > 1e-4:
        # note: for rotated aerials the block-reduce below is approximate; global
        # bakes are north-up so this rarely matters.
        print("WARN: aerial not axis-aligned; detection grid is approximate", flush=True)
    tex_r = max(1, int(round(1.2 / max(world_per_px, 1e-6))))
    std, _ = integral_boxstd(V, tex_r)

    canopy = (exg > args.exg) & (V < args.dark) & (std > args.tex)

    # surface mask (exclude WOODS -> getTrees covers it; exclude FAIRWAY -> no
    # trees on the mown fairway even if a shadow reads dark)
    mask_arr = None
    mask_to_src = None
    sm = course.get("surfaceMask")
    if sm:
        mp = os.path.join(os.path.dirname(__file__), "..", "courses", sm["file"])
        if os.path.exists(mp):
            mim = Image.open(mp)
            # It's a PALETTE png: np.asarray on mode 'P' gives the class INDEX
            # (0..3). convert('L') would give luminance (46/88/..) and break the
            # WOODS/FAIRWAY compare — the bug that let woods through.
            mask_arr = np.asarray(mim) if mim.mode == "P" else np.asarray(mim.convert("P"))
            mask_to_src = inv_affine(sm["toWorld"])
            if mask_arr.max() > 3:
                print(f"WARN: mask indices max {mask_arr.max()} (expected <=3); "
                      f"WOODS/FAIRWAY exclusion may be off", flush=True)

    # water polygons (world units) to veto
    waters = (course.get("surfaces", {}) or {}).get("water", []) or []

    def in_water(x, y):
        for poly in waters:
            n = len(poly); inside = False; j = n - 1
            for i in range(n):
                xi, yi = poly[i]["x"], poly[i]["y"]; xj, yj = poly[j]["x"], poly[j]["y"]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi:
                    inside = not inside
                j = i
            if inside:
                return True
        return False

    # block-reduce canopy to the world cell grid (north-up assumption)
    world_w, world_h = course["world"]["w"], course["world"]["h"]
    to_src = inv_affine(a_w)
    nx = max(1, int(world_w / args.cell)); ny = max(1, int(world_h / args.cell))
    items = []
    tree_h_units = 4.5   # crown height baseline (world units) for a detected tree
    for j in range(ny):
        wy = (j + 0.5) * args.cell
        for i in range(nx):
            wx = (i + 0.5) * args.cell
            # cell -> aerial px box
            px0, py0 = to_src(wx - args.cell / 2, wy - args.cell / 2)
            px1, py1 = to_src(wx + args.cell / 2, wy + args.cell / 2)
            xa, xb = sorted((px0, px1)); ya, yb = sorted((py0, py1))
            xa = max(0, int(xa)); xb = min(W, int(xb) + 1)
            ya = max(0, int(ya)); yb = min(H, int(yb) + 1)
            if xb <= xa or yb <= ya:
                continue
            cov = canopy[ya:yb, xa:xb].mean()
            if cov < args.bush_cov:
                continue
            # exclude woods / fairway via mask
            if mask_arr is not None:
                mx, my = mask_to_src(wx, wy)
                mxi, myi = int(mx), int(my)
                if 0 <= myi < mask_arr.shape[0] and 0 <= mxi < mask_arr.shape[1]:
                    cls = mask_arr[myi, mxi]
                    if cls == WOODS or cls == FAIRWAY:
                        continue
            if in_water(wx, wy):
                continue
            kind = "tree" if cov >= args.tree_cov else "bush"
            h = tree_h_units * (0.7 + 0.6 * cov) if kind == "tree" else 0.0  # bush h set in engine
            items.append({"x": round(wx, 1), "y": round(wy, 1),
                          "h": round(h, 1), "kind": kind})

    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "courses", "trees"), exist_ok=True)
    dest = os.path.join(os.path.dirname(__file__), "..", "courses", "trees", args.id + ".json")
    with open(dest, "w") as f:
        json.dump({"id": args.id, "cell": args.cell, "items": items}, f, separators=(",", ":"))
    nt = sum(1 for it in items if it["kind"] == "tree")
    nb = len(items) - nt
    print(f"Wrote {dest}: {nt} trees + {nb} bushes (outside woods/fairway)", flush=True)

    if args.debug:
        dbg = arr.copy()
        dbg[canopy] = dbg[canopy] * 0.4 + np.array([255, 0, 255]) * 0.6
        Image.fromarray(dbg.astype(np.uint8)).save(
            os.path.join(os.path.dirname(__file__), "..", "courses", "img", args.id, "canopy_debug.png"))
        print("wrote canopy_debug.png", flush=True)


if __name__ == "__main__":
    main()
