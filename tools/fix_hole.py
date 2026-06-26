#!/usr/bin/env python3
"""Re-derive one hole's tee/pin from the real OSM golf=hole centerline.

The baker can snap a hole's tee/pin to the wrong tee box / green when corridors
cluster (e.g. front holes by a clubhouse). This fixes a single hole authoritatively:

  - fetch the course's OSM golf=hole ways (Overpass),
  - build a latlon->world affine self-calibrated from the OTHER (correct) holes'
    line-midpoint <-> baked-midpoint pairs (endpoint-order independent),
  - reproject the target hole's two endpoints; the one nearest a real green = green
    end, the other = tee end,
  - snap pin -> nearest green polygon centroid, tee -> nearest tee-box centroid,
  - recompute yards from the OSM line length, write back, run verify_course.py.

Usage:
  python3 tools/fix_hole.py --id butter-brook-golf-club --boundary-way 215333121 --hole 1
  (use --boundary-rel for relation boundaries)
"""
import argparse, json, math, os, re, subprocess, sys, urllib.parse, urllib.request

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "golf-game-dev/1.0 (fix_hole)"


def fetch_holes(boundary_id, kind):
    sel = "rel" if kind == "rel" else "way"
    q = (f'[out:json][timeout:60];{sel}({boundary_id});map_to_area->.oc;'
         f'(way(area.oc)["golf"="hole"];);out tags geom;')
    req = urllib.request.Request(OVERPASS + "?" + urllib.parse.urlencode({"data": q}),
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=70) as r:
        data = json.load(r)
    out = {}
    for el in data.get("elements", []):
        t = el.get("tags", {})
        m = re.match(r"\s*(\d+)", t.get("ref") or t.get("name") or "")
        g = el.get("geometry") or []
        if not m or len(g) < 2:
            continue
        n = int(m.group(1))
        out.setdefault(n, [(p["lat"], p["lon"]) for p in g])   # first wins
    return out


def line_len_yd(pts):
    L = 0.0
    for i in range(len(pts) - 1):
        (la0, lo0), (la1, lo1) = pts[i], pts[i + 1]
        de = (lo1 - lo0) * 111320 * math.cos(math.radians(la0))
        dn = (la1 - la0) * 110540
        L += math.hypot(de, dn)
    return L * 1.09361


def solve3(rows, rhs):
    """Least-squares for [k0,k1,k2] minimizing sum (k0*a+k1*b+k2*1 - y)^2."""
    # normal equations: (A^T A) k = A^T y, A row = [a, b, 1]
    AtA = [[0.0] * 3 for _ in range(3)]
    Aty = [0.0] * 3
    for (a, b), y in zip(rows, rhs):
        v = (a, b, 1.0)
        for i in range(3):
            Aty[i] += v[i] * y
            for j in range(3):
                AtA[i][j] += v[i] * v[j]
    # Gaussian elimination on 3x3
    M = [AtA[i][:] + [Aty[i]] for i in range(3)]
    for c in range(3):
        p = max(range(c, 3), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        pivot = M[c][c]
        M[c] = [v / pivot for v in M[c]]
        for r in range(3):
            if r != c:
                f = M[r][c]
                M[r] = [M[r][k] - f * M[c][k] for k in range(4)]
    return [M[0][3], M[1][3], M[2][3]]


def centroid(poly):
    xs = [p["x"] for p in poly]
    ys = [p["y"] for p in poly]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--boundary-way", type=int)
    g.add_argument("--boundary-rel", type=int)
    ap.add_argument("--hole", type=int, required=True)
    args = ap.parse_args()

    path = os.path.join(ROOT, "courses", args.id + ".json")
    with open(path) as f:
        course = json.load(f)
    holes = course["holes"]
    greens = course["surfaces"]["green"]
    tees = course["surfaces"]["tee"]

    bid = args.boundary_rel if args.boundary_rel else args.boundary_way
    kind = "rel" if args.boundary_rel else "way"
    osm = fetch_holes(bid, kind)
    if args.hole not in osm:
        sys.exit(f"OSM has no hole {args.hole} (got {sorted(osm)})")

    # Affine latlon->world from the OTHER holes' midpoints (order-independent).
    rows, wx, wy = [], [], []
    for h in holes:
        n = h["num"]
        if n == args.hole or n not in osm:
            continue
        pts = osm[n]
        mlat = (pts[0][0] + pts[-1][0]) / 2
        mlon = (pts[0][1] + pts[-1][1]) / 2
        rows.append((mlat, mlon))
        wx.append((h["tee"]["x"] + h["pin"]["x"]) / 2)
        wy.append((h["tee"]["y"] + h["pin"]["y"]) / 2)
    if len(rows) < 3:
        sys.exit(f"need >=3 reference holes, have {len(rows)}")
    kx = solve3(rows, wx)
    ky = solve3(rows, wy)

    def to_world(lat, lon):
        return (kx[0] * lat + kx[1] * lon + kx[2],
                ky[0] * lat + ky[1] * lon + ky[2])

    # residual check on the reference holes
    res = max(math.hypot(to_world(*rows[i])[0] - wx[i], to_world(*rows[i])[1] - wy[i])
              for i in range(len(rows)))
    print(f"affine fit: {len(rows)} holes, max midpoint residual {res:.1f} world units")

    pts = osm[args.hole]
    e0, e1 = to_world(*pts[0]), to_world(*pts[-1])

    def nearest(pt, polys):
        best, bd = None, 1e18
        for poly in polys:
            c = centroid(poly)
            d = (c[0] - pt[0]) ** 2 + (c[1] - pt[1]) ** 2
            if d < bd:
                bd, best = d, c
        return best, math.sqrt(bd)

    # green end = endpoint closest to any green centroid
    g0, d0 = nearest(e0, greens)
    g1, d1 = nearest(e1, greens)
    if d0 <= d1:
        green_c, tee_end = g0, e1
    else:
        green_c, tee_end = g1, e0
    tee_c, td = nearest(tee_end, tees)

    h = holes[args.hole - 1]
    old_t, old_p = dict(h["tee"]), dict(h["pin"])
    h["tee"] = {"x": round(tee_c[0], 2), "y": round(tee_c[1], 2)}
    h["pin"] = {"x": round(green_c[0], 2), "y": round(green_c[1], 2)}
    h["yards"] = round(line_len_yd(pts))
    print(f"hole {args.hole}: tee {old_t} -> {h['tee']}")
    print(f"hole {args.hole}: pin {old_p} -> {h['pin']}   (snap dist tee {td:.1f}u)")
    print(f"hole {args.hole}: yards -> {h['yards']} (par {h['par']})")

    with open(path, "w") as f:
        json.dump(course, f, separators=(",", ":"))
    print(f"wrote {path}")

    vc = os.path.join(TOOLS, "verify_course.py")
    if os.path.exists(vc):
        print("\n--- verify_course.py ---")
        subprocess.run([sys.executable, vc, args.id], cwd=ROOT)


if __name__ == "__main__":
    main()
