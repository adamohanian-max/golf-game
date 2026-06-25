# Scorecard overrides

Free, deterministic per-hole `par` / `yards` / `si` (stroke index) typed once
from a course's published scorecard. These **override** the values the bake
otherwise guesses, fixing two weaknesses of geometry/OSM-only ingest:

- `par` defaults to **4** when OSM has no `par` tag.
- `yards` is **measured off OSM hole-line geometry** (a rough estimate, often a
  different tee than the card), not the real scorecard distance.

## How it's used

`tools/fetch_course.py` auto-loads `courses/scorecard/<id>.json` during a bake
(or pass an explicit `--scorecard <path>`). Merge precedence, highest first:

    manual override (this file)  →  GolfAPI.io (optional, --golfapi-course)  →  OSM tags  →  par=4

Partial files are fine — any hole or field you omit falls through to the next
source. The baker prints how many holes came from the scorecard and warns when
a scorecard yardage diverges from the geometry by >60y (likely mis-keyed hole).

## Schema

```json
{
  "name": "Pinehurst No. 2",
  "tee": "championship",
  "holes": {
    "1": { "par": 4, "yards": 402, "si": 5 },
    "2": { "par": 4, "yards": 506 }
  }
}
```

- Top-level `holes` map keyed by hole number (string). A flat `{ "1": {...} }`
  (no `holes` wrapper) is also accepted.
- Per hole, every field is optional: `par` (int), `yards` (int, real card
  distance), `si` (int, stroke index / handicap rank 1–18).
- `name` / `tee` are documentation only; ignored by the baker.
