#!/usr/bin/env python3
"""Bake OCEAN water polygons into a coastal course JSON from its aerial.

Why: OSM maps the Pacific as natural=coastline, which fetch_course.py never
collects (it queries golf=water_hazard + natural=water), and the surface mask
has no water class — so at Pebble Beach the ocean inside the playing envelope
classified as ROUGH: a ball hit into Stillwater Cove got a playable lie, no
penalty, and state.lastSafe banked IN the ocean. surfaceAt() tests
surfaces.water FIRST, so appending real ocean polygons fixes penalty, splash,
toast and drop with zero engine change.

How: classify blue-dominant pixels on the baked aerial (downsampled), keep
large/border-touching components (the ocean, not ponds — existing mapped water
is left alone), trace each component's outline with a marching-squares walk,
simplify with Douglas-Peucker, convert px -> world via aerial.toWorld.

NOTE a course re-bake (fetch_course_global.py) rewrites surfaces.water and
drops these polygons — just re-run this tool afterwards.

Usage:
  python3 tools/ocean_water_bake.py --id pebble-beach-golf-course [--dry-run] [--force]
"""
import argparse, json, os, shutil, sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow required: python3 -m pip install --user --break-system-packages pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWN = 4            # classify at 1/4 resolution (speed; ~1.1u/px at Pebble)
MIN_AREA_PX = 400   # component floor at DOWN res (~500 sq units) — skips ponds
SIMPLIFY_TOL = 2.0  # Douglas-Peucker tolerance, world units
MAX_PTS_TOTAL = 400


def is_ocean_px(r, g, b):
    # Blue-dominant + not too bright (surf foam picked up via closing instead).
    return b > r + 12 and b > g + 4 and b > 40 and r < 150


def classify(img):
    w, h = img.size
    px = img.load()
    m = [[False] * w for _ in range(h)]
    for y in range(h):
        row = m[y]
        for x in range(w):
            r, g, b = px[x, y][:3]
            row[x] = is_ocean_px(r, g, b)
    return m


def morph(m, w, h, radius, want):
    """Dilate (want=True) or erode (want=False) with a square kernel."""
    out = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            hit = not want
            for dy in range(-radius, radius + 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in range(-radius, radius + 1):
                    xx = x + dx
                    if 0 <= xx < w and m[yy][xx] == want:
                        hit = want
                        break
                if hit == want:
                    break
            out[y][x] = hit
    return out


def components(m, w, h):
    seen = [[False] * w for _ in range(h)]
    comps = []
    for y0 in range(h):
        for x0 in range(w):
            if not m[y0][x0] or seen[y0][x0]:
                continue
            stack = [(x0, y0)]
            seen[y0][x0] = True
            cells = []
            border = False
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                if x in (0, w - 1) or y in (0, h - 1):
                    border = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and m[yy][xx] and not seen[yy][xx]:
                        seen[yy][xx] = True
                        stack.append((xx, yy))
            comps.append({"cells": cells, "border": border})
    return comps


def trace_outline(cells, w, h):
    """Moore-neighbour boundary tracing: ordered, closed, non-self-intersecting
    outer outline of a connected component. (A nearest-neighbour point walk was
    tried first and its closure edge cut ACROSS the course — the even-odd fill
    then flagged fairways as ocean.)"""
    cs = set(cells)
    dirs = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    start = min(cells, key=lambda c: (c[1], c[0]))   # top-most, then left-most
    cur = start
    backtrack = (start[0] - 1, start[1])             # empty by construction
    boundary = [start]
    for _ in range(300000):
        bi = dirs.index((backtrack[0] - cur[0], backtrack[1] - cur[1]))
        found = None
        for k in range(1, 9):
            d = dirs[(bi + k) % 8]
            nxt = (cur[0] + d[0], cur[1] + d[1])
            if nxt in cs:
                found = nxt
                pd = dirs[(bi + k - 1) % 8]
                backtrack = (cur[0] + pd[0], cur[1] + pd[1])
                break
        if not found:
            break                                    # isolated cell
        cur = found
        if cur == start and len(boundary) > 2:
            break
        boundary.append(cur)
    return boundary if len(boundary) >= 3 else None


def dp_simplify(pts, tol):
    if len(pts) < 3:
        return pts
    def seg_d(p, a, b):
        ax, ay = a; bx, by = b; px, py = p
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0:
            return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
        qx, qy = ax + t * dx, ay + t * dy
        return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5
    def rec(lo, hi):
        if hi <= lo + 1:
            return [pts[lo]]
        dmax, imax = -1, lo
        for i in range(lo + 1, hi):
            d = seg_d(pts[i], pts[lo], pts[hi])
            if d > dmax:
                dmax, imax = d, i
        if dmax <= tol:
            return [pts[lo]]
        return rec(lo, imax) + rec(imax, hi)
    out = rec(0, len(pts) - 1) + [pts[-1]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", default="pebble-beach-golf-course")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    jpath = os.path.join(ROOT, "courses", f"{args.id}.json")
    course = json.load(open(jpath))
    aer = course.get("aerial")
    if not aer or not aer.get("file"):
        sys.exit("course has no aerial")
    water = course["surfaces"].setdefault("water", [])
    if len(water) > 1 and not args.force:
        sys.exit(f"surfaces.water already has {len(water)} polys — baked before? (--force to redo)")

    img = Image.open(os.path.join(ROOT, "courses", aer["file"])).convert("RGB")
    w0, h0 = img.size
    img = img.resize((w0 // DOWN, h0 // DOWN))
    w, h = img.size
    m = classify(img)
    # close (fill surf/foam) then open (drop speckle)
    m = morph(morph(m, w, h, 1, True), w, h, 1, False)
    comps = [c for c in components(m, w, h)
             if len(c["cells"]) >= MIN_AREA_PX and c["border"]]
    print(f"aerial {w0}x{h0} → {w}x{h}; ocean components kept: "
          f"{[(len(c['cells']), 'border' if c['border'] else 'inner') for c in comps]}")

    a, b_, c_, d_, e_, f_ = aer["toWorld"]
    def to_world(p):
        px, py = p[0] * DOWN + DOWN / 2, p[1] * DOWN + DOWN / 2
        return [round(a * px + b_ * py + c_, 1), round(d_ * px + e_ * py + f_, 1)]

    polys = []
    for comp in comps:
        path = trace_outline(comp["cells"], w, h)
        if not path:
            continue
        wpts = [to_world(p) for p in path]
        wpts = dp_simplify(wpts, SIMPLIFY_TOL)
        if len(wpts) >= 3:
            polys.append([{"x": p[0], "y": p[1]} for p in wpts])
    total = sum(len(p) for p in polys)
    while total > MAX_PTS_TOTAL:   # coarsen until under budget
        polys = [p[::2] if len(p) > 24 else p for p in polys]
        t2 = sum(len(p) for p in polys)
        if t2 == total:
            break
        total = t2
    print(f"ocean polys: {len(polys)}, total points {total}")

    # sanity table: known points must classify correctly through the NEW polys
    def in_poly(x, y, poly):
        inside = False
        j = len(poly) - 1
        for i in range(len(poly)):
            xi, yi = poly[i]["x"], poly[i]["y"]
            xj, yj = poly[j]["x"], poly[j]["y"]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside
    def hits(x, y):
        return any(in_poly(x, y, p) for p in polys)
    ok = True
    for hnum, hole in enumerate(course.get("holes", []), 1):
        for key in ("pin", "tee"):
            pt = hole.get(key)
            if pt and hits(pt["x"], pt["y"]):
                print(f"  FAIL hole {hnum} {key} inside ocean poly!")
                ok = False
    # Real play surfaces must stay dry. (NOT the straight tee->pin chord — at
    # Pebble h8/h18 that line legitimately crosses the cove; the fairway bends
    # around it.) Centroid used only when it falls inside its own polygon
    # (crescent fairways can have an external centroid).
    bad = 0
    for kind in ("fairway", "green", "tee"):
        for poly in course["surfaces"].get(kind, []):
            cx = sum(q["x"] for q in poly) / len(poly)
            cy = sum(q["y"] for q in poly) / len(poly)
            if not in_poly(cx, cy, poly):
                continue
            if hits(cx, cy):
                print(f"  FAIL {kind} centroid ({cx:.0f},{cy:.0f}) inside ocean poly!")
                bad += 1
    if bad:
        ok = False
    print("tee/pin + play-surface containment check:", "PASS" if ok else "FAIL")
    if not ok:
        sys.exit("refusing to write — polys cover play points")

    if args.dry_run:
        print("--dry-run: not writing")
        return
    shutil.copy(jpath, jpath + ".bak")
    water.extend(polys)
    json.dump(course, open(jpath, "w"), separators=(",", ":"))
    print(f"wrote {jpath} (+{len(polys)} water polys; backup at .bak)")


if __name__ == "__main__":
    main()
