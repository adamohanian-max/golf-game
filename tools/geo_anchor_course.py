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

PREFER --greens. The default correspondence (baker pin <-> OSM hole-way
ENDPOINT) is noisy by construction: a hole way's last vertex is wherever the
mapper stopped drawing, routinely tens of metres from the pin it stands in for.
--greens instead pairs this course's BAKED GREEN POLYGON CENTROIDS with the same
OSM golf=green polygons they were baked from — the same physical object, defined
the same way on both sides. Since the baker projects with a pure scale+offset,
that relation is exactly affine, so the fit RECOVERS the baking transform rather
than approximating it. Measured on butter-brook-golf-club: green centroids give
held-out (2-fold) and leave-one-out residuals of 0.002 m over 18 greens, where
the pin fit reported 4.77 m mean / 8.57 m max and left a real 1.48 m mean /
3.03 m max offset against the greens.

Do NOT compare the two modes on the pin metric — it reads ~5 m median for ANY
affine, including the exact one, because the noise is in the target.

Overpass 504s/429s are frequent here: retry serially, never in parallel.

Usage:
    python3 tools/geo_anchor_course.py --id butter-brook-golf-club \
        --near 42.534868,-71.407785 --greens --write
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


def fetch_holes_and_greens(near_lat, near_lon, kind=None, bid=None):
    if bid is None:
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
    ap.add_argument("--boundary-rel", type=int, help="force OSM relation id as the course boundary (skip nearest-lookup)")
    ap.add_argument("--boundary-way", type=int, help="force OSM way id as the course boundary (skip nearest-lookup)")
    ap.add_argument("--greens", action="store_true",
                    help="fit baked green-polygon centroids against OSM golf=green centroids "
                         "(exact — recovers the baking affine; see the module docstring)")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    near_lat, near_lon = (float(v) for v in args.near.split(","))
    ov_kind, ov_bid = None, None
    if args.boundary_rel:
        ov_kind, ov_bid = "relation", args.boundary_rel
    elif args.boundary_way:
        ov_kind, ov_bid = "way", args.boundary_way
    path = os.path.join(os.path.dirname(__file__), "..", "courses", f"{args.id}.json")
    course = json.load(open(path))
    if not course.get("global"):
        sys.exit(f"{args.id} is not a global-mode course — this script assumes no per-hole rotation.")

    els = fetch_holes_and_greens(near_lat, near_lon, ov_kind, ov_bid)
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

    if args.greens:
        # Green-centroid mode (preferred — see module docstring). Pair each baked
        # green with its OSM source by nearest centroid under the CURRENT affine;
        # a green is ~25 m across, so a 45 m cap can only ever admit the right one.
        if not greens:
            sys.exit("--greens: no golf=green ways returned by Overpass.")
        cur = (course.get("geo") or {}).get("toLonLat")
        if not cur:
            sys.exit("--greens needs an existing course.geo to seed the pairing; "
                     "run once without it first, then re-run with --greens.")
        mlat = sum(g[0] for g in greens) / len(greens)
        mpdlat, mpdlon = 111320.0, 111320.0 * math.cos(math.radians(mlat))
        for gi, poly in enumerate(course["surfaces"].get("green", [])):
            cx = sum(q["x"] for q in poly) / len(poly)
            cy = sum(q["y"] for q in poly) / len(poly)
            plat = cur[3] * cx + cur[4] * cy + cur[5]
            plon = cur[0] * cx + cur[1] * cy + cur[2]
            best = min(greens, key=lambda g: math.hypot((g[0] - plat) * mpdlat,
                                                        (g[1] - plon) * mpdlon))
            d = math.hypot((best[0] - plat) * mpdlat, (best[1] - plon) * mpdlon)
            if d > 45:
                skipped.append(f"green{gi}({d:.0f}m)")
                continue
            world_pts.append((cx, cy))
            lat_targets.append(best[0])
            lon_targets.append(best[1])
            matched.append(f"g{gi}")

    # --greens REPLACES the pin correspondence; it must never also collect pins.
    # (Appending both "worked" only because outlier rejection happened to drop
    # every pin point against an exact green fit — luck, not design.)
    for h in ([] if args.greens else course["holes"]):
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

    label = "greens" if args.greens else "holes"
    print(f"Matched {len(matched)}/18 {label}: {matched}" + (f"  (skipped: {skipped})" if skipped else ""))
    per_hole = residuals(lon_coef, lat_coef, range(len(world_pts)))
    print("Per-point residuals (m): " + ", ".join(
        f"{matched[i]}:{per_hole[i]:.2f}" for i in range(len(matched))))
    if dropped:
        print("Dropped as outliers: " + ", ".join(f"{n} ({e:.0f}m)" for n, e in dropped))
    print(f"Fit residual: mean {mean_err_m:.2f}m, max {max_err_m:.2f}m over {len(idx)} {label} points")
    # Significant digits, NOT decimal places: at round(v, 10) the scale terms
    # (~3e-05) lose real precision and the small-but-real shear terms (~1e-11)
    # collapse to 0.0.
    to_lon_lat = [float(f"{float(v):.12g}") for v in
                  [lon_coef[0], lon_coef[1], lon_coef[2], lat_coef[0], lat_coef[1], lat_coef[2]]]
    print(f"geo.toLonLat = {to_lon_lat}")
    print("  lon = a*worldX + b*worldY + c ; lat = d*worldX + e*worldY + f")

    if args.write:
        course["geo"] = {
            "toLonLat": to_lon_lat,
            "note": ("lon = a*wx+b*wy+c, lat = d*wx+e*wy+f (world units -> WGS84). "
                     + ("Least-squares fit of BAKED GREEN-POLYGON CENTROIDS against the same "
                        "OSM golf=green polygons they were baked from -- exact, recovers the "
                        "baking affine (the baker projects with a pure scale+offset). "
                        if args.greens else
                        "Least-squares fit of hole-pin world coords against fresh OSM golf=hole "
                        "ENDPOINTS, matched to golf=green centroids -- noisy target, prefer "
                        "--greens. Tees excluded (may be scorecard-stretched by the baker). ")
                     + "tools/geo_anchor_course.py"),
            "residualMeanM": round(mean_err_m, 2),
            "residualMaxM": round(max_err_m, 2),
            "fitMethod": "green-centroids" if args.greens else "pin-endpoints",
            "fitPoints": len(idx),
        }
        with open(path, "w") as f:
            json.dump(course, f)
        print(f"Wrote geo anchor into {path}")
    else:
        print("(dry run — pass --write to save)")


if __name__ == "__main__":
    main()
