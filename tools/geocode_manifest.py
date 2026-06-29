#!/usr/bin/env python3
"""Reverse-geocode precise "City, ST" locations for manifest courses.

enrich_manifest.py can only derive a coarse country ("USA") from the lat/lon
embedded in a course's `sub` string. This pass turns that lat/lon into a real
"Atkinson, NH" / "St Andrews, Scotland" via OSM Nominatim and caches the result
in courses/geocode.json. enrich_manifest.py then prefers the cache.

Polite to Nominatim per the usage policy: custom UA + 1 request/second + only
courses not already cached (resumable/idempotent — safe to re-run after baking).

    python3 tools/geocode_manifest.py            # geocode all uncached lat/lon courses
    python3 tools/geocode_manifest.py --force    # re-geocode everything
    python3 tools/geocode_manifest.py --only atkinson-resort-country-club
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
MANIFEST = os.path.join(COURSES, "manifest.json")
CACHE = os.path.join(COURSES, "geocode.json")

NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
UA = "golf-game-dev/1.0 (course location geocoder; contact adamohanian@gmail.com)"
LATLON_RE = re.compile(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)")

US_STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "District of Columbia": "DC",
}

# UK uses "country" = England/Scotland/Wales/Northern Ireland within the GB nation.
UK_NATIONS = {"England", "Scotland", "Wales", "Northern Ireland"}


def reverse(lat, lon):
    q = urllib.parse.urlencode({
        "lat": lat, "lon": lon, "format": "jsonv2",
        "zoom": "12", "addressdetails": "1",
        "accept-language": "en",  # English country/state names (else "España", Arabic, ...)
    })
    req = urllib.request.Request(NOMINATIM + "?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def label_from_address(addr, country_code):
    """Build 'City, ST' (US) or 'Town, Country' (else) from a Nominatim address."""
    city = (addr.get("city") or addr.get("town") or addr.get("village")
            or addr.get("hamlet") or addr.get("municipality")
            or addr.get("suburb") or addr.get("county") or "").strip()
    cc = (country_code or "").lower()
    if cc == "us":
        st = US_STATE_ABBR.get(addr.get("state", "").strip())
        region = st or addr.get("state", "").strip()
    elif cc == "gb":
        # Prefer the home nation (Scotland/England/...) over "United Kingdom".
        nation = (addr.get("state") or "").strip()
        region = nation if nation in UK_NATIONS else (addr.get("country") or "UK").strip()
    else:
        region = (addr.get("country") or "").strip()
    if city and region:
        return f"{city}, {region}"
    return city or region or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-geocode even if cached")
    ap.add_argument("--only", default="", help="comma-separated ids to restrict to")
    ap.add_argument("--sleep", type=float, default=1.1, help="seconds between requests")
    args = ap.parse_args()

    with open(MANIFEST) as f:
        manifest = json.load(f)
    cache = {}
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            cache = json.load(f)

    only = {s for s in args.only.split(",") if s}
    todo = []
    for c in manifest:
        cid = c["id"]
        if only and cid not in only:
            continue
        if cid in cache and not args.force:
            continue
        m = LATLON_RE.search(c.get("sub", ""))
        if not m:
            continue
        todo.append((cid, float(m.group(1)), float(m.group(2))))

    print(f"{len(todo)} course(s) to geocode "
          f"({len(cache)} already cached, ~{len(todo) * args.sleep:.0f}s)")
    ok = fail = 0
    for i, (cid, lat, lon) in enumerate(todo, 1):
        try:
            data = reverse(lat, lon)
            label = label_from_address(data.get("address", {}), data.get("address", {}).get("country_code"))
            if label:
                cache[cid] = label
                ok += 1
                print(f"[{i}/{len(todo)}] {cid} -> {label}")
            else:
                fail += 1
                print(f"[{i}/{len(todo)}] {cid} -> (no usable label)")
        except Exception as e:  # network hiccup — skip, re-runnable
            fail += 1
            print(f"[{i}/{len(todo)}] {cid} FAIL: {e}")
        # write incrementally so a crash keeps progress
        with open(CACHE, "w") as f:
            json.dump(cache, f, indent=1, ensure_ascii=False, sort_keys=True)
            f.write("\n")
        if i < len(todo):
            time.sleep(args.sleep)

    print(f"done: {ok} geocoded, {fail} failed/empty -> {CACHE} ({len(cache)} total)")


if __name__ == "__main__":
    sys.exit(main())
