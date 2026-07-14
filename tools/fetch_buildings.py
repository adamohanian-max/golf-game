#!/usr/bin/env python3
"""Fetch OSM building footprints for a baked course and write them in WORLD
units so the 3D engine (three3d/course3d.js) can extrude real building massing —
the clubhouse, cart barn, and surrounding houses — instead of leaving them as
flat rooftops painted on the aerial.

Course-agnostic: works for any course whose JSON has a `geo.toLonLat` affine
(from tools/geo_anchor_course.py). Output is a SEPARATE file
`courses/buildings/<id>.json` — it never rewrites the course JSON, so it's safe
to run alongside other in-progress edits.

    python3 tools/fetch_buildings.py --id four-oaks-dracut

Output shape:
    {"id": "...", "buildings": [{"poly": [[x,y],...], "h": <metres>}, ...]}

x,y are course world units (same frame as course.surfaces.*). h is the extrude
height in metres (from OSM height / building:levels, else a default).
"""
import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request

UA = "golf-game-buildings/1.0 (course massing bake)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
LEVEL_M = 3.2          # metres per building level when only levels are tagged
DEFAULT_H = 4.5        # metres when a building has no height/levels tag
MIN_H, MAX_H = 2.5, 60.0


def load_course(cid):
    path = os.path.join(os.path.dirname(__file__), "..", "courses", cid + ".json")
    with open(path) as f:
        c = json.load(f)
    if "geo" not in c or "toLonLat" not in c["geo"]:
        sys.exit(f"{cid}: no geo.toLonLat affine — run tools/geo_anchor_course.py first")
    return c


def world_bbox_lonlat(course):
    a, b, c, d, e, f = course["geo"]["toLonLat"]
    W, H = course["world"]["w"], course["world"]["h"]
    lons, lats = [], []
    for x, y in ((0, 0), (W, 0), (0, H), (W, H)):
        lons.append(a * x + b * y + c)
        lats.append(d * x + e * y + f)
    return min(lons), min(lats), max(lons), max(lats)


def inv_affine(geo):
    """Return a lon/lat -> world (x,y) function inverting geo.toLonLat."""
    a, b, c, d, e, f = geo["toLonLat"]
    det = a * e - b * d
    if abs(det) < 1e-18:
        sys.exit("degenerate geo affine")
    def to_world(lon, lat):
        u, v = lon - c, lat - f
        x = (e * u - b * v) / det
        y = (-d * u + a * v) / det
        return x, y
    return to_world


def parse_height(tags):
    h = tags.get("height")
    if h:
        try:
            return max(MIN_H, min(MAX_H, float(str(h).split()[0].replace("m", ""))))
        except ValueError:
            pass
    lv = tags.get("building:levels")
    if lv:
        try:
            return max(MIN_H, min(MAX_H, float(lv) * LEVEL_M))
        except ValueError:
            pass
    return DEFAULT_H


def overpass(bbox):
    minlon, minlat, maxlon, maxlat = bbox
    q = (f"[out:json][timeout:90];"
         f'(way["building"]({minlat},{minlon},{maxlat},{maxlon});'
         f' relation["building"]({minlat},{minlon},{maxlat},{maxlon}););'
         f"out geom;")
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as ex:      # noqa: BLE001 — try the next mirror
            last = ex
            print(f"  overpass {url} failed: {ex}", flush=True)
    sys.exit(f"all Overpass endpoints failed: {last}")


def rings_from_element(el):
    """Yield lon/lat rings for a way (its geometry) or a relation (outer ways)."""
    if el["type"] == "way" and el.get("geometry"):
        yield [(n["lon"], n["lat"]) for n in el["geometry"]]
    elif el["type"] == "relation":
        for mem in el.get("members", []):
            if mem.get("role") == "outer" and mem.get("geometry"):
                yield [(n["lon"], n["lat"]) for n in mem["geometry"]]


def main():
    ap = argparse.ArgumentParser(description="Bake OSM building footprints (world units)")
    ap.add_argument("--id", required=True, help="course id (courses/<id>.json)")
    ap.add_argument("--min-area", type=float, default=12.0,
                    help="drop footprints smaller than this (world-unit^2); kills map noise")
    args = ap.parse_args()

    course = load_course(args.id)
    bbox = world_bbox_lonlat(course)
    to_world = inv_affine(course["geo"])
    print(f"{args.id}: bbox {bbox}", flush=True)

    data = overpass(bbox)
    W, H = course["world"]["w"], course["world"]["h"]
    pad = 8.0  # keep footprints a touch outside the world rect (edge houses)
    out = []
    for el in data.get("elements", []):
        h = parse_height(el.get("tags", {}))
        for ring in rings_from_element(el):
            if len(ring) < 4:
                continue
            pts = [to_world(lon, lat) for lon, lat in ring]
            # clip out footprints fully outside the (padded) world rect
            if all(x < -pad or x > W + pad or y < -pad or y > H + pad for x, y in pts):
                continue
            # shoelace area (world units^2) to drop slivers/noise
            area = abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
                           for i in range(len(pts) - 1))) / 2.0
            if area < args.min_area:
                continue
            out.append({"poly": [[round(x, 2), round(y, 2)] for x, y in pts],
                        "h": round(h, 1)})

    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "courses", "buildings"),
                exist_ok=True)
    dest = os.path.join(os.path.dirname(__file__), "..", "courses", "buildings", args.id + ".json")
    with open(dest, "w") as f:
        json.dump({"id": args.id, "buildings": out}, f, separators=(",", ":"))
    tallest = max((b["h"] for b in out), default=0)
    print(f"Wrote {dest}: {len(out)} footprints, tallest {tallest} m", flush=True)


if __name__ == "__main__":
    main()
