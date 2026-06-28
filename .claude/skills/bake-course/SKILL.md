---
name: bake-course
description: Bake a real golf course (geometry + aerial imagery) into courses/<id>.json for the golf game, using OpenStreetMap/Overpass + Esri imagery via tools/fetch_course.py. Use when adding or re-baking a course.
---

# Bake a golf course

Turns a real course into a playable `courses/<id>.json` (+ aerial photos) that the game loads. The game stays build-stepless and just fetches the static files.

## The standard: global + DEM (use `fetch_course_global.py`)

**`tools/fetch_course_global.py` is THE bake path.** It produces the "Pinehurst standard" format: ONE connected north-up aerial (`img/<id>/course.jpg`) covering the whole course in a shared global world frame (`global:true`, neighbouring holes show at the screen edges), **plus a real elevation DEM** (AWS Terrain Tiles, z=14 Terrarium PNG, **no API key**) that drives slope/break instead of a synthetic field. It supports the scorecard layer (par/yards/si override) and `--boundary-rel`.

`tools/fetch_course.py` (per-hole rotated frames, no DEM) is **legacy** — only reach for it if you specifically need the old per-hole format. Everything below (boundary discovery, scorecard, Golfbert source) feeds **both** tools; `fetch_course_global.py` reuses `fetch_course.py`'s helpers.

**A course is not done until `python3 tools/verify_course.py <id>` exits 0** (see "Definition of done" below).

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

## 2. Bake (global + DEM — the standard)
```
PYTHONPATH=tools python3 tools/fetch_course_global.py --boundary-way <WAY_ID> --id <slug> --name "<Display Name>"
PYTHONPATH=tools python3 tools/fetch_course_global.py --boundary-rel <REL_ID> --id <slug> --name "<Display Name>"
```
- Writes `courses/<slug>.json` (`global:true`, top-level `world`/`aerial`/`surfaces`/`dem`, holes carry only `num/par/yards/tee/pin`) and **one** `courses/img/<slug>/course.jpg`.
- Auto-loads `courses/scorecard/<slug>.json` (or `--scorecard <path>`) for par/yards/si — same merge as the per-hole tool.
- `--no-imagery` skips the photo; `--no-dem` skips elevation; `--cache <path>` caches the raw Overpass JSON so re-bakes don't re-query.
- Prints a `quality:` line — par, real-fairway ratio, scorecard coverage, DEM grid, aerial y/n — plus the >60y scorecard-vs-geometry divergence warning. `synthFairways` (count of holes with no mapped OSM fairway, corridor-synthesized) is stored in the JSON for the gate.
- If the single global aerial times out, the JSON is still written; `curl` the printed `AERIAL_URL` into `courses/img/<slug>/course.jpg` and re-run `verify_course.py`.

`PYTHONPATH=tools` is required (the global tool imports `fetch_course` as a module). `--from-index <slug>` discovery (step 1) works the same; pass it instead of `--boundary-*`.

*Legacy per-hole path (only if you need the old format):* `python3 tools/fetch_course.py --boundary-way <id> --id <slug> --name "..."` → per-hole `hole<N>.jpg`, no DEM.

## Scorecard accuracy (par / yards / stroke index)
Geometry/OSM alone leaves `par` defaulting to **4** when untagged and `yards` as a rough geometric estimate. Layer real numbers on top with a free, deterministic override:
- Create `courses/scorecard/<id>.json` (auto-loaded by id; or pass `--scorecard <path>`). Schema + example in `courses/scorecard/README.md`: `{"holes": {"1": {"par":4,"yards":402,"si":5}, ...}}`. Every hole/field optional — gaps fall through.
- Merge precedence: **manual override → GolfAPI.io (optional `--golfapi-course`, needs `GOLFAPI_KEY`) → OSM tags → par=4**.
- The baker prints how many holes came from the scorecard and warns when a card yardage diverges from geometry by >60y (mis-keyed hole). Output gains `si` and, where overridden, `geomYards` (the geometric estimate, kept for QA).

## Alternate geometry source: Golfbert (`--source golfbert`)
For courses OSM hasn't mapped, Golfbert (api.golfbert.com) supplies per-hole polygon greens/fairways/bunkers/water + real tee/flag vectors. The adapter re-shapes Golfbert into Overpass-style elements so the **same** projection/hole-build/aerial/scorecard pipeline runs unchanged.
```
GOLFBERT_KEY=… GOLFBERT_AWS_KEY=… GOLFBERT_AWS_SECRET=… \
  python3 tools/fetch_course.py --source golfbert --golfbert-course <id> --id <slug> --name "<Name>"
```
- Auth is AWS SigV4 (`execute-api`) + `x-api-key`, signed with pure stdlib (no extra deps). Get free dev credentials at golfbert.com/api. `GOLFBERT_REGION` defaults `us-east-1`.
- Key-gated and opt-in; the default `--source osm` path is untouched. Scorecard layer still applies on top.
- Response field mapping (`surfacetype`→`golf=*`, `long`→`lon`, `flag`/`teebox` vectors→centerline) lives in `tools/sources/golfbert.py:_normalize`/`fetch_as_overpass`; verified offline against a synthetic fixture — tighten field names against a live account if a first real bake comes back thin.

## What it ingests (Overpass)
`golf=green|fairway|tee|bunker|hole|cartpath|water_hazard`, `natural=wood|water`, `landuse=grass`. Hole order = leading int of each `golf=hole` way's `ref` (handles `"7"` and `"7 - #2"`), deduped by number. Fairways/bunkers/woods/cartpaths/grass are assigned to the **nearest hole**; greens to the nearest hole pin; a fairway corridor is **synthesized only** when a hole has no mapped fairway.

## Output schema (`courses/<id>.json`)
`{ id, name, yardsPerUnit, holes:[ { num, par, yards, world:{w,h}, tee:{x,y}, pin:{x,y}, aerial:{file,w,h,toWorld:[a,b,c,d,e,f]}, surfaces:{ green,fairway,bunker,water,tee,woods,cartpath,grass: [[{x,y}...]] } } ] }`. Optional per-hole `si` (stroke index) and `geomYards` (geometric estimate when `yards` came from a scorecard override) are added when available. Scale is FIXED (`yardsPerUnit`≈3) so swing feel is constant across holes; `world` bounds are per-hole. `toWorld` maps aerial pixel→world: `world.x=a*px+b*py+c`, `world.y=d*px+e*py+f`.

## Point the game at a course
In `game.js` near the bottom: `loadCourse("<slug>")`. Course name shows automatically.

## Enrich the manifest (course-select page metadata)
After baking (the tool appends `{id,name,sub}` to `courses/manifest.json`), run
`python3 tools/enrich_manifest.py` to backfill the fields the course-select page +
cards need: `par`, `yards`, `holes` (summed from the baked geometry), `location` +
`region` (from the `sub` lat/lon or "City, ST"), and curated `tags`. Add PGA Tour /
major-venue ids to `tools/course_tags.json` first if the new course qualifies.
Idempotent — safe to re-run after every bake.

## Definition of done — `verify_course.py` (the gate)
A course is up to standard only when **`python3 tools/verify_course.py <id>` exits 0**. The gate (calibrated so Pinehurst scores grade A) runs automatically:
- **HARD (any failure → exit 1):** `global:true` + `world`/`aerial`/`surfaces` present; expected hole count (`--holes N`, default 18) each with par/yards/tee/pin; `course.jpg` exists + valid JPEG + **every tee/pin registers inside it** via the inverse `toWorld` affine; DEM grid `nx*ny == len(data)` covering the world rect (waive with `--allow-no-dem`); and the **engine smoke test** — `tools/engine_smoke.js` via `osascript -l JavaScript` stubs DOM/canvas/Image and runs `draw()` on every hole in BOTH vector + photoreal modes plus a swing + putt (no throw = pass). `--no-engine` skips it.
- **SOFT (lower the A/B/C grade, still pass):** scorecard coverage (≥40% of holes — free real data, so every course should ship one), bunkers present, and **every pin sits on a real green** (double-green aware: St Andrews' 7 greens serving 14 holes pass, because it checks pin→green coverage, not a raw count).
- **INFORMATIONAL (printed, does NOT affect grade):** real-vs-synth fairway ratio. In the global+photoreal format the real aerial shows the actual fairway and a synth corridor still classifies the ball's lie, so OSM's fairway-mapping gaps (links/unmapped courses) are surfaced but don't block grade A.

**Grade A = the standard.** A bake gets there with: valid global format + registration + DEM + engine-pass (all HARD) and a scorecard (the one SOFT lever you control). `fetch_course_global.py` **auto-runs this gate** at the end of every bake (skip with `--no-verify`) and prints PASS/FAIL + grade, so a new course can't silently ship below standard.

Then visual-check: `python3 -m http.server 8080`; with a browser MCP, screenshot a few holes and compare registration to the real aerial / Overpass Turbo; else have the user playtest.

## Gotchas
- Overpass needs a `User-Agent` (406 without). It rate-limits — cache raw responses.
- OSM pars/yards can differ from the official scorecard — supply `courses/scorecard/<id>.json` to override (see Scorecard accuracy above).
- OSM vector vs Esri imagery can be offset a few meters (registration); overlays may not perfectly hug the photo.
- Pillow is NOT required — images stay north-up; rotation is handled at runtime by the affine.
