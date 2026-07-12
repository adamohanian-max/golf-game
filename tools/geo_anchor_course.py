#!/usr/bin/env python3
"""
Recover a real-world (lat/lon) georeference for an already-baked GLOBAL course
JSON that has none (courses/*.json stores only local "world units", tied to
the baked aerial's pixel affine, not WGS84).

Method: fetch_course_global.py bakes global courses with NO rotation — world
x/y are a pure scale+offset of an equirectangular meters projection (see its
`SCALE`/`MARGIN` math). So world->lonlat is a 6-param affine with zero shear
if the source data is consistent; we solve it anyway via least squares (more
robust to any per-hole noise) using each hole's PIN as a correspondence point
(pins are never moved; tees can be scorecard-stretched by the baker, so we
avoid using them here — see CLAUDE.md "Baker: stretch tee back...").

Usage:
    python3 tools/geo_anchor_course.py --id butter-brook-golf-club \
        --near 42.534868,-71.407785 --write
"""
import argparse, json, math, os, sys, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import fetch_course as fc

DEG_MARGIN = 0.03  # ~3km — used only for the golf_course-way lookup, not the hole query


def find_boundary_way(near_lat, near_lon):
    """Locate the leisure=golf_course way/relation nearest --near, so the hole
    query below can be area-scoped and not pick up an unrelated course's holes
    that happen to share ref numbers within a loose bbox (bit us on first try)."""
    q = (f'[out:json][timeout:60];'
         f'(way["leisure"="golf_course"](around:{int(DEG_MARGIN*111000)},{near_lat},{near_lon});'
         f'relation["leisure"="golf_course"](around:{int(DEG_MARGIN*111000)},{near_lat},{near_lon}););'
         f'out tags center;')
    req = urllib.request.Request(
        fc.OVERPASS + "?" + urllib.parse.urlencode({"data": q}),
        headers={"User-Agent": fc.UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        els = json.load(r)["elements"]
    if not els:
        sys.exit("No leisure=golf_course way/relation found near --near.")
    if len(els) > 1:
        def d(e):
            c = e.get("center") or {}
            return math.hypot(c.get("lat", 999) - near_lat, c.get("lon", 999) - near_lon)
        els.sort(key=d)
        print(f"{len(els)} golf_course features near --near, using the closest: "
              + ", ".join(f"{e['type']}/{e['id']} {e.get('tags',{}).get('name')} "
                           f"({d(e)*111000:.0f}m)" for e in els))
    return els[0]["type"], els[0]["id"]


def fetch_holes_and_greens(near_lat, near_lon):
    kind, bid = find_boundary_way(near_lat, near_lon)
    sel = "rel" if kind == "relation" else "way"
    q = (f'[out:json][timeout:60];{sel}({bid})->.b;.b map_to_area->.oc;'
         f'(way(area.oc)["golf"="hole"];way(area.oc)["golf"="green"];);'
         f'out tags geom;')
    req = urllib.request.Request(
        fc.OVERPASS + "?" + urllib.parse.urlencode({"data": q}),
        headers={"User-Agent": fc.UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["elements"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--near", required=True, help="lat,lon near the course")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    near_lat, near_lon = (float(v) for v in args.near.split(","))
    path = os.path.join(os.path.dirname(__file__), "..", "courses", f"{args.id}.json")
    course = json.load(open(path))
    if not course.get("global"):
        sys.exit(f"{args.id} is not a global-mode course — this script assumes no per-hole rotation.")

    els = fetch_holes_and_greens(near_lat, near_lon)
    hole_lines = {}
    greens = []
    for e in els:
        if e.get("tags", {}).get("golf") == "hole":
            n = fc.hole_num(e)
            if n is not None and e.get("geometry"):
                if n not in hole_lines or len(e["geometry"]) > len(hole_lines[n]):
                    hole_lines[n] = e["geometry"]
        elif e.get("tags", {}).get("golf") == "green" and e.get("geometry"):
            pts = [(p["lat"], p["lon"]) for p in e["geometry"] if p]
            if pts:
                greens.append((sum(p[0] for p in pts) / len(pts),
                                sum(p[1] for p in pts) / len(pts)))

    if not hole_lines:
        sys.exit("No golf=hole ways found near --near — widen DEG_MARGIN or check coordinates.")

    def nearest_green_dist(lat, lon):
        return min(math.hypot(lat - g[0], lon - g[1]) for g in greens)

    world_pts, lon_targets, lat_targets = [], [], []
    matched, skipped = [], []
    for h in course["holes"]:
        n = h.get("num")
        line = hole_lines.get(n)
        if not line or "pin" not in h:
            skipped.append(n)
            continue
        a, b = line[0], line[-1]
        # pin end = whichever raw endpoint sits closer to a real green centroid
        pin_ll = a if nearest_green_dist(a["lat"], a["lon"]) < nearest_green_dist(b["lat"], b["lon"]) else b
        world_pts.append((h["pin"]["x"], h["pin"]["y"]))
        lon_targets.append(pin_ll["lon"])
        lat_targets.append(pin_ll["lat"])
        matched.append(n)

    if len(world_pts) < 3:
        sys.exit(f"Only {len(world_pts)} hole(s) matched (need >=3) — matched={matched} skipped={skipped}")

    import numpy as np

    mean_lat = sum(lat_targets) / len(lat_targets)
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(mean_lat))

    def fit(idx):
        A = np.array([[world_pts[i][0], world_pts[i][1], 1.0] for i in idx])
        lon_c, *_ = np.linalg.lstsq(A, np.array([lon_targets[i] for i in idx]), rcond=None)
        lat_c, *_ = np.linalg.lstsq(A, np.array([lat_targets[i] for i in idx]), rcond=None)
        return lon_c, lat_c

    def residuals(lon_c, lat_c, idx):
        out = []
        for i in idx:
            (wx, wy), lon_t, lat_t = world_pts[i], lon_targets[i], lat_targets[i]
            lon_p = lon_c[0] * wx + lon_c[1] * wy + lon_c[2]
            lat_p = lat_c[0] * wx + lat_c[1] * wy + lat_c[2]
            out.append(math.hypot((lon_p - lon_t) * m_per_deg_lon, (lat_p - lat_t) * m_per_deg_lat))
        return out

    # Robust fit: drop the worst correspondence while it's >2.5x the mean of the
    # rest (a mispaired pin poisons the whole affine — every hole pays for it),
    # keeping at least 6 points so the fit stays well-conditioned.
    idx = list(range(len(world_pts)))
    dropped = []
    while True:
        lon_coef, lat_coef = fit(idx)
        errs = residuals(lon_coef, lat_coef, idx)
        worst = max(range(len(errs)), key=lambda k: errs[k])
        rest = [e for k, e in enumerate(errs) if k != worst]
        if len(idx) <= 6 or errs[worst] <= 2.5 * (sum(rest) / len(rest)):
            break
        dropped.append((matched[idx[worst]] if False else [matched[i] for i in idx][worst], errs[worst]))
        del idx[worst]

    errs = residuals(lon_coef, lat_coef, idx)
    mean_err_m = sum(errs) / len(errs)
    max_err_m = max(errs)

    print(f"Matched {len(matched)}/18 holes: {matched}" + (f"  (skipped: {skipped})" if skipped else ""))
    per_hole = residuals(lon_coef, lat_coef, range(len(world_pts)))
    print("Per-hole residuals (m): " + ", ".join(f"{matched[i]}:{per_hole[i]:.0f}" for i in range(len(matched))))
    if dropped:
        print("Dropped as outliers: " + ", ".join(f"hole {n} ({e:.0f}m)" for n, e in dropped))
    print(f"Fit residual: mean {mean_err_m:.2f}m, max {max_err_m:.2f}m over {len(idx)} pin points")
    to_lon_lat = [round(float(v), 10) for v in
                  [lon_coef[0], lon_coef[1], lon_coef[2], lat_coef[0], lat_coef[1], lat_coef[2]]]
    print(f"geo.toLonLat = {to_lon_lat}")
    print("  lon = a*worldX + b*worldY + c ; lat = d*worldX + e*worldY + f")

    if args.write:
        course["geo"] = {
            "toLonLat": to_lon_lat,
            "note": "lon = a*wx+b*wy+c, lat = d*wx+e*wy+f (world units -> WGS84). "
                    "Derived via least-squares fit of hole-pin world coords against fresh "
                    "OSM golf=hole endpoints, matched to golf=green centroids. Tees excluded "
                    "(may be scorecard-stretched by the baker). tools/geo_anchor_course.py",
            "residualMeanM": round(mean_err_m, 2),
            "residualMaxM": round(max_err_m, 2),
        }
        with open(path, "w") as f:
            json.dump(course, f)
        print(f"Wrote geo anchor into {path}")
    else:
        print("(dry run — pass --write to save)")


if __name__ == "__main__":
    main()
