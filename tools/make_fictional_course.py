#!/usr/bin/env python3
"""Generate 'Blackwater Vale' — a fictional championship course — as
courses/blackwater-vale.json (global format, vector-render, no aerial).

Fully spec-driven: hole centerlines are hand-authored waypoints in one shared
world coordinate space; fairway/rough ribbons, green blobs, tees, bunkers,
water and the OB boundary hull are generated deterministically from the spec.
Centerlines are scaled about the tee so measured length hits each hole's
target yardage exactly (yards = arc length x 3).

Usage:
  python3 tools/make_fictional_course.py [--svg /path/debug.svg]

Stdlib only. Deterministic (hash-noise, no random module state).
"""
import argparse
import json
import math
import os

try:
    # optional — only needed for --aerial-base compositing
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    Image = ImageDraw = ImageFilter = None

YARDS_PER_UNIT = 3.0
WORLD = {"w": 940, "h": 740}

# ---------------------------------------------------------------- helpers

def frac_hash(a, b):
    """Deterministic 0..1 noise, same flavor as game.js hashSeed."""
    s = math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return s - math.floor(s)


def catmull_rom(pts, per_seg=16):
    """Smooth polyline through waypoints (endpoint-clamped Catmull-Rom)."""
    if len(pts) < 3:
        # densify straight line so downstream frac sampling stays smooth
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        return [(x0 + (x1 - x0) * i / 24.0, y0 + (y1 - y0) * i / 24.0) for i in range(25)]
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(per_seg):
            t = k / float(per_seg)
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(p[-2])
    return out


def polyline_length(line):
    return sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
               for i in range(len(line) - 1))


def point_at(line, frac):
    """Point + unit direction at arc-length fraction frac of the polyline."""
    total = polyline_length(line)
    target = max(0.0, min(1.0, frac)) * total
    run = 0.0
    for i in range(len(line) - 1):
        seg = math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
        if run + seg >= target or i == len(line) - 2:
            t = 0.0 if seg == 0 else (target - run) / seg
            x = line[i][0] + (line[i + 1][0] - line[i][0]) * t
            y = line[i][1] + (line[i + 1][1] - line[i][1]) * t
            d = (line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
            m = math.hypot(*d) or 1.0
            return (x, y), (d[0] / m, d[1] / m)
        run += seg
    (x, y) = line[-1]
    return (x, y), (0.0, -1.0)


def width_at(profile, frac):
    """profile = [(frac, halfwidth), ...] sorted; linear interp."""
    if frac <= profile[0][0]:
        return profile[0][1]
    for i in range(len(profile) - 1):
        a, b = profile[i], profile[i + 1]
        if frac <= b[0]:
            t = (frac - a[0]) / (b[0] - a[0] or 1)
            return a[1] + (b[1] - a[1]) * t
    return profile[-1][1]


def ribbon(line, profile, jitter=0.10, seed=0.0, n=44):
    """Variable-width band around a centerline -> closed polygon."""
    left, right = [], []
    for i in range(n + 1):
        f = i / float(n)
        (x, y), (dx, dy) = point_at(line, f)
        w = width_at(profile, f)
        w *= 1.0 + jitter * math.sin(f * 19.0 + seed * 6.2831) \
                 + 0.5 * jitter * math.sin(f * 47.0 + seed * 12.7)
        px, py = -dy, dx  # right-hand perpendicular (y-down)
        left.append((x - px * w, y - py * w))
        right.append((x + px * w, y + py * w))
    return left + right[::-1]


def blob(cx, cy, rx, ry, rot=0.0, seed=0.0, n=16, irr=0.16):
    """Irregular ellipse (radial hash noise)."""
    pts = []
    c, s = math.cos(rot), math.sin(rot)
    for i in range(n):
        a = i * 2 * math.pi / n
        r = 1.0 + irr * (frac_hash(seed + i * 3.7, seed * 1.3 + i) - 0.5) * 2
        ex, ey = math.cos(a) * rx * r, math.sin(a) * ry * r
        pts.append((cx + ex * c - ey * s, cy + ex * s + ey * c))
    return pts


def moat(cx, cy, inner, width, open_dir, open_span_deg=95, n=40):
    """C-shaped water ring around a green: open arc faces open_dir (radians)."""
    half = math.radians(open_span_deg) / 2.0
    a0, a1 = open_dir + half, open_dir + 2 * math.pi - half
    outer_pts, inner_pts = [], []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        wob = 1.0 + 0.08 * math.sin(a * 3 + cx)
        outer_pts.append((cx + math.cos(a) * (inner + width) * wob,
                          cy + math.sin(a) * (inner + width) * wob))
        inner_pts.append((cx + math.cos(a) * inner, cy + math.sin(a) * inner))
    return outer_pts + inner_pts[::-1]


def rect_at(cx, cy, dx, dy, half_along, half_across):
    px, py = -dy, dx
    return [(cx - dx * half_along - px * half_across, cy - dy * half_along - py * half_across),
            (cx + dx * half_along - px * half_across, cy + dy * half_along - py * half_across),
            (cx + dx * half_along + px * half_across, cy + dy * half_along + py * half_across),
            (cx - dx * half_along + px * half_across, cy - dy * half_along + py * half_across)]


def convex_hull(points):
    pts = sorted(set((round(x, 3), round(y, 3)) for x, y in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def dilate(poly, margin):
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    out = []
    for x, y in poly:
        d = math.hypot(x - cx, y - cy) or 1.0
        out.append((x + (x - cx) / d * margin, y + (y - cy) / d * margin))
    return out


def rnd(poly):
    return [{"x": round(x, 2), "y": round(y, 2)} for x, y in poly]


def pip(x, y, poly):
    """Ray-cast point-in-polygon (matches game.js pointInPoly)."""
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------- course spec
# Waypoints hand-routed in world units (1u = 3yds), origin top-left.
# Front nine ("The Vale") loops the west half; back nine ("The Spine") the east.
# fw = [(frac, halfwidth)] width profile; None = no fairway (pure-carry par 3).
# bunkers = [(frac, side, rx, ry)] — side: +right / -left of play direction.
HOLES = [
    dict(num=1, par=4, yards=462, si=13, green_r=(8.5, 7.5),
         wpts=[(448, 600), (360, 585), (295, 570)],
         fw=[(0.08, 7), (0.5, 7.5), (0.85, 6), (1.0, 5)],
         bunkers=[(0.52, -11, 5, 3.4), (0.58, -13, 4.4, 3), (0.47, -12, 3.6, 2.6),
                  (0.97, 10, 4, 3)]),
    dict(num=2, par=5, yards=618, si=5, green_r=(8, 8.5),
         wpts=[(275, 575), (215, 550), (165, 500), (138, 430)],
         fw=[(0.06, 7), (0.4, 6.5), (0.55, 5), (0.75, 6.5), (1.0, 5)],
         bunkers=[(0.38, 10, 5, 3.4), (0.62, -9, 4.6, 3.2), (0.95, -10, 4, 3)]),
    dict(num=3, par=3, yards=247, si=11, green_r=(5.5, 10),
         wpts=[(128, 410), (98, 332)],
         fw=[(0.3, 4), (0.85, 4.5), (1.0, 3.5)],
         bunkers=[(0.96, -9, 3.6, 5.5), (0.96, 9, 3.6, 5.5)]),
    dict(num=4, par=4, yards=495, si=1, green_r=(8, 8), green_speed=13.5,
         wpts=[(95, 308), (108, 228), (128, 148)],
         fw=[(0.07, 6.5), (0.5, 6), (1.0, 5)],
         bunkers=[(0.5, 10, 5, 3.4), (0.94, 10, 4.4, 3.2)]),
    dict(num=5, par=4, yards=438, si=9, green_r=(7.5, 7.5),
         wpts=[(140, 125), (215, 105), (262, 48)],
         fw=[(0.08, 6), (0.45, 5), (0.75, 5.5), (1.0, 4.5)],
         bunkers=[(0.5, 9, 4.6, 3.2), (0.93, -8, 3.8, 3)]),
    dict(num=6, par=5, yards=585, si=7, green_r=(7, 7),
         wpts=[(278, 42), (355, 60), (432, 82), (462, 102)],
         fw=[(0.06, 7), (0.5, 6.5), (0.8, 5), (0.95, 4)],
         bunkers=[(0.55, -9, 4.8, 3.2), (0.55, 10, 4.4, 3)]),
    dict(num=7, par=3, yards=152, si=17, green_r=(5.5, 5.5), green_speed=14.5,
         wpts=[(485, 135), (523, 168)],
         fw=None,
         bunkers=[(0.88, -8, 3, 2.4)]),
    dict(num=8, par=4, yards=505, si=3, green_r=(8, 9),
         wpts=[(552, 195), (530, 280), (516, 362)],
         fw=[(0.07, 7), (0.42, 6), (0.55, 5), (0.68, 6), (1.0, 5.5)],
         bunkers=[(0.44, -7, 8, 4), (0.6, 7, 8, 4), (0.95, -10, 4, 3)]),
    dict(num=9, par=4, yards=447, si=15, green_r=(8.5, 8), green_speed=14,
         wpts=[(510, 385), (488, 455), (470, 525)],
         fw=[(0.08, 6.5), (0.5, 6), (1.0, 5)],
         bunkers=[(0.9, -10, 4.4, 3.4), (0.92, 10, 4.4, 3.4), (0.8, 0, 3.4, 2.6)]),
    dict(num=10, par=4, yards=483, si=10, green_r=(8, 8),
         wpts=[(555, 545), (585, 470), (610, 395)],
         fw=[(0.07, 7), (0.5, 6.5), (1.0, 5)],
         bunkers=[(0.5, 10, 5, 3.4), (0.56, 12, 4.2, 3), (0.44, 11, 3.6, 2.6)]),
    dict(num=11, par=3, yards=238, si=16, green_r=(7, 8),
         wpts=[(618, 372), (640, 296)],
         fw=None,
         bunkers=[(0.5, 0, 13, 7), (0.78, 6, 5, 3.4)]),
    dict(num=12, par=5, yards=641, si=2, green_r=(7.5, 8.5),
         wpts=[(645, 272), (660, 190), (700, 125), (740, 95)],
         fw=[(0.05, 7.5), (0.35, 6.5), (0.45, 5), (0.65, 6), (0.75, 4.5), (1.0, 4.5)],
         bunkers=[(0.4, -9, 5, 3.4), (0.42, 9, 4, 3), (0.68, 8, 4.6, 3.2),
                  (0.72, -8, 4.2, 3), (0.95, 9, 4, 3)]),
    dict(num=13, par=4, yards=455, si=8, green_r=(8, 8),
         wpts=[(762, 105), (795, 175), (820, 245)],
         fw=[(0.07, 6.5), (0.45, 9.5), (0.62, 9.5), (0.8, 6), (1.0, 5)],
         bunkers=[(0.5, 0, 4.5, 7), (0.94, -9, 4, 3)]),
    dict(num=14, par=4, yards=428, si=12, green_r=(8.5, 8.5), green_speed=14,
         wpts=[(825, 270), (838, 345), (842, 415)],
         fw=[(0.08, 6.5), (0.5, 6), (1.0, 5)],
         bunkers=[(0.9, -9, 3.4, 2.6), (0.93, 9, 3.4, 2.6), (0.98, 0, 3, 2.4)]),
    dict(num=15, par=5, yards=592, si=4, green_r=(7.5, 8),
         wpts=[(848, 438), (825, 510), (800, 585), (788, 625)],
         fw=[(0.06, 7), (0.5, 6.5), (0.78, 5), (0.95, 4.5)],
         bunkers=[(0.55, -9, 5, 3.4), (0.85, 8, 4.2, 3)]),
    dict(num=16, par=4, yards=468, si=6, green_r=(8, 9.5),
         wpts=[(768, 638), (690, 620), (615, 605)],
         fw=[(0.07, 6.5), (0.45, 5.5), (0.6, 4.2), (0.8, 5.5), (1.0, 5)],
         bunkers=[(0.93, 0, 5, 3), (0.6, -8, 4, 3)]),
    dict(num=17, par=3, yards=224, si=18, green_r=(7, 7.5),
         wpts=[(568, 645), (505, 685)],
         fw=None,
         bunkers=[(0.9, 9, 3.6, 2.8)]),
    dict(num=18, par=4, yards=502, si=14, green_r=(8, 8.5),
         wpts=[(472, 695), (505, 610), (525, 532)],
         fw=[(0.07, 7), (0.5, 6), (1.0, 5)],
         bunkers=[(0.55, 9, 5, 3.4), (0.93, 9, 4.4, 3.2)]),
]

# Real lakes in the base aerial (Superior NF patch) — matching water polygons
# so what LOOKS like water in the photo also plays as water: (cx, cy, rx, ry).
ABS_WATER = [
    (382, 380, 45, 50),   # the big blackwater lake inside the front-nine loop
    (38, 205, 28, 48),    # western lake beyond hole 4's designed lake
]

# Water anchored to holes: (hole num, frac, side, rx, ry) blobs, plus specials.
# side must exceed ry (blob half-width across play) + the local fairway/green
# half-width, or the blob spills onto the playing surface — the audit checks.
WATER_BLOBS = [
    (4, 0.5, -19, 75, 9),     # Black Lake: hugs 4's left edge (long axis along play)
    (6, 1.0, -32, 26, 14),    # lake body NE of 6's peninsula green, beyond the moat
    (15, 0.93, 17, 10, 9),    # pond guarding 15's approach, short-right
    (17, 0.5, 0, 15, 10),     # lake arm 17 carries
    (18, 0.45, -16, 48, 7),   # lake down 18's left (long axis along play)
]
MOATS = [  # (hole num, width, open_span_deg) — opening faces the approach
    (6, 13, 105),
    (7, 11, 120),
]
CREEKS = [(2, 0.70, 24, 4.5)]  # (hole, frac, half length across, half width)

WOODS = [  # (cx, cy, rx, ry) pine blocks in the dead ground between corridors
    (200, 655, 45, 24), (245, 480, 38, 30), (185, 300, 28, 38),
    (330, 300, 58, 44), (420, 300, 36, 46), (90, 600, 38, 48),
    (300, 682, 55, 18), (570, 55, 26, 20), (690, 215, 20, 16),
    (745, 400, 30, 26), (700, 545, 24, 20), (875, 560, 18, 40),
    (870, 120, 22, 26), (620, 690, 45, 16),
]
GRASS = [(470, 578, 26, 20)]  # clubhouse lawn


def build():
    surfaces = {k: [] for k in
                ("green", "fairway", "tee", "bunker", "water", "rough",
                 "woods", "cartpath", "grass")}
    holes_json = []
    lines = {}
    report = []

    for spec in HOLES:
        n = spec["num"]
        target_u = spec["yards"] / YARDS_PER_UNIT
        raw = catmull_rom(spec["wpts"])
        # scale about the tee so arc length == target yardage exactly
        scale = target_u / polyline_length(raw)
        tee0 = raw[0]
        line = [(tee0[0] + (x - tee0[0]) * scale, tee0[1] + (y - tee0[1]) * scale)
                for x, y in raw]
        lines[n] = line
        (gx, gy), (gdx, gdy) = point_at(line, 1.0)
        (tx, ty), (tdx, tdy) = point_at(line, 0.0)
        r_along, r_perp = spec["green_r"]
        grot = math.atan2(gdy, gdx)

        # rough band then fairway ribbon (rough halfwidth = fw + 8)
        fw = spec["fw"]
        if fw:
            rough_prof = [(f, w + 8) for f, w in fw]
            surfaces["rough"].append(ribbon(line, rough_prof, jitter=0.08, seed=n * 0.31))
            surfaces["fairway"].append(ribbon(line, fw, jitter=0.10, seed=n * 0.77))
        else:
            surfaces["rough"].append(ribbon(line, [(0.0, 9), (1.0, 11)],
                                            jitter=0.08, seed=n * 0.31))

        surfaces["green"].append(blob(gx, gy, r_along, r_perp, rot=grot + math.pi / 2,
                                      seed=n * 2.1, irr=0.13))
        surfaces["tee"].append(rect_at(tx, ty, tdx, tdy, 4.0, 2.2))

        for (f, side, rx, ry) in spec["bunkers"]:
            (bx, by), (bdx, bdy) = point_at(line, f)
            px, py = -bdy, bdx
            surfaces["bunker"].append(blob(bx + px * side, by + py * side, rx, ry,
                                           rot=math.atan2(bdy, bdx),
                                           seed=n * 5.3 + f * 17, irr=0.2))

        # pins: front / middle / back along the approach axis
        off = r_along * 0.42
        pins = [
            {"x": round(gx - gdx * off, 2), "y": round(gy - gdy * off, 2), "name": "front"},
            {"x": round(gx, 2), "y": round(gy, 2), "name": "middle"},
            {"x": round(gx + gdx * off, 2), "y": round(gy + gdy * off, 2), "name": "back"},
        ]
        rec = {
            "num": n, "par": spec["par"], "yards": spec["yards"], "si": spec["si"],
            "tee": {"x": round(tx, 2), "y": round(ty, 2)},
            "pin": {"x": round(gx, 2), "y": round(gy, 2)},
            "pins": pins,
        }
        if spec.get("green_speed"):
            rec["greenSpeed"] = spec["green_speed"]
        holes_json.append(rec)
        report.append((n, spec["par"], spec["yards"],
                       round(polyline_length(line) * YARDS_PER_UNIT)))

    # absolute water (real lakes in the aerial base) — physics only; the bake
    # does NOT paint these (the photo already shows them). Kept FIRST in the
    # water list, and inset well inside the visible shoreline so the game's
    # blue water tint reads as lake depth, never spills onto trees. The shore
    # strip plays as rough — generous, and only reachable when badly offline.
    for (cx, cy, rx, ry) in ABS_WATER:
        surfaces["water"].append(blob(cx, cy, rx, ry, seed=cx * 0.7 + cy,
                                      irr=0.06, n=24))
    # anchored water
    for (hn, f, side, rx, ry) in WATER_BLOBS:
        line = lines[hn]
        (x, y), (dx, dy) = point_at(line, f)
        px, py = -dy, dx
        surfaces["water"].append(blob(x + px * side, y + py * side, rx, ry,
                                      rot=math.atan2(dy, dx), seed=hn * 3.7, irr=0.14))
    for (hn, width, span) in MOATS:
        line = lines[hn]
        (gx, gy), (gdx, gdy) = point_at(line, 1.0)
        r_along, r_perp = HOLES[hn - 1]["green_r"]
        inner = max(r_along, r_perp) * 1.18 + 1.5   # fringe so water never overlaps green
        open_dir = math.atan2(-gdy, -gdx)           # opening faces back down the hole
        surfaces["water"].append(moat(gx, gy, inner, width, open_dir, span))
    for (hn, f, half_len, half_w) in CREEKS:
        line = lines[hn]
        (x, y), (dx, dy) = point_at(line, f)
        px, py = -dy, dx  # creek runs across the corridor
        wig = [(x + px * t * half_len +
                dx * math.sin(t * 4.2 + hn) * half_w * 1.6,
                y + py * t * half_len +
                dy * math.sin(t * 4.2 + hn) * half_w * 1.6)
               for t in [i / 8.0 * 2 - 1 for i in range(9)]]
        surfaces["water"].append(ribbon(wig, [(0.0, half_w * 0.7), (0.5, half_w),
                                              (1.0, half_w * 0.8)],
                                        jitter=0.15, seed=hn * 1.9, n=24))

    for (cx, cy, rx, ry) in WOODS:
        surfaces["woods"].append(blob(cx, cy, rx, ry, seed=cx * 0.13 + cy, irr=0.22, n=18))
    for (cx, cy, rx, ry) in GRASS:
        surfaces["grass"].append(blob(cx, cy, rx, ry, seed=9.1, irr=0.1))

    # cartpath: thread green -> next tee
    for i in range(len(HOLES)):
        (gx, gy), _ = point_at(lines[HOLES[i]["num"]], 1.0)
        nxt = holes_json[(i + 1) % 18]["tee"]
        surfaces["cartpath"].append([(gx, gy), ((gx + nxt["x"]) / 2 + 3, (gy + nxt["y"]) / 2 + 3),
                                     (nxt["x"], nxt["y"])])

    # OB boundary: dilated convex hull of every play surface
    all_pts = []
    for key in ("fairway", "rough", "green", "tee", "bunker", "water"):
        for poly in surfaces[key]:
            all_pts.extend(poly)
    boundary = dilate(convex_hull(all_pts), 14)

    # corridor spacing audit (non-consecutive holes closer than 22u get flagged)
    warn = []
    for i in range(len(HOLES)):
        for j in range(i + 1, len(HOLES)):
            if j == i + 1:
                continue
            a, b = lines[HOLES[i]["num"]], lines[HOLES[j]["num"]]
            dmin = min(math.hypot(p[0] - q[0], p[1] - q[1])
                       for p in a[::4] for q in b[::4])
            if dmin < 22:
                warn.append("holes %d and %d corridors only %.1f units apart"
                            % (HOLES[i]["num"], HOLES[j]["num"], dmin))

    # water-overlap audit: no green/tee point (or green interior) may sit in
    # water, and no water other than a creek may cross a fairway centerline.
    n_creek = len(CREEKS)
    for gi, green in enumerate(surfaces["green"]):
        bbx = [p[0] for p in green]; bby = [p[1] for p in green]
        cx, cy = sum(bbx) / len(bbx), sum(bby) / len(bby)
        probes = list(green) + [(cx, cy)] + \
                 [((x + cx) / 2, (y + cy) / 2) for x, y in green]
        for w in surfaces["water"]:
            if any(pip(x, y, w) for x, y in probes):
                warn.append("water overlaps green of hole %d" % HOLES[gi]["num"])
                break
    for ti, tee in enumerate(surfaces["tee"]):
        for w in surfaces["water"]:
            if any(pip(x, y, w) for x, y in tee):
                warn.append("water overlaps tee of hole %d" % HOLES[ti]["num"])
                break
    non_creek = surfaces["water"][:-n_creek] if n_creek else surfaces["water"]
    for spec in HOLES:
        if not spec["fw"]:
            continue
        line = lines[spec["num"]]
        for k in range(0, len(line), 3):
            x, y = line[k]
            if any(pip(x, y, w) for w in non_creek):
                warn.append("water crosses fairway centerline of hole %d" % spec["num"])
                break

    course = {
        "id": "blackwater-vale",
        "name": "Blackwater Vale",
        "global": True,
        "yardsPerUnit": YARDS_PER_UNIT,
        "world": WORLD,
        "greenSpeed": 13.5,
        "greenTopo": {"tiltMul": 1.35, "undAmp": 1.7, "lobes": 3},
        "boundary": [rnd(boundary)],
        "surfaces": {k: [rnd(p) for p in v] for k, v in surfaces.items()},
        "holes": holes_json,
    }
    return course, report, warn, lines


SVG_FILL = {"rough": "#2c6e30", "fairway": "#4eb053", "tee": "#5cbf61",
            "bunker": "#e8d9a8", "water": "#2a86d4", "woods": "#274d2b",
            "green": "#8fd095", "grass": "#3a9440"}


# ------------------------------------------------------------- aerial bake
# Composite the course into a real aerial photo (any forest patch downloaded
# from Esri World Imagery) so the game can render it in photoreal mode. The
# base photo supplies the setting (real pine/lakes/texture); we "carve" the
# playing surfaces into it with feathered, texture-modulated paint. Colors are
# kept a touch muted — the game's processAerial() grades every aerial
# (saturate 1.35 + green wash) at load.

def _mask(size):
    return Image.new("L", size, 0)


def _pt(p):
    return (p["x"], p["y"]) if isinstance(p, dict) else (p[0], p[1])


def _draw_polys(mask, polys, scale, fill=255):
    d = ImageDraw.Draw(mask)
    for poly in polys:
        pts = [_pt(p) for p in poly]
        d.polygon([(x * scale, y * scale) for x, y in pts], fill=fill)


def _sub_ribbon(line, profile, f0, f1, n=6):
    left, right = [], []
    for i in range(n + 1):
        f = f0 + (f1 - f0) * i / n
        (x, y), (dx, dy) = point_at(line, f)
        w = width_at(profile, f)
        px, py = -dy, dx
        left.append((x - px * w, y - py * w))
        right.append((x + px * w, y + py * w))
    return left + right[::-1]


def bake_aerial(course, lines, base_path, out_path):
    base = Image.open(base_path).convert("RGB")
    W, H = base.size
    scale = W / float(course["world"]["w"])
    S = course["surfaces"]
    unit = scale  # px per world unit

    def paint(mask_polys, rgb, feather, opacity, noise_sigma=9):
        """Blend a flat-ish color into `base` through a feathered polygon mask,
        modulated by the underlying photo's texture so it sits in the scene."""
        mask = _mask((W, H))
        _draw_polys(mask, mask_polys, scale)
        mask = mask.filter(ImageFilter.GaussianBlur(feather * unit))
        mask = mask.point(lambda v: int(v * opacity / 255))
        color = Image.new("RGB", (W, H), rgb)
        if noise_sigma:
            noise = Image.effect_noise((W, H), noise_sigma).filter(
                ImageFilter.GaussianBlur(0.6))
            color = Image.composite(
                Image.blend(color, Image.new("RGB", (W, H), (0, 0, 0)), 0.18),
                Image.blend(color, Image.new("RGB", (W, H), (255, 255, 255)), 0.10),
                noise)
        # let the real ground texture (blurred luminance) show through the paint
        lum = base.convert("L").filter(ImageFilter.GaussianBlur(1.2))
        lum = lum.point(lambda v: min(255, int(150 + v * 0.9)))  # 0.59..1.5 gain
        color = Image.composite(color, color.point(lambda v: int(v * 0.55)),
                                lum)
        base.paste(color, (0, 0), mask)

    # rough band under everything (slightly wild, low opacity keeps ground detail)
    paint(S["grass"], (96, 122, 64), 1.6, 220, 11)
    paint(S["rough"], (82, 110, 58), 1.4, 170, 12)
    # fairways with mow stripes
    paint(S["fairway"], (112, 148, 70), 0.8, 250, 9)
    for spec in HOLES:
        if not spec["fw"]:
            continue
        line = lines[spec["num"]]
        total = polyline_length(line)
        band = 7.0 / total  # stripe every ~7 world units
        f = 0.0
        i = 0
        stripes_l, stripes_d = [], []
        while f < 1.0:
            f1 = min(1.0, f + band)
            (stripes_l if i % 2 == 0 else stripes_d).append(
                _sub_ribbon(line, spec["fw"], f, f1))
            f = f1
            i += 1
        paint(stripes_l, (122, 158, 76), 0.5, 105, 7)
        paint(stripes_d, (103, 138, 66), 0.5, 95, 7)
    paint(S["tee"], (120, 158, 78), 0.4, 250, 7)
    # greens: bright, smooth, tight feather
    paint(S["green"], (138, 172, 88), 0.5, 255, 5)
    # bunkers: sand with a softly darker rim (mask blur eats the edge)
    paint(S["bunker"], (188, 172, 132), 0.5, 250, 13)
    inner = _mask((W, H))
    _draw_polys(inner, S["bunker"], scale)
    inner = inner.filter(ImageFilter.GaussianBlur(1.5 * unit))
    inner = inner.point(lambda v: 255 if v > 235 else 0)
    inner = inner.filter(ImageFilter.GaussianBlur(0.5 * unit))
    sand = Image.new("RGB", (W, H), (206, 192, 152))
    base.paste(sand, (0, 0), inner.point(lambda v: int(v * 0.85)))
    # water: blackwater — dark core, slightly lifted shore ring. Skip the
    # ABS_WATER polys (first in the list): those are real lakes already in the
    # photo — painting over them wrecks their natural shorelines.
    designed_water = S["water"][len(ABS_WATER):]
    paint(designed_water, (26, 38, 36), 0.7, 255, 6)
    core = _mask((W, H))
    _draw_polys(core, designed_water, scale)
    core = core.filter(ImageFilter.GaussianBlur(1.2 * unit))
    core = core.point(lambda v: 255 if v > 220 else 0).filter(
        ImageFilter.GaussianBlur(0.6 * unit))
    base.paste(Image.new("RGB", (W, H), (12, 20, 20)), (0, 0),
               core.point(lambda v: int(v * 0.9)))
    # cartpaths: thin worn line
    d = ImageDraw.Draw(base, "RGBA")
    for path in S["cartpath"]:
        d.line([(x * scale, y * scale) for x, y in map(_pt, path)],
               fill=(186, 176, 150, 120), width=max(2, int(0.55 * unit)),
               joint="curve")

    base.save(out_path, quality=82)
    return {"file": os.path.join("img", course["id"], os.path.basename(out_path)).replace(os.sep, "/"),
            "w": W, "h": H,
            "toWorld": [round(course["world"]["w"] / W, 6), 0, 0,
                        0, round(course["world"]["h"] / H, 6), 0]}


# Surface-classification mask from ground-truth geometry (no aerial heuristics
# needed — we KNOW where everything is). Everything off the maintained
# corridors is dense forest -> WOODS (carries the OB penalty and the red OB
# tint, exactly matching what the photo shows); outside the property boundary
# -> OB. Palette indices must match fetch_course.py's MASK_PALETTE, which the
# game's nearestMaskIdx decodes: 0=OB, 1=FAIRWAY, 2=ROUGH, 3=WOODS.
MASK_PALETTE = [200, 40, 40, 150, 210, 90, 60, 130, 55, 25, 60, 30]


def bake_mask(course, out_path):
    Wm, Hm = int(course["world"]["w"]), int(course["world"]["h"])  # 1 unit/px
    im = Image.new("P", (Wm, Hm), 3)  # default: deep forest (woods)
    im.putpalette(MASK_PALETTE + [0] * (768 - len(MASK_PALETTE)))
    d = ImageDraw.Draw(im)
    S = course["surfaces"]

    def dr(polys, idx):
        for poly in polys:
            d.polygon([_pt(p) for p in poly], fill=idx)

    # playable band first (rough), then fairway/tee on top. Green/bunker/water
    # cells are marked ROUGH — the game checks those polygons before the mask,
    # so the mask value under them only matters at polygon edges (keep benign).
    dr(S["rough"], 2)
    dr(S["grass"], 2)
    dr(S["water"], 2)
    dr(S["bunker"], 2)
    dr(S["green"], 2)
    for path in S["cartpath"]:  # cart paths through the forest stay playable
        d.line([_pt(p) for p in path], fill=2, width=3)
    dr(S["fairway"], 1)
    dr(S["tee"], 1)
    # OB outside the property boundary
    outside = Image.new("L", (Wm, Hm), 255)
    ImageDraw.Draw(outside).polygon([_pt(p) for p in course["boundary"][0]], fill=0)
    im.paste(0, (0, 0), outside)
    im.save(out_path, optimize=True)
    return {"file": os.path.join("img", course["id"], os.path.basename(out_path)).replace(os.sep, "/"),
            "w": Wm, "h": Hm, "toWorld": [1, 0, 0, 0, 1, 0]}


def write_svg(path, course, lines):
    w, h = course["world"]["w"], course["world"]["h"]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">'
             % (w, h, w, h),
             '<rect width="%d" height="%d" fill="#1c3f1e"/>' % (w, h)]
    b = course["boundary"][0]
    parts.append('<polygon points="%s" fill="none" stroke="#d33" stroke-width="2" stroke-dasharray="6 4"/>'
                 % " ".join("%.1f,%.1f" % (p["x"], p["y"]) for p in b))
    for key in ("woods", "grass", "rough", "fairway", "tee", "bunker", "green", "water"):
        for poly in course["surfaces"][key]:
            parts.append('<polygon points="%s" fill="%s" fill-opacity="0.9"/>'
                         % (" ".join("%.1f,%.1f" % (p["x"], p["y"]) for p in poly), SVG_FILL[key]))
    for path_pts in course["surfaces"]["cartpath"]:
        parts.append('<polyline points="%s" fill="none" stroke="#ded8c2" stroke-width="1.2" stroke-opacity="0.7"/>'
                     % " ".join("%.1f,%.1f" % (p["x"], p["y"]) for p in path_pts))
    for hn, line in lines.items():
        parts.append('<polyline points="%s" fill="none" stroke="#fff" stroke-width="0.8" stroke-opacity="0.55"/>'
                     % " ".join("%.1f,%.1f" % (x, y) for x, y in line[::3]))
        rec = next(r for r in course["holes"] if r["num"] == hn)
        parts.append('<circle cx="%s" cy="%s" r="2.4" fill="#ff0"/>' % (rec["pin"]["x"], rec["pin"]["y"]))
        parts.append('<text x="%.0f" y="%.0f" fill="#fff" font-size="13" font-family="sans-serif">%d</text>'
                     % (rec["tee"]["x"] + 4, rec["tee"]["y"] - 4, hn))
    parts.append("</svg>")
    with open(path, "w") as f:
        f.write("\n".join(parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--svg", help="also write a debug SVG of the whole property")
    ap.add_argument("--aerial-base",
                    help="real Esri forest JPG to composite the course into "
                         "(bakes courses/img/<id>/aerial.jpg + aerial key)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..",
                                                  "courses", "blackwater-vale.json"))
    args = ap.parse_args()

    course, report, warn, lines = build()
    if args.aerial_base:
        if Image is None:
            raise SystemExit("--aerial-base needs Pillow (pip install pillow)")
        img_dir = os.path.join(os.path.dirname(args.out), "img", course["id"])
        os.makedirs(img_dir, exist_ok=True)
        out_img = os.path.join(img_dir, "aerial.jpg")
        course["aerial"] = bake_aerial(course, lines, args.aerial_base, out_img)
        print("baked aerial %s (%.0f KB)" % (out_img, os.path.getsize(out_img) / 1024))
        out_mask = os.path.join(img_dir, "surfacemask.png")
        course["surfaceMask"] = bake_mask(course, out_mask)
        print("baked mask %s (%.0f KB)" % (out_mask, os.path.getsize(out_mask) / 1024))
    total_par = sum(h["par"] for h in course["holes"])
    total_yds = sum(h["yards"] for h in course["holes"])
    print("hole  par  yards (measured)")
    for n, par, yds, measured in report:
        print("  %2d    %d   %4d  (%d)" % (n, par, yds, measured))
    print("total par %d, %d yds" % (total_par, total_yds))
    for w in warn:
        print("WARN: " + w)

    with open(args.out, "w") as f:
        json.dump(course, f, separators=(",", ":"))
    print("wrote %s (%.0f KB)" % (os.path.normpath(args.out), os.path.getsize(args.out) / 1024))
    if args.svg:
        write_svg(args.svg, course, lines)
        print("wrote %s" % args.svg)


if __name__ == "__main__":
    main()
