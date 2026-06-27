#!/usr/bin/env python3
"""Add per-hole `pins[]` (Front/Middle/Back) to already-baked GLOBAL course
JSONs, derived from the surfaces + tee/pin already in the file. Pure geometry in
world units — no network, no aerial/DEM re-download. Idempotent: re-running
recomputes. Also strips any legacy `tees[]` arrays.

Mirrors the emission in tools/fetch_course_global.py so a re-bake produces the
same arrays. Usage: python3 tools/augment_pins.py courses/<id>.json [...]
"""
import json, math, sys


def cent(poly):
    return (sum(p["x"] for p in poly) / len(poly), sum(p["y"] for p in poly) / len(poly))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def point_in_poly(pt, poly):  # poly = list of (x, y)
    x, y = pt; inside = False; n = len(poly); j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def augment(path):
    d = json.load(open(path))
    surf = d.get("surfaces", {})
    greens = [[(p["x"], p["y"]) for p in g] for g in surf.get("green", [])]
    green_cents = [cent([{"x": p[0], "y": p[1]} for p in g]) for g in greens]
    npn = 0
    for h in d["holes"]:
        h.pop("tees", None)  # drop any legacy multi-tee data
        if not green_cents:
            continue
        tee = (h["tee"]["x"], h["tee"]["y"]); pin = (h["pin"]["x"], h["pin"]["y"])
        L = dist(tee, pin) or 1.0
        u = ((pin[0] - tee[0]) / L, (pin[1] - tee[1]) / L)
        gi = min(range(len(green_cents)), key=lambda i: dist(green_cents[i], pin))
        gpoly = greens[gi]; gc = green_cents[gi]
        alongs = [(p[0] - tee[0]) * u[0] + (p[1] - tee[1]) * u[1] for p in gpoly]
        amin, amax = min(alongs), max(alongs)
        span = (amax - amin) or 1.0
        ag = (gc[0] - tee[0]) * u[0] + (gc[1] - tee[1]) * u[1]
        pouts = []

        def add_pin(at, label):
            at = max(amin + 0.12 * span, min(amax - 0.12 * span, at))
            pm = (gc[0] + u[0] * (at - ag), gc[1] + u[1] * (at - ag))
            if not point_in_poly(pm, gpoly):
                pm = gc
            pouts.append({"x": round(pm[0], 2), "y": round(pm[1], 2), "name": label})
        add_pin(amin + 0.30 * span, "Front")
        add_pin(ag, "Middle")
        add_pin(amax - 0.30 * span, "Back")
        h["pins"] = pouts; npn += 1
    json.dump(d, open(path, "w"), separators=(",", ":"))
    print(f"{path}: pins on {npn}/{len(d['holes'])} holes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: augment_pins.py courses/<id>.json [...]")
    for p in sys.argv[1:]:
        augment(p)
