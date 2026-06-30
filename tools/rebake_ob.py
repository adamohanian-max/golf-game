#!/usr/bin/env python3
"""Batch-rebake every course that lacks the real OSM-boundary OB.

A course is "correct" iff its courses/<id>.json has a non-empty top-level
`boundary` key (written by the post-1422810 bake path). Anything else still has
the old color-guess OB (or none) and gets re-baked via fetch_course_global.py.

Resumable + idempotent: skips any slug that already has a boundary key, so it can
be re-run after an interruption / rate-limit. Throttled between courses for the
public Overpass API. Logs per-course PASS/FAIL to LOG_PATH.

Coverage validator (--report / --min-drop):
  "Has a boundary key" != "correct OB". `drop_fraction()` mirrors the game's
  per-hole self-heal (game.js setHole): a hole drops boundary-OB when >40% of its
  tee->pin line falls outside the boundary rings. `--report` prints the drop
  fraction for every course (the audit). `--min-drop F` adds courses whose drop
  fraction >= F to the rebake worklist even if they already have a boundary, and
  `--force` lets them overwrite the existing boundary.

  NOTE (2026-06-29 audit): a high drop fraction usually is NOT a wrong boundary.
  Overpass returns the same golf_course element already baked, so there is no
  better boundary to swap to. The real causes are (1) corrupt routing from missing
  OSM greens -- pins collapse onto the few mapped greens, making bogus cross-course
  tee->pin lines that exit any boundary (e.g. golf-de-saint-quentin-en-yvelines has
  2 greens / golf-de-saint-germain-l-s-corbeil has 1), and (2) legit edge / cross-
  parcel holes that genuinely run to the property line (self-heal handles these).
  So --report is a diagnostic; don't blind-rebake on it.

Usage:
  python3 tools/rebake_ob.py --report [--only slug,slug]
  python3 tools/rebake_ob.py [--sleep 8] [--limit N] [--only slug,slug] [--dry-run]
                             [--min-drop 0.17] [--force]
"""
import argparse, json, os, subprocess, sys, time, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
INDEX = os.path.join(COURSES, "index.json")
LOG_PATH = os.path.join(ROOT, "tools", "rebake_ob.log")
SKIP = {"manifest", "index", "range"}


def load_course(slug):
    p = os.path.join(COURSES, slug + ".json")
    if not os.path.exists(p):
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None


def has_boundary(slug):
    d = load_course(slug)
    return bool(d and d.get("boundary"))


def _pip(x, y, poly):
    """Point in polygon (ray cast). poly = list of {x,y}."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]["x"], poly[i]["y"]
        xj, yj = poly[j]["x"], poly[j]["y"]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def drop_fraction(slug):
    """Fraction of holes whose tee->pin line would self-heal-drop the boundary.

    Mirrors game.js setHole(): a hole drops boundary-OB when >40% of 20 samples
    along the tee->pin line fall outside the boundary rings. Returns (frac, nholes)
    or (None, 0) if the course has no boundary / no holes to test.
    """
    d = load_course(slug)
    if not d:
        return None, 0
    rings = d.get("boundary")
    holes = d.get("holes") or []
    if not rings or not holes:
        return None, len(holes)
    tested = drop = 0
    N = 20
    for h in holes:
        t, p = h.get("tee"), h.get("pin")
        if not t or not p:
            continue
        tested += 1
        outside = 0
        for i in range(N + 1):
            x = t["x"] + (p["x"] - t["x"]) * i / N
            y = t["y"] + (p["y"] - t["y"]) * i / N
            if not any(_pip(x, y, r) for r in rings):
                outside += 1
        if outside > N * 0.4:
            drop += 1
    if not tested:
        return None, 0
    return drop / tested, tested


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sleep", type=float, default=8.0,
                    help="seconds to wait between courses (Overpass throttle)")
    ap.add_argument("--limit", type=int, default=0, help="max courses this run (0=all)")
    ap.add_argument("--only", default="", help="comma-separated slugs to restrict to")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--report", action="store_true",
                    help="print the boundary drop-fraction table for all courses and exit")
    ap.add_argument("--min-drop", type=float, default=None,
                    help="also (re)bake courses whose boundary drop-fraction >= this "
                         "(e.g. 0.17), not just courses missing a boundary key")
    ap.add_argument("--force", action="store_true",
                    help="rebake slugs even if they already have a boundary key "
                         "(needed to overwrite a wrong/partial boundary)")
    args = ap.parse_args()

    only = {s for s in args.only.split(",") if s}

    if args.report:
        rows = []
        for p in sorted(glob.glob(os.path.join(COURSES, "*.json"))):
            slug = os.path.basename(p)[:-5]
            if slug in SKIP or slug in ("manifest", "index", "geocode", "range"):
                continue
            if only and slug not in only:
                continue
            frac, nh = drop_fraction(slug)
            rows.append((slug, frac, nh))
        rows.sort(key=lambda r: (-1 if r[1] is None else r[1]), reverse=True)
        print(f"{'course':46} {'drop':>6}  holes")
        for slug, frac, nh in rows:
            label = "NO_BNDRY" if frac is None else f"{frac:5.0%}"
            print(f"{slug:46} {label:>6}  {nh}")
        return

    with open(INDEX) as f:
        idx = json.load(f)

    # worklist = every baked course json without a boundary key, plus (if --min-drop)
    # every course whose boundary covers the routing poorly (wrong/partial polygon).
    slugs = []
    for p in sorted(glob.glob(os.path.join(COURSES, "*.json"))):
        slug = os.path.basename(p)[:-5]
        if slug in SKIP:
            continue
        if not has_boundary(slug):
            slugs.append(slug)
        elif args.min_drop is not None:
            frac, _ = drop_fraction(slug)
            if frac is not None and frac >= args.min_drop:
                slugs.append(slug)

    if only:
        slugs = [s for s in slugs if s in only]

    in_index = [s for s in slugs if s in idx]
    missing = [s for s in slugs if s not in idx]

    log(f"=== rebake_ob start: {len(slugs)} stale, {len(in_index)} in index, "
        f"{len(missing)} NOT in index ===")
    if missing:
        log(f"NOT IN INDEX (handle by hand): {', '.join(missing)}")

    todo = in_index if args.limit == 0 else in_index[:args.limit]
    ok = fail = 0
    for i, slug in enumerate(todo, 1):
        if has_boundary(slug) and not args.force:  # re-check: a prior run may have done it
            log(f"[{i}/{len(todo)}] {slug} SKIP (already has boundary)")
            continue
        ent = idx[slug]
        flag = "--boundary-rel" if ent.get("type") in ("rel", "relation") else "--boundary-way"
        cmd = ["python3", os.path.join(ROOT, "tools", "fetch_course_global.py"),
               flag, str(ent["boundaryWay"]), "--id", slug,
               "--name", ent["name"], "--no-verify"]
        log(f"[{i}/{len(todo)}] {slug} -> {flag} {ent['boundaryWay']}")
        if args.dry_run:
            continue
        env = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "tools"))
        try:
            r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True,
                               text=True, timeout=600)
        except subprocess.TimeoutExpired:
            log(f"    FAIL {slug}: timeout")
            fail += 1
            time.sleep(args.sleep)
            continue
        if r.returncode == 0 and has_boundary(slug):
            ok += 1
            tail = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
            log(f"    PASS {slug} :: {tail}")
        else:
            fail += 1
            err = (r.stderr.strip() or r.stdout.strip()).splitlines()
            log(f"    FAIL {slug} rc={r.returncode} :: {err[-1] if err else '?'}")
        time.sleep(args.sleep)

    log(f"=== done: {ok} PASS, {fail} FAIL, {len(missing)} skipped(no-index) ===")


if __name__ == "__main__":
    main()
