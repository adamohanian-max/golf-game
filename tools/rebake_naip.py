#!/usr/bin/env python3
"""Batch re-bake every US course's aerial from NAIP (USDA, public domain,
commercial-OK) instead of Esri (whose free tier forbids monetized use). This is
the license gate for turning on ads/subscriptions.

NAIP only covers the US, so this skips non-US regions (St Andrews, Middle East)
and the fictional Originals. In-place overwrite; SAFE because every course is
committed in git, so `git checkout -- courses/<id>.json courses/img/<id>`
restores any botched bake. Resumable: skips courses already on NAIP
(aerial.src == "naip"). Mirrors tools/rebake_ob.py.

  python3 tools/rebake_naip.py --dry-run     # print the worklist, bake nothing
  python3 tools/rebake_naip.py --limit 3     # validate end-to-end on a few
  python3 tools/rebake_naip.py               # all eligible US courses
  python3 tools/rebake_naip.py --only pinehurst-no2,bethpage-black
  python3 tools/rebake_naip.py --force       # re-bake even ones already naip
"""
import argparse
import datetime
import json
import os
import subprocess
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
INDEX = os.path.join(COURSES, "index.json")
MANIFEST = os.path.join(COURSES, "manifest.json")
LOG = os.path.join(ROOT, "tools", "rebake_naip.log")

# US courses whose index.json entry is blank/missing but whose OSM boundary id is
# known (e.g. the default course was hand-baked, not discovered via build_index).
OVERRIDES = {
    "pinehurst-no2": (1358696570, "way"),
    "four-oaks-dracut": (18442673, "rel"),
    "butter-brook-golf-club": (215333121, "way"),
}


def log(msg):
    line = f"{datetime.datetime.now():%H:%M:%S} {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def aerial_src(slug):
    """Current imagery source of a baked course ('esri' | 'naip' | None)."""
    try:
        with open(os.path.join(COURSES, slug + ".json")) as f:
            d = json.load(f)
        return (d.get("aerial") or {}).get("src")
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated slugs to limit to")
    ap.add_argument("--limit", type=int, default=0, help="max courses this run (0=all)")
    ap.add_argument("--sleep", type=float, default=8.0, help="pause between bakes (Overpass politeness)")
    ap.add_argument("--dry-run", action="store_true", help="print the worklist, bake nothing")
    ap.add_argument("--force", action="store_true", help="re-bake even courses already on naip")
    args = ap.parse_args()

    only = {s for s in args.only.split(",") if s}
    with open(INDEX) as f:
        idx = json.load(f)
    with open(MANIFEST) as f:
        manifest = json.load(f)

    us = [e for e in manifest if e.get("region") == "USA"]
    worklist, skipped_src, skipped_noidx = [], [], []
    for e in us:
        slug = e["id"]
        if only and slug not in only:
            continue
        if aerial_src(slug) == "naip" and not args.force:
            skipped_src.append(slug)
            continue
        ent = idx.get(slug)
        if ent and ent.get("boundaryWay"):
            bid, btype, name = ent["boundaryWay"], ent.get("type", "way"), (ent.get("name") or e["name"])
        elif slug in OVERRIDES:
            bid, btype, name = OVERRIDES[slug][0], OVERRIDES[slug][1], e["name"]
        else:
            skipped_noidx.append(slug)
            continue
        worklist.append((slug, bid, btype, name))

    log(f"=== rebake_naip: {len(us)} US courses | {len(worklist)} to bake | "
        f"{len(skipped_src)} already naip | {len(skipped_noidx)} no-boundary-id ===")
    if skipped_noidx:
        log(f"NO BOUNDARY ID (bake by hand): {', '.join(skipped_noidx)}")

    todo = worklist if args.limit == 0 else worklist[:args.limit]
    ok = fail = 0
    for i, (slug, bid, btype, name) in enumerate(todo, 1):
        flag = "--boundary-rel" if btype in ("rel", "relation") else "--boundary-way"
        log(f"[{i}/{len(todo)}] {slug} -> {flag} {bid} --imagery naip")
        if args.dry_run:
            continue
        cmd = ["python3", os.path.join(ROOT, "tools", "fetch_course_global.py"),
               flag, str(bid), "--id", slug, "--name", name,
               "--imagery", "naip", "--no-verify"]
        env = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "tools"))
        try:
            r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True,
                               text=True, timeout=600)
        except subprocess.TimeoutExpired:
            log(f"    FAIL {slug}: timeout")
            fail += 1
            time.sleep(args.sleep)
            continue
        if r.returncode == 0 and aerial_src(slug) == "naip":
            ok += 1
            tail = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
            log(f"    PASS {slug} :: {tail}")
        else:
            fail += 1
            errs = (r.stderr.strip() or r.stdout.strip()).splitlines()
            log(f"    FAIL {slug} rc={r.returncode} :: {errs[-1] if errs else '?'}")
        time.sleep(args.sleep)

    log(f"=== done: {ok} PASS, {fail} FAIL, {len(skipped_noidx)} no-id, "
        f"{len(skipped_src)} already-naip ===")


if __name__ == "__main__":
    main()
