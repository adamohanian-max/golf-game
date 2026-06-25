---
name: bake-course
description: Bake a real golf course (geometry + aerial imagery) into courses/<id>.json for the golf game, using OpenStreetMap/Overpass + Esri imagery via tools/fetch_course.py. Use when adding or re-baking a course.
---

# Bake a golf course

Turns a real course into a playable `courses/<id>.json` (+ per-hole aerial photos) that the game loads. All work is done by the dev tool `tools/fetch_course.py`; the game itself stays build-stepless and just fetches the static files.

## 1. Find the course boundary way

**Easiest — the discovery index.** `tools/build_index.py` maintains `courses/index.json` (slug → boundary-way/name/center) so you can bake by name instead of hand-finding ids:
```
python3 tools/build_index.py --overpass --around 35.195,-79.47,4500   # live OSM near a point
python3 tools/build_index.py --overpass --bbox S,W,N,E                 # or a bbox
python3 tools/build_index.py --seed-cc0                                # bulk-seed ~461 NA courses (CC0)
python3 tools/build_index.py --search pinehurst                        # find what's indexed
```
OSM (`source=osm`) entries are authoritative and override CC0 hints; CC0 ids can be stale/relations and cover North America only. Then in step 2 pass `--from-index <slug>` and skip `--boundary-way`.

**Manual fallback** — find the boundary way directly via Overpass (bbox around the course):
```
[out:json][timeout:60];
( way["leisure"="golf_course"](LAT0,LON0,LAT1,LON1);
  relation["leisure"="golf_course"](LAT0,LON0,LAT1,LON1); );
out tags;
```
Pick the way whose `name` matches (e.g. Pinehurst No. 2 = way `1358696570`, St Andrews Old = way `1019045811`). A single **way** boundary is easiest; relations work via `map_to_area` too. Inspect visually at https://overpass-turbo.eu.

## 2. Bake
```
python3 tools/fetch_course.py --from-index <slug> [--id <slug>]        # by name, via the index
python3 tools/fetch_course.py --boundary-way <WAY_ID> --id <slug> --name "<Display Name>"
```
`--from-index` fills boundary-way/id/name from `courses/index.json`; explicit flags still override (e.g. `--id pinehurst-no2` to match an existing course file + its scorecard).
- Writes `courses/<slug>.json` and `courses/img/<slug>/hole<N>.jpg` (one north-up aerial per hole, Esri World Imagery, keyless).
- `--no-imagery` skips the photos (fast, vector-only).
- `--cache <path>` caches the raw Overpass JSON so re-bakes don't re-query.
- Console prints per-hole surface counts, how many holes fell back to a **synthesized** fairway (links courses lack mapped fairways), and how many aerials were baked.

## Scorecard accuracy (par / yards / stroke index)
Geometry/OSM alone leaves `par` defaulting to **4** when untagged and `yards` as a rough geometric estimate. Layer real numbers on top with a free, deterministic override:
- Create `courses/scorecard/<id>.json` (auto-loaded by id; or pass `--scorecard <path>`). Schema + example in `courses/scorecard/README.md`: `{"holes": {"1": {"par":4,"yards":402,"si":5}, ...}}`. Every hole/field optional — gaps fall through.
- Merge precedence: **manual override → GolfAPI.io (optional `--golfapi-course`, needs `GOLFAPI_KEY`) → OSM tags → par=4**.
- The baker prints how many holes came from the scorecard and warns when a card yardage diverges from geometry by >60y (mis-keyed hole). Output gains `si` and, where overridden, `geomYards` (the geometric estimate, kept for QA).

## What it ingests (Overpass)
`golf=green|fairway|tee|bunker|hole|cartpath|water_hazard`, `natural=wood|water`, `landuse=grass`. Hole order = leading int of each `golf=hole` way's `ref` (handles `"7"` and `"7 - #2"`), deduped by number. Fairways/bunkers/woods/cartpaths/grass are assigned to the **nearest hole**; greens to the nearest hole pin; a fairway corridor is **synthesized only** when a hole has no mapped fairway.

## Output schema (`courses/<id>.json`)
`{ id, name, yardsPerUnit, holes:[ { num, par, yards, world:{w,h}, tee:{x,y}, pin:{x,y}, aerial:{file,w,h,toWorld:[a,b,c,d,e,f]}, surfaces:{ green,fairway,bunker,water,tee,woods,cartpath,grass: [[{x,y}...]] } } ] }`. Optional per-hole `si` (stroke index) and `geomYards` (geometric estimate when `yards` came from a scorecard override) are added when available. Scale is FIXED (`yardsPerUnit`≈3) so swing feel is constant across holes; `world` bounds are per-hole. `toWorld` maps aerial pixel→world: `world.x=a*px+b*py+c`, `world.y=d*px+e*py+f`.

## Point the game at a course
In `game.js` near the bottom: `loadCourse("<slug>")`. Course name shows automatically.

## Verify (no browser needed)
- **Data:** load the JSON in Python — 18 holes, fairways with many points (real) vs 6 (synth capsule), all aerials exist + valid JPEG, every hole has `aerial`, key points (tee/pin/green) map inside the image via the inverse affine.
- **Engine:** the JavaScriptCore harness (`osascript -l JavaScript`) with DOM/canvas/Image stubs — concatenate stubs + `game.js` + a test script; assert `draw()` runs on all 18 holes in BOTH vector and photoreal modes and that a swing + putt resolve.
- **Visual:** `python3 -m http.server 8080`; if a browser MCP is available, screenshot holes and compare to the real aerial / Overpass Turbo for registration; else have the user playtest.

## Gotchas
- Overpass needs a `User-Agent` (406 without). It rate-limits — cache raw responses.
- OSM pars/yards can differ from the official scorecard — supply `courses/scorecard/<id>.json` to override (see Scorecard accuracy above).
- OSM vector vs Esri imagery can be offset a few meters (registration); overlays may not perfectly hug the photo.
- Pillow is NOT required — images stay north-up; rotation is handled at runtime by the affine.
