#!/usr/bin/env python3
"""LiDAR terrain bake — offline pipeline for the web course viewer (spec §4b).

Runs on your machine, NOT in the browser. Output is a static Terrarium tile
pyramid (+ optional per-green slope arrows) you host and point the viewer at via
`Course.terrainTiles`.

    3DEP point cloud  ->  ground DEM GeoTIFF  ->  Terrarium PNG tiles z10..z18
                                              \-> per-green slope arrows GeoJSON

The 7 steps (spec §4b): FETCH, CLASSIFY, GRID, COMPOSITE, SMOOTH, ENCODE, SERVE.
Steps 1-3 run through PDAL (tools/lidar/ground_dem.json.tmpl); 4-6 through GDAL +
rio-rgbify + gdal2tiles. This is orchestration glue, not an application — every
heavy stage shells out to an open-source binary.

External binaries required (guarded — missing ones abort with BLOCKED, never a
fake/flat tileset): `pdal`, `gdal_fillnodata.py`, `rio` (rio-rgbify plugin),
`gdal2tiles.py`. `numpy` (python) required for slope extraction. Install e.g.
`conda install -c conda-forge pdal gdal python-pdal rio-rgbify`.

Coordinate domains: this tool lives in GEOGRAPHIC space (lon/lat, UTM metres). It
does NOT know the game's world-unit coordinate system. Wiring LiDAR into the
existing 2D/three3d game `course.dem` grid is a separate change inside
fetch_course_global.py (swap its AWS Terrarium sampler for a GeoTIFF sampler —
that file has the per-course lat0/lon0/SCALE origin this one deliberately lacks).
See WORKFLOW.md Phase 1b "--emit-game-dem".

Usage:
    # bbox form (fastest — you already know the corners)
    python3 tools/bake_lidar.py --id pinehurst-no2 \
        --bbox -79.475,35.185,-79.455,35.205 \
        --greens courses/geo/pinehurst-no2-greens.geojson

    # boundary form (pull the course polygon from OSM like fetch_course does)
    python3 tools/bake_lidar.py --id four-oaks-dracut --boundary-rel 18442673

Exit codes: 0 ok, 2 BLOCKED (missing binary / no 3DEP coverage), 1 other error.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TMPL = os.path.join(HERE, "lidar", "ground_dem.json.tmpl")

# USGS 3DEP public entwine (EPT) point clouds on AWS Open Data. The boundary
# index lists every published resource + its footprint; we pick the one covering
# our bbox. Public 3DEP EPTs are stored in EPSG:3857 (Web Mercator).
USGS_LIDAR_BUCKET = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"
USGS_RESOURCES = (
    "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson"
)
UA = "golf-game-lidar-bake/1.0"
BUFFER_M_DEFAULT = 200.0
RESOLUTION_M = 0.5
ZMIN, ZMAX = 10, 18


def blocked(msg):
    """Spec §4b: a flat/zero tileset is the one failure mode the whole pipeline
    exists to prevent. When we cannot produce a real one, stop loudly."""
    print(f"BLOCKED: {msg}", file=sys.stderr)
    sys.exit(2)


def need(binary):
    if shutil.which(binary) is None:
        blocked(f"required binary '{binary}' not on PATH — see module docstring "
                f"for the conda install line")


# ---------------------------------------------------------------------------
# geo helpers
# ---------------------------------------------------------------------------
def lonlat_to_3857(lon, lat):
    R = 6378137.0
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    return x, y


def utm_epsg(lon, lat):
    """Metric SRS for honest 0.5 m cells: UTM zone of the bbox centre."""
    zone = int((lon + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def buffer_bbox_deg(minlon, minlat, maxlon, maxlat, buf_m):
    """Grow a lon/lat bbox outward by buf_m metres (§4b: +200 m so the horizon
    doesn't cliff off at the LiDAR boundary)."""
    lat0 = (minlat + maxlat) / 2
    dlat = buf_m / 111320.0
    dlon = buf_m / (111320.0 * max(0.1, math.cos(math.radians(lat0))))
    return (minlon - dlon, minlat - dlat, maxlon + dlon, maxlat + dlat)


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# step 0 — bbox resolution
# ---------------------------------------------------------------------------
def bbox_from_boundary(boundary_way, boundary_rel):
    """Pull the course polygon from OSM and return its lon/lat bbox. Reuses the
    same Overpass source fetch_course.py uses."""
    if boundary_rel:
        area = f"rel({boundary_rel});map_to_area->.a;"
    else:
        area = f"way({boundary_way});map_to_area->.a;"
    q = f"[out:json][timeout:60];{area}(way(area.a)[leisure=golf_course];);out geom;"
    data = fetch_json("https://overpass-api.de/api/interpreter?data=" +
                      urllib.request.quote(q))
    lons, lats = [], []
    for el in data.get("elements", []):
        for nd in el.get("geometry", []):
            lons.append(nd["lon"]); lats.append(nd["lat"])
    if not lons:
        blocked(f"OSM returned no golf_course geometry for "
                f"{'rel' if boundary_rel else 'way'} "
                f"{boundary_rel or boundary_way}")
    return min(lons), min(lats), max(lons), max(lats)


# ---------------------------------------------------------------------------
# step 1 — resolve the 3DEP EPT resource covering the bbox
# ---------------------------------------------------------------------------
def resolve_ept(bbox_deg):
    minlon, minlat, maxlon, maxlat = bbox_deg
    clon, clat = (minlon + maxlon) / 2, (minlat + maxlat) / 2
    print("FETCH: resolving 3DEP EPT resource for bbox centre "
          f"{clon:.5f},{clat:.5f} ...", flush=True)
    try:
        idx = fetch_json(USGS_RESOURCES)
    except Exception as e:
        blocked(f"could not fetch 3DEP resource index ({e}); pass --ept-url "
                f"explicitly if you already know the project")
    hits = []
    for feat in idx.get("features", []):
        if _point_in_feature(clon, clat, feat):
            name = feat.get("properties", {}).get("name") or \
                   feat.get("properties", {}).get("id")
            if name:
                hits.append(name)
    if not hits:
        blocked("no 3DEP LiDAR coverage for this bbox (US-only; international "
                "courses fall back to the global DEM — leave terrainTiles null). "
                "Spec §4b 'known gotchas'.")
    # Prefer the NEWEST acquisition — modern QL2 collects (e.g. *_2021) are far
    # denser/cleaner than legacy ARRA-era ones (~2011), and 3DEP often stacks
    # several projects over one spot. Sort by the year embedded in the name.
    def _year(n):
        ys = re.findall(r"(?:19|20)\d{2}", n)
        return max((int(y) for y in ys), default=0)
    hits.sort(key=_year, reverse=True)
    name = hits[0]
    if len(hits) > 1:
        print(f"FETCH: {len(hits)} overlapping projects, using newest '{name}' "
              f"(others: {', '.join(hits[1:])})", flush=True)
    return f"{USGS_LIDAR_BUCKET}/{name}/ept.json"


def _point_in_feature(lon, lat, feat):
    geom = feat.get("geometry") or {}
    polys = []
    if geom.get("type") == "Polygon":
        polys = [geom["coordinates"]]
    elif geom.get("type") == "MultiPolygon":
        polys = geom["coordinates"]
    for poly in polys:
        if poly and _pt_in_ring(lon, lat, poly[0]):
            return True
    return False


def _pt_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y0 > y) != (y1 > y):
            xint = (x1 - x0) * (y - y0) / (y1 - y0 + 1e-30) + x0
            if x < xint:
                inside = not inside
    return inside


# ---------------------------------------------------------------------------
# steps 1-3 — PDAL: clip + ground classify + grid to DEM GeoTIFF
# ---------------------------------------------------------------------------
def run_pdal(ept_url, bbox_deg, out_srs, out_tif, resolution):
    minlon, minlat, maxlon, maxlat = bbox_deg
    minx, miny = lonlat_to_3857(minlon, minlat)
    maxx, maxy = lonlat_to_3857(maxlon, maxlat)
    with open(TMPL) as f:
        pipe = f.read()
    for k, v in {
        "{{EPT_URL}}": ept_url,
        "{{MINX_3857}}": f"{minx:.3f}", "{{MAXX_3857}}": f"{maxx:.3f}",
        "{{MINY_3857}}": f"{miny:.3f}", "{{MAXY_3857}}": f"{maxy:.3f}",
        "{{OUT_SRS}}": out_srs,
        "{{OUT_TIF}}": out_tif,
        "{{RESOLUTION}}": str(resolution),
    }.items():
        pipe = pipe.replace(k, v)
    # strip the "//" comment keys (valid in template for humans, not for PDAL).
    # Rebuild a clean root {"pipeline": [...]} — PDAL rejects unknown root keys,
    # and the template carries "//" notes at both root and stage level.
    parsed = json.loads(pipe)
    pipe_obj = {"pipeline": [
        {k: v for k, v in stage.items() if k != "//"}
        for stage in parsed["pipeline"]
    ]}
    fd, pj = tempfile.mkstemp(suffix=".json", prefix="pdal_")
    with os.fdopen(fd, "w") as f:
        json.dump(pipe_obj, f)
    print(f"GRID: pdal pipeline -> {out_tif} @ {resolution} m ...", flush=True)
    r = subprocess.run(["pdal", "pipeline", pj], capture_output=True, text=True)
    os.unlink(pj)
    if r.returncode != 0:
        blocked(f"pdal pipeline failed:\n{r.stderr.strip()}")
    if not os.path.exists(out_tif) or os.path.getsize(out_tif) == 0:
        blocked("pdal produced no raster (empty clip? check bbox vs EPT extent)")


# ---------------------------------------------------------------------------
# steps 4-5 — fill voids (water/bunkers) + smooth. Spec §4b: smoothing is the
# real work, not cosmetic — do it BEFORE encoding, and take slope from it.
# ---------------------------------------------------------------------------
def fill_and_smooth(in_tif, out_tif):
    need("gdal_fillnodata.py")
    print("COMPOSITE/SMOOTH: fill voids + smooth ...", flush=True)
    r = subprocess.run(
        ["gdal_fillnodata.py", "-md", "50", "-si", "2", in_tif, out_tif],
        capture_output=True, text=True)
    if r.returncode != 0:
        blocked(f"gdal_fillnodata failed:\n{r.stderr.strip()}")
    # Drop the nodata tag now that voids are filled. rio rgbify's output is uint8
    # RGB and it inherits the source nodata (-9999), which is out of uint8 range
    # -> rasterio rejects the write. Unsetting it here (voids already filled) lets
    # the encode succeed. gdal_edit ships with gdal.
    if shutil.which("gdal_edit.py"):
        subprocess.run(["gdal_edit.py", "-unsetnodata", out_tif],
                       capture_output=True, text=True)
    # NOTE: fillnodata's -si 2 gives light smoothing; for putting-surface slope
    # extraction the green-local plane fit in extract_slope_arrows() does the
    # heavy denoising. A course-wide gaussian here would blur real fairway relief.


# ---------------------------------------------------------------------------
# step 6 — ENCODE to Terrarium PNG tiles z10..z18
# ---------------------------------------------------------------------------
def encode_tiles(dem_tif, out_dir, zmin, zmax):
    need("rio")
    need("gdal2tiles.py")
    os.makedirs(out_dir, exist_ok=True)
    rgb_tif = dem_tif.replace(".tif", "_terrarium.tif")
    # Terrarium: elevation = (R*256 + G + B/256) - 32768  ->  base -32768,
    # interval 1/256 = 0.00390625 m (4 mm vertical quant, spec §4).
    print("ENCODE: rio rgbify -> Terrarium RGB (4 mm quant) ...", flush=True)
    r = subprocess.run(
        ["rio", "rgbify", "-b", "-32768", "-i", "0.00390625",
         dem_tif, rgb_tif],
        capture_output=True, text=True)
    if r.returncode != 0:
        blocked(f"rio rgbify failed (is rio-rgbify installed?):\n{r.stderr.strip()}")
    print(f"SERVE: gdal2tiles z{zmin}-{zmax} -> {out_dir}/ ...", flush=True)
    r = subprocess.run(
        ["gdal2tiles.py", "-p", "mercator", "--xyz", "-r", "bilinear",
         "-z", f"{zmin}-{zmax}", "-w", "none", rgb_tif, out_dir],
        capture_output=True, text=True)
    if r.returncode != 0:
        blocked(f"gdal2tiles failed:\n{r.stderr.strip()}")


# ---------------------------------------------------------------------------
# slope arrows — smoothed-surface gradient per green (spec §4b). NEVER raw
# point-to-point: per-point error (~10 cm) ~ the signal (2%/3m green rises ~6 cm).
# ---------------------------------------------------------------------------
def extract_slope_arrows(dem_tif, greens_geojson, out_geojson, sample_m=2.5):
    try:
        import numpy as np
        from osgeo import gdal, osr
    except Exception as e:
        blocked(f"slope extraction needs numpy + GDAL python bindings ({e})")

    ds = gdal.Open(dem_tif)
    band = ds.GetRasterBand(1)
    arr = band.ReadAsArray().astype("float64")
    gt = ds.GetGeoTransform()          # (ox, px, 0, oy, 0, -py)
    ox, px, _, oy, _, py = gt
    nd = band.GetNoDataValue()
    if nd is not None:
        arr[arr == nd] = np.nan

    # transform of the DEM (UTM metres) -> WGS84 so we can place green polys
    src = osr.SpatialReference(); src.ImportFromWkt(ds.GetProjection())
    dst = osr.SpatialReference(); dst.ImportFromEPSG(4326)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_wgs = osr.CoordinateTransformation(src, dst)
    to_utm = osr.CoordinateTransformation(dst, src)

    greens = json.load(open(greens_geojson))
    feats = greens["features"] if greens.get("type") == "FeatureCollection" \
        else [greens]

    def sample(mx, my):
        c = (mx - ox) / px
        r = (my - oy) / py
        ci, ri = int(round(c)), int(round(r))
        if 0 <= ri < arr.shape[0] and 0 <= ci < arr.shape[1]:
            return arr[ri, ci]
        return np.nan

    out = []
    for gi, feat in enumerate(feats):
        geom = feat.get("geometry", {})
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        rings = geom["coordinates"] if geom["type"] == "Polygon" \
            else geom["coordinates"][0]
        ring = rings[0]
        # green centroid in UTM
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        mx, my, _ = to_utm.TransformPoint(cx, cy)
        # plane fit over a window of samples inside the green -> denoise. Slope
        # from the FITTED plane, not neighbouring cells.
        A, Z = [], []
        span = 12.0  # metres, ~ green radius sample window
        n = 7
        for j in range(n):
            for i in range(n):
                sx = mx + (i / (n - 1) - 0.5) * 2 * span
                sy = my + (j / (n - 1) - 0.5) * 2 * span
                z = sample(sx, sy)
                if not math.isnan(z):
                    A.append([sx - mx, sy - my, 1.0]); Z.append(z)
        if len(A) < 6:
            continue
        A = np.array(A); Z = np.array(Z)
        (a, b, _), *_ = np.linalg.lstsq(A, Z, rcond=None)
        # a = dz/d(east), b = dz/d(north). Downhill bearing from north, cw.
        slope_pct = 100.0 * math.hypot(a, b)
        bearing = (math.degrees(math.atan2(-a, -b)) + 360) % 360
        lon, lat, _ = to_wgs.TransformPoint(mx, my)
        out.append({
            "type": "Feature",
            "properties": {"kind": "slope",
                           "bearing": round(bearing, 1),
                           "magnitude": round(slope_pct, 2)},
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        })
        print(f"  green {gi}: {slope_pct:.2f}% @ {bearing:.0f}°", flush=True)

    if not out:
        print("WARN: no slope arrows extracted (greens outside DEM extent?)",
              file=sys.stderr)
    fc = {"type": "FeatureCollection", "features": out}
    with open(out_geojson, "w") as f:
        json.dump(fc, f, indent=2)
    print(f"slope: {len(out)} arrows -> {out_geojson}", flush=True)


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="LiDAR terrain bake (spec §4b)")
    ap.add_argument("--id", required=True, help="course id (tile dir name)")
    ap.add_argument("--bbox", help="minlon,minlat,maxlon,maxlat (play area, pre-buffer)")
    ap.add_argument("--boundary-way", type=int, help="OSM way id (leisure=golf_course)")
    ap.add_argument("--boundary-rel", type=int, help="OSM relation id")
    ap.add_argument("--ept-url", help="explicit 3DEP EPT ept.json URL (skip resolver)")
    ap.add_argument("--greens", help="GeoJSON of green polygons (WGS84) for slope arrows")
    ap.add_argument("--buffer", type=float, default=BUFFER_M_DEFAULT,
                    help="horizon buffer metres (default 200)")
    ap.add_argument("--resolution", type=float, default=RESOLUTION_M,
                    help="DEM cell metres (default 0.5)")
    ap.add_argument("--zoom", default=f"{ZMIN}-{ZMAX}", help="tile zoom range, e.g. 10-18")
    ap.add_argument("--out", default=None,
                    help="tile output dir (default web/public/tiles/<id>)")
    ap.add_argument("--work", default=None, help="scratch dir for intermediate tifs")
    ap.add_argument("--keep", action="store_true", help="keep intermediate GeoTIFFs")
    args = ap.parse_args()

    need("pdal")   # fail fast before any network work

    # bbox
    if args.bbox:
        parts = [float(x) for x in args.bbox.split(",")]
        if len(parts) != 4:
            sys.exit("--bbox needs minlon,minlat,maxlon,maxlat")
        bbox = tuple(parts)
    elif args.boundary_way or args.boundary_rel:
        bbox = bbox_from_boundary(args.boundary_way, args.boundary_rel)
    else:
        sys.exit("need one of --bbox / --boundary-way / --boundary-rel")
    bbox = buffer_bbox_deg(*bbox, args.buffer)
    clon, clat = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    out_srs = f"EPSG:{utm_epsg(clon, clat)}"
    print(f"bbox+buffer {bbox}  out_srs {out_srs}", flush=True)

    ept = args.ept_url or resolve_ept(bbox)
    print(f"EPT: {ept}", flush=True)

    zmin, zmax = (int(x) for x in args.zoom.split("-"))
    work = args.work or tempfile.mkdtemp(prefix=f"lidar_{args.id}_")
    os.makedirs(work, exist_ok=True)
    raw_tif = os.path.join(work, f"{args.id}_ground.tif")
    dem_tif = os.path.join(work, f"{args.id}_dem.tif")
    out_dir = args.out or os.path.join(HERE, "..", "web", "public", "tiles", args.id)

    run_pdal(ept, bbox, out_srs, raw_tif, args.resolution)
    fill_and_smooth(raw_tif, dem_tif)
    encode_tiles(dem_tif, out_dir, zmin, zmax)

    if args.greens:
        extract_slope_arrows(
            dem_tif, args.greens,
            os.path.join(os.path.dirname(out_dir.rstrip("/")),
                         f"{args.id}-slope.geojson"))

    rel = os.path.relpath(out_dir, os.path.join(HERE, ".."))
    print("\nDONE. Set in the web Course record:")
    print(f'  terrainTiles: "/{rel.replace(os.sep, "/")}/{{z}}/{{x}}/{{y}}.png"')
    print("  (maxzoom 18, encoding terrarium — spec §4)")
    if not args.keep and not args.work:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
