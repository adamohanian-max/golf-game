#!/usr/bin/env python3
"""Discover verified OSM golf-course boundaries for tour venues.

Read-only dev helper. For each venue (piped from tour_venues.py --json, or given
on argv) it geocodes "venue, city, state" via Nominatim, then queries Overpass
for leisure=golf_course ways/relations near that point and picks the one whose
NAME best matches the venue — so a bake targets the real course, not a
token-collision lookalike (e.g. La Quinta CC in CA, not La Quinta in Spain).

Prints a bake-ready table + JSON. Does NOT bake anything.

Usage:
  python3 tools/tour_venues.py --json | python3 tools/discover_boundaries.py
  python3 tools/discover_boundaries.py --venue "Aronimink Golf Club" --loc "Newtown Square, PA"
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "golf-game/discover-boundaries (course baking)"}

STOP = {"the", "golf", "club", "course", "country", "links", "resort", "gc",
        "cc", "no", "and", "at", "complex", "courses", "resort", "spa"}


def norm(s):
    return [w for w in "".join(c.lower() if c.isalnum() else " " for c in (s or "")).split()
            if w and w not in STOP]


def clean_venue(name):
    # Drop the parenthetical course-within-resort qualifier for geocoding.
    return name.split("(")[0].strip()


def geocode(q, tries=2):
    for _ in range(tries):
        try:
            url = NOMINATIM + "?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                js = json.load(r)
            if js:
                return float(js[0]["lat"]), float(js[0]["lon"])
        except Exception:
            time.sleep(1.0)
    return None


def overpass_courses(lat, lon, radius=4000, tries=2):
    q = f"""[out:json][timeout:40];
(way["leisure"="golf_course"](around:{radius},{lat},{lon});
 relation["leisure"="golf_course"](around:{radius},{lat},{lon}););
out tags center;"""
    for _ in range(tries):
        try:
            req = urllib.request.Request(OVERPASS, data=q.encode(), headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r).get("elements", [])
        except Exception:
            time.sleep(2.0)
    return []


def best_boundary(venue, elements):
    want = set(norm(venue))
    if not want:
        return None
    best, best_score = None, 0.0
    for el in elements:
        nm = (el.get("tags") or {}).get("name", "")
        have = set(norm(nm))
        if not have:
            continue
        overlap = len(want & have)
        score = overlap / len(want)
        if score > best_score:
            best, best_score = el, score
    if best:
        return {"id": best["id"], "type": best["type"], "name": (best.get("tags") or {}).get("name"),
                "score": round(best_score, 2)}
    return None


def discover(venue, loc):
    q = clean_venue(venue) + (", " + loc if loc else "")
    center = geocode(q)
    time.sleep(1.1)   # Nominatim: 1 req/s
    if not center:
        return {"venue": venue, "loc": loc, "boundary": None, "note": "geocode failed"}
    els = overpass_courses(*center)
    b = best_boundary(venue, els)
    time.sleep(0.5)
    return {"venue": venue, "loc": loc, "center": center, "nearby": len(els),
            "boundary": b, "note": "" if b and b["score"] >= 0.5 else "low confidence — verify"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--venue")
    ap.add_argument("--loc", default="")
    args = ap.parse_args()

    if args.venue:
        rows = [{"venue": args.venue, "loc": args.loc}]
    else:
        data = json.load(sys.stdin)
        rows = data.get("needsBake", data) if isinstance(data, dict) else data

    results = []
    for r in rows:
        venue = r.get("venue") or r.get("name")
        loc = r.get("loc", "")
        print(f"  … {venue}", file=sys.stderr)
        res = discover(venue, loc)
        res["event"] = r.get("event")
        results.append(res)

    print(f"\n{'VENUE':34}{'BOUNDARY':40}{'FLAG'}")
    for r in results:
        b = r.get("boundary")
        if b:
            flag = f"--boundary-{'rel' if b['type']=='relation' else 'way'} {b['id']}  ({b['score']}) {r['note']}"
        else:
            flag = r["note"]
        print(f"  {r['venue'][:32]:32}{(b['name'] if b else '—')[:38]:38}{flag}")
    print("\n" + json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
