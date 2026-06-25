#!/usr/bin/env python3
"""Course discovery index — bake by name instead of a hand-found boundary-way id.

Builds/merges courses/index.json: slug -> {name, boundaryWay, type, center, source}.
fetch_course.py reads it via --from-index <slug> so you never hand-look-up an OSM
way id again.

Two sources, complementary:
  --overpass (bbox/around)  authoritative, live OSM way/relation ids  [source=osm]
  --seed-cc0                bulk seed ~461 North-American courses from the CC0
                            GeoJSON (TheMapSmith/GeoJSON-GolfCourses)  [source=cc0]

CC0 ids can be stale or point at a relation, and coverage is NA-only — treat them
as unverified hints; prefer --overpass for anything you actually bake. An OSM hit
overwrites a CC0 hit for the same slug.

Usage:
  python3 tools/build_index.py --overpass --around 35.19,-79.47,4000
  python3 tools/build_index.py --overpass --bbox 35.17,-79.49,35.21,-79.45
  python3 tools/build_index.py --seed-cc0
  python3 tools/build_index.py --search pinehurst
  python3 tools/build_index.py --list
"""
import argparse, json, os, re, sys, urllib.parse, urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
CC0_URL = ("https://raw.githubusercontent.com/TheMapSmith/GeoJSON-GolfCourses/"
           "master/north-american-golf-courses.geojson")
UA = "golf-game-dev/1.0 (course index)"
INDEX = os.path.join(os.path.dirname(__file__), "..", "courses", "index.json")


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return re.sub(r"-+", "-", s)


def load_index(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_index(path, idx):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(idx, f, indent=1, sort_keys=True)


def merge(idx, rec):
    """Insert/upgrade. OSM (verified) beats CC0; never downgrade a verified entry."""
    slug = rec["slug"]
    cur = idx.get(slug)
    if cur and cur.get("source") == "osm" and rec["source"] != "osm":
        return False
    idx[slug] = {k: rec[k] for k in
                 ("name", "boundaryWay", "type", "center", "source")}
    return True


# --- Overpass (authoritative) ----------------------------------------------
def overpass_courses(area_clause):
    q = (f'[out:json][timeout:90];'
         f'(way["leisure"="golf_course"]{area_clause};'
         f' relation["leisure"="golf_course"]{area_clause};);'
         f'out tags center;')
    req = urllib.request.Request(
        OVERPASS + "?" + urllib.parse.urlencode({"data": q}),
        headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    out = []
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name")
        c = el.get("center") or {}
        if not name or "lat" not in c:
            continue
        out.append({"slug": slugify(name), "name": name,
                    "boundaryWay": el["id"], "type": el["type"],
                    "center": [round(c["lat"], 6), round(c["lon"], 6)],
                    "source": "osm"})
    return out


# --- CC0 GeoJSON bulk seed --------------------------------------------------
def cc0_courses():
    req = urllib.request.Request(CC0_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        gj = json.load(r)
    out = []
    for f in gj.get("features", []):
        p = f.get("properties", {})
        name, oid = p.get("name"), p.get("osm_id")
        if not name or not oid:
            continue
        out.append({"slug": slugify(name), "name": name,
                    "boundaryWay": int(oid), "type": "way",
                    "center": _centroid(f["geometry"]), "source": "cc0"})
    return out


def _centroid(geom):
    """Rough [lat,lon] centroid of a (Multi)Polygon's outer rings."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" \
        else [geom["coordinates"]]
    xs, ys = [], []
    for poly in polys:
        for lon, lat in poly[0]:    # outer ring
            xs.append(lon); ys.append(lat)
    return [round(sum(ys) / len(ys), 6), round(sum(xs) / len(xs), 6)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--overpass", action="store_true",
                    help="query live OSM for golf courses (needs --bbox/--around)")
    ap.add_argument("--bbox", help="S,W,N,E latitudes/longitudes")
    ap.add_argument("--around", help="lat,lon,radius_m")
    ap.add_argument("--seed-cc0", action="store_true",
                    help="bulk-seed North-American courses from the CC0 GeoJSON")
    ap.add_argument("--search", help="print indexed courses matching a substring")
    ap.add_argument("--list", action="store_true", help="print the whole index")
    ap.add_argument("--out", default=INDEX)
    args = ap.parse_args()

    idx = load_index(args.out)

    if args.list or args.search:
        q = (args.search or "").lower()
        rows = [(s, r) for s, r in sorted(idx.items())
                if not q or q in s or q in r["name"].lower()]
        for s, r in rows:
            print(f"  {s:<40} way {r['boundaryWay']:<12} {r['source']:<4} {r['name']}")
        print(f"  ({len(rows)} of {len(idx)} courses)")
        return

    found = []
    if args.overpass:
        if args.around:
            lat, lon, rad = args.around.split(",")
            clause = f"(around:{rad},{lat},{lon})"
        elif args.bbox:
            s, w, n, e = args.bbox.split(",")
            clause = f"({s},{w},{n},{e})"
        else:
            sys.exit("--overpass needs --bbox S,W,N,E or --around lat,lon,radius")
        found += overpass_courses(clause)
    if args.seed_cc0:
        found += cc0_courses()
    if not found:
        sys.exit("nothing to do — pass --overpass, --seed-cc0, --list or --search")

    added = sum(merge(idx, rec) for rec in found)
    save_index(args.out, idx)
    print(f"Indexed {len(found)} course(s) from this run, "
          f"{added} written/upgraded; index now {len(idx)} total -> {args.out}")
    for rec in found[:20]:
        print(f"  {rec['slug']:<40} way {rec['boundaryWay']:<12} "
              f"{rec['source']:<4} {rec['name']}")


if __name__ == "__main__":
    main()
