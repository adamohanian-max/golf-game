#!/usr/bin/env python3
"""
Bake a course as ONE connected map: a single north-up aerial covering the whole
course + all hole geometry in a shared global world frame. The game frames the
current hole as a sub-rect, so neighbouring holes show at the edges (connected),
and hole-to-hole transitions can pan across the map.

Contrast with fetch_course.py, which bakes each hole in its own rotated frame.

DEV tool. Reuses fetch_course.py helpers. Re-bake Pinehurst No. 2:
    PYTHONPATH=tools python3 tools/fetch_course_global.py \
        --boundary-way 1358696570 --id pinehurst-no2 --name "Pinehurst No. 2"
"""
import argparse, json, math, os, struct, sys, zlib
import urllib.request
import fetch_course as fc


def carve_synth_fairways(surfaces, jobs, aerial, img_path):
    """Replace each synth-fairway corridor in surfaces["fairway"] with a ribbon
    measured from the global aerial. Mutates surfaces in place; returns the count
    carved. No-op without Pillow / aerial / classifiable fairway (corridor kept)."""
    if fc.Image is None or not aerial or not jobs:
        return 0
    w2p = fc.invert_affine(*aerial["toWorld"])
    if w2p is None:
        return 0
    carved = 0
    with fc.Image.open(img_path) as im:
        im = im.convert("RGB")
        for idx, center, half in jobs:
            try:
                ribbon = fc.measure_fairway_ribbon(im, w2p, center, half)
            except Exception:
                ribbon = None
            if ribbon and idx < len(surfaces["fairway"]):
                surfaces["fairway"][idx] = [{"x": round(x, 2), "y": round(y, 2)}
                                            for (x, y) in ribbon]
                carved += 1
    return carved


# ---------------------------------------------------------------------------
# Minimal stdlib RGB PNG decoder (no Pillow needed). Handles filter types 0-4.
# ---------------------------------------------------------------------------
def _decode_png_rgb(data):
    """Decode an RGB8 PNG blob. Returns (width, height, pixels) where
    pixels is a list of (r,g,b) tuples in row-major order."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError("Not a PNG")
    pos = 8
    idat, width, height, color_type, bit_depth = [], 0, 0, 0, 0
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos+4])[0]
        ctype = data[pos+4:pos+8]
        cdata = data[pos+8:pos+8+length]
        pos += 12 + length
        if ctype == b'IHDR':
            width, height = struct.unpack('>II', cdata[:8])
            bit_depth, color_type = cdata[8], cdata[9]
        elif ctype == b'IDAT':
            idat.append(cdata)
        elif ctype == b'IEND':
            break
    if color_type != 2 or bit_depth != 8:
        raise ValueError(f"Expected RGB8 PNG, got type={color_type} depth={bit_depth}")
    raw = zlib.decompress(b''.join(idat))
    stride = width * 3
    pixels, prev = [], bytes(stride)
    for y in range(height):
        off = y * (stride + 1)
        filt = raw[off]
        row = bytearray(raw[off+1:off+1+stride])
        if filt == 1:   # Sub
            for x in range(3, stride): row[x] = (row[x] + row[x-3]) & 0xFF
        elif filt == 2: # Up
            for x in range(stride): row[x] = (row[x] + prev[x]) & 0xFF
        elif filt == 3: # Average
            for x in range(stride):
                a = row[x-3] if x >= 3 else 0
                row[x] = (row[x] + (a + prev[x]) // 2) & 0xFF
        elif filt == 4: # Paeth
            for x in range(stride):
                a = row[x-3] if x >= 3 else 0
                b = prev[x]; c = prev[x-3] if x >= 3 else 0
                p = a + b - c; pa = abs(p-a); pb = abs(p-b); pc = abs(p-c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 0xFF
        prev = bytes(row)
        for x in range(width):
            i = x * 3
            pixels.append((row[i], row[i+1], row[i+2]))
    return width, height, pixels


# ---------------------------------------------------------------------------
# AWS Terrain Tiles DEM baking (Terrarium PNG, z=14, no API key needed)
# ---------------------------------------------------------------------------
def bake_dem(Wd, Hd, MARGIN, SCALE, MINX, MAXY, lat0, lon0):
    """Download AWS Terrain Tiles and sample a world-unit elevation grid.
    Returns a dem dict {x0,y0,x1,y1,nx,ny,baseElevM,data} or None on failure.
    Elevation in data is metres above the minimum (relative), at ~2 world-unit
    grid spacing (~6 yards per cell)."""
    ZOOM, TPX = 14, 256

    def world_to_latlon(wx, wy):
        m_east  = (wx - MARGIN) / SCALE + MINX
        m_north = MAXY - (wy - MARGIN) / SCALE
        return fc.unproject(m_east, m_north, lat0, lon0)

    def latlon_to_gpx(lat, lon):
        """Float global-pixel coords at ZOOM (tile_coord × TPX)."""
        n = 1 << ZOOM
        xf = (lon + 180.0) / 360.0 * n
        lat_r = math.radians(lat)
        yf = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
        return xf * TPX, yf * TPX

    # Tile bounds from world corners
    all_gx, all_gy = [], []
    for wx in (0, Wd):
        for wy in (0, Hd):
            lat, lon = world_to_latlon(wx, wy)
            gx, gy = latlon_to_gpx(lat, lon)
            all_gx.append(gx); all_gy.append(gy)
    tx0 = max(0, int(min(all_gx)) // TPX)
    tx1 = int(max(all_gx)) // TPX
    ty0 = max(0, int(min(all_gy)) // TPX)
    ty1 = int(max(all_gy)) // TPX
    n_tiles = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    print(f"DEM: {n_tiles} tile(s) z={ZOOM} x={tx0}..{tx1} y={ty0}..{ty1}", flush=True)

    tiles = {}
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            url = (f"https://s3.amazonaws.com/elevation-tiles-prod/"
                   f"terrarium/{ZOOM}/{tx}/{ty}.png")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": fc.UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    raw = r.read()
                w, h, pix = _decode_png_rgb(raw)
                if w != TPX or h != TPX:
                    raise ValueError(f"unexpected tile size {w}x{h}")
                tiles[(tx, ty)] = pix
                print(f"  ok  tile {tx},{ty}", flush=True)
            except Exception as e:
                print(f"  err tile {tx},{ty}: {e}", flush=True)

    if not tiles:
        print("DEM: all tiles failed — skipping")
        return None

    def get_elev_at(gxi, gyi):
        tx, ty = gxi // TPX, gyi // TPX
        px = max(0, min(TPX - 1, gxi % TPX))
        py = max(0, min(TPX - 1, gyi % TPX))
        t = tiles.get((tx, ty))
        if t is None:
            return 0.0
        rv, gv, bv = t[py * TPX + px]
        return (rv * 256 + gv + bv / 256.0) - 32768.0

    # Sample grid at ~2 world-unit resolution
    nx = max(2, round(Wd / 2.0) + 1)
    ny = max(2, round(Hd / 2.0) + 1)
    elevs = []
    for j in range(ny):
        for i in range(nx):
            wx = i / (nx - 1) * Wd
            wy = j / (ny - 1) * Hd
            lat, lon = world_to_latlon(wx, wy)
            gxf, gyf = latlon_to_gpx(lat, lon)
            x0i, y0i = int(gxf), int(gyf)
            fx, fy = gxf - x0i, gyf - y0i
            e = (get_elev_at(x0i,   y0i)   * (1-fx) * (1-fy) +
                 get_elev_at(x0i+1, y0i)   *    fx  * (1-fy) +
                 get_elev_at(x0i,   y0i+1) * (1-fx) *    fy  +
                 get_elev_at(x0i+1, y0i+1) *    fx  *    fy)
            elevs.append(e)

    base = min(elevs)
    data = [round(e - base, 2) for e in elevs]
    print(f"DEM: {nx}x{ny} grid, base {base:.1f}m, "
          f"range 0..{max(data):.1f}m ({len(data)} pts)", flush=True)
    return {"x0": 0, "y0": 0, "x1": round(Wd, 2), "y1": round(Hd, 2),
            "nx": nx, "ny": ny, "baseElevM": round(base, 2), "data": data}

YPU = fc.YARDS_PER_UNIT          # 3 yards/unit
MPY = fc.M_PER_YARD
SCALE = 1.0 / (YPU * MPY)        # meters -> world units
MARGIN = fc.MARGIN_UNITS
IMG_MAX_PX = 2560                # one big aerial over the whole course
IMG_PAD = 1.04


def main():
    ap = argparse.ArgumentParser()
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--boundary-way", type=int)
    grp.add_argument("--boundary-rel", type=int)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--cache")
    ap.add_argument("--no-imagery", action="store_true")
    ap.add_argument("--no-dem", action="store_true",
                    help="Skip DEM elevation baking")
    ap.add_argument("--scorecard",
                    help="Path to a scorecard override JSON (defaults to "
                         "courses/scorecard/<id>.json if present)")
    ap.add_argument("--no-verify", action="store_true",
                    help="Skip the quality gate (verify_course.py) after baking")
    args = ap.parse_args()

    if args.boundary_rel:
        data = fc.fetch_overpass(args.boundary_rel, args.cache, kind="rel")
    else:
        data = fc.fetch_overpass(args.boundary_way, args.cache)
    els = [e for e in data["elements"] if "geometry" in e and e.get("tags")]
    by = lambda g: [e for e in els if e["tags"].get("golf") == g]
    byt = lambda k, v: [e for e in els if e["tags"].get(k) == v]
    greens, bunkers, waters, tees = by("green"), by("bunker"), by("water_hazard"), by("tee")
    fairways, cartpaths = by("fairway"), by("cartpath")
    roughs = by("rough")
    woods = byt("natural", "wood")
    grass = byt("landuse", "grass")
    waters = waters + byt("natural", "water")

    best = {}
    for h in by("hole"):
        n = fc.hole_num(h)
        if n is None:
            continue
        if n not in best or len(h["geometry"]) > len(best[n]["geometry"]):
            best[n] = h
    holes_sorted = [best[n] for n in sorted(best)]
    if not holes_sorted or not greens:
        sys.exit("No numbered hole lines or greens found.")

    pts = [(p["lat"], p["lon"]) for h in holes_sorted for p in h["geometry"]]
    lat0 = sum(p[0] for p in pts) / len(pts)
    lon0 = sum(p[1] for p in pts) / len(pts)

    def projall(geom):
        return [fc.project(p["lat"], p["lon"], lat0, lon0) for p in geom]

    # --- global bbox (meters) from play features: hole lines, greens, fairways, tees
    hole_lines = [(fc.hole_num(h), projall(h["geometry"])) for h in holes_sorted]
    bbox_pts = [p for _, lm in hole_lines for p in lm]
    for el in greens + fairways + tees + bunkers + waters:
        bbox_pts += projall(el["geometry"])
    MINX = min(p[0] for p in bbox_pts); MAXX = max(p[0] for p in bbox_pts)
    MINY = min(p[1] for p in bbox_pts); MAXY = max(p[1] for p in bbox_pts)

    # Secondary bbox query: natural=wood + landuse=forest near the course.
    # The boundary query misses trees mapped outside or with landuse=forest tags.
    _EXP = 400  # metres to expand beyond course bounds
    sw_lat, sw_lon = fc.unproject(MINX - _EXP, MINY - _EXP, lat0, lon0)
    ne_lat, ne_lon = fc.unproject(MAXX + _EXP, MAXY + _EXP, lat0, lon0)
    _bbox = f"{sw_lat:.5f},{sw_lon:.5f},{ne_lat:.5f},{ne_lon:.5f}"
    _wq = (f'[out:json][timeout:60];'
           f'(way["natural"="wood"]({_bbox});'
           f'way["landuse"="forest"]({_bbox}););out geom;')
    try:
        import urllib.parse as _up
        _req = urllib.request.Request(
            fc.OVERPASS + "?" + _up.urlencode({"data": _wq}),
            headers={"User-Agent": fc.UA})
        with urllib.request.urlopen(_req, timeout=70) as _r:
            _wd = json.load(_r)
        _added = 0
        for _we in _wd["elements"]:
            if "geometry" in _we:
                woods.append(_we)
                _added += 1
        print(f"woods bbox query: {_added} feature(s) added")
    except Exception as _e:
        print(f"! woods bbox query failed: {_e}", file=sys.stderr)

    def W(m):  # meters (east,north) -> global world units (north up = small y)
        return {"x": round((m[0] - MINX) * SCALE + MARGIN, 2),
                "y": round((MAXY - m[1]) * SCALE + MARGIN, 2)}
    def polyU(geom): return [W(p) for p in projall(geom)]

    world = {"w": round((MAXX - MINX) * SCALE + 2 * MARGIN, 2),
             "h": round((MAXY - MINY) * SCALE + 2 * MARGIN, 2)}

    # --- per-hole tee/pin in global coords (orient: pin = end nearest a green) ---
    gc = [(fc.centroid(projall(g["geometry"])), g) for g in greens]
    def nearest_green(pt): return min(gc, key=lambda c: fc.dist(pt, c[0]))
    surfaces = {"green": [], "fairway": [], "bunker": [], "water": [], "tee": [],
                "woods": [], "cartpath": [], "grass": [], "rough": []}
    out_holes, synth = [], 0
    synth_fw_jobs = []   # (index in surfaces["fairway"], centerline world pts, half_w units)
    # Scorecard override (par/yards/si): manual -> OSM tag -> par=4 / geom yards.
    scorecard = fc.load_scorecard(args.scorecard, args.id)
    card_count = 0
    # which holes have a real mapped fairway nearby (else synthesize a corridor)
    fw_assigned = {n: [] for n, _ in hole_lines}
    for el in fairways:
        c = fc.centroid(projall(el["geometry"]))
        n = min(hole_lines, key=lambda hl: fc.polyline_dist(c, hl[1]))
        if fc.polyline_dist(c, n[1]) <= fc.FAIRWAY_NEAR_YDS * MPY:
            fw_assigned[n[0]].append(el)

    for n, lm in hole_lines:
        h = best[n]
        card = scorecard.get(str(n), {})
        par, si, yov, _csrc = fc.resolve_card(h["tags"], card)
        d0 = fc.dist(lm[0], nearest_green(lm[0])[0])
        d1 = fc.dist(lm[-1], nearest_green(lm[-1])[0])
        if d0 < d1:
            lm = lm[::-1]
        tee_m, pin_m = lm[0], lm[-1]
        green_c = nearest_green(pin_m)[0]
        length_m = sum(fc.dist(lm[i], lm[i + 1]) for i in range(len(lm) - 1))
        geom_yards = round(length_m / MPY)
        rec = {"num": n, "par": par, "yards": yov if yov else geom_yards,
               "tee": W(tee_m), "pin": W(green_c)}
        if si is not None:
            rec["si"] = si
        if yov:                       # keep the geometric estimate for QA
            rec["geomYards"] = geom_yards
        out_holes.append(rec)
        if card:
            card_count += 1
        if yov and abs(yov - geom_yards) > 60:
            print(f"  ! hole {n}: scorecard {yov}y vs geometry {geom_yards}y "
                  f"— check hole numbering", file=sys.stderr)
        if not fw_assigned[n]:   # synthesize a fairway corridor for this hole
            corr = fc.fairway_corridor(lm, fc.FAIRWAY_HALF_W_YDS * MPY,
                                       fc.FAIRWAY_START_YDS * MPY)
            synth_fw_jobs.append((len(surfaces["fairway"]),
                                  [(W(p)["x"], W(p)["y"]) for p in lm],
                                  fc.FAIRWAY_HALF_W_YDS * MPY * SCALE))
            surfaces["fairway"].append([W(p) for p in corr])
            synth += 1

    # --- global surfaces (whole course, shared) ---
    for g in greens: surfaces["green"].append(polyU(g["geometry"]))
    for el in fairways: surfaces["fairway"].append(polyU(el["geometry"]))
    for el in bunkers: surfaces["bunker"].append(polyU(el["geometry"]))
    for el in waters: surfaces["water"].append(polyU(el["geometry"]))
    for el in tees: surfaces["tee"].append(polyU(el["geometry"]))
    for el in woods: surfaces["woods"].append(polyU(el["geometry"]))
    for el in cartpaths: surfaces["cartpath"].append(polyU(el["geometry"]))
    for el in grass: surfaces["grass"].append(polyU(el["geometry"]))
    for el in roughs: surfaces["rough"].append(polyU(el["geometry"]))   # mapped golf=rough

    # --- one global aerial: world rect -> merc bbox; pixel->world affine ---------
    def world_to_merc(wx, wy):
        mx = (wx - MARGIN) / SCALE + MINX
        my = MAXY - (wy - MARGIN) / SCALE
        lat, lon = fc.unproject(mx, my, lat0, lon0)
        return fc.lonlat_to_merc(lon, lat)
    def world_from_merc(MX, MY):
        lon, lat = fc.merc_to_lonlat(MX, MY)
        m = fc.project(lat, lon, lat0, lon0)
        return ((m[0] - MINX) * SCALE + MARGIN, (MAXY - m[1]) * SCALE + MARGIN)

    Wd, Hd = world["w"], world["h"]
    mc = [world_to_merc(*c) for c in ((0, 0), (Wd, 0), (Wd, Hd), (0, Hd))]
    xs = [m[0] for m in mc]; ys = [m[1] for m in mc]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    hw = (max(xs) - min(xs)) / 2 * IMG_PAD; hh = (max(ys) - min(ys)) / 2 * IMG_PAD
    Xmin, Xmax, Ymin, Ymax = cx - hw, cx + hw, cy - hh, cy + hh
    MW, MH = Xmax - Xmin, Ymax - Ymin
    if MW >= MH:
        pxw, pxh = IMG_MAX_PX, max(16, round(IMG_MAX_PX * MH / MW))
    else:
        pxh, pxw = IMG_MAX_PX, max(16, round(IMG_MAX_PX * MW / MH))

    def px_to_world(px, py):
        return world_from_merc(Xmin + px / pxw * MW, Ymax - py / pxh * MH)
    src = [(0, 0), (pxw, 0), (0, pxh)]
    to_world = fc.solve_affine(src, [px_to_world(*s) for s in src])

    rel = f"img/{args.id}/course.jpg"
    aerial = None if args.no_imagery else {
        "file": rel, "w": pxw, "h": pxh, "toWorld": [round(v, 6) for v in to_world]}

    # write the JSON FIRST so geometry is saved even if the image download is slow
    dem = None
    if not args.no_dem:
        dem = bake_dem(Wd, Hd, MARGIN, SCALE, MINX, MAXY, lat0, lon0)

    course = {"id": args.id, "name": args.name, "yardsPerUnit": YPU, "global": True,
              "world": world, "aerial": aerial, "surfaces": surfaces,
              "synthFairways": synth,
              "holes": sorted(out_holes, key=lambda h: h["num"])}
    if dem:
        course["dem"] = dem
    out = os.path.join(os.path.dirname(__file__), "..", "courses", args.id + ".json")
    with open(out, "w") as f:
        json.dump(course, f, separators=(",", ":"))
    print(f"Wrote {out}: {len(out_holes)} holes, world {world['w']}x{world['h']} units, "
          f"{synth} synthesized fairway(s)")
    real_holes = len(hole_lines) - synth
    par_total = sum(h["par"] for h in out_holes)
    dem_s = f"{dem['nx']}x{dem['ny']}" if dem else "none"
    print(f"  quality: par {par_total} | fairways {real_holes}/{len(hole_lines)} real "
          f"| scorecard {card_count}/{len(out_holes)} | DEM {dem_s} "
          f"| aerial {'yes' if aerial else 'no'}")
    # Esri export URL for the global aerial (curl this separately if it times out):
    esri_url = (fc.ESRI + "?" + __import__("urllib.parse", fromlist=["urlencode"]).urlencode({
        "bbox": f"{Xmin},{Ymin},{Xmax},{Ymax}", "bboxSR": "3857", "imageSR": "3857",
        "size": f"{pxw},{pxh}", "format": "jpg", "f": "image"}))
    print("AERIAL_PXW_PXH", pxw, pxh)
    print("AERIAL_URL", esri_url)
    if not args.no_imagery:
        out_dir = os.path.join(os.path.dirname(__file__), "..", "courses")
        os.makedirs(os.path.join(out_dir, "img", args.id), exist_ok=True)
        try:
            fc.fetch_aerial((Xmin, Ymin, Xmax, Ymax), pxw, pxh, os.path.join(out_dir, rel))
            print(f"aerial baked {pxw}x{pxh} -> courses/{rel}")
            # Carve synth fairways from the now-downloaded aerial, then re-dump JSON.
            carved = carve_synth_fairways(surfaces, synth_fw_jobs, aerial,
                                          os.path.join(out_dir, rel))
            if carved:
                with open(out, "w") as f:
                    json.dump(course, f, separators=(",", ":"))
                print(f"  ({carved} synth fairway(s) carved from the aerial; JSON re-written)")
        except Exception as e:
            print(f"  ! aerial download failed ({e}); curl AERIAL_URL -> courses/{rel}")

    # --- quality gate: every bake self-grades against the Pinehurst standard ---
    if not args.no_verify:
        import subprocess
        gate = os.path.join(os.path.dirname(__file__), "verify_course.py")
        print("\n--- quality gate (verify_course.py) ---")
        rc = subprocess.run([sys.executable, gate, args.id]).returncode
        if rc != 0:
            print("  ! gate did NOT pass — fix the FAIL lines above before shipping "
                  "this course (re-run: python3 tools/verify_course.py " + args.id + ").",
                  file=sys.stderr)


if __name__ == "__main__":
    main()
