#!/usr/bin/env python3
"""
Phase 2 data-prep: pull real golf-course geometry from OpenStreetMap (Overpass)
and bake it into a normalized JSON the game loads at runtime.

This is a DEV tool, not part of the game build. The game itself stays
build-stepless and just fetches the static courses/<id>.json this produces.

Usage:
    python3 tools/fetch_course.py --boundary-way 1019045811 \
        --id st-andrews-old --name "St Andrews Links — Old Course"

Data source: OSM `golf=*` ways plus `natural=wood|water` and `landuse=grass`.
We keep real greens/bunkers/water/tees/fairways (+ woods/cartpaths/grass), and
SYNTHESIZE a fairway corridor only for holes with no mapped fairway. Geometry is
projected to a flat metric frame, rotated per hole so the tee is at the bottom
and the pin straight up, and scaled to world units at a FIXED yards-per-unit so a
given swing means the same distance on every hole.

We ALSO bake one north-up aerial photo per hole (Esri World Imagery, keyless)
plus a pixel->world affine, so the game can draw a real satellite base under the
play surfaces. Disable with --no-imagery.
"""
import argparse, json, math, os, re, sys, urllib.parse, urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
ESRI = ("https://services.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/export")
UA = "golf-game-dev/1.0 (course baking)"
R_EARTH = 6378137.0

# --- Tunables for the bake -------------------------------------------------
YARDS_PER_UNIT = 3.0      # world scale: 1 unit = 3 yards (consistent across holes)
M_PER_YARD = 0.9144
FAIRWAY_HALF_W_YDS = 18   # synthesized fairway corridor half-width
FAIRWAY_START_YDS = 25    # corridor starts this far ahead of the tee
GREEN_NEAR_M = 70         # max dist pin->green centroid to associate a green
FAIRWAY_NEAR_YDS = 70     # real fairway assigned to a hole if centroid within this
BUNKER_NEAR_YDS = 50      # bunker assigned to a hole if centroid within this
WATER_NEAR_YDS = 70
TEE_NEAR_YDS = 35
WOODS_NEAR_YDS = 90       # woods/grass are big & numerous -> wider catch
GRASS_NEAR_YDS = 60
CARTPATH_NEAR_YDS = 45
MARGIN_UNITS = 12         # padding around hole geometry -> world bounds
IMG_MAX_PX = 1536         # long side of each baked aerial image
IMG_PAD = 1.06            # expand aerial footprint past the world rect a touch


# --- Overpass --------------------------------------------------------------
def fetch_overpass(boundary_way, cache):
    if cache and os.path.exists(cache):
        with open(cache) as f:
            return json.load(f)
    q = (f'[out:json][timeout:90];way({boundary_way});map_to_area->.oc;'
         f'(way(area.oc)["golf"];'
         f'way(area.oc)["natural"~"wood|water"];'
         f'way(area.oc)["landuse"="grass"];);'
         f'out tags geom;')
    req = urllib.request.Request(
        OVERPASS + "?" + urllib.parse.urlencode({"data": q}),
        headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    if cache:
        with open(cache, "w") as f:
            json.dump(data, f)
    return data


# --- Geometry helpers (plain math, no deps) --------------------------------
def project(lat, lon, lat0, lon0):
    """Equirectangular lat/lon -> meters around (lat0, lon0)."""
    x = math.radians(lon - lon0) * math.cos(math.radians(lat0)) * 6378137.0
    y = math.radians(lat - lat0) * 6378137.0
    return (x, y)


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def seg_dist(p, a, b):
    """Distance from point p to segment a-b."""
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return dist(p, a)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return dist(p, (ax + t * dx, ay + t * dy))


def polyline_dist(p, line):
    return min(seg_dist(p, line[i], line[i + 1]) for i in range(len(line) - 1))


def fairway_corridor(line, half_w, start_skip):
    """Buffer a polyline into a corridor polygon (left side + right side back).
    half_w and start_skip in meters. line is tee->pin in meters."""
    # trim the first `start_skip` meters off the tee end so the corridor
    # starts out in front of the tee box, like a real fairway.
    trimmed = trim_front(line, start_skip)
    if len(trimmed) < 2:
        trimmed = line
    left, right = [], []
    n = len(trimmed)
    for i, p in enumerate(trimmed):
        # average direction at this vertex
        if i == 0:
            d = sub(trimmed[1], trimmed[0])
        elif i == n - 1:
            d = sub(trimmed[-1], trimmed[-2])
        else:
            d = add(unit(sub(trimmed[i], trimmed[i - 1])),
                    unit(sub(trimmed[i + 1], trimmed[i])))
        u = unit(d)
        normal = (-u[1], u[0])
        left.append((p[0] + normal[0] * half_w, p[1] + normal[1] * half_w))
        right.append((p[0] - normal[0] * half_w, p[1] - normal[1] * half_w))
    return left + right[::-1]


def trim_front(line, skip):
    out, acc = [], 0.0
    for i in range(len(line) - 1):
        seg = dist(line[i], line[i + 1])
        if acc + seg >= skip:
            t = (skip - acc) / seg
            start = (line[i][0] + (line[i + 1][0] - line[i][0]) * t,
                     line[i][1] + (line[i + 1][1] - line[i][1]) * t)
            return [start] + line[i + 1:]
        acc += seg
    return line[-1:]


def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def unit(a):
    m = math.hypot(*a)
    return (a[0] / m, a[1] / m) if m else (0.0, 0.0)


# --- Projection inverse + Web Mercator + affine (for aerial imagery) --------
def unproject(x, y, lat0, lon0):
    """Inverse of project(): meters around (lat0,lon0) -> (lat, lon)."""
    lat = lat0 + math.degrees(y / R_EARTH)
    lon = lon0 + math.degrees(x / (R_EARTH * math.cos(math.radians(lat0))))
    return (lat, lon)


def lonlat_to_merc(lon, lat):
    x = math.radians(lon) * R_EARTH
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R_EARTH
    return (x, y)


def merc_to_lonlat(x, y):
    lon = math.degrees(x / R_EARTH)
    lat = math.degrees(2 * math.atan(math.exp(y / R_EARTH)) - math.pi / 2)
    return (lon, lat)


def solve_affine(src, dst):
    """3 (sx,sy)->(dx,dy) correspondences -> [a,b,c,d,e,f] with
    dx = a*sx + b*sy + c,  dy = d*sx + e*sy + f.  (Cramer's rule)"""
    (x0, y0), (x1, y1), (x2, y2) = src
    det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1)
    def coeffs(d0, d1, d2):
        a = (d0 * (y1 - y2) - y0 * (d1 - d2) + (d1 * y2 - d2 * y1)) / det
        b = (x0 * (d1 - d2) - d0 * (x1 - x2) + (x1 * d2 - x2 * d1)) / det
        c = (x0 * (y1 * d2 - y2 * d1) - y0 * (x1 * d2 - x2 * d1)
             + d0 * (x1 * y2 - x2 * y1)) / det
        return a, b, c
    a, b, c = coeffs(dst[0][0], dst[1][0], dst[2][0])
    d, e, f = coeffs(dst[0][1], dst[1][1], dst[2][1])
    return [a, b, c, d, e, f]


def fetch_aerial(merc_bbox, w, h, out_path):
    """Download a north-up Esri World Imagery JPG for a Web Mercator bbox."""
    xmin, ymin, xmax, ymax = merc_bbox
    url = ESRI + "?" + urllib.parse.urlencode({
        "bbox": f"{xmin},{ymin},{xmax},{ymax}", "bboxSR": "3857",
        "imageSR": "3857", "size": f"{w},{h}", "format": "jpg", "f": "image"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    with open(out_path, "wb") as fh:
        fh.write(data)


# Hole number from an OSM `ref` (handles "7" and "7 - #2"); None if unparseable.
def hole_num(el):
    m = re.match(r"\s*(\d+)", str(el.get("tags", {}).get("ref", "")))
    return int(m.group(1)) if m else None


# --- Scorecard layer -------------------------------------------------------
# Free, deterministic per-hole {par, yards, si} overrides typed from a course's
# published scorecard. Merge precedence (highest first): manual override ->
# GolfAPI.io (optional, key-gated) -> OSM tags -> par=4 fallback. This fixes the
# par=4 default and gives real yardage without any paid dependency.
def load_scorecard(path, cid):
    """Read courses/scorecard/<id>.json (or an explicit path). Accepts either
    {"holes": {"1": {...}}} or a flat {"1": {...}}. Returns {str(hole): rec}."""
    if not path:
        path = os.path.join(os.path.dirname(__file__), "..", "courses",
                            "scorecard", cid + ".json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        doc = json.load(f)
    holes = doc.get("holes", doc) if isinstance(doc, dict) else {}
    return {str(k): v for k, v in holes.items()}


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# Resolve a hole's par/si/yards from the merge chain. `osm_tags` is the OSM
# hole-line tag dict; `card` is the manual override for this hole (may be {}).
def resolve_card(osm_tags, card):
    par = to_int(card.get("par")) or to_int(osm_tags.get("par")) or 4
    si = to_int(card.get("si")) or to_int(osm_tags.get("handicap"))
    yards = to_int(card.get("yards"))   # only the scorecard gives real yardage
    src = "scorecard" if card else ("osm" if osm_tags.get("par") else "default")
    return par, si, yards, src


# --- Build one hole --------------------------------------------------------
# `line_m` is the projected (meters) centerline; `fairway_els`/`bunker_els` are
# the real OSM polygons already assigned to THIS hole (fairway may be empty,
# in which case we fall back to a synthesized corridor).
def build_hole(cid, num, par, line_m, greens, fairway_els, bunker_els, waters,
               tees, woods_els, cartpath_els, grass_els, lat0, lon0,
               si=None, yards_override=None):
    line_m = list(line_m)

    # Orient: pin = endpoint nearest a green centroid; tee = the other end.
    gc = [(centroid([project(p["lat"], p["lon"], lat0, lon0) for p in g["geometry"]]), g)
          for g in greens]
    def nearest_green(pt):
        best = min(gc, key=lambda c: dist(pt, c[0]))
        return best, dist(pt, best[0])
    (_, d_start) = nearest_green(line_m[0])
    (_, d_end) = nearest_green(line_m[-1])
    if d_start < d_end:
        line_m = line_m[::-1]
    tee_m, pin_m = line_m[0], line_m[-1]
    (green_c, green_el), green_d = nearest_green(pin_m)

    length_m = sum(dist(line_m[i], line_m[i + 1]) for i in range(len(line_m) - 1))
    geom_yards = round(length_m / M_PER_YARD)
    # Real scorecard yardage (if provided) is authoritative; geometry is a fallback.
    yards = yards_override if yards_override else geom_yards

    # Per-hole frame: u = tee->pin direction. Map u -> screen-up (-y).
    u = unit(sub(pin_m, tee_m))
    nrm = (-u[1], u[0])
    def to_frame(p):
        rel = sub(p, tee_m)
        along = rel[0] * u[0] + rel[1] * u[1]   # 0 at tee, +length at pin
        side = rel[0] * nrm[0] + rel[1] * nrm[1]
        return (side, -along)                    # screen: up is -y, tee at bottom

    SCALE = 1.0 / (YARDS_PER_UNIT * M_PER_YARD)   # meters -> world units

    def poly_units(geom):
        return [to_frame(project(p["lat"], p["lon"], lat0, lon0)) for p in geom]

    surfaces = {"green": [], "fairway": [], "bunker": [], "water": [], "tee": [],
                "woods": [], "cartpath": [], "grass": []}

    # green for this hole
    if green_d <= GREEN_NEAR_M:
        surfaces["green"].append(poly_units(green_el["geometry"]))

    # fairway: prefer the REAL OSM polygons assigned to this hole; only if there
    # are none do we synthesize a corridor (links courses w/o mapped fairways).
    synth_fw = not fairway_els
    if fairway_els:
        for el in fairway_els:
            surfaces["fairway"].append(poly_units(el["geometry"]))
    else:
        corridor = fairway_corridor(line_m, FAIRWAY_HALF_W_YDS * M_PER_YARD,
                                    FAIRWAY_START_YDS * M_PER_YARD)
        surfaces["fairway"].append([to_frame(p) for p in corridor])

    # nearest-hole pre-assigned polygons (bunker/woods/cartpath/grass)
    for el in bunker_els:
        surfaces["bunker"].append(poly_units(el["geometry"]))
    for el in woods_els:
        surfaces["woods"].append(poly_units(el["geometry"]))
    for el in cartpath_els:
        surfaces["cartpath"].append(poly_units(el["geometry"]))  # polyline
    for el in grass_els:
        surfaces["grass"].append(poly_units(el["geometry"]))

    # water near the hole line; tee box nearest the tee point
    for el in waters:
        g = [project(p["lat"], p["lon"], lat0, lon0) for p in el["geometry"]]
        if polyline_dist(centroid(g), line_m) <= WATER_NEAR_YDS * M_PER_YARD:
            surfaces["water"].append([to_frame(p) for p in g])
    tee_best, tee_best_d = None, 1e9
    for el in tees:
        g = [project(p["lat"], p["lon"], lat0, lon0) for p in el["geometry"]]
        dd = dist(centroid(g), tee_m)
        if dd < tee_best_d:
            tee_best, tee_best_d = g, dd
    if tee_best and tee_best_d <= TEE_NEAR_YDS * M_PER_YARD:
        surfaces["tee"].append([to_frame(p) for p in tee_best])

    # bounds from PLAY surfaces only (woods/grass/cartpath can sprawl far and
    # would bloat the world rect / camera) plus the tee & pin.
    play_keys = ("green", "fairway", "bunker", "water", "tee")
    allpts = [to_frame(tee_m), to_frame(pin_m)]
    for k in play_keys:
        for poly in surfaces[k]:
            allpts += poly
    minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
    miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)

    def fix(p):
        return {"x": round((p[0] - minx) * SCALE + MARGIN_UNITS, 2),
                "y": round((p[1] - miny) * SCALE + MARGIN_UNITS, 2)}

    out_surfaces = {k: [[fix(p) for p in poly] for poly in v] for k, v in surfaces.items()}
    tee_pt = fix(to_frame(tee_m)); pin_pt = fix(to_frame(pin_m))
    world = {"w": round((maxx - minx) * SCALE + 2 * MARGIN_UNITS, 2),
             "h": round((maxy - miny) * SCALE + 2 * MARGIN_UNITS, 2)}

    # --- aerial: world rect -> Web Mercator bbox; pixel->world affine ---------
    def world_to_merc(wx, wy):
        fx = (wx - MARGIN_UNITS) / SCALE + minx
        fy = (wy - MARGIN_UNITS) / SCALE + miny
        side, along = fx, -fy                       # invert to_frame
        mx = tee_m[0] + side * nrm[0] + along * u[0]
        my = tee_m[1] + side * nrm[1] + along * u[1]
        lat, lon = unproject(mx, my, lat0, lon0)
        return lonlat_to_merc(lon, lat)

    def world_from_merc(mx, my):
        lon, lat = merc_to_lonlat(mx, my)
        fr = to_frame(project(lat, lon, lat0, lon0))
        return ((fr[0] - minx) * SCALE + MARGIN_UNITS,
                (fr[1] - miny) * SCALE + MARGIN_UNITS)

    W, H = world["w"], world["h"]
    mcorners = [world_to_merc(*c) for c in ((0, 0), (W, 0), (W, H), (0, H))]
    xs = [m[0] for m in mcorners]; ys = [m[1] for m in mcorners]
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
    to_world = solve_affine(src, [px_to_world(*s) for s in src])

    rel = f"img/{cid}/hole{num}.jpg"
    aerial = {"file": rel, "w": pxw, "h": pxh, "toWorld": [round(v, 6) for v in to_world]}
    aerial_meta = {"merc": (Xmin, Ymin, Xmax, Ymax), "w": pxw, "h": pxh, "rel": rel}

    hole_rec = {"num": num, "par": par, "yards": yards, "world": world,
                "tee": tee_pt, "pin": pin_pt, "aerial": aerial,
                "surfaces": out_surfaces}
    if si is not None:
        hole_rec["si"] = si                       # stroke index (handicap rank)
    if yards_override:
        hole_rec["geomYards"] = geom_yards        # keep the geometric estimate for QA
    return (hole_rec, synth_fw, aerial_meta)


# Resolve --boundary-way/--id/--name from courses/index.json by slug, so a course
# can be baked by name once build_index.py has indexed it.
def resolve_from_index(slug):
    path = os.path.join(os.path.dirname(__file__), "..", "courses", "index.json")
    if not os.path.exists(path):
        sys.exit(f"no course index ({path}); run tools/build_index.py first")
    with open(path) as f:
        idx = json.load(f)
    key = slug if slug in idx else re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
    rec = idx.get(key)
    if not rec:
        sys.exit(f"'{slug}' not in index; try: build_index.py --search {slug}")
    if rec.get("type") == "relation":
        print(f"  ! '{key}' is an OSM relation; the baker expects a way "
              f"boundary — bake may fail.", file=sys.stderr)
    return rec["boundaryWay"], key, rec["name"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-index", metavar="SLUG",
                    help="resolve boundary-way/id/name from courses/index.json")
    ap.add_argument("--boundary-way", type=int)
    ap.add_argument("--id")
    ap.add_argument("--name")
    ap.add_argument("--cache")
    ap.add_argument("--out")
    ap.add_argument("--no-imagery", action="store_true",
                    help="skip baking aerial photos (vector-only)")
    ap.add_argument("--scorecard",
                    help="scorecard override JSON (par/yards/si per hole); "
                         "defaults to courses/scorecard/<id>.json if present")
    ap.add_argument("--golfapi-course",
                    help="optional GolfAPI.io course id for par/yards/si "
                         "(needs GOLFAPI_KEY env); manual --scorecard still wins")
    args = ap.parse_args()

    if args.from_index:
        bw, cid, name = resolve_from_index(args.from_index)
        args.boundary_way = args.boundary_way or bw
        args.id = args.id or cid          # explicit flags still override the index
        args.name = args.name or name
    if not (args.boundary_way and args.id and args.name):
        ap.error("need --from-index SLUG, or all of --boundary-way/--id/--name")

    data = fetch_overpass(args.boundary_way, args.cache)
    els = [e for e in data["elements"] if "geometry" in e and e.get("tags")]
    by = lambda g: [e for e in els if e["tags"].get("golf") == g]
    byt = lambda k, v: [e for e in els if e["tags"].get(k) == v]
    greens, bunkers, waters, tees = by("green"), by("bunker"), by("water_hazard"), by("tee")
    fairways, cartpaths = by("fairway"), by("cartpath")
    woods = byt("natural", "wood")
    grass = byt("landuse", "grass")
    # OSM water lives under golf=water_hazard and/or natural=water
    waters = waters + byt("natural", "water")

    # Dedupe hole lines by parsed number, keeping the most-detailed geometry.
    best = {}
    for h in by("hole"):
        n = hole_num(h)
        if n is None:
            continue
        if n not in best or len(h["geometry"]) > len(best[n]["geometry"]):
            best[n] = h
    holes_sorted = [best[n] for n in sorted(best)]
    if not holes_sorted or not greens:
        sys.exit("No (numbered) hole lines or greens found — check the boundary way / tags.")

    # course-wide projection anchor = centroid of all hole-line points
    pts = [(p["lat"], p["lon"]) for h in holes_sorted for p in h["geometry"]]
    lat0 = sum(p[0] for p in pts) / len(pts)
    lon0 = sum(p[1] for p in pts) / len(pts)

    # Precompute each hole's projected centerline; assign fairways/bunkers to the
    # nearest hole (so each real polygon belongs to exactly one hole).
    hole_lines = [(hole_num(h), h, [project(p["lat"], p["lon"], lat0, lon0)
                                    for p in h["geometry"]]) for h in holes_sorted]

    def assign(items, cap_yds):
        res = {n: [] for n, _, _ in hole_lines}
        cap = cap_yds * M_PER_YARD
        for el in items:
            c = centroid([project(p["lat"], p["lon"], lat0, lon0) for p in el["geometry"]])
            best_n, best_d = None, 1e18
            for n, _, lm in hole_lines:
                d = polyline_dist(c, lm)
                if d < best_d:
                    best_d, best_n = d, n
            if best_n is not None and best_d <= cap:
                res[best_n].append(el)
        return res

    fw_by_hole = assign(fairways, FAIRWAY_NEAR_YDS)
    bk_by_hole = assign(bunkers, BUNKER_NEAR_YDS)
    wd_by_hole = assign(woods, WOODS_NEAR_YDS)
    cp_by_hole = assign(cartpaths, CARTPATH_NEAR_YDS)
    gr_by_hole = assign(grass, GRASS_NEAR_YDS)

    out_dir = os.path.dirname(args.out or os.path.join(
        os.path.dirname(__file__), "..", "courses", args.id + ".json"))
    img_dir = os.path.join(out_dir, "img", args.id)
    if not args.no_imagery:
        os.makedirs(img_dir, exist_ok=True)

    scorecard = load_scorecard(args.scorecard, args.id)
    # Optional, key-gated GolfAPI.io layer: fills holes the manual card omits.
    if args.golfapi_course:
        from sources import golfapi_io
        for n, rec in golfapi_io.fetch_scorecard(args.golfapi_course).items():
            merged = dict(rec); merged.update(scorecard.get(n, {}))  # manual wins
            scorecard[n] = merged
    if scorecard:
        print(f"  (scorecard override: {len(scorecard)} hole(s))")

    out_holes, synth_count, img_count, card_count = [], 0, 0, 0
    for n, h, lm in hole_lines:
        par, si, yov, src = resolve_card(h["tags"], scorecard.get(str(n), {}))
        if src == "scorecard":
            card_count += 1
        try:
            hole, synth, am = build_hole(
                args.id, n, par, lm, greens, fw_by_hole[n], bk_by_hole[n],
                waters, tees, wd_by_hole[n], cp_by_hole[n], gr_by_hole[n], lat0, lon0,
                si=si, yards_override=yov)
            # QA: flag big scorecard-vs-geometry yardage gaps (mis-keyed hole, etc.)
            if yov and abs(yov - hole.get("geomYards", yov)) > 60:
                print(f"  ! hole {n}: scorecard {yov}y vs geometry "
                      f"{hole['geomYards']}y — check hole numbering", file=sys.stderr)
            if args.no_imagery:
                hole.pop("aerial", None)
            else:
                try:
                    fetch_aerial(am["merc"], am["w"], am["h"],
                                 os.path.join(out_dir, am["rel"]))
                    img_count += 1
                except Exception as e:
                    print(f"  ! aerial fetch failed hole {n}: {e}", file=sys.stderr)
                    hole.pop("aerial", None)
            out_holes.append(hole)
            if synth:
                synth_count += 1
        except Exception as e:
            print(f"  ! skipped hole {n}: {e}", file=sys.stderr)
    if synth_count:
        print(f"  ({synth_count} hole(s) had no mapped fairway -> synthesized corridor)")
    if not args.no_imagery:
        print(f"  ({img_count} aerial image(s) baked into {img_dir})")

    course = {"id": args.id, "name": args.name,
              "yardsPerUnit": YARDS_PER_UNIT, "holes": out_holes}
    out = args.out or os.path.join(os.path.dirname(__file__), "..", "courses",
                                   args.id + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(course, f, separators=(",", ":"))
    par_total = sum(h["par"] for h in out_holes)
    print(f"Wrote {out}: {len(out_holes)} holes, par {par_total}"
          f" ({card_count} hole(s) from scorecard)")
    for h in out_holes:
        s = h["surfaces"]
        si = f" si{h['si']:>2}" if "si" in h else ""
        print(f"  #{h['num']:>2} par {h['par']} {h['yards']:>3}y{si}  "
              f"world {h['world']['w']}x{h['world']['h']}  "
              f"green={len(s['green'])} fw={len(s['fairway'])} "
              f"bunker={len(s['bunker'])} water={len(s['water'])} tee={len(s['tee'])}")


if __name__ == "__main__":
    main()
