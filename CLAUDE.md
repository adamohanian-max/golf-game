# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mobile-first golf game built with Vanilla JS + HTML5 Canvas. No build step — open `index.html` directly or serve with Python.

## Running locally

```sh
cd ~/Documents/GitHub/golf-game
python3 -m http.server 8080
```

Desktop: `http://localhost:8080`  
Phone (same WiFi): `http://<your-mac-ip>:8080`

**Admin server (optional):** `python3 tools/bake_server.py` is a drop-in replacement for `http.server` that ALSO exposes `/api/search` + `/api/bake`, powering the in-game admin **➕ Add course** button (search any course → bakes via `fetch_course_global.py` → appends `courses/manifest.json` → git commits). Flags: `--port 8080 --no-git --push`. The button is admin-gated AND hidden unless `/api/ping` answers, so a plain static deploy never shows it. The course list is driven by `courses/manifest.json` (fallback: hardcoded `FALLBACK_COURSES` in game.js).

## Concurrent Claude Code agents

Multiple agents can work this repo at once. Two independent isolations — **neither needs a commit or push**:

- **Browser (Playwright):** `.mcp.json` runs the Playwright MCP with `--isolated`, so each Claude session gets its own ephemeral Chrome profile instead of fighting over one shared profile dir (`mcp-chrome-*`). Without it a second agent hits `Browser is already in use ... use --isolated`. Isolated mode keeps no persistent browser state — fine here (localhost, no logins). The dev server (`python3 -m http.server 8080`) is shared; one instance serves all agents.
- **Files (git):** to stop agents clobbering each other's edits, give each its own **git worktree** (`git worktree add ../golf-game-<name>`, or the Agent tool's `isolation: "worktree"`). Each worktree is a separate working copy on its own branch; merge when done. Committing/pushing is only for sharing results, never a prerequisite for running agents in parallel.

## File structure

- `index.html` — canvas element, scorecard overlay (HTML, updated by JS), result modal
- `style.css` — full-screen canvas, `touch-action: none` to block browser scroll hijack, safe-area insets for notched phones
- `courses/<id>.json` — baked real-course geometry the game loads at runtime (Phase 2)
- `tools/fetch_course.py` — dev-only data-prep: pulls a course from OpenStreetMap (Overpass API) and writes `courses/<id>.json`. NOT part of the game build.
- `game.js` — all game logic, organized in sections:
  - **TUNE** (top) — all physics tunables as named constants
  - **HOLE data** — `HOLE` is built at runtime by `setHole()` from loaded course data (`surfaces` = arrays of polygons per type); `FALLBACK_HOLE` is a hardcoded par 4 used if the fetch fails
  - **Derived power** — `recalcPower()`: fixed across holes (consistent swing feel); re-run only if scale/green speed changes
  - **State** — single `state` object + `resetState()`
  - **Geometry helpers** — `dist()`, `pointInPoly()`, `inAnyPoly()`, `surfaceAt()`
  - **Physics** — `update()`: velocity, per-surface friction, world-edge bounce, hole capture/lip-out, water penalty
  - **Input** — touch, mouse drag, and two-finger trackpad swipe (wheel events); all funnel through `launch(dxs, dys, dt)`; swipe direction + speed → launch vector
  - **Rendering** — `draw()` has TWO modes: **photoreal** (`drawPhotoSurfaces()` — real aerial base via `drawAerial()` + translucent play-surface overlays) when the hole's aerial image has loaded, else **vector** (`drawVectorSurfaces()` — stylized stripes/gradients incl. woods/cartpaths/grass). Shared helpers: `stripes()`, `withClip()`, `tracePoly()`, `strokePolyline()`, `drawGreen(photo)`. **Topographic green**: a synthesized (deterministic, no real elevation) height field per green → contour lines via marching squares (`buildGreenTopo()`/`contourSegments()`, precomputed in `setHole`), drawn in both modes. **This same field drives putting break** — each green exposes `h(x,y)` + analytic `grad(x,y)`; `greenSlopeAt()` returns the downhill gradient and `rollStep` accelerates the ball along it (`TUNE.slopeAccel`, gated by `TUNE.slopeStopSpeed` so a settled ball doesn't creep). So what you see (contours) is what breaks. Real LiDAR (USGS 3DEP) can later replace `grad`/`h` per-green without touching downstream. **Shaded-relief topo**: a soft hillshade overlay (NOT a rainbow heatmap) shown only on the **green in play** + the **target green** (`greensInPlay()` = green under the ball and under the pin). Per green, `buildGreenRelief()` bakes a small offscreen raster (light/shadow from the height-field normal, NW light, + a whisper of warm tint on the steepest spots); `drawGreenRelief()` clips to the green and draws it through the view transform (composes `dpr·(view∘m)` like `drawAerial`, `imageSmoothingEnabled` → smooth, rotates with the camera). It's **whisper-faint always-on** (`TUNE.reliefAmbient`) and the slope button (`#slope-btn`) **boosts intensity** (`TUNE.reliefFull`) and adds thin **fall-line arrows** (`drawFallArrow`/`drawGreenArrows`, fixed screen-px width, cell-center sampled). Relief tunables: `reliefAmbient/reliefFull/reliefExag/reliefShade/reliefTint`. Greens-only (the old fabricated fairway field + rainbow `slopeColor`/`drawSlopeHeat` were removed). Aerial draw composes `dpr·(view ∘ aerial.toWorld)` and `drawImage`.
  - **Scorecard/UI** — DOM updates + result modal; running round total (`round.score`), per-hole `setHole`, "Next hole" advances
  - **Course loading** — `loadCourse(id)` fetches the JSON; `setHole(rec)` builds HOLE/WORLD
  - **Loop** — `requestAnimationFrame` driving `update` + `draw`

## Coordinate system

Per-hole world bounds (`WORLD.w/h`, set by `setHole`); origin top-left, tee at bottom and pin near the top. Scale is **fixed** at `YARDS_PER_UNIT` (≈3 yds/unit, from the course JSON) so a given swing means the same distance on every hole. `view.scale`, `view.ox`, `view.oy` map world→screen via the camera rect; `wx(x)`, `wy(y)`, `ws(v)` convert coords/sizes. Recomputed on every window resize and hole change.

## Course data pipeline (Phase 2)

Real geometry comes from OpenStreetMap via the Overpass API (`golf=green|fairway|tee|bunker|water_hazard|hole`). Strategy is **pre-bake, not live-fetch**: `tools/fetch_course.py` queries one course (by its boundary way id), projects lat/lon → per-hole world units (tee→pin oriented "up", fixed yards/unit), and writes a normalized `courses/<id>.json` the game fetches statically.

Geometry is **real-first**: greens, bunkers, water, tees, **fairways**, **rough** (`golf=rough`), plus **woods/cartpaths/grass** come from real OSM polygons (`golf=*`, `natural=wood|water`, `landuse=grass`). Hole lines are ordered by the leading int in their `ref` (handles `"7"` and `"7 - #2"`), deduped by number. Fairways/bunkers/rough/woods/cartpaths/grass are assigned to the **nearest hole** (centroid→centerline). A fairway corridor is **synthesized only as a fallback** for holes with no mapped fairway (links courses like St Andrews) — the tool prints how many holes fell back.

**Rough vs fairway inference:** `surfaceAt()` returns `"rough"` as the implicit default (any point not in a water/bunker/green/fairway/tee/woods polygon); mapped `golf=rough` is now also baked as an explicit `rough` surface (mostly aids rendering — physics already defaults to rough). The real accuracy fix is **aerial-carved fairways**: for holes with no OSM fairway, the bake replaces the crude fixed-width corridor with a **variable-width ribbon measured from the Esri aerial** (`measure_fairway_ribbon`/`carve_synth_fairway` in `fetch_course.py`; `carve_synth_fairways` in the global tool). It classifies mown fairway grass by HSV (`is_fairway_px`, `FW_*` constants — may need per-course tuning), marches perpendiculars off the tee→pin centerline to find each edge, and **clamps width ≤ the fixed corridor** so world bounds stay valid. Needs **Pillow** (optional — `try: from PIL import Image`); without it, or on classification failure, it falls back to the fixed corridor (e.g. Pinehurst's sandy no-rough holes don't carve and keep the rectangle).

**Aerial imagery:** the tool also bakes one north-up **Esri World Imagery** JPG per hole into `courses/img/<id>/hole<N>.jpg` (keyless), plus a pixel→world affine `aerial.toWorld=[a,b,c,d,e,f]` (`world.x=a*px+b*py+c`, `world.y=d*px+e*py+f`). The game draws the photo as the hole base, rotated to play "up" via that affine — no image processing needed for *rendering* (Pillow not required there). `--no-imagery` skips it. Pillow **is** used (optionally) to carve synth fairways from the baked aerial — see "Rough vs fairway inference" above.

**Aerial surface mask (OOB + fairway/rough from what you SEE):** OSM polygons make OOB inconsistent (only `natural=wood` counted — neighborhoods/roads/parking defaulted to playable rough) and fairway/rough coarse. So the bake also classifies the aerial per-pixel into a coarse **label raster** (`courses/img/<id>/surfacemask.png`, palette `OB=0 / FAIRWAY=1 / ROUGH=2 / WOODS=3`) + a `surfaceMask:{file,w,h,toWorld}` affine. `build_surface_mask`/`_classify_px` in `fetch_course.py` (wired into `fetch_course_global.py` after the aerial downloads): green-turf by HSV (reuses `is_fairway_px`'s band); fairway-vs-rough by **brightness split** (Otsu over the green pixels → `_otsu`, mostly removes per-course tuning); woods = dark + high local edge energy (`FIND_EDGES`+`BoxBlur`); everything non-green is **OOB only outside the playing envelope** — inside it, non-turf (sand/path/dirt) is just rough, so a fairway bunker isn't mistaken for a parking lot. The envelope is the **union** of the OSM boundary polygon, the buffered hole centerlines (`MASK_CORRIDOR_UNITS`) and the OSM play polygons (fairway/green/tee/bunker), all dilated outward by `MASK_ENV_DILATE_UNITS` — parcel lines often cut through real dunes/fairway edges (coastal + multi-parcel courses). Outside the envelope, **sand-looking pixels are rescued to rough** (bright/warm/low-sat, `MASK_SAND_*`) within `MASK_SAND_NEAR_UNITS` of it — sand is never OB. Despeckled (`ModeFilter`), OSM `woods` unioned in as a strong prior. Tunables: `MASK_*` constants. Pillow-optional + guarded (no Pillow / classify fail → no `surfaceMask` key). `--no-mask` skips it. **Game side:** `loadSurfaceMask`/`maskClassAt` (game.js) decode the PNG once (nearest-palette → `Uint8` labels) and sample it in `surfaceAt()` — OSM stays authoritative for green/bunker/water/tee, then the **mask decides OB vs playable** (its envelope already folds in the boundary polygon; fairway/rough/woods/`ob`), then the vector `boundary` polygon (OB outside it, except mapped fairway) covers off-mask points, then OSM polygons on no-mask holes. `tools/remask_courses.py` rebuilds every course's mask offline from the baked aerial + JSON (no Overpass); `--audit` prints OB-in-fairway / OB-near-centerline metrics. New `"ob"` surface mirrors woods in `friction`/`bounce`/`lie`; OOB penalty (`woods`+`ob`) is gated by `TUNE.obPenalty` (default on = +1 & drop at `lastSafe`). `drawOOBOverlay` draws the OB+woods cells as a red tint through the aerial transform (gated by the `showOOB` button).

Default course: **Pinehurst No. 2** (`courses/pinehurst-no2.json` + `courses/img/pinehurst-no2/`, 11/18 holes with real fairways). Re-bake:
`python3 tools/fetch_course.py --boundary-way 1358696570 --id pinehurst-no2 --name "Pinehurst No. 2"`
St Andrews Old is also baked (`--boundary-way 1019045811 --id st-andrews-old`, fairways synthesized). **Four Oaks Country Club** (Dracut, MA) is baked from an OSM **relation** boundary: `--boundary-rel 18442673 --id four-oaks-dracut --name "Four Oaks Country Club"` (18 holes, par 70; the 4 par-3s' aerials returned Esri 500s so those holes render in vector mode — re-bake to retry). `fetch_course.py` now accepts `--boundary-rel <id>` (relation→area via `rel(id);map_to_area`) in addition to `--boundary-way`.

**Course picker:** the home menu lists `COURSES` (game.js, near `loadCourse`) as tappable options; `selectedCourseId` drives `startCourse()`, which calls `loadCourse(selectedCourseId)` when switching. Add a course = bake its JSON + push `{id,name,sub}` onto `COURSES`. See the `bake-course` skill (`.claude/skills/bake-course/`) for the full workflow.

## Key tunables (`TUNE` in game.js)

| Constant | Effect |
|---|---|
| `powerFactor` / `maxPower` | Swipe speed → launch speed; derived from `YARDS.maxCarry` projectile range |
| `launchAngleDeg` / `gravity` / `airDrag` | Ball-flight arc shape & hang time |
| `spinFactor` | How hard a curved swipe bends flight (draw/fade) |
| `bounce.<surface>.{e,h}` | Landing: `e` vertical restitution, `h` horizontal speed retained |
| `bounceStopVz` | Downward speed below which bouncing stops → rolling |
| `captureSpeed` | Max ball speed to drop into cup (higher = more forgiving) |
| `friction.*` | Per-surface rolling velocity multiplier per frame (fairway/rough/bunker/water; lower = more friction). Green is separate (constant deceleration, see below) |
| `greenDecel` | Green roll: constant deceleration/frame, derived from stimp (`GREEN_DECEL_K / greenSpeed`); realistic putt rollout |
| `slopeAccel` | Putting break: downhill accel per unit of green-field gradient (folds vertical scale + gravity into one knob) |
| `slopeStopSpeed` | Below this roll speed slope is ignored, so a settled ball rests instead of creeping |

## Ball flight & physics

A swing is either a **putt** (on the green: stays grounded, rolls with slope-aware break — see Topographic green) or a **full shot** (airborne projectile). State carries `z` (height), `vz` (vertical velocity), `spin`. `update()` dispatches to `flightStep` (gravity arc + sidespin curve + land/bounce) or `rollStep` (per-surface friction + hole capture + water). Flight calibrated so a max swing *carries* `YARDS.maxCarry`; bounce + rollout add more. Shot shape comes from swipe curvature (`curveFromPath`). Rendered with a ground shadow at `(x,y)` and the ball lifted by `z`.

Lip-out: a rolling ball entering `holeRadius` at speed ≥ `captureSpeed` reflects off the rim (0.5 restitution); slow enough → sinks (airborne balls can't drop). Water: ball lands/stops in water → +1 penalty, resets to `state.lastSafe`. Per-surface `bounce` values are placeholders for real per-course data from the future golf API.

## Roadmap

- ✅ Phase 2: real course geometry from a golf API (OSM/Overpass), generalized canvas hole renderer, 18-hole round play. Baked: St Andrews Old. Future: more courses, real stimp/bunce per course, real green elevation (USGS 3DEP LiDAR) to replace the synthetic break field, club-fitting (auto-calibrate swing → player carry distance — deferred). ✅ Slope-aware putting (break from the synthetic green field).
- Phase 3: live PGA Tour schedule feed — "play today's course" (runtime fetch)
- Phase 4: scoring history, leaderboard, user accounts
