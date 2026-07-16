#!/usr/bin/env python3
"""Reconcile the 2026 PGA Tour schedule against baked courses.

Read-only dev helper (NOT part of the game build). Enumerates every event on
ESPN's season calendar, resolves each event's venue, and splits them into:

  MATCHED    venue already maps to a baked course (Tour Events can tee it off)
  NEEDS-BAKE venue has no baked course yet — candidate for `fetch_course_global.py`
             (a boundary-way guess from courses/index.json is printed when found)
  NO-VENUE   canceled / no venue in ESPN's feed — skip (spectator only)

The MATCHED test mirrors game.js `matchTourCourse()` (significant-token overlap,
threshold 0.6) so the tool's verdict matches what the game will actually do.

Usage:
  python3 tools/tour_venues.py                 # full table + summary
  python3 tools/tour_venues.py --needs-bake    # only the bake TODO list
  python3 tools/tour_venues.py --json          # machine-readable
"""
import argparse
import json
import os
import sys
import time
import urllib.request

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard"
CORE_EVENT = "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "courses", "manifest.json")
INDEX = os.path.join(ROOT, "courses", "index.json")

# Mirror of game.js _COURSE_STOP / _normCourse.
STOP = {"the", "golf", "club", "course", "country", "links", "resort",
        "gc", "cc", "no", "and", "at", "complex", "courses"}


def norm(s):
    out = []
    for w in "".join(c.lower() if c.isalnum() else " " for c in (s or "")).split():
        if w and w not in STOP:
            out.append(w)
    return out


def fetch_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "golf-game/tour-venues"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(0.6)
    return None


def match_course(name, courses):
    """Best token-overlap course, or None. Threshold 0.6 of the venue's tokens."""
    want = norm(name)
    if not want:
        return None, 0.0
    best, best_score = None, 0.0
    for c in courses:
        have = set(norm(c.get("name", "")))
        overlap = sum(1 for w in want if w in have)
        score = overlap / len(want)
        if score > best_score:
            best, best_score = c, score
    return (best, best_score) if best_score >= 0.6 else (None, best_score)


def guess_boundary(name, index):
    """Best index.json entry by token overlap — a bake starting point."""
    want = set(norm(name))
    if not want:
        return None
    best, best_score = None, 0.0
    for slug, rec in index.items():
        have = set(norm(rec.get("name", "")))
        if not have:
            continue
        overlap = len(want & have)
        score = overlap / max(len(want), 1)
        if score > best_score:
            best, best_score = (slug, rec), score
    if best and best_score >= 0.5:
        slug, rec = best
        return {"slug": slug, "way": rec.get("boundaryWay"),
                "type": rec.get("type"), "source": rec.get("source"),
                "name": rec.get("name"), "score": round(best_score, 2)}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--needs-bake", action="store_true", help="only print the bake TODO list")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--write-map", metavar="PATH",
                    help="write { eventId: {courseId, courseName, venue} } for matched events (for the in-game schedule playability chips)")
    args = ap.parse_args()

    courses = json.load(open(MANIFEST))
    index = json.load(open(INDEX)) if os.path.exists(INDEX) else {}

    sb = fetch_json(SCOREBOARD)
    if not sb:
        print("ERROR: couldn't reach ESPN scoreboard", file=sys.stderr)
        return 1
    cal = ((sb.get("leagues") or [{}])[0]).get("calendar") or []
    print(f"Calendar: {len(cal)} events\n", file=sys.stderr)

    matched, needs, novenue = [], [], []
    for i, c in enumerate(cal):
        eid = c.get("id")
        label = c.get("label") or eid
        print(f"  [{i+1}/{len(cal)}] {label} …", file=sys.stderr)
        detail = fetch_json(CORE_EVENT + str(eid))
        venue = None
        if detail:
            cs = (detail.get("courses") or [])
            if cs:
                a = cs[0].get("address") or {}
                venue = {"name": cs[0].get("name"),
                         "city": a.get("city"), "state": a.get("state") or a.get("region"),
                         "par": cs[0].get("shotsToPar"), "yards": cs[0].get("totalYards")}
        row = {"eventId": eid, "event": label, "start": c.get("startDate")}
        if not venue or not venue.get("name"):
            novenue.append(row)
            continue
        row["venue"] = venue["name"]
        row["loc"] = ", ".join(x for x in [venue.get("city"), venue.get("state")] if x)
        course, score = match_course(venue["name"], courses)
        if course:
            row["courseId"] = course["id"]
            row["courseName"] = course.get("name")
            matched.append(row)
        else:
            row["bestScore"] = round(score, 2)
            row["boundary"] = guess_boundary(venue["name"], index)
            needs.append(row)
        time.sleep(0.15)

    if args.write_map:
        m = {r["eventId"]: {"courseId": r["courseId"], "courseName": r.get("courseName"),
                            "venue": r.get("venue")} for r in matched}
        with open(args.write_map, "w") as f:
            json.dump(m, f, indent=2)
        print(f"wrote {len(m)} event→course entries -> {args.write_map}", file=sys.stderr)
        return 0

    if args.json:
        print(json.dumps({"matched": matched, "needsBake": needs, "noVenue": novenue}, indent=2))
        return 0

    def line(r, extra=""):
        return f"  {r['event'][:34]:34}  {r.get('venue', '—')[:32]:32}  {extra}"

    if not args.needs_bake:
        print(f"\n=== MATCHED ({len(matched)}) — already playable ===")
        for r in matched:
            print(line(r, "→ " + r["courseId"]))
        print(f"\n=== NO VENUE ({len(novenue)}) — canceled/TBD, spectator only ===")
        for r in novenue:
            print(f"  {r['event'][:34]:34}")

    print(f"\n=== NEEDS BAKE ({len(needs)}) ===")
    for r in needs:
        b = r.get("boundary")
        if b and b.get("way"):
            tip = f"try: --boundary-way {b['way']}  (index '{b['slug']}', {b['score']})"
        elif b:
            tip = f"index '{b['slug']}' ({b['source']}/{b['type']}, {b['score']}) — no way id"
        else:
            tip = "no OSM boundary found — hand-find or leave spectator-only"
        print(f"  {r['event'][:30]:30}  {r['venue'][:30]:30}  {r.get('loc', ''):22}  {tip}")

    print(f"\nSummary: {len(matched)} playable · {len(needs)} to bake · {len(novenue)} no-venue")
    return 0


if __name__ == "__main__":
    sys.exit(main())
