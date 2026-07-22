#!/usr/bin/env python3
"""
Post-bake CV audit — score every baked course for look/consistency, flag the
worst offenders (thin-OSM courses especially) so re-bake / enhancement effort
goes where it pays.

    python3 tools/cv_audit.py                 # audit all, print ranked table
    python3 tools/cv_audit.py --only a,b      # just these ids
    python3 tools/cv_audit.py --json courses/audit.json   # also write report
    python3 tools/cv_audit.py --top 15        # show N worst

READ-ONLY. Never mutates a course. It measures three things per course:

  1. Structural completeness (JSON) — green/fairway/bunker/water counts vs the
     peer distribution. Flags absurd outliers (vesper 1 green, inverness 0
     bunkers) and thin-OSM courses (a handful of bunkers on an 18-holer).

  2. Missing-bunker CV (aerial) — detect sand-coloured pixels inside the
     playing envelope, subtract the area already covered by mapped bunker
     polygons. A high uncovered-sand fraction == real sand the game never
     draws as a bunker. This is the biggest "looks fake" signal on thin courses.

  3. Turf tone (aerial) — mean LAB of fairway-polygon pixels. Courses whose
     turf tone is a z-score outlier (winter brown / washed out / blue cast)
     read as mismatched in the picker and in play; they are the tone-normalize
     work list.

Needs Pillow (pip install pillow). No OpenCV / no model weights — same
dependency floor as the rest of the bake pipeline.

KNOWN LIMIT: sand is detected from RGB only (no NIR band), so bright warm
non-turf inside the boundary — clubhouse roofs, parking, bare dirt, dormant
bermuda — can alias to "sand". The missing-bunker flag is therefore strongest
when it co-occurs with thin-bunkers/no-bunkers (priority >= 5); a standalone
missing-bunkers flag on a lush, well-bunkered course is advisory, not gospel.
Blob-size gating or an NDVI proxy would tighten it — future work.
"""
import argparse, colorsys, glob, json, math, os, statistics, sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow required: pip3 install pillow", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.join(os.path.dirname(__file__), "..")
YPU = 3.0                      # yards per world unit (see fetch_course.py)
WORK_PX = 640                  # long side we downscale the aerial to for sampling
SKIP_IDS = {"manifest", "index", "tour_venues", "geocode", "range", "course_tags"}

# --- sand pixel heuristic (mirrors fetch_course.MASK_SAND_*) --------------
SAND_HUE_MAX = 65.0 / 360.0    # warm hue ceiling (colorsys hue is 0..1)
SAND_SAT_LO, SAND_SAT_HI = 0.08, 0.35
SAND_VAL_MIN = 0.55            # sand is bright
# --- turf pixel heuristic (mirrors FW_* band) -----------------------------
FW_HUE_LO, FW_HUE_HI = 60 / 360.0, 160 / 360.0
FW_VAL_MIN, FW_VAL_MAX, FW_SAT_MIN = 0.30, 0.92, 0.12


def inv_affine(tw):
    """world(x,y) -> pixel(px,py), inverse of toWorld=[a,b,c,d,e,f]."""
    a, b, c, d, e, f = tw
    det = a * e - b * d
    if abs(det) < 1e-12:
        return None
    ia, ib = e / det, -b / det
    id_, ie = -d / det, a / det
    ic = -(ia * c + ib * f)
    if_ = -(id_ * c + ie * f)
    return (ia, ib, ic, id_, ie, if_)


def w2p(inv, x, y):
    a, b, c, d, e, f = inv
    return (a * x + b * y + c, d * x + e * y + f)


def is_sand(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return v >= SAND_VAL_MIN and SAND_SAT_LO <= s <= SAND_SAT_HI and \
        (h <= SAND_HUE_MAX or h >= 0.92)


def is_turf(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return FW_HUE_LO <= h <= FW_HUE_HI and FW_VAL_MIN <= v <= FW_VAL_MAX and s >= FW_SAT_MIN


def rgb_to_lab(r, g, b):
    """sRGB 0..255 -> CIELAB (D65). Small, dependency-free."""
    def lin(c):
        c /= 255
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    R, G, B = lin(r), lin(g), lin(b)
    X = R * 0.4124 + G * 0.3576 + B * 0.1805
    Y = R * 0.2126 + G * 0.7152 + B * 0.0722
    Z = R * 0.0193 + G * 0.1192 + B * 0.9505
    X, Y, Z = X / 0.95047, Y, Z / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(X), f(Y), f(Z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def poly_mask(polys, inv, W, H):
    """Rasterize world-space polygons into an L mask at working resolution."""
    m = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(m)
    for poly in polys or []:
        pts = [w2p(inv, p["x"], p["y"]) for p in poly]
        if len(pts) >= 3:
            dr.polygon(pts, fill=255)
    return m


def audit_course(cid, rec):
    surfaces = rec.get("surfaces") or {}
    holes = rec.get("holes") or []
    out = {
        "id": cid, "holes": len(holes),
        "green": len(surfaces.get("green", []) or []),
        "fairway": len(surfaces.get("fairway", []) or []),
        "bunker": len(surfaces.get("bunker", []) or []),
        "water": len(surfaces.get("water", []) or []),
        "has_aerial": "aerial" in rec, "has_mask": "surfaceMask" in rec,
        "has_dem": "dem" in rec, "has_boundary": "boundary" in rec,
        "flags": [],
    }

    aer = rec.get("aerial")
    if not aer or "toWorld" not in aer:
        return out
    fpath = os.path.join(ROOT, "courses", aer["file"])
    if not os.path.exists(fpath):
        out["flags"].append("aerial-missing-file")
        return out

    inv_full = inv_affine(aer["toWorld"])
    if not inv_full:
        return out
    try:
        img = Image.open(fpath).convert("RGB")
    except Exception:
        out["flags"].append("aerial-unreadable")
        return out

    fw, fh = img.size
    scale = WORK_PX / max(fw, fh)
    W, H = max(1, round(fw * scale)), max(1, round(fh * scale))
    small = img.resize((W, H), Image.BILINEAR)
    # working-res world->pixel: aerial px are 1/scale bigger, so scale the affine
    a, b, c, d, e, f = inv_full
    inv = (a * scale, b * scale, c * scale, d * scale, e * scale, f * scale)
    px_area_units = abs(aer["toWorld"][0] * aer["toWorld"][4] -
                        aer["toWorld"][1] * aer["toWorld"][3]) / (scale * scale)

    env = poly_mask(rec.get("boundary") or [], inv, W, H)
    if not rec.get("boundary"):
        # fall back to union of all play surfaces if no boundary polygon
        allp = []
        for k in ("fairway", "green", "tee", "bunker"):
            allp += surfaces.get(k, []) or []
        env = poly_mask(allp, inv, W, H)
    bunk = poly_mask(surfaces.get("bunker", []), inv, W, H)
    fwm = poly_mask(surfaces.get("fairway", []), inv, W, H)
    # bright non-sand surfaces the detector otherwise mistakes for sand
    excl = poly_mask((surfaces.get("cartpath", []) or []) +
                     (surfaces.get("green", []) or []) +
                     (surfaces.get("tee", []) or []) +
                     (surfaces.get("water", []) or []), inv, W, H)

    px = small.load()
    em, bm, fm, xm = env.load(), bunk.load(), fwm.load(), excl.load()
    sand_in, sand_uncov, bunk_px, turf_lab, turf_n = 0, 0, 0, [0.0, 0.0, 0.0], 0
    for y in range(H):
        for x in range(W):
            if bm[x, y]:
                bunk_px += 1
            if not em[x, y]:
                continue
            r, g, bb = px[x, y]
            if is_sand(r, g, bb):
                sand_in += 1
                if not bm[x, y] and not xm[x, y]:
                    sand_uncov += 1
            if fm[x, y] and is_turf(r, g, bb):
                L, A, B = rgb_to_lab(r, g, bb)
                turf_lab[0] += L; turf_lab[1] += A; turf_lab[2] += B
                turf_n += 1

    out["bunker_units2"] = round(bunk_px * px_area_units, 1)
    out["sand_units2"] = round(sand_in * px_area_units, 1)
    out["sand_uncovered_units2"] = round(sand_uncov * px_area_units, 1)
    out["sand_uncovered_frac"] = round(sand_uncov / sand_in, 3) if sand_in else 0.0
    # unmapped sand relative to what IS mapped as bunker — the real signal
    out["sand_unmapped_ratio"] = round(sand_uncov / bunk_px, 2) if bunk_px else \
        (999.0 if sand_uncov else 0.0)
    if turf_n:
        out["turf_lab"] = [round(turf_lab[i] / turf_n, 1) for i in range(3)]
        out["turf_px"] = turf_n
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated course ids")
    ap.add_argument("--json", help="write full report to this path")
    ap.add_argument("--top", type=int, default=20, help="rows to print (worst first)")
    args = ap.parse_args()

    only = set(args.only.split(",")) if args.only else None
    rows = []
    for fp in sorted(glob.glob(os.path.join(ROOT, "courses", "*.json"))):
        cid = os.path.basename(fp)[:-5]
        if cid in SKIP_IDS or (only and cid not in only):
            continue
        try:
            rec = json.load(open(fp))
        except Exception:
            continue
        if not isinstance(rec.get("surfaces"), dict):
            continue
        print(f"  audit {cid} ...", file=sys.stderr)
        rows.append(audit_course(cid, rec))

    # --- peer distributions for outlier flags ---
    def med(key):
        vals = [r[key] for r in rows if r.get(key)]
        return statistics.median(vals) if vals else 0
    bunk_med = med("bunker")
    turf_Ls = [r["turf_lab"][0] for r in rows if r.get("turf_lab")]
    turf_as = [r["turf_lab"][1] for r in rows if r.get("turf_lab")]
    turf_bs = [r["turf_lab"][2] for r in rows if r.get("turf_lab")]

    def zscore(v, arr):
        if len(arr) < 3:
            return 0.0
        mu, sd = statistics.mean(arr), statistics.pstdev(arr)
        return (v - mu) / sd if sd else 0.0

    for r in rows:
        h = r["holes"] or 18
        # structural flags
        if r["green"] < h * 0.85:
            r["flags"].append(f"low-greens({r['green']}/{h})")
        if r["fairway"] < h * 0.6:
            r["flags"].append(f"low-fairways({r['fairway']}/{h})")
        if r["bunker"] == 0:
            r["flags"].append("no-bunkers")
        elif r["bunker"] < max(6, bunk_med * 0.15):
            r["flags"].append(f"thin-bunkers({r['bunker']})")
        # CV flags — unmapped sand is only suspect when it dwarfs mapped bunker
        # area (courses with lots of real bunkers already read fine).
        su = r.get("sand_uncovered_units2", 0)
        ratio = r.get("sand_unmapped_ratio", 0)
        if su > 800 and ratio >= 4.0:
            r["flags"].append(f"missing-bunkers(~{int(su)}u2 sand, {ratio}x mapped)")
        if r.get("turf_lab"):
            L, A, B = r["turf_lab"]
            zL, zA, zB = zscore(L, turf_Ls), zscore(A, turf_as), zscore(B, turf_bs)
            r["turf_z"] = round(max(abs(zL), abs(zA), abs(zB)), 2)
            if r["turf_z"] > 2.0:
                r["flags"].append(f"tone-outlier(z{r['turf_z']})")
        # missing assets
        for k, lbl in (("has_aerial", "no-aerial"), ("has_mask", "no-mask"),
                       ("has_boundary", "no-boundary")):
            if not r[k]:
                r["flags"].append(lbl)
        # priority score = how much this course needs work
        r["priority"] = (
            len([f for f in r["flags"] if f.startswith(("low-", "no-", "thin-"))]) * 3
            + (2 if any(f.startswith("missing-bunkers") for f in r["flags"]) else 0)
            + (1 if any(f.startswith("tone-outlier") for f in r["flags"]) else 0)
        )

    rows.sort(key=lambda r: (-r["priority"], -len(r["flags"])))

    print(f"\n{'id':40} pr  flags")
    print("-" * 96)
    shown = [r for r in rows if r["flags"]][: args.top]
    for r in shown:
        print(f"{r['id']:40} {r['priority']:2}  {', '.join(r['flags'])}")
    clean = len([r for r in rows if not r["flags"]])
    print("-" * 96)
    print(f"{len(rows)} courses  ·  {clean} clean  ·  {len(rows)-clean} flagged  "
          f"·  showing top {len(shown)}")

    if args.json:
        json.dump({"generated": rows}, open(args.json, "w"), indent=1)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
