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
import argparse, json, math, os, sys
import fetch_course as fc

YPU = fc.YARDS_PER_UNIT          # 3 yards/unit
MPY = fc.M_PER_YARD
SCALE = 1.0 / (YPU * MPY)        # meters -> world units
MARGIN = fc.MARGIN_UNITS
IMG_MAX_PX = 2560                # one big aerial over the whole course
IMG_PAD = 1.04


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundary-way", type=int, required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--cache")
    ap.add_argument("--no-imagery", action="store_true")
    args = ap.parse_args()

    data = fc.fetch_overpass(args.boundary_way, args.cache)
    els = [e for e in data["elements"] if "geometry" in e and e.get("tags")]
    by = lambda g: [e for e in els if e["tags"].get("golf") == g]
    byt = lambda k, v: [e for e in els if e["tags"].get(k) == v]
    greens, bunkers, waters, tees = by("green"), by("bunker"), by("water_hazard"), by("tee")
    fairways, cartpaths = by("fairway"), by("cartpath")
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
                "woods": [], "cartpath": [], "grass": []}
    out_holes, synth = [], 0
    # which holes have a real mapped fairway nearby (else synthesize a corridor)
    fw_assigned = {n: [] for n, _ in hole_lines}
    for el in fairways:
        c = fc.centroid(projall(el["geometry"]))
        n = min(hole_lines, key=lambda hl: fc.polyline_dist(c, hl[1]))
        if fc.polyline_dist(c, n[1]) <= fc.FAIRWAY_NEAR_YDS * MPY:
            fw_assigned[n[0]].append(el)

    for n, lm in hole_lines:
        h = best[n]
        par = int(h["tags"].get("par", 4))
        d0 = fc.dist(lm[0], nearest_green(lm[0])[0])
        d1 = fc.dist(lm[-1], nearest_green(lm[-1])[0])
        if d0 < d1:
            lm = lm[::-1]
        tee_m, pin_m = lm[0], lm[-1]
        green_c = nearest_green(pin_m)[0]
        length_m = sum(fc.dist(lm[i], lm[i + 1]) for i in range(len(lm) - 1))
        out_holes.append({"num": n, "par": par, "yards": round(length_m / MPY),
                          "tee": W(tee_m), "pin": W(green_c)})
        if not fw_assigned[n]:   # synthesize a fairway corridor for this hole
            corr = fc.fairway_corridor(lm, fc.FAIRWAY_HALF_W_YDS * MPY,
                                       fc.FAIRWAY_START_YDS * MPY)
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
    course = {"id": args.id, "name": args.name, "yardsPerUnit": YPU, "global": True,
              "world": world, "aerial": aerial, "surfaces": surfaces,
              "holes": sorted(out_holes, key=lambda h: h["num"])}
    out = os.path.join(os.path.dirname(__file__), "..", "courses", args.id + ".json")
    with open(out, "w") as f:
        json.dump(course, f, separators=(",", ":"))
    print(f"Wrote {out}: {len(out_holes)} holes, world {world['w']}x{world['h']} units, "
          f"{synth} synthesized fairway(s)")
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
        except Exception as e:
            print(f"  ! aerial download failed ({e}); curl AERIAL_URL -> courses/{rel}")


if __name__ == "__main__":
    main()
