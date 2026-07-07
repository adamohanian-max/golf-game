#!/usr/bin/env python3
"""Generate 'Hogwarts Grounds' — a Harry Potter themed fictional course — as
courses/hogwarts-grounds.json (global format, photoreal-render over a real
aerial base of Alnwick Castle & Hulne Park, Northumberland — an actual Harry
Potter film location).

Same fully spec-driven approach as make_fictional_course.py (Blackwater Vale):
hole centerlines are hand-authored waypoints in one shared world coordinate
space; fairway/rough ribbons, green blobs, tees, bunkers, water and the OB
boundary hull are generated deterministically from the spec. Centerlines are
scaled about the tee so measured length hits each hole's target yardage
exactly (yards = arc length x 3).

Two holes are pixel-anchored to real structures in the base aerial photo
(computed from the fetched image, not guessed): hole 4's green sits just
outside Alnwick Castle itself (across the River Aln from the north meadow),
and hole 7's green sits at a real ruined-priory-style building tucked in the
woods (Hagrid's-hut stand-in). Both use a straight 2-waypoint centerline so
the post-scale endpoint lands exactly on the real-world anchor point.

Usage:
  python3 tools/make_hp_course.py [--svg /path/debug.svg] [--aerial-base courses/img/hogwarts-grounds/base.jpg]

Stdlib only except --aerial-base (needs Pillow).
"""
import argparse
import json
import math
import os

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    Image = ImageDraw = ImageFilter = None

YARDS_PER_UNIT = 3.0
WORLD = {"w": 1150, "h": 900}

# ---------------------------------------------------------------- helpers
# (identical to make_fictional_course.py — kept local so this script has no
# import-order dependency on that one.)

def frac_hash(a, b):
    s = math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return s - math.floor(s)


def catmull_rom(pts, per_seg=16):
    if len(pts) < 3:
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
    if frac <= profile[0][0]:
        return profile[0][1]
    for i in range(len(profile) - 1):
        a, b = profile[i], profile[i + 1]
        if frac <= b[0]:
            t = (frac - a[0]) / (b[0] - a[0] or 1)
            return a[1] + (b[1] - a[1]) * t
    return profile[-1][1]


def ribbon(line, profile, jitter=0.10, seed=0.0, n=44):
    left, right = [], []
    for i in range(n + 1):
        f = i / float(n)
        (x, y), (dx, dy) = point_at(line, f)
        w = width_at(profile, f)
        w *= 1.0 + jitter * math.sin(f * 19.0 + seed * 6.2831) \
                 + 0.5 * jitter * math.sin(f * 47.0 + seed * 12.7)
        px, py = -dy, dx
        left.append((x - px * w, y - py * w))
        right.append((x + px * w, y + py * w))
    return left + right[::-1]


def blob(cx, cy, rx, ry, rot=0.0, seed=0.0, n=16, irr=0.16):
    pts = []
    c, s = math.cos(rot), math.sin(rot)
    for i in range(n):
        a = i * 2 * math.pi / n
        r = 1.0 + irr * (frac_hash(seed + i * 3.7, seed * 1.3 + i) - 0.5) * 2
        ex, ey = math.cos(a) * rx * r, math.sin(a) * ry * r
        pts.append((cx + ex * c - ey * s, cy + ex * s + ey * c))
    return pts


def moat(cx, cy, inner, width, open_dir, open_span_deg=95, n=40):
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
# Base aerial: Esri World Imagery, 1536x1202px, centered so it covers Alnwick
# Castle and the Hulne Park woods to its NW. Fetched via fetch_course.fetch_aerial
# with a bbox around (lat 55.4158+0.0075, lon -1.7062-0.007), image px -> world
# units scale = WORLD.w/1536 = 0.7487 (x and y agree to within 0.01%).
#
# Real-anchor pixel positions found by inspecting the fetched photo:
#   Alnwick Castle courtyard:        px (983, 1007)  -> world (736, 754)
#   Real river-adjacent lawn just outside the castle gate (hole 4 green spot):
#                                     px (890, 975)   -> world (666.6, 730.1)
#   Ruined-priory-style building in the woods (Hagrid's-hut stand-in, hole 7
#   green spot):                      px (472, 855)   -> world (353.4, 640.1)
# Holes 4 and 7 use straight 2-waypoint centerlines so the scale-to-yardage
# step (which scales the raw polyline about the tee to hit exact yardage)
# lands the green EXACTLY on these real-world points: tee = green - unit_dir *
# (yards/3), so raw length already equals the target and the scale factor is 1.
PX_SCALE = WORLD["w"] / 1536.0
CASTLE_GREEN_PX = (985, 975)   # open lawn just N of Alnwick Castle's outer wall
HUT_GREEN_PX = (430, 895)      # clearing just S of the ruined-priory building


def px_to_world(px, py):
    return (px * PX_SCALE, py * PX_SCALE)


def anchor_hole(green_px, yards, dir_unit):
    """Straight hole ending exactly at green_px; tee placed `yards` back along
    dir_unit (unit vector pointing from tee toward green)."""
    gx, gy = px_to_world(*green_px)
    u = yards / YARDS_PER_UNIT
    dx, dy = dir_unit
    m = math.hypot(dx, dy) or 1.0
    dx, dy = dx / m, dy / m
    tx, ty = gx - dx * u, gy - dy * u
    return [(tx, ty), (gx, gy)]


HOLE4_WPTS = anchor_hole(CASTLE_GREEN_PX, 440, (0.869, 0.495))  # tee NW across the Aln, plays SE into the castle
HOLE7_WPTS = anchor_hole(HUT_GREEN_PX, 370, (0.0, -1.0))        # tee S in the woods, plays due north to the ruin

# Waypoints hand-routed in world units (1u = 3yds), origin top-left.
# fw = [(frac, halfwidth)] width profile; None = no fairway (pure-carry par 3).
# bunkers = [(frac, side, rx, ry)] — side: +right / -left of play direction.
HOLES = [
    dict(num=1, par=4, yards=400, si=13, green_r=(7.5, 7),
         wpts=[(60, 700), (120, 660), (190, 630)],
         fw=[(0.08, 7), (0.5, 6.5), (1.0, 5)],
         bunkers=[(0.55, -3, 3.4, 5.6), (0.55, 3, 3.4, 5.6)]),  # brick-pillar gap
    dict(num=2, par=5, yards=560, si=5, green_r=(8, 8.5),
         wpts=[(205, 615), (270, 560), (330, 500), (385, 440)],
         fw=[(0.06, 7), (0.4, 6.5), (0.6, 5), (0.8, 6), (1.0, 5)],
         bunkers=[(0.35, 9, 4.6, 3.2), (0.72, -9, 4.4, 3)]),
    dict(num=3, par=3, yards=190, si=15, green_r=(6, 9),
         wpts=[(400, 425), (450, 365)],
         fw=None,
         bunkers=[(0.9, -8, 3.4, 5), (0.9, 8, 3.4, 5)]),
    dict(num=4, par=4, yards=440, si=1, green_r=(8, 8), green_speed=13.5,
         wpts=HOLE4_WPTS,
         fw=[(0.06, 6.5), (0.4, 6), (1.0, 5)],
         bunkers=[(0.9, 9, 4.4, 3.2), (0.92, -9, 3.8, 3)]),
    dict(num=5, par=3, yards=165, si=17, green_r=(7, 7), green_speed=14,
         wpts=[(800, 690), (845, 650)],
         fw=None,
         bunkers=[(0.5, 0, 3.6, 3.6)]),   # the Willow itself, dead center
    dict(num=6, par=4, yards=415, si=9, green_r=(7.5, 7.5),
         wpts=[(460, 880), (400, 850), (335, 800)],
         fw=[(0.07, 6.5), (0.45, 5.5), (0.7, 5), (1.0, 4.5)],
         bunkers=[(0.4, -8, 3.6, 2.8), (0.44, 7, 3.2, 2.6), (0.5, -6, 2.8, 2.2),
                  (0.9, 8, 3.6, 2.8)]),
    dict(num=7, par=4, yards=370, si=11, green_r=(6.5, 6.5), green_speed=14,
         wpts=HOLE7_WPTS,
         fw=[(0.08, 6.5), (0.5, 6), (1.0, 4.5)],
         bunkers=[(0.85, -7, 3.2, 3), (0.88, 6, 3, 2.8)]),   # round "pumpkin" bunkers
    dict(num=8, par=5, yards=585, si=3, green_r=(8.5, 9),
         wpts=[(340, 650), (300, 550), (260, 480)],
         fw=[(0.06, 8), (0.4, 8.5), (0.7, 7), (1.0, 5.5)],
         bunkers=[(0.5, 0, 12, 6.5), (0.95, -9, 4, 3)]),   # ring "hoop" bunkers guarding green
    dict(num=9, par=3, yards=205, si=16, green_r=(6.5, 9.5),
         wpts=[(275, 465), (325, 415)],
         fw=None,
         bunkers=[(0.92, -8, 3.4, 5.2)]),
    dict(num=10, par=4, yards=385, si=10, green_r=(7.5, 7.5),
         wpts=[(935, 345), (1000, 300), (1060, 260)],
         fw=[(0.07, 5.5), (0.5, 5), (1.0, 4.5)],
         bunkers=[(0.5, 7, 3.6, 2.8), (0.85, -7, 3.4, 2.6)]),
    dict(num=11, par=4, yards=425, si=7, green_r=(7.5, 8),
         wpts=[(1045, 225), (980, 190), (910, 160)],
         fw=[(0.07, 6.5), (0.5, 6), (1.0, 5)],
         bunkers=[(0.45, -3.5, 2.6, 2), (0.5, 3.5, 2.6, 2), (0.6, -3, 2.2, 1.8),
                  (0.92, 8, 3.8, 3)]),   # deep narrow "vault door" pots
    dict(num=12, par=5, yards=600, si=2, green_r=(7.5, 8.5),
         wpts=[(895, 175), (800, 220), (700, 280), (620, 320), (480, 300)],
         fw=[(0.05, 7), (0.3, 5), (0.45, 6.5), (0.6, 4.5), (0.75, 6), (1.0, 4.5)],
         bunkers=[(0.35, 8, 4, 3), (0.55, -8, 3.8, 3), (0.7, 7, 3.6, 2.8),
                  (0.95, -9, 3.8, 3)]),
    dict(num=13, par=4, yards=360, si=14, green_r=(7.5, 7.5),
         wpts=[(465, 285), (400, 250), (340, 220)],
         fw=[(0.08, 6), (0.5, 5.5), (1.0, 5)],
         bunkers=[(0.35, 6.5, 3.2, 3), (0.55, -6.5, 3.2, 3), (0.75, 6.5, 3, 2.8)]),
    dict(num=14, par=4, yards=430, si=6, green_r=(8, 8.5), green_speed=14,
         wpts=[(325, 235), (280, 300), (240, 380), (200, 460)],
         fw=[(0.07, 6.5), (0.45, 6), (0.75, 5), (1.0, 4.5)],
         bunkers=[(0.9, -8, 3.6, 2.8), (0.93, 8, 3.4, 2.6)]),
    dict(num=15, par=4, yards=405, si=8, green_r=(7.5, 7.5), green_speed=14.5,
         wpts=[(185, 475), (150, 550), (120, 620)],
         fw=[(0.07, 6.5), (0.45, 8, ), (0.6, 8), (0.8, 5.5), (1.0, 4.5)],
         bunkers=[(0.55, 0, 3, 6.5), (0.9, -7, 3.4, 2.8)]),   # winding "snake" bunker
    dict(num=16, par=3, yards=175, si=18, green_r=(6, 6),
         wpts=[(560, 375), (615, 415)],
         fw=None,
         bunkers=[(0.88, 8, 3, 2.6)]),
    dict(num=17, par=5, yards=545, si=4, green_r=(8, 8.5),
         wpts=[(615, 415), (650, 500), (681, 584)],
         fw=[(0.05, 7), (0.35, 6.5), (0.65, 6), (0.85, 6.5), (1.0, 5)],
         bunkers=[(0.4, -9, 4.4, 3.2), (0.6, 9, 4.2, 3), (0.93, -9, 4, 3)]),
    dict(num=18, par=4, yards=450, si=12, green_r=(8, 8),
         wpts=[(690, 590), (735, 650), (778, 711)],
         fw=[(0.07, 6.5), (0.5, 6), (1.0, 5)],
         bunkers=[(0.9, 9, 4.2, 3.2), (0.93, -9, 3.8, 3)]),
]

# No real lake was confirmed in the fetched photo (an apparent dark patch
# turned out to be tree-shadow over a field, not water) — all water on this
# course is painted (WATER_BLOBS/MOATS/CREEKS), same mechanism Blackwater Vale
# used for most of its hazards. Two crossings (holes 2 and 4) are positioned
# to land on the real River Aln's course through the photo.
ABS_WATER = []

WATER_BLOBS = [
    (3, 0.45, 0, 7, 10),    # Black Lake — full carry
    (9, 0.45, 0, 7, 10),    # Giant Squid's Lake — full carry
]
MOATS = [   # (hole num, width, open_span_deg) — opening faces the approach
    (5, 9, 110),    # Whomping Willow's ring
    (15, 11, 100),  # Chamber of Secrets
]
CREEKS = [
    (2, 0.55, 20, 5),    # viaduct crossing mid-fairway (Hogwarts Express)
    (14, 0.55, 16, 4),   # Shrieking Shack — creek crossing the corridor
]

WOODS = [  # (cx, cy, rx, ry) — following the real forest belt along the Aln
    (140, 380, 55, 60), (230, 470, 42, 50), (300, 560, 38, 42),
    (150, 250, 46, 55), (250, 200, 40, 34), (330, 640, 40, 46),
    (420, 470, 34, 60), (470, 590, 30, 40), (350, 400, 44, 50),
    (500, 490, 32, 44), (200, 700, 34, 26), (620, 400, 26, 60),
    (700, 340, 24, 40), (760, 620, 30, 26), (820, 680, 26, 22),
    (960, 500, 22, 30), (1050, 420, 24, 26), (610, 190, 22, 18),
]
GRASS = [(300, 260, 60, 40), (700, 655, 30, 20)]  # the Pastures deer-park meadow + castle lawn


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
        scale = target_u / polyline_length(raw)
        tee0 = raw[0]
        line = [(tee0[0] + (x - tee0[0]) * scale, tee0[1] + (y - tee0[1]) * scale)
                for x, y in raw]
        lines[n] = line
        (gx, gy), (gdx, gdy) = point_at(line, 1.0)
        (tx, ty), (tdx, tdy) = point_at(line, 0.0)
        r_along, r_perp = spec["green_r"]
        grot = math.atan2(gdy, gdx)

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

    for (cx, cy, rx, ry) in ABS_WATER:
        surfaces["water"].append(blob(cx, cy, rx, ry, seed=cx * 0.7 + cy,
                                      irr=0.06, n=24))
    for (hn, f, side, rx, ry) in WATER_BLOBS:
        line = lines[hn]
        (x, y), (dx, dy) = point_at(line, f)
        px, py = -dy, dx
        surfaces["water"].append(blob(x + px * side, y + py * side, rx, ry,
                                      rot=math.atan2(dy, dx), seed=hn * 3.7, irr=0.14))
    for (hn, width, span) in MOATS:
        line = lines[hn]
        (gx, gy), (gdx, gdy) = point_at(line, 1.0)
        r_along, r_perp = next(s["green_r"] for s in HOLES if s["num"] == hn)
        inner = max(r_along, r_perp) * 1.18 + 1.5
        open_dir = math.atan2(-gdy, -gdx)
        surfaces["water"].append(moat(gx, gy, inner, width, open_dir, span))
    for (hn, f, half_len, half_w) in CREEKS:
        line = lines[hn]
        (x, y), (dx, dy) = point_at(line, f)
        px, py = -dy, dx
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

    for i in range(len(HOLES)):
        (gx, gy), _ = point_at(lines[HOLES[i]["num"]], 1.0)
        nxt = holes_json[(i + 1) % 18]["tee"]
        surfaces["cartpath"].append([(gx, gy), ((gx + nxt["x"]) / 2 + 3, (gy + nxt["y"]) / 2 + 3),
                                     (nxt["x"], nxt["y"])])

    all_pts = []
    for key in ("fairway", "rough", "green", "tee", "bunker", "water"):
        for poly in surfaces[key]:
            all_pts.extend(poly)
    boundary = dilate(convex_hull(all_pts), 16)

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
        "id": "hogwarts-grounds",
        "name": "Hogwarts Grounds",
        "global": True,
        "yardsPerUnit": YARDS_PER_UNIT,
        "world": WORLD,
        "greenSpeed": 13.5,
        "greenTopo": {"tiltMul": 1.3, "undAmp": 1.6, "lobes": 3},
        "boundary": [rnd(boundary)],
        "surfaces": {k: [rnd(p) for p in v] for k, v in surfaces.items()},
        "holes": holes_json,
    }
    return course, report, warn, lines


SVG_FILL = {"rough": "#2c6e30", "fairway": "#4eb053", "tee": "#5cbf61",
            "bunker": "#e8d9a8", "water": "#2a86d4", "woods": "#274d2b",
            "green": "#8fd095", "grass": "#3a9440"}


# ------------------------------------------------------------- aerial bake
# Same technique as make_fictional_course.py's bake_aerial/bake_mask — see
# that file for the detailed rationale. Kept in lockstep so both fictional
# courses composite identically.

def _pt(p):
    return (p["x"], p["y"]) if isinstance(p, dict) else (p[0], p[1])


def _mask(size):
    return Image.new("L", size, 0)


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
    unit = scale

    def paint(mask_polys, rgb, feather, opacity, noise_sigma=9):
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
        lum = base.convert("L").filter(ImageFilter.GaussianBlur(1.2))
        lum = lum.point(lambda v: min(255, int(150 + v * 0.9)))
        color = Image.composite(color, color.point(lambda v: int(v * 0.55)), lum)
        base.paste(color, (0, 0), mask)

    paint(S["grass"], (96, 122, 64), 1.6, 210, 11)
    paint(S["rough"], (82, 110, 58), 1.4, 165, 12)
    paint(S["fairway"], (112, 148, 70), 0.8, 245, 9)
    for spec in HOLES:
        if not spec["fw"]:
            continue
        line = lines[spec["num"]]
        total = polyline_length(line)
        band = 7.0 / total
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
    paint(S["green"], (138, 172, 88), 0.5, 255, 5)
    paint(S["bunker"], (188, 172, 132), 0.5, 250, 13)
    inner = _mask((W, H))
    _draw_polys(inner, S["bunker"], scale)
    inner = inner.filter(ImageFilter.GaussianBlur(1.5 * unit))
    inner = inner.point(lambda v: 255 if v > 235 else 0)
    inner = inner.filter(ImageFilter.GaussianBlur(0.5 * unit))
    sand = Image.new("RGB", (W, H), (206, 192, 152))
    base.paste(sand, (0, 0), inner.point(lambda v: int(v * 0.85)))
    designed_water = S["water"][len(ABS_WATER):]
    paint(designed_water, (26, 46, 44), 0.7, 250, 6)
    core = _mask((W, H))
    _draw_polys(core, designed_water, scale)
    core = core.filter(ImageFilter.GaussianBlur(1.2 * unit))
    core = core.point(lambda v: 255 if v > 220 else 0).filter(
        ImageFilter.GaussianBlur(0.6 * unit))
    base.paste(Image.new("RGB", (W, H), (14, 24, 24)), (0, 0),
               core.point(lambda v: int(v * 0.9)))
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


MASK_PALETTE = [200, 40, 40, 150, 210, 90, 60, 130, 55, 25, 60, 30]


def bake_mask(course, out_path):
    Wm, Hm = int(course["world"]["w"]), int(course["world"]["h"])
    im = Image.new("P", (Wm, Hm), 3)
    im.putpalette(MASK_PALETTE + [0] * (768 - len(MASK_PALETTE)))
    d = ImageDraw.Draw(im)
    S = course["surfaces"]

    def dr(polys, idx):
        for poly in polys:
            d.polygon([_pt(p) for p in poly], fill=idx)

    dr(S["rough"], 2)
    dr(S["grass"], 2)
    dr(S["water"], 2)
    dr(S["bunker"], 2)
    dr(S["green"], 2)
    for path in S["cartpath"]:
        d.line([_pt(p) for p in path], fill=2, width=3)
    dr(S["fairway"], 1)
    dr(S["tee"], 1)
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
                    help="real Esri aerial JPG (Alnwick Castle/Hulne Park) to "
                         "composite the course into")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..",
                                                  "courses", "hogwarts-grounds.json"))
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
