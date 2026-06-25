"""Optional scorecard source: GolfAPI.io.

GolfAPI.io is contact-priced, so this adapter is OPT-IN and KEY-GATED — it is
never called by default and adds no paid dependency to the free bake path. It
exists so that, if/when a (free or cheap) key is obtained, per-hole par /
stroke-index / yardage can be filled for courses that have no manual override
(courses/scorecard/<id>.json), using the same merge precedence as everything
else: manual override -> GolfAPI.io -> OSM tags -> par=4 fallback.

Enable by setting GOLFAPI_KEY and passing the provider course id to the baker.
Output shape matches a manual scorecard's "holes" map:
    {"1": {"par": 4, "yards": 402, "si": 5}, ...}
"""
import json, os, urllib.parse, urllib.request

BASE = "https://www.golfapi.io/api/v2.3"   # adjust to the documented endpoint
UA = "golf-game-dev/1.0 (course baking)"


def available():
    """True if a key is configured — callers should skip this source if not."""
    return bool(os.environ.get("GOLFAPI_KEY"))


def fetch_scorecard(course_id, key=None, timeout=30):
    """Return {str(hole): {par, yards, si}} for a GolfAPI.io course id, or {}.

    Network/parse failures degrade to {} so a bake never breaks on this optional
    source. The exact JSON field names depend on the GolfAPI.io plan/response;
    map them here once a key + sample response are in hand.
    """
    key = key or os.environ.get("GOLFAPI_KEY")
    if not key:
        return {}
    url = f"{BASE}/courses/{urllib.parse.quote(str(course_id))}"
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            doc = json.load(r)
    except Exception as e:  # noqa: BLE001 — optional source, never fatal
        print(f"  ! golfapi.io fetch failed ({e}); skipping", flush=True)
        return {}
    return _normalize(doc)


def _normalize(doc):
    """Map a GolfAPI.io course response -> {str(hole): {par,yards,si}}.

    Stubbed against the documented shape; tighten when a real sample is in hand.
    Tries a few plausible field names so a first real response is likely to work.
    """
    holes = doc.get("holes") or doc.get("scorecard") or []
    out = {}
    for i, h in enumerate(holes, 1):
        num = h.get("hole") or h.get("number") or i
        rec = {}
        par = h.get("par")
        si = h.get("index") or h.get("handicap") or h.get("si")
        yards = h.get("yards") or h.get("length") or h.get("yardage")
        if par is not None:
            rec["par"] = int(par)
        if si is not None:
            rec["si"] = int(si)
        if yards is not None:
            rec["yards"] = int(yards)
        if rec:
            out[str(int(num))] = rec
    return out


if __name__ == "__main__":   # smoke: `GOLFAPI_KEY=... python3 golfapi_io.py <id>`
    import sys
    if not available():
        sys.exit("set GOLFAPI_KEY to test")
    print(json.dumps(fetch_scorecard(sys.argv[1]), indent=2))
