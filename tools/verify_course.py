#!/usr/bin/env python3
"""
Quality gate for a baked course — is it up to "Pinehurst standard"?

    python3 tools/verify_course.py <id> [--holes N] [--no-engine] [--allow-no-dem]

Loads courses/<id>.json and grades it against the global+DEM rubric that
Pinehurst No. 2 sets. HARD checks gate the bake (any failure -> exit 1); SOFT
checks only lower a printed letter grade (A/B/C). The default run also fires the
JavaScriptCore engine smoke test (tools/engine_smoke.js) so a course that
crashes draw()/swing/putt fails the gate.

Calibrate against the gold standard first:  python3 tools/verify_course.py pinehurst-no2
"""
import argparse, json, math, os, subprocess, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
YPU = 3.0                      # yards per world unit (fixed, see fetch_course.py)
NEAR_UNITS = 70 / YPU          # a fairway within ~70yds of a hole counts as "near"


class Report:
    def __init__(self):
        self.hard_fail, self.soft_warn, self.notes = [], [], []
    def hard(self, ok, msg):
        (self.notes if ok else self.hard_fail).append(("PASS" if ok else "FAIL") + "  " + msg)
        return ok
    def soft(self, ok, msg):
        (self.notes if ok else self.soft_warn).append(("ok  " if ok else "warn") + "  " + msg)
        return ok
    def note(self, msg):
        self.notes.append("info  " + msg)


def inv_affine(tw):
    """Return world(x,y)->pixel(px,py) from a toWorld=[a,b,c,d,e,f] affine."""
    a, b, c, d, e, f = tw
    det = a * e - b * d
    if abs(det) < 1e-12:
        return None
    return lambda X, Y: ((e * (X - c) - b * (Y - f)) / det,
                         (-d * (X - c) + a * (Y - f)) / det)


def jpeg_ok(path):
    try:
        with open(path, "rb") as fh:
            return fh.read(2) == b"\xff\xd8"
    except OSError:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--holes", type=int, default=18, help="expected hole count")
    ap.add_argument("--no-engine", action="store_true", help="skip JSC smoke test")
    ap.add_argument("--allow-no-dem", action="store_true")
    args = ap.parse_args()

    jpath = os.path.join(ROOT, "courses", args.id + ".json")
    if not os.path.exists(jpath):
        sys.exit(f"no such course: {jpath}")
    d = json.load(open(jpath))
    r = Report()

    # --- format (HARD) -----------------------------------------------------
    r.hard(d.get("global") is True, "global:true (connected-map format)")
    for k in ("world", "aerial", "surfaces", "holes"):
        r.hard(k in d and d[k], f"has top-level '{k}'")
    world = d.get("world") or {}
    holes = d.get("holes") or []
    surf = d.get("surfaces") or {}

    # --- holes / par (HARD) ------------------------------------------------
    r.hard(len(holes) == args.holes, f"{len(holes)} holes (expected {args.holes})")
    par_total = sum(h.get("par", 0) for h in holes)
    r.hard(60 <= par_total <= 75, f"par total {par_total} in [60,75]")
    bad = [h.get("num") for h in holes
           if not (h.get("par") and h.get("yards", 0) > 0 and h.get("tee") and h.get("pin"))]
    r.hard(not bad, f"every hole has par/yards/tee/pin (bad: {bad})")

    # --- aerial registration (HARD) ----------------------------------------
    aer = d.get("aerial") or {}
    apath = os.path.join(ROOT, "courses", aer.get("file", "")) if aer else ""
    r.hard(bool(aer) and os.path.exists(apath) and jpeg_ok(apath),
           f"aerial file exists + valid JPEG ({aer.get('file')})")
    W, H = aer.get("w"), aer.get("h")
    inv = inv_affine(aer["toWorld"]) if aer.get("toWorld") and W and H else None
    if inv:
        off = []
        for h in holes:
            for nm in ("tee", "pin"):
                px, py = inv(h[nm]["x"], h[nm]["y"])
                if not (0 <= px <= W and 0 <= py <= H):
                    off.append(f"{h['num']}.{nm}")
        r.hard(not off, f"all tee/pin register inside the aerial (off: {off})")
    else:
        r.hard(False, "aerial has a usable w/h/toWorld affine")

    # --- DEM (HARD unless --allow-no-dem) ----------------------------------
    dem = d.get("dem")
    if dem and not args.allow_no_dem:
        n = dem.get("nx", 0) * dem.get("ny", 0)
        r.hard(n == len(dem.get("data", [])), f"DEM grid {dem.get('nx')}x{dem.get('ny')} == {len(dem.get('data', []))} samples")
        r.hard(all(math.isfinite(v) for v in dem["data"][:2000]), "DEM samples finite (sampled)")
        r.hard(dem.get("x1", 0) >= world.get("w", 1e9) * 0.9 and dem.get("y1", 0) >= world.get("h", 1e9) * 0.9,
               "DEM bounds cover the world rect")
    elif not args.allow_no_dem:
        r.hard(False, "has a DEM (real elevation); pass --allow-no-dem to waive")

    # --- fairway coverage: INFORMATIONAL only ------------------------------
    # In the global+photoreal format the real aerial shows the actual fairway,
    # and a synth corridor still classifies the ball's lie, so OSM's fairway-
    # mapping gaps (links/unmapped courses) don't lower the grade. We surface
    # the ratio so a thin bake is still visible.
    synth = d.get("synthFairways")
    if synth is None:   # legacy fallback: count low-vertex capsule polygons
        synth = sum(1 for p in surf.get("fairway", []) if len(p) <= 6)
    real = len(holes) - synth
    r.note(f"real fairways {real}/{len(holes)} ({(real / len(holes) if holes else 0):.0%}; "
           f"rest are synth corridors over the real aerial)")

    # --- scorecard coverage (SOFT — free real data, every course should have it)
    spath = os.path.join(ROOT, "courses", "scorecard", args.id + ".json")
    card = 0
    if os.path.exists(spath):
        sc = json.load(open(spath))
        sc = sc.get("holes", sc) if isinstance(sc, dict) else {}
        card = sum(1 for v in sc.values() if isinstance(v, dict) and (v.get("par") or v.get("yards")))
    r.soft(card >= len(holes) * 0.4, f"scorecard override on {card}/{len(holes)} holes (>=40% target)")

    # --- bunkers present (SOFT) --------------------------------------------
    r.soft(len(surf.get("bunker", [])) >= 4, f"{len(surf.get('bunker', []))} bunkers mapped")

    # --- greens: every hole's pin sits on a real green (SOFT, double-green aware)
    # A shared green legitimately serves two holes (St Andrews has 7), so we check
    # pin->green coverage, not a raw green count.
    def poly_centroid(p):
        n = len(p) or 1
        return (sum(v["x"] for v in p) / n, sum(v["y"] for v in p) / n)
    gcent = [poly_centroid(p) for p in surf.get("green", []) if p]
    if gcent:
        far = [h["num"] for h in holes
               if min(math.hypot(h["pin"]["x"] - c[0], h["pin"]["y"] - c[1]) for c in gcent) > 30]
        r.soft(not far, f"every pin sits on a real green ({len(gcent)} greens; off-green holes: {far})")
    else:
        r.soft(False, "no greens mapped")

    # --- engine smoke test (HARD) ------------------------------------------
    if not args.no_engine:
        smoke = os.path.join(os.path.dirname(__file__), "engine_smoke.js")
        if os.path.exists(smoke):
            p = subprocess.run(["osascript", "-l", "JavaScript", smoke, args.id,
                                os.path.abspath(ROOT)], capture_output=True, text=True)
            ok = p.returncode == 0
            r.hard(ok, "engine smoke (draw both modes + swing + putt, all holes)")
            if not ok:
                r.notes.append((p.stdout + p.stderr).strip()[-800:])
        else:
            r.soft(False, "engine_smoke.js missing — skipped engine test")

    # --- report ------------------------------------------------------------
    print(f"\n=== verify {args.id} ===")
    for ln in r.notes:
        print("  " + ln)
    for ln in r.soft_warn:
        print("  " + ln)
    for ln in r.hard_fail:
        print("  " + ln)
    grade = "A" if not r.soft_warn else ("B" if len(r.soft_warn) <= 2 else "C")
    passed = not r.hard_fail
    print(f"\n  {'PASS' if passed else 'FAIL'}  grade {grade if passed else '-'}  "
          f"({len(r.hard_fail)} hard fail, {len(r.soft_warn)} soft warn)")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
