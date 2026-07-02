#!/usr/bin/env python3
"""Rebuild surfacemask.png for already-baked courses — offline, no Overpass.

Re-runs fetch_course.build_surface_mask over the existing baked aerial
(courses/img/<id>/course.jpg) + course JSON (boundary, surfaces, holes), so
classification fixes (envelope union/dilation, sand rescue) reach every course
without a network rebake. Overwrites the PNG and updates the JSON surfaceMask
record in place.

Usage:
  python3 tools/remask_courses.py                 # all global courses with an aerial
  python3 tools/remask_courses.py --only a,b,c    # restrict to slugs
  python3 tools/remask_courses.py --dry-run       # list what would be done
  python3 tools/remask_courses.py --audit         # metrics only, change nothing:
      per course, mask-OB inside OSM fairway polys + runtime-OB (mask-OB or
      outside-boundary, minus OSM-protected surfaces) in an 8-unit tee->pin band
      + mask-WOODS (also a penalty) inside the guard halo around OSM greens.
"""
import argparse, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_course as fc
from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
SKIP = {"index", "manifest", "geocode", "range"}
AUDIT_BAND_UNITS = 8  # half-width of the tee->pin "near play" audit band


def course_slugs(only):
    for fn in sorted(os.listdir(COURSES)):
        if not fn.endswith(".json"):
            continue
        slug = fn[:-5]
        if slug in SKIP or (only and slug not in only):
            continue
        yield slug


def load(slug):
    with open(os.path.join(COURSES, slug + ".json")) as f:
        return json.load(f)


def corridors_from_holes(holes):
    lines = []
    for h in holes:
        t, p = h.get("tee"), h.get("pin")
        if t and p:
            lines.append([t, p])
    return lines


def _rasters(course, sm):
    """Audit rasters in mask space: (labels, fairway, protected, boundary, band)."""
    pf = os.path.join(COURSES, sm["file"])
    im = Image.open(pf)
    w, h = im.size
    lab = Image.frombytes("L", (w, h), im.tobytes())
    w2p = fc.invert_affine(*sm["toWorld"])
    ia, ib, ic, id_, ie, if_ = w2p

    def proj(p):
        return (ia * p["x"] + ib * p["y"] + ic, id_ * p["x"] + ie * p["y"] + if_)

    def fill(polys):
        r = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(r)
        for poly in polys:
            pts = [proj(p) for p in poly]
            if len(pts) >= 3:
                d.polygon(pts, fill=255)
        return r

    surf = course.get("surfaces", {})
    fw = fill(surf.get("fairway", []))
    prot = fill(surf.get("bunker", []) + surf.get("water", [])
                + surf.get("green", []) + surf.get("tee", []))
    bnd = fill(course.get("boundary") or []) if course.get("boundary") else None
    band = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(band)
    upp = math.hypot(sm["toWorld"][0], sm["toWorld"][3]) or 1.0
    wd = max(1, round(2 * AUDIT_BAND_UNITS / upp))
    for line in corridors_from_holes(course.get("holes", [])):
        p1, p2 = proj(line[0]), proj(line[1])
        d.line([p1, p2], fill=255, width=wd)
    return lab, fw, prot, bnd, band


def audit_course(slug):
    """Returns (obFW%, band8%, wdGrn%) or None if the course has no mask."""
    course = load(slug)
    sm = course.get("surfaceMask")
    if not sm or not os.path.exists(os.path.join(COURSES, sm["file"])):
        return None
    lab, fw, prot, bnd, band = _rasters(course, sm)
    obm = lab.point([255 if i == 0 else 0 for i in range(256)])
    # runtime OB = mask OB minus OSM-protected surfaces (mask-first surfaceAt;
    # the boundary polygon only matters off-mask, which the mask raster covers)
    runtime = ImageChops.multiply(obm, ImageChops.invert(prot))
    # mask-OB inside mapped fairway (mask outranks OSM fairway at runtime)
    ob_fw = ImageChops.multiply(obm, fw).histogram()[255]
    n_fw = fw.histogram()[255]
    ob_band = ImageChops.multiply(runtime, band).histogram()[255]
    n_band = band.histogram()[255]
    # WOODS (also a penalty surface) hugging greens: canopy shade misread as
    # forest turns near-green misses into OB — the Four Oaks complaint
    upp = math.hypot(sm["toWorld"][0], sm["toWorld"][3]) or 1.0
    surf = course.get("surfaces", {})
    grn = Image.new("L", lab.size, 0)
    d = ImageDraw.Draw(grn)
    w2p = fc.invert_affine(*sm["toWorld"])
    ia, ib, ic, id_, ie, if_ = w2p
    for poly in surf.get("green", []):
        pts = [(ia * p["x"] + ib * p["y"] + ic,
                id_ * p["x"] + ie * p["y"] + if_) for p in poly]
        if len(pts) >= 3:
            d.polygon(pts, fill=255)
    grn = fc._dilate(grn, fc.MASK_PLAY_GUARD_UNITS / upp)
    wdm = lab.point([255 if i == 3 else 0 for i in range(256)])
    wd_grn = ImageChops.multiply(wdm, grn).histogram()[255]
    n_grn = grn.histogram()[255]
    return (100.0 * ob_fw / n_fw if n_fw else 0.0,
            100.0 * ob_band / n_band if n_band else 0.0,
            100.0 * wd_grn / n_grn if n_grn else 0.0)


def remask(slug, dry):
    course = load(slug)
    aerial = course.get("aerial")
    if not course.get("global") or not aerial or not aerial.get("file"):
        return "skip (no global aerial)"
    img_path = os.path.join(COURSES, aerial["file"])
    if not os.path.exists(img_path):
        return "skip (aerial jpg missing)"
    if dry:
        return "would remask"
    surf = course.get("surfaces", {})
    mrel = f"img/{slug}/surfacemask.png"
    mask = fc.build_surface_mask(
        img_path, aerial, course.get("world"), surf.get("woods", []),
        corridors_from_holes(course.get("holes", [])),
        os.path.join(COURSES, mrel),
        boundary=course.get("boundary"),
        bunker_world=surf.get("bunker", []),
        envelope_polys=(surf.get("fairway", []) + surf.get("green", [])
                        + surf.get("tee", [])),
        guard_polys=(surf.get("green", []) + surf.get("tee", [])
                     + surf.get("bunker", [])))
    if not mask:
        return "FAIL (build_surface_mask returned None)"
    mask["file"] = mrel
    course["surfaceMask"] = mask
    with open(os.path.join(COURSES, slug + ".json"), "w") as f:
        json.dump(course, f, separators=(",", ":"))
    return f"remasked {mask['w']}x{mask['h']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated slugs")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--audit", action="store_true",
                    help="print OB metrics per course and exit (changes nothing)")
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}

    if args.audit:
        rows = []
        for slug in course_slugs(only):
            r = audit_course(slug)
            if r:
                rows.append((slug, *r))
        rows.sort(key=lambda r: -(r[2] + r[3]))
        print(f"{'course':46} {'obFW%':>6} {'band8%':>7} {'wdGrn%':>7}")
        for slug, obfw, band, wdgrn in rows:
            print(f"{slug:46} {obfw:6.1f} {band:7.1f} {wdgrn:7.1f}")
        n_bad = sum(1 for r in rows if r[2] > 5 or r[1] > 1 or r[3] > 2)
        print(f"-- {len(rows)} courses, {n_bad} with band8>5%, obFW>1% or wdGrn>2%")
        return

    ok = fail = skip = 0
    for slug in course_slugs(only):
        msg = remask(slug, args.dry_run)
        print(f"{slug}: {msg}", flush=True)
        if msg.startswith("remasked") or msg == "would remask":
            ok += 1
        elif msg.startswith("skip"):
            skip += 1
        else:
            fail += 1
    print(f"-- done: {ok} remasked, {skip} skipped, {fail} failed")


if __name__ == "__main__":
    main()
