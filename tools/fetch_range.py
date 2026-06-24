#!/usr/bin/env python3
"""
Bake a real driving range into courses/range.json (+ aerial) for the game's
practice mode. Models Pinehurst's practice range (OSM golf=driving_range,
way 739455156) so the range shares the photoreal look of Pinehurst No. 2.

DEV tool, not part of the build. Reuses the aerial/affine machinery from
fetch_course.py. Re-bake:
    python3 tools/fetch_range.py
"""
import json, math, os, urllib.parse, urllib.request
import fetch_course as fc   # reuse project/unproject/merc/affine/fetch_aerial

RANGE_WAY = 739455156           # Pinehurst practice range
YARDS_PER_UNIT = 3.0
M_PER_YARD = fc.M_PER_YARD
MARGIN_UNITS = 12
IMG_MAX_PX = fc.IMG_MAX_PX
IMG_PAD = fc.IMG_PAD
WIDTH_YDS = 95                  # downrange strip half-handled below


def fetch_geom(way):
    q = f"[out:json][timeout:60];way({way});out geom;"
    req = urllib.request.Request(fc.OVERPASS,
        data=urllib.parse.urlencode({"data": q}).encode(),
        headers={"User-Agent": fc.UA})
    d = json.load(urllib.request.urlopen(req, timeout=90))
    return d["elements"][0]["geometry"]


def main():
    geom = fetch_geom(RANGE_WAY)
    lat0 = sum(p["lat"] for p in geom) / len(geom)
    lon0 = sum(p["lon"] for p in geom) / len(geom)
    pts = [fc.project(p["lat"], p["lon"], lat0, lon0) for p in geom]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)

    # principal axis (long downrange direction) via covariance
    sxx = sum((p[0]-cx)**2 for p in pts); syy = sum((p[1]-cy)**2 for p in pts)
    sxy = sum((p[0]-cx)*(p[1]-cy) for p in pts)
    th = 0.5 * math.atan2(2*sxy, sxx-syy)
    axis = (math.cos(th), math.sin(th)); perp = (-axis[1], axis[0])

    along = [(p[0]-cx)*axis[0] + (p[1]-cy)*axis[1] for p in pts]
    cross = [(p[0]-cx)*perp[0] + (p[1]-cy)*perp[1] for p in pts]
    amin, amax = min(along), max(along)
    med = (amin + amax) / 2
    # tee end = the narrower end of the fan (small cross-spread)
    near = [cross[i] for i in range(len(pts)) if along[i] < med]
    far  = [cross[i] for i in range(len(pts)) if along[i] >= med]
    def spread(v): return (max(v)-min(v)) if v else 0
    if spread([c for i,c in enumerate(cross) if along[i] < med]) > \
       spread([c for i,c in enumerate(cross) if along[i] >= med]):
        axis = (-axis[0], -axis[1]); perp = (-perp[0], -perp[1])
        along = [-a for a in along]; amin, amax = -amax, -amin

    tee_m = (cx + amin*axis[0], cy + amin*axis[1])    # narrow (tee) end
    pin_m = (cx + amax*axis[0], cy + amax*axis[1])    # open (downrange) end

    # --- world frame: tee at bottom, downrange straight up (mirrors build_hole) -
    u = fc.unit(fc.sub(pin_m, tee_m)); nrm = (-u[1], u[0])
    def to_frame(p):
        rel = fc.sub(p, tee_m)
        a = rel[0]*u[0] + rel[1]*u[1]
        s = rel[0]*nrm[0] + rel[1]*nrm[1]
        return (s, -a)
    SCALE = 1.0 / (YARDS_PER_UNIT * M_PER_YARD)

    poly = [to_frame(p) for p in pts]
    half = WIDTH_YDS * M_PER_YARD
    allpts = poly + [to_frame(tee_m), to_frame(pin_m),
                     (-half, 0), (half, 0)]
    minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
    miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)

    def fix(p):
        return {"x": round((p[0]-minx)*SCALE + MARGIN_UNITS, 2),
                "y": round((p[1]-miny)*SCALE + MARGIN_UNITS, 2)}
    world = {"w": round((maxx-minx)*SCALE + 2*MARGIN_UNITS, 2),
             "h": round((maxy-miny)*SCALE + 2*MARGIN_UNITS, 2)}
    tee_pt = fix(to_frame(tee_m)); pin_pt = fix(to_frame(pin_m))

    # --- aerial: world rect -> Web Mercator bbox; pixel->world affine ----------
    def world_to_merc(wx, wy):
        fx = (wx - MARGIN_UNITS)/SCALE + minx
        fy = (wy - MARGIN_UNITS)/SCALE + miny
        s, a = fx, -fy
        mx = tee_m[0] + s*nrm[0] + a*u[0]
        my = tee_m[1] + s*nrm[1] + a*u[1]
        lat, lon = fc.unproject(mx, my, lat0, lon0)
        return fc.lonlat_to_merc(lon, lat)

    def world_from_merc(mx, my):
        lon, lat = fc.merc_to_lonlat(mx, my)
        fr = to_frame(fc.project(lat, lon, lat0, lon0))
        return ((fr[0]-minx)*SCALE + MARGIN_UNITS, (fr[1]-miny)*SCALE + MARGIN_UNITS)

    W, H = world["w"], world["h"]
    mc = [world_to_merc(*c) for c in ((0, 0), (W, 0), (W, H), (0, H))]
    xs = [m[0] for m in mc]; ys = [m[1] for m in mc]
    mcx, mcy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
    hw = (max(xs)-min(xs))/2*IMG_PAD; hh = (max(ys)-min(ys))/2*IMG_PAD
    Xmin, Xmax, Ymin, Ymax = mcx-hw, mcx+hw, mcy-hh, mcy+hh
    MW, MH = Xmax-Xmin, Ymax-Ymin
    if MW >= MH:
        pxw, pxh = IMG_MAX_PX, max(16, round(IMG_MAX_PX*MH/MW))
    else:
        pxh, pxw = IMG_MAX_PX, max(16, round(IMG_MAX_PX*MW/MH))

    def px_to_world(px, py):
        return world_from_merc(Xmin + px/pxw*MW, Ymax - py/pxh*MH)
    src = [(0, 0), (pxw, 0), (0, pxh)]
    to_world = fc.solve_affine(src, [px_to_world(*s) for s in src])

    os.makedirs("courses/img/range", exist_ok=True)
    fc.fetch_aerial((Xmin, Ymin, Xmax, Ymax), pxw, pxh, "courses/img/range/range.jpg")

    rec = {
        "id": "range", "name": "Pinehurst Practice Range",
        "yardsPerUnit": YARDS_PER_UNIT,
        "world": world, "tee": tee_pt, "pin": pin_pt,
        "aerial": {"file": "img/range/range.jpg", "w": pxw, "h": pxh,
                   "toWorld": [round(v, 6) for v in to_world]},
        "surfaces": {"green": [], "fairway": [[fix(p) for p in poly]],
                     "bunker": [], "water": [], "tee": [],
                     "woods": [], "cartpath": [], "grass": []},
    }
    with open("courses/range.json", "w") as f:
        json.dump(rec, f)
    print(f"baked range: world {world['w']}x{world['h']} units, "
          f"img {pxw}x{pxh}, tee {tee_pt}, downrange end {pin_pt}")


if __name__ == "__main__":
    main()
