#!/usr/bin/env python3
"""Batch-rebake every course that lacks the real OSM-boundary OB.

A course is "correct" iff its courses/<id>.json has a non-empty top-level
`boundary` key (written by the post-1422810 bake path). Anything else still has
the old color-guess OB (or none) and gets re-baked via fetch_course_global.py.

Resumable + idempotent: skips any slug that already has a boundary key, so it can
be re-run after an interruption / rate-limit. Throttled between courses for the
public Overpass API. Logs per-course PASS/FAIL to LOG_PATH.

Usage:
  python3 tools/rebake_ob.py [--sleep 8] [--limit N] [--only slug,slug] [--dry-run]
"""
import argparse, json, os, subprocess, sys, time, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
INDEX = os.path.join(COURSES, "index.json")
LOG_PATH = os.path.join(ROOT, "tools", "rebake_ob.log")
SKIP = {"manifest", "index", "range"}


def has_boundary(slug):
    p = os.path.join(COURSES, slug + ".json")
    if not os.path.exists(p):
        return False
    try:
        with open(p) as f:
            return bool(json.load(f).get("boundary"))
    except Exception:
        return False


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
    args = ap.parse_args()

    with open(INDEX) as f:
        idx = json.load(f)

    # worklist = every baked course json without a boundary key
    slugs = []
    for p in sorted(glob.glob(os.path.join(COURSES, "*.json"))):
        slug = os.path.basename(p)[:-5]
        if slug in SKIP:
            continue
        if not has_boundary(slug):
            slugs.append(slug)

    only = {s for s in args.only.split(",") if s}
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
        if has_boundary(slug):  # re-check: a prior run may have done it
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
