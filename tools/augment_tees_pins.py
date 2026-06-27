#!/usr/bin/env python3
"""Add per-hole `tees[]` (Back/Blue/White/... by length) and `pins[]`
(Front/Middle/Back) to already-baked GLOBAL course JSONs, derived from the
surfaces + tee/pin that are already in the file. Pure geometry in world units —
no network, no aerial/DEM re-download. Idempotent: re-running recomputes.

Mirrors the emission in tools/fetch_course_global.py so a re-bake produces the
same arrays. Usage: python3 tools/augment_tees_pins.py courses/<id>.json [...]
"""
import json, math, sys

TEE_PALETTE = ["Back", "Blue", "White", "Gold", "Green", "Red"]
TEE_BOX_NEAR_YDS = 40.0


def cent(poly):
    return (sum(p["x"] for p in poly) / len(poly), sum(p["y"] for p in poly) / len(poly))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return dist(p, (ax + t * dx, ay + t * dy))


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
    ypu = d.get("yardsPerUnit") or 3.0
    surf = d.get("surfaces", {})
    tee_polys = surf.get("tee", [])
    tee_cents = [cent(t) for t in tee_polys]
    greens = [[(p["x"], p["y"]) for p in g] for g in surf.get("green", [])]
    green_cents = [cent([{"x": p[0], "y": p[1]} for p in g]) for g in greens]
    near_u = TEE_BOX_NEAR_YDS / ypu
    nt = npn = 0
    for h in d["holes"]:
        tee = (h["tee"]["x"], h["tee"]["y"]); pin = (h["pin"]["x"], h["pin"]["y"])
        L = dist(tee, pin) or 1.0
        u = ((pin[0] - tee[0]) / L, (pin[1] - tee[1]) / L)

        # --- tees: longest -> shortest -------------------------------------
        cands = [(round(L * ypu), tee)]  # canonical hole tee (back)
        for c in tee_cents:
            if seg_dist(c, tee, pin) > near_u:
                continue
            along = (c[0] - tee[0]) * u[0] + (c[1] - tee[1]) * u[1]
            if along < -15 / ypu or along > L * 0.6:
                continue
            cands.append((round(dist(c, pin) * ypu), c))
        cands.sort(key=lambda t: -t[0])
        touts, seen = [], []
        for yds, c in cands:
            if any(dist(c, s) < 6 / ypu for s in seen):
                continue
            seen.append(c)
            touts.append({"x": round(c[0], 2), "y": round(c[1], 2), "yards": yds,
                          "name": TEE_PALETTE[min(len(touts), len(TEE_PALETTE) - 1)]})
        if touts:
            touts[0]["yards"] = h["yards"]  # back tee carries the scorecard yardage
        if len(touts) > 1:
            h["tees"] = touts; nt += 1
        else:
            h.pop("tees", None)

        # --- pins: front / middle / back on the nearest green --------------
        if green_cents:
            gi = min(range(len(green_cents)), key=lambda i: dist(green_cents[i], pin))
            gpoly = greens[gi]
            gc = green_cents[gi]
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
    print(f"{path}: tees on {nt}/{len(d['holes'])} holes, pins on {npn}/{len(d['holes'])}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: augment_tees_pins.py courses/<id>.json [...]")
    for p in sys.argv[1:]:
        augment(p)
