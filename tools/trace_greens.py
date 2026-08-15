#!/usr/bin/env python3
"""Trace real GREEN and TEE polygons out of a course's baked aerial.

    python3 tools/trace_greens.py --id vesper-country-club
    python3 tools/trace_greens.py --id vesper-country-club --sheet   # verify only
    python3 tools/trace_greens.py --id vesper-country-club --write

Why this exists
---------------
OSM is the source of truth for greens and tees (`fetch_course.py:86` — the
surface mask deliberately has no GREEN class, because a green and a fairway are
both bright, smooth, saturated turf and no *global* classifier separates them).
That fails completely when OSM simply has no greens: Vesper CC maps ONE green
polygon for 18 holes, and it is the practice putting green by the clubhouse.
Without a green polygon `surfaceAt()` never returns "green", so putting, the
contour read, break and the 3D green view are all dead.

The trick that makes imagery work here is the SEED. We are not asking "where are
the greens" — the baker already knows, because each hole line's far end is the
green to a 0.3 yd median (measured against stated yardages). We ask the much
easier question "how far does this turf extend from THIS point", which a bounded
region-grow answers robustly even though the global problem is ill-posed.

Raster -> polygon reuses the pipeline already shipping on Pebble
(`ocean_water_bake.py`): Moore-neighbour boundary tracing + Douglas-Peucker +
`aerial.toWorld`. Imported, not copied — a copy is how a harness ends up testing
code the game no longer runs.

Idempotent: it reads the aerial and the hole tees/pins, so re-running after any
rebake restores the polygons in one command. `verify_course.py` hard-fails when
green count drops below 80% of the hole count, so a rebake that drops them
cannot pass silently.
"""
import argparse, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ocean_water_bake import trace_outline, dp_simplify   # reuse, never copy

try:
    from PIL import Image
except ImportError:
    sys.exit("needs Pillow:  python3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YPU = 3.0                       # yards per world unit (fixed; see fetch_course.py)

# Grow radius. A championship green is ~20-35 yd across, so 30 yd of radius holds
# the biggest with margin while keeping the grow off the next fairway.
GREEN_R_YDS = 30.0
TEE_R_YDS = 14.0                # tee pads are small; a wide radius swallows fairway
# Similarity to the seed patch, in 0..255 per channel. Greens read a touch paler
# and much smoother than the fairway around them; this is the whole separation.
TOL_V = 18.0                    # brightness distance (greens)
# Tee pads are smaller, mown a touch differently and sit against fairway rather
# than against rough, so they need a looser cut than a green does. One shared
# number costs 3 of 18 tees; splitting them costs nothing on the greens.
TOL_TEE = 26.0
TOL_C = 14.0                    # chroma distance (guards against sand + cartpath)
MIN_CELLS = 40                  # smaller than this is noise, not a green
SIMPLIFY_TOL_U = 0.6            # Douglas-Peucker tolerance, world units
DOWN = 2                        # aerial downsample for the grow (speed; ~0.9 m/px)


def load(cid):
    p = os.path.join(ROOT, "courses", cid + ".json")
    with open(p) as f:
        return p, json.load(f)


def grow(px, seed, r_px, tol_v, tol_c, w, h):
    """Flood-fill from `seed` over pixels similar to the seed patch, bounded to
    r_px. Bounded on purpose: the seed is known-correct, so the answer is a local
    extent question, and a radius stops the fill leaking down the fairway."""
    sx, sy = seed
    # seed colour = median of a small patch, so one bright cart or divot cannot set it
    patch = []
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            x, y = sx + dx, sy + dy
            if 0 <= x < w and 0 <= y < h:
                patch.append(px[x, y])
    if not patch:
        return set()
    patch.sort(key=lambda c: c[0] + c[1] + c[2])
    sr, sg, sb = patch[len(patch) // 2]
    sv = (sr + sg + sb) / 3.0

    def ok(c):
        r_, g_, b_ = c
        v = (r_ + g_ + b_) / 3.0
        if abs(v - sv) > tol_v:
            return False
        # chroma difference — keeps sand (warm) and cartpath (grey) out even when
        # they happen to match on brightness
        return (abs((r_ - v) - (sr - sv)) + abs((g_ - v) - (sg - sv))
                + abs((b_ - v) - (sb - sv))) <= tol_c * 3

    out, stack = set(), [(sx, sy)]
    seen = {(sx, sy)}
    r2 = r_px * r_px
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h):
            continue
        if (x - sx) ** 2 + (y - sy) ** 2 > r2:
            continue
        if not ok(px[x, y]):
            continue
        out.add((x, y))
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in seen:
                seen.add((nx, ny))
                stack.append((nx, ny))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--write", action="store_true", help="save into courses/<id>.json")
    ap.add_argument("--sheet", help="contact-sheet path (default: /tmp/<id>-traced.png)")
    ap.add_argument("--green-radius", type=float, default=GREEN_R_YDS)
    ap.add_argument("--tee-radius", type=float, default=TEE_R_YDS)
    ap.add_argument("--tol", type=float, default=TOL_V, help="green colour tolerance")
    ap.add_argument("--tee-tol", type=float, default=TOL_TEE, help="tee colour tolerance")
    args = ap.parse_args()

    path, course = load(args.id)
    aer = course.get("aerial")
    if not aer:
        sys.exit("course has no baked aerial to trace from")
    holes = sorted(course["holes"], key=lambda h: h["num"])

    img = Image.open(os.path.join(ROOT, "courses", aer["file"])).convert("RGB")
    if DOWN > 1:
        img = img.resize((img.width // DOWN, img.height // DOWN), Image.BILINEAR)
    W, H = img.size
    px = img.load()

    a, b_, c_, d_, e_, f_ = aer["toWorld"]
    det = a * e_ - b_ * d_

    def w2p(x, y):      # world -> downsampled pixel
        dx, dy = x - c_, y - f_
        return ((e_ * dx - b_ * dy) / det / DOWN, (a * dy - d_ * dx) / det / DOWN)

    def p2w(p):         # downsampled pixel -> world (cell centre)
        X, Y = p[0] * DOWN + DOWN / 2.0, p[1] * DOWN + DOWN / 2.0
        return [round(a * X + b_ * Y + c_, 2), round(d_ * X + e_ * Y + f_, 2)]

    # world units per downsampled px, for radius conversion
    upp = math.hypot(a, d_) * DOWN

    def trace_at(wx, wy, r_yds, tol_v):
        sx, sy = w2p(wx, wy)
        cells = grow(px, (int(round(sx)), int(round(sy))), (r_yds / YPU) / upp,
                     tol_v, TOL_C, W, H)
        if len(cells) < MIN_CELLS:
            return None, len(cells)
        path_px = trace_outline(cells, W, H)
        if not path_px:
            return None, len(cells)
        poly = dp_simplify([p2w(p) for p in path_px], SIMPLIFY_TOL_U)
        if len(poly) < 3:
            return None, len(cells)
        return poly, len(cells)

    greens, tees, report = [], [], []
    for h in holes:
        gp, gn = trace_at(h["pin"]["x"], h["pin"]["y"], args.green_radius, args.tol)
        tp, tn = trace_at(h["tee"]["x"], h["tee"]["y"], args.tee_radius, args.tee_tol)
        if gp:
            greens.append([{"x": p[0], "y": p[1]} for p in gp])
        if tp:
            tees.append([{"x": p[0], "y": p[1]} for p in tp])
        area = lambda P: abs(sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1]
                                 for i in range(len(P)))) / 2.0
        report.append((h["num"], len(gp) if gp else 0, area(gp) * YPU * YPU if gp else 0,
                       len(tp) if tp else 0, area(tp) * YPU * YPU if tp else 0))

    print(f"{'hole':>4} {'green pts':>9} {'green yd2':>10} {'tee pts':>8} {'tee yd2':>8}")
    for n, gpts, ga, tpts, ta in report:
        flag = "" if gpts else "   <== NO GREEN"
        print(f"{n:>4} {gpts:>9} {ga:>10.0f} {tpts:>8} {ta:>8.0f}{flag}")
    print(f"\ntraced {len(greens)}/{len(holes)} greens, {len(tees)}/{len(holes)} tees")

    sheet = args.sheet or f"/tmp/{args.id}-traced.png"
    make_sheet(img, holes, greens, tees, w2p, sheet)
    print("contact sheet ->", sheet)

    if args.write:
        course["surfaces"]["green"] = greens
        course["surfaces"]["tee"] = tees
        with open(path, "w") as f:
            json.dump(course, f, separators=(",", ":"))
        print("wrote", path)
    else:
        print("(dry run — pass --write to save)")


def make_sheet(img, holes, greens, tees, w2p, out):
    """Every traced outline over its own crop. These get EYEBALLED before they
    ship — a bad grow must be visible, not silently written."""
    from PIL import ImageDraw
    CELL, R = 300, 150
    cols = 6
    rows = (len(holes) + cols - 1) // cols
    sheet = Image.new("RGB", (CELL * cols, CELL * rows), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for i, h in enumerate(holes):
        cx, cy = w2p(h["pin"]["x"], h["pin"]["y"])
        crop = img.crop((int(cx - R), int(cy - R), int(cx + R), int(cy + R))).resize((CELL, CELL))
        ox, oy = (i % cols) * CELL, (i // cols) * CELL
        sheet.paste(crop, (ox, oy))
        g = greens[i] if i < len(greens) else None
        if g:
            pts = []
            for q in g:
                qx, qy = w2p(q["x"], q["y"])
                pts.append((ox + (qx - cx + R) * CELL / (2 * R), oy + (qy - cy + R) * CELL / (2 * R)))
            if len(pts) >= 2:
                dr.line(pts + [pts[0]], fill=(255, 40, 40), width=3)
        dr.text((ox + 6, oy + 6), f"H{h['num']}", fill=(255, 255, 0))
    sheet.save(out)


if __name__ == "__main__":
    main()
