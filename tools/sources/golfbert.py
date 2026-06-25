"""Golfbert geometry source — free polygon greens/fairways/bunkers/water + real
tee-box positions, for courses OSM hasn't mapped.

Golfbert (api.golfbert.com) returns per-hole lat/long polygons and tee/flag
vectors. Rather than reimplement the bake, this adapter re-shapes Golfbert into
the SAME structure Overpass returns ({"elements": [...]}), so fetch_course.py's
existing projection / hole-building / aerial / scorecard pipeline consumes it
unchanged. surfacetype -> golf tag; Golfbert "long" -> "lon".

Auth: AWS SigV4 (execute-api) + x-api-key, signed with pure stdlib (no boto/aws4).
Key-gated and opt-in — never touched on the default OSM path. Set:
    GOLFBERT_KEY         x-api-key issued by Golfbert
    GOLFBERT_AWS_KEY     AWS access key id
    GOLFBERT_AWS_SECRET  AWS secret access key
    GOLFBERT_REGION      optional, defaults us-east-1

Field names follow Golfbert's documented shapes; _normalize tolerates a few
spellings so a first real response is likely to map. Verify against a live
account and tighten if needed (same pattern as golfapi_io).
"""
import datetime, hashlib, hmac, json, os, urllib.parse, urllib.request

HOST = "api.golfbert.com"
SERVICE = "execute-api"
UA = "golf-game-dev/1.0 (course baking)"

# Golfbert surfacetype -> the game's golf=* tag. Rough/unknown are dropped.
SURFACE_TAG = {
    "green": "green", "fairway": "fairway", "bunker": "bunker",
    "water": "water_hazard", "teebox": "tee", "tee": "tee",
}


def available():
    return all(os.environ.get(k) for k in
               ("GOLFBERT_KEY", "GOLFBERT_AWS_KEY", "GOLFBERT_AWS_SECRET"))


# --- AWS SigV4 (GET, empty body) -------------------------------------------
def _sign(path, query=""):
    key = os.environ["GOLFBERT_AWS_KEY"]
    secret = os.environ["GOLFBERT_AWS_SECRET"]
    region = os.environ.get("GOLFBERT_REGION", "us-east-1")
    now = datetime.datetime.utcnow()
    amzdate = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()

    canonical_headers = (f"host:{HOST}\n"
                         f"x-amz-date:{amzdate}\n")
    signed_headers = "host;x-amz-date"
    canonical_request = "\n".join([
        "GET", path, query, canonical_headers, signed_headers, payload_hash])

    scope = f"{datestamp}/{region}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amzdate, scope,
        hashlib.sha256(canonical_request.encode()).hexdigest()])

    def hmac256(k, m):
        return hmac.new(k, m.encode(), hashlib.sha256).digest()
    k_date = hmac256(("AWS4" + secret).encode(), datestamp)
    k_region = hmac256(k_date, region)
    k_service = hmac256(k_region, SERVICE)
    k_signing = hmac256(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(),
                         hashlib.sha256).hexdigest()

    auth = (f"AWS4-HMAC-SHA256 Credential={key}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}")
    return {"Authorization": auth, "x-amz-date": amzdate,
            "x-api-key": os.environ["GOLFBERT_KEY"], "User-Agent": UA}


def _get(path, query=""):
    url = f"https://{HOST}{path}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers=_sign(path, query))
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# --- API calls -------------------------------------------------------------
def course_holes(course_id):
    return _get(f"/v1/courses/{course_id}/holes").get("resources", [])


def hole_polygons(hole_id):
    return _get(f"/v1/holes/{hole_id}/polygons").get("resources", [])


# --- Normalize Golfbert -> Overpass-shaped {"elements": [...]} --------------
def _coords(poly):
    """[{lat,long|lon}] -> [{lat,lon}] (Overpass geometry shape)."""
    out = []
    for p in poly:
        lon = p.get("lon", p.get("long"))
        if p.get("lat") is not None and lon is not None:
            out.append({"lat": p["lat"], "lon": lon})
    return out


def _vec_point(vectors, *types):
    """First vector whose type matches (case-insensitive) -> {lat,lon}."""
    want = {t.lower() for t in types}
    for v in vectors or []:
        if str(v.get("type", "")).lower() in want:
            lon = v.get("lon", v.get("long"))
            if v.get("lat") is not None and lon is not None:
                return {"lat": v["lat"], "lon": lon}
    return None


def fetch_as_overpass(course_id):
    """Return Golfbert course geometry as an Overpass-style response dict so
    fetch_course.py's pipeline can bake it with no other changes."""
    elements = []
    for h in course_holes(course_id):
        num = h.get("number") or h.get("hole")
        par = h.get("par")
        vectors = h.get("vectors") or []
        polys = hole_polygons(h["id"])

        # hole centerline: teebox/back tee -> flag (pin). Fall back to green
        # centroid for the pin if no flag vector is present.
        tee = _vec_point(vectors, "teebox", "back", "blue", "white", "tee")
        flag = _vec_point(vectors, "flag", "pin", "center")
        if flag is None:
            greens = [_coords(p["polygon"]) for p in polys
                      if str(p.get("surfacetype", "")).lower() == "green"]
            if greens and greens[0]:
                flag = {"lat": sum(c["lat"] for c in greens[0]) / len(greens[0]),
                        "lon": sum(c["lon"] for c in greens[0]) / len(greens[0])}
        if tee and flag and num:
            tags = {"golf": "hole", "ref": str(num)}
            if par is not None:
                tags["par"] = str(par)
            elements.append({"type": "way", "tags": tags,
                             "geometry": [tee, flag]})

        for p in polys:
            tag = SURFACE_TAG.get(str(p.get("surfacetype", "")).lower())
            geom = _coords(p.get("polygon", []))
            if tag and len(geom) >= 3:
                elements.append({"type": "way", "tags": {"golf": tag},
                                 "geometry": geom})
    return {"elements": elements}


if __name__ == "__main__":   # smoke: GOLFBERT_*=... python3 golfbert.py <course_id>
    import sys
    if not available():
        sys.exit("set GOLFBERT_KEY / GOLFBERT_AWS_KEY / GOLFBERT_AWS_SECRET")
    d = fetch_as_overpass(sys.argv[1])
    print(f"{len(d['elements'])} elements")
