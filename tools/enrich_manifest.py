#!/usr/bin/env python3
"""Enrich courses/manifest.json with card + filter metadata.

For every course in the manifest, compute par / yards / hole-count from the baked
courses/<id>.json geometry, derive a display location + coarse region from the
lat/lon embedded in the manifest `sub` (or a "City, ST" string for the few
hand-added courses), and attach curated tags from tools/course_tags.json.

Output object per course:
  { id, name, sub, par, yards, holes, location, region, tags }

Re-runnable and idempotent. Run after baking new courses so the course-select
page stays accurate:

    python3 tools/enrich_manifest.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COURSES = os.path.join(ROOT, "courses")
MANIFEST = os.path.join(COURSES, "manifest.json")
TAGS = os.path.join(ROOT, "tools", "course_tags.json")

US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY",
}

LATLON_RE = re.compile(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)")
CITY_RE = re.compile(r"^\s*(.+?,\s*[A-Z]{2})\s*·")
# A named place prefix that isn't the "Par N ·" auto format, e.g. "St Andrews, Scotland".
PLACE_RE = re.compile(r"^\s*([^·]+?)\s*·")

COUNTRY_KEYWORDS = {
    "scotland": "Scotland", "england": "England", "wales": "England",
    "ireland": "Ireland", "northern ireland": "Ireland",
    "spain": "Spain", "portugal": "Portugal", "france": "France",
    "italy": "Italy", "netherlands": "Netherlands", "germany": "Germany",
    "uae": "UAE", "dubai": "UAE",
}


def country_from_latlon(lat, lon):
    """Coarse country label from coordinates. Boxes tuned to the baked clusters."""
    # USA
    if 24 <= lat <= 50 and -125 <= lon <= -66:
        return "USA"
    # Middle East (Dubai / UAE)
    if 22 <= lat <= 27 and 50 <= lon <= 60:
        return "UAE"
    # Ireland / Northern Ireland (west of GB)
    if 51.3 <= lat <= 55.4 and -10.6 <= lon <= -5.3:
        return "Ireland"
    # Scotland
    if 55.3 <= lat <= 59 and -8 <= lon <= -1.5:
        return "Scotland"
    # England / Wales
    if 49.8 <= lat <= 55.5 and -6 <= lon <= 2:
        return "England"
    # Portugal (Algarve)
    if 36.8 <= lat <= 42 and -9.6 <= lon <= -7.4:
        return "Portugal"
    # Spain (Costa del Sol / Sotogrande)
    if 35.5 <= lat <= 43.8 and -7.4 <= lon <= 4.4:
        return "Spain"
    # France
    if 42 <= lat <= 51.2 and -1.0 <= lon <= 8.5:
        return "France"
    # Italy
    if 44 <= lat <= 47 and 7 <= lon <= 12:
        return "Italy"
    # Netherlands
    if 51.8 <= lat <= 53.6 and 3.3 <= lon <= 7.3:
        return "Netherlands"
    # Germany / Austria / Switzerland
    if 46 <= lat <= 49.5 and 9 <= lon <= 13:
        return "Germany"
    return "Other"


# Coarse region buckets used for the filter rail.
COUNTRY_REGION = {
    "USA": "USA",
    "UAE": "Middle East",
    "Ireland": "UK & Ireland",
    "Scotland": "UK & Ireland",
    "England": "UK & Ireland",
    "Portugal": "Europe",
    "Spain": "Europe",
    "France": "Europe",
    "Italy": "Europe",
    "Netherlands": "Europe",
    "Germany": "Europe",
    "Other": "Other",
}


def course_totals(cid):
    """Return (par, yards, holes) from the baked course JSON, or (None, None, None)."""
    path = os.path.join(COURSES, cid + ".json")
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None, None, None
    holes = data.get("holes") or []
    par = sum(h.get("par", 0) for h in holes) or None
    yards = sum(h.get("yards", 0) for h in holes) or None
    return par, yards, (len(holes) or None)


def par_from_sub(sub):
    m = re.search(r"Par\s+(\d+)", sub or "")
    return int(m.group(1)) if m else None


def main():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    with open(TAGS) as f:
        tags_src = json.load(f)
    tag_map = {}
    for tag, ids in tags_src.items():
        if tag.startswith("_"):
            continue
        for cid in ids:
            tag_map.setdefault(cid, []).append(tag)

    region_counts = {}
    missing_geo = []
    out = []
    for c in manifest:
        cid = c["id"]
        sub = c.get("sub", "")
        par, yards, holes = course_totals(cid)
        if par is None:
            par = par_from_sub(sub)
            missing_geo.append(cid)

        # Location + region
        location = None
        region = "Other"
        m = LATLON_RE.search(sub)
        cm = CITY_RE.match(sub)
        if cm:
            location = cm.group(1)
            st = location.rsplit(",", 1)[-1].strip()
            if st in US_STATES:
                region = "USA"
            else:
                country = COUNTRY_KEYWORDS.get(st.lower())
                region = COUNTRY_REGION.get(country, "Other")
        elif m:
            lat, lon = float(m.group(1)), float(m.group(2))
            country = country_from_latlon(lat, lon)
            location = country
            region = COUNTRY_REGION.get(country, "Other")
        else:
            pm = PLACE_RE.match(sub)
            if pm and not pm.group(1).strip().lower().startswith("par"):
                location = pm.group(1).strip()
                tail = location.rsplit(",", 1)[-1].strip().lower()
                country = COUNTRY_KEYWORDS.get(tail)
                region = COUNTRY_REGION.get(country, "Other")

        region_counts[region] = region_counts.get(region, 0) + 1
        out.append({
            "id": cid,
            "name": c.get("name"),
            "sub": sub,
            "par": par,
            "yards": yards,
            "holes": holes,
            "location": location or "Unknown",
            "region": region,
            "tags": tag_map.get(cid, []),
        })

    with open(MANIFEST, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Enriched {len(out)} courses -> {MANIFEST}")
    print("Region distribution:", dict(sorted(region_counts.items(), key=lambda x: -x[1])))
    tagged = sum(1 for c in out if c["tags"])
    print(f"Tagged courses: {tagged} (pgaTour={sum('pgaTour' in c['tags'] for c in out)}, "
          f"major={sum('major' in c['tags'] for c in out)})")
    if missing_geo:
        print(f"WARNING: {len(missing_geo)} courses missing geometry totals "
              f"(par from sub, no yards): {', '.join(missing_geo[:8])}"
              + (" ..." if len(missing_geo) > 8 else ""))


if __name__ == "__main__":
    sys.exit(main())
