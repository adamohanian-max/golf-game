# Golf Course Viewer — Autonomous Build Workflow

Multi-model Claude Code orchestration for two workstreams:
- **WEB:** MapLibre GL JS v5 + Three.js course viewer (the reusable engine)
- ~~**IOS:** MapKit static 3D preview (lightweight, no custom physics)~~ — **RETIRED 2026-08-05.** Never built, and the direction is dead: the game's native Apple MapKit ground was removed and every photoreal course now renders through Google Photorealistic 3D Tiles (`three3d/gtiles3d.js`), one JS path that already runs in the iOS webview. Phase 7 and the `ios-implementer` agent spec below are kept only as a record of the abandoned plan.

Companion spec: `web_course_viewer_spec.md` (the technical brief — this file is the *process*, that file is the *content*).

---

## 0. READ THIS FIRST — what "hands-off" can and cannot mean here

You asked for completely hands-off. I'm going to be straight with you: **this workflow gets you ~90% hands-off, not 100%, and the missing 10% is not a limitation of the agents — it's the nature of the task.**

The failure modes in this project are *visual*:
- ball rendered mirrored, or sunk into the terrain, or floating above it
- overlay drifting relative to the map during camera moves
- terrain looking flat because DEM tiles silently failed

**No automated test catches any of these.** A typecheck passes, the build passes, the headless screenshot renders *something*, and the thing still looks wrong. An agent that can't see the output will happily report success on a broken render.

So the workflow below is designed to:
1. Run fully autonomously through everything that *is* machine-verifiable (scaffold, types, build, lint, data plumbing, physics unit tests).
2. **Stop at exactly two human gates** where you look at a screenshot for 30 seconds and say yes/no.
3. Automate the screenshot capture itself, so your gate is "open two PNGs" not "set up a dev environment."

Two gates. Roughly one minute of your attention total. That is the honest floor.

---

## 1. Prerequisites (one-time, ~10 min)

```bash
# Claude Code must be recent enough for Fable + Sonnet 5
claude update
claude --version    # need v2.1.197+ for Sonnet 5; Fable needs a recent build too

# Node for the web workstream
node --version      # v20+
```

**Cost awareness before you start.** Approximate per-MTok rates at time of writing (verify in your console — these move):

| Model | Input / Output | Role here |
|---|---|---|
| Fable 5 | $10 / $50 | Orchestrator only. ~10x Haiku. |
| Opus 4.8 | $5 / $25 | Hard sub-tasks (matrix math, physics) |
| Sonnet 5 | $2 / $10 (intro, then $3/$15) | Everyday implementation |
| Haiku 4.5 | $1 / $5 | Fan-out: reading, scaffolding, formatting |

### ⏰ Fable billing — time-sensitive, read before you start

**As of July 11, 2026: Fable 5 is INCLUDED on Pro/Max/Team plans**, for up to 50% of your weekly usage limit. That window runs through **July 12, 2026, 11:59:59 PM PT** (extended from the original July 7 cutoff). From **July 13**, Fable moves to prepaid usage credits at $10/$50 per MTok.

**Implication: run this build now.** The Fable orchestration pass is precisely the heavy, durable, high-leverage work worth banking on subscription tokens. Cheaper models can execute against the resulting artifacts afterward.

Two things that still bite even while it's "free":
1. **Fable draws down your weekly pool faster than Opus 4.8** for equivalent work, and the 50% inclusion shares that pool with everything else you run. The thin-orchestrator design in §9 is therefore still load-bearing — it's protecting your weekly limit, not just your wallet.
2. **When the pool empties, Fable access stops mid-session with no automatic fallback.** Enable usage credits (claude.ai → Settings → Usage) with a spend cap *before* you kick off, as cheap insurance. Mobile subscribers must do this on the web app.

This workflow keeps Fable's token count *small* regardless: it plans, delegates, and reads summaries. It should never read a source file directly. After July 13 that discipline is what keeps the run from costing real money; before July 13 it's what keeps the run from eating your week.

**Haiku's context is 200K, not 1M.** Never hand a Haiku agent a huge file or a broad "read the whole repo" task. Its jobs below are all narrow by design.

**Extended thinking propagates.** Subagents inherit the main session's thinking setting. Fable already runs adaptive thinking; leaving thinking on for the session means every Haiku fan-out also thinks, which is pure waste. Recommendation: **run the session with thinking off** and let Fable's own always-on reasoning do the heavy lifting.

---

## 2. Repo layout

```
golf-viewer/
  CLAUDE.md                      # project instructions (§4)
  docs/
    web_course_viewer_spec.md    # the technical brief — drop it here
    PROGRESS.md                  # agents append here; your recovery log
  .claude/
    agents/
      explorer.md                # haiku
      scaffolder.md              # haiku
      implementer.md             # sonnet
      terrain-baker.md           # opus (LiDAR bake, spec §4b)
      graphics-specialist.md     # opus
      physics-specialist.md      # opus
      verifier.md                # sonnet
      ios-implementer.md         # sonnet
  web/                           # MapLibre + Three.js app (Vite)
    public/tiles/{courseId}/     # LiDAR Terrarium tile pyramid (Phase 1b output)
  ios/                           # MapKit preview (Swift)
  tools/
    bake_lidar.py                # offline LiDAR bake driver (spec §4b)
    lidar/ground_dem.json.tmpl   # PDAL pipeline: 3DEP EPT -> ground DEM
  scripts/
    shoot.mjs                    # headless screenshot for the human gates
```

---

## 3. Model routing — the actual logic

The rule: **expensive tokens go where judgment lives; cheap tokens do the grunt work.**

| Stage | Model | Why |
|---|---|---|
| Orchestration, phase planning, gate decisions, reconciling failures | **Fable 5** | Long-horizon, ambiguous, must notice its own mistakes. Never touches files. |
| `modelMatrix` / custom-layer projection math | **Opus 4.8** | Highest-bug-density code in the project. Wrong axis sign = silent visual bug. Worth the tokens. |
| LiDAR terrain bake (PDAL/GDAL pipeline, ground classify, slope-from-smoothed-surface) | **Opus 4.8** | Silent-failure heavy: unclassified canopy in fairway, noise-driven random slope arrows, wrong encoding = flat greens. Judgment per §4b. |
| Ball flight physics + integration | **Opus 4.8** | Correctness-critical, reusable across both platforms. |
| GeoJSON layers, style config, Vite setup, iOS view code | **Sonnet 5** | Everyday implementation. Well-specified, unambiguous. |
| Reading spec files, scaffolding dirs, formatting, running builds, reporting errors | **Haiku 4.5** | Mechanical. No judgment required. |
| Build/typecheck/test verification, error triage | **Sonnet 5** | Needs to read errors and decide if they matter. |

**The waste to avoid:** using Fable to write a `tsconfig.json`. That's a $50/MTok model doing a $1/MTok job.

---

## 4. `CLAUDE.md` — create this at repo root

```markdown
# Golf Course Viewer

Two workstreams. The web engine is the priority; iOS is a thin preview.

## Ground truth
- `docs/web_course_viewer_spec.md` is the authoritative technical spec. Follow it.
- Where this file and the spec disagree, the spec wins on *technical content*;
  this file wins on *process*.

## Hard constraints (do not violate, do not "improve")
- MapLibre GL JS **v5**. The custom layer render signature is `render(gl, args)`
  and the matrix is `args.defaultProjectionData.mainMatrix`.
  Nearly every example online is v4 (`render(gl, matrix)`) and is WRONG here.
  If you find yourself "fixing" this back to the v4 form, stop — you are
  introducing the bug, not removing it.
- Projection is **mercator, locked**. Do not enable globe. The globe/mercator
  transition breaks custom-layer matrix math.
- The ball custom layer MUST be `renderingMode: '3d'` or terrain occlusion breaks.
- `game/ball.ts` must NOT import maplibre or three. It is the reusable engine.
  Renderer-agnostic. This is non-negotiable — it is the whole reason the web
  workstream exists before the iOS one.
- Tee/green/slope arrows are **GeoJSON layers**, not Three.js meshes. Do not
  "upgrade" them to 3D. MapLibre drapes them on terrain for free.

## Delegation policy
- Never read a source file into the orchestrator context. Delegate reads to the
  explorer subagent and work from its summary.
- Prefer the cheapest model that can do the job correctly (see routing table in
  docs/WORKFLOW.md). Escalate only on failure.
- After every phase, append a status block to `docs/PROGRESS.md` (see format below).

## Progress log format (append, never rewrite)
```
## Phase N — <name> — <PASS|FAIL|BLOCKED>
- What was built:
- Files touched:
- Verification result:
- Open risks:
- Next action:
```

## Definition of done for a phase
A phase is done when `npm run verify` exits 0 AND the phase's own acceptance
check in docs/WORKFLOW.md passes. "It compiles" is not done.

## When blocked
Do not guess and proceed. Write the blocker to docs/PROGRESS.md with
status BLOCKED, state the two options you considered, and stop.
```

---

## 5. Subagent definitions

Create each of these as a file under `.claude/agents/`.

### `.claude/agents/explorer.md`
```markdown
---
name: explorer
description: Read-only codebase and spec exploration. Finds files, reads specs, reports findings. Use proactively before any implementation task.
tools: Read, Grep, Glob
model: haiku
---
You read and summarize. You never write.

Return a tight summary: what exists, where it lives, what's relevant to the
asking task. Do not paste large file bodies back — summarize and cite paths
and line numbers. Your caller has a limited context budget and pays a premium
rate for it. Be brief.

Your context window is 200K. If asked to read something larger, read the most
relevant portion and say explicitly what you skipped.
```

### `.claude/agents/scaffolder.md`
```markdown
---
name: scaffolder
description: Creates directory structure, config files, package.json, tsconfig, Vite config. Mechanical setup only, no application logic.
tools: Read, Write, Edit, Bash
model: haiku
---
You do mechanical project setup: directories, config files, dependency install.

You do NOT write application logic, graphics code, or physics. If a task
requires a judgment call about how something should work, stop and say so
rather than inventing an approach.

Pin dependency versions exactly. Do not use caret ranges for maplibre-gl or three —
this project depends on specific API shapes.
```

### `.claude/agents/implementer.md`
```markdown
---
name: implementer
description: Everyday feature implementation from a clear spec — GeoJSON layers, map style, UI wiring, data loading. Use for well-specified work.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---
You implement clearly-specified features. `docs/web_course_viewer_spec.md` is
your source of truth.

Rules:
- Follow the spec's code shapes. Where the spec gives a snippet, treat it as the
  intended shape, not a suggestion to improve upon.
- Do not touch `three/modelMatrix.ts`, `three/ballLayer.ts`, or `game/ball.ts` —
  those belong to the specialist agents. If your task seems to need a change
  there, report it instead of doing it.
- Run `npm run verify` before reporting done. Report the actual output.
```

### `.claude/agents/graphics-specialist.md`
```markdown
---
name: graphics-specialist
description: MapLibre custom layers, Three.js integration, projection and model matrix math, terrain and depth. Use for anything touching the render pipeline.
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch
model: opus
---
You own the render pipeline. This is the highest-bug-density code in the project
and the bugs are SILENT — they produce a build that compiles and renders something
wrong. Assume you are wrong until verified.

Non-negotiables (from the spec):
- MapLibre v5: `render(gl, args)`, matrix from `args.defaultProjectionData.mainMatrix`.
- `renderingMode: '3d'` on the ball layer.
- `renderer.autoClear = false` and `renderer.resetState()` every frame.
- Mercator locked; never enable globe.
- Premultiplied alpha blending — if edges halo, that's the cause.

Before writing the model matrix, WebFetch the official MapLibre "Add a 3D model
using three.js" example and diff your axis conventions against it. Do not write
this from memory. Getting the rotation axis or the mercator scale wrong yields a
mirrored or sunken ball with zero error output.

Guard `map.queryTerrainElevation()` — it returns null until DEM tiles load.

When you finish, write to docs/PROGRESS.md exactly what you are UNSURE about
visually. That list is what the human will check at the gate.
```

### `.claude/agents/physics-specialist.md`
```markdown
---
name: physics-specialist
description: Ball flight, roll, and rest physics in game/ball.ts. Renderer-agnostic engine code.
tools: Read, Write, Edit, Bash, Grep, Glob
model: opus
---
You own `game/ball.ts` and its tests.

Hard rule: this module imports NOTHING from maplibre or three. It is plain
TypeScript. It knows geography (lng/lat, meters, bearings) and physics. It does
not know what is rendering it. This is what makes it reusable on iOS.

Deliver with unit tests (vitest). Test at minimum:
- a hit with known launch params lands within tolerance of an expected point
- the ball comes to rest (no infinite roll)
- state transitions: teed -> flying -> rolling -> rest
- heightAboveGround is never negative

Physics that is "close enough to look right" is the goal, not a real aero model.
Do not gold-plate.
```

### `.claude/agents/terrain-baker.md`
```markdown
---
name: terrain-baker
description: Offline LiDAR terrain bake (spec §4b) — 3DEP point cloud -> ground DEM -> Terrarium tiles + slope arrows. PDAL/GDAL/rio-rgbify. Not browser code.
tools: Read, Write, Edit, Bash, Grep, Glob, WebFetch, WebSearch
model: opus
---
You own the offline LiDAR pipeline (`tools/bake_lidar.py`, `tools/lidar/*`). This
runs on the machine, not in the browser. Spec §4b is your source of truth.

Silent-failure hazards — assume you are wrong until a decoded tile proves you right:
- **Ground classification (ASPRS class 2) is mandatory.** Skip it and tree canopy
  becomes fairway terrain. Verify point counts drop after the ground filter.
- **Never compute slope from raw point-to-point diffs.** Per-point vertical error
  (~10cm) ≈ the signal (a 2% / 3m green rises ~6cm). Fit a smoothed surface over the
  green polygon, take the gradient of THAT. Smoothing is the real work, not cosmetic.
- **Terrarium encoding, not Mapbox terrain-RGB.** 4mm vs 100mm vertical quant. On a
  green, 100mm renders flat plateaus with 10cm cliffs. rio-rgbify Terrarium params.
- **Voids over water/bunkers are expected.** Interpolate (IDW/TIN) and move on.
- **Composite onto global DEM for the +200m buffer ring** so the horizon doesn't
  cliff to zero at the LiDAR boundary. Feather the seam.

If PDAL / GDAL / rio-rgbify are not installed, or 3DEP has no coverage for the bbox,
write BLOCKED to docs/PROGRESS.md with the exact missing binary or empty-coverage
response. Do NOT emit a zero/flat tileset and call it done — a flat tileset is the
one failure mode the whole spec exists to prevent.

Store the LiDAR acquisition date in the course record and flag it stale — greens get
rebuilt; a 2019 flight doesn't know about a 2023 redesign.
```

### `.claude/agents/verifier.md`
```markdown
---
name: verifier
description: Runs builds, typechecks, tests, and headless screenshots. Triages errors. Reports pass/fail with evidence. Use after every phase.
tools: Read, Bash, Grep, Glob
model: sonnet
---
You verify. You do not fix.

Run `npm run verify`. Report the real output — never claim a pass you did not see.

For visual phases, run `node scripts/shoot.mjs` and confirm the PNGs were written
and are non-trivial (not a blank/uniform image — check file size and, if you can,
pixel variance). A screenshot that renders is NOT a screenshot that is correct.
Say so explicitly in your report: "renders without error; visual correctness
requires human review."

If verification fails, produce a triage: what failed, the exact error, your best
hypothesis, and which specialist should own the fix. Then stop.
```

### `.claude/agents/ios-implementer.md` — RETIRED, do not run
> Superseded 2026-08-05 along with the whole iOS MapKit workstream (see the
> header). Apple Flyover is no longer a ground backend anywhere in this project.
```markdown
---
name: ios-implementer
description: MapKit-based iOS course preview — MKMapView, MKMapCamera, overlays, annotations. Swift only.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---
You build the iOS preview. Scope is deliberately small: a pitched 3D satellite
MapKit view with tee/green polygons, slope arrow annotations, and a static ball.

You do NOT port the physics. The ball-flight engine lives in the web workstream
(game/ball.ts). If someone asks you to reimplement it in Swift, push back —
that's exactly the duplication this project is structured to avoid.

Approach:
- MKMapView, `mapType = .hybridFlyover` (or .satelliteFlyover), pitch ~70-80 via
  MKMapCamera, low altitude.
- Tee/green: MKPolygon + MKPolygonRenderer.
- Slope arrows + ball + pin: MKAnnotation with custom images.
- Read the hole data from the SAME JSON schema as the web app
  (docs/web_course_viewer_spec.md §8). Do not invent a second schema.

Note honestly in PROGRESS.md that Flyover 3D quality degrades in rural areas
where Apple lacks detailed data — this is expected, not a bug to fix.
```

---

## 6. The screenshot harness (your gate mechanism)

Have the scaffolder create `scripts/shoot.mjs` using Playwright. It should:
1. Boot the Vite dev server.
2. Load the app, wait for `map.on('idle')` plus a fixed 3s for DEM/satellite tiles.
3. Capture 3 PNGs to `shots/`:
   - `01-overview.png` — pitched view, whole hole
   - `02-ball-tee.png` — camera close on the ball at the tee
   - `03-occlusion.png` — camera positioned so terrain is between camera and ball
4. Exit non-zero on any console error.

`npm run verify` = `tsc --noEmit && vitest run && vite build`
`npm run shoot` = `node scripts/shoot.mjs`

---

## 7. The kickoff — paste this once, then walk away

```bash
cd golf-viewer
claude --model claude-fable-5
```

Then, with thinking OFF, paste:

```
You are the orchestrator for this build. Read CLAUDE.md and docs/WORKFLOW.md,
then execute the phase plan in WORKFLOW.md §8 autonomously.

Operating rules:
- You are running on Fable, the most expensive model in the stack. Your job is
  planning, delegation, and judgment — NOT reading files or writing code.
  Delegate every read to `explorer` and every write to the appropriate specialist.
- Route each task to the cheapest model that can do it correctly, per the routing
  table in WORKFLOW.md §3. Escalate only on failure.
- After each phase, run the `verifier` subagent. Do not advance on a failed verify.
- Append a status block to docs/PROGRESS.md after every phase.
- At HUMAN GATE phases, stop completely. Write the gate request to PROGRESS.md
  and end your turn. Do not proceed past a gate on your own judgment — the check
  is visual and you cannot see.
- If you are blocked or a phase fails twice, stop and write BLOCKED to
  PROGRESS.md with your diagnosis. Do not thrash.

Begin with Phase 1.
```

Then leave. It will run Phases 1–3 and stop at Gate A.

---

## 8. Phase plan

### WEB workstream

**Phase 1 — Scaffold** · `scaffolder` (haiku)
Vite + TS project, pinned deps (`maplibre-gl@^5.24`, `three@^0.169`, vitest, playwright), directory structure per spec §3, `npm run verify` + `npm run shoot` scripts, empty `shoot.mjs`.
*Accept:* `npm run verify` exits 0 on an empty project.

**Phase 1b — LiDAR terrain bake (offline, HARD DEPENDENCY for Phase 2)** · `terrain-baker` (opus)
Offline pipeline per spec **§4b**. Run once per hero course on your machine, not in the browser. `tools/bake_lidar.py` drives the 7 steps (FETCH→CLASSIFY→GRID→COMPOSITE→SMOOTH→ENCODE→SERVE) via PDAL (`tools/lidar/ground_dem.json.tmpl` pipeline) + GDAL + rio-rgbify. Inputs: USGS 3DEP EPT/COPC on AWS Open Data + OSM `leisure=golf_course` boundary +200m buffer. Outputs, all keyed by course id:
- Terrarium PNG pyramid z10–z18 at `web/public/tiles/{courseId}/{z}/{x}/{y}.png` → `Course.terrainTiles` URL (nullable; null = coarse global-DEM fallback).
- Per-green `slope` GeoJSON points (smoothed-surface gradient, **not** raw point-to-point) → fold straight into `data/hole-N.json` `featureCollection` (§5 schema, no adapter).
- Optional: resample the same 0.5m ground GeoTIFF into the existing game's `course.dem` grid (`--emit-game-dem`) so the 2D/`three3d` engine inherits LiDAR too. Same dict shape ⇒ every `terrainZ`/`buildDEMShade`/`downsample_dem.py` consumer unchanged.

*Why hard dep:* Phase 2 loads `Course.terrainTiles`. On a course with no LiDAR the viewer renders a nearly-flat plane (§4 "terrain is the whole ballgame") — a valid, silently-wrong image. Bake at least the one demo hole's course before Phase 2 so Gate A has real relief to judge.
*Encoding gate:* **Terrarium, not Mapbox terrain-RGB** (4mm vs 100mm vertical quant — spec §4). rio-rgbify `--base-val -32768 --interval 0.00390625`.
*Accept:* tileset exists at expected path, spot-check a z18 tile decodes to plausible elevations (not all-zero, not clamped); slope arrows non-degenerate over a known-sloped green. Binaries missing ⇒ report BLOCKED, do not fake output.

**Phase 2 — Base map + terrain** · `implementer` (sonnet)
`map/style.ts` (satellite raster, mercator locked), `map/terrain.ts` — `addTerrain(map, course)` per spec §4: use `course.terrainTiles` (Terrarium, `maxzoom: 18`) when present, else `GLOBAL_DEM` fallback; `setTerrain({exaggeration: 1.0})`. `main.ts` boot with pitch 72. Consumes Phase 1b output.
*Accept:* app builds, dev server boots, no console errors; LiDAR course renders visible relief, not a flat plane.

**Phase 3 — Course furniture** · `implementer` (sonnet)
`map/holeLayers.ts` — tee/green fills, slope-arrow symbol layer with the arrow image registered. Sample `data/hole-1.json` with real coordinates for one hole.
Then `verifier` runs `shoot.mjs`.

> ### 🛑 HUMAN GATE A
> **Open `shots/01-overview.png`.** You are checking one thing: *does it look like a golf hole on tilted 3D terrain?*
> - Terrain visibly sloped (not a flat plane)? Satellite imagery draped and sharp?
> - Tee and green polygons sitting ON the ground, not floating or offset?
> - Slope arrows readable and rotating with the map?
>
> **If yes:** reply `Gate A passed, continue to Phase 4.`
> **If no:** reply with what's wrong in plain words. Fable will route the fix.
>
> *Why this gate exists: flat terrain from a silently-failed DEM source renders as a perfectly valid, perfectly wrong image. No test catches it.*

**Phase 4 — Ball layer (the hard one)** · `graphics-specialist` (opus)
`three/modelMatrix.ts` and `three/ballLayer.ts`. Static white sphere on the tee at correct ground height and scale, tracking correctly through camera moves.
*Accept:* builds clean; `shoot.mjs` produces `02-ball-tee.png` and `03-occlusion.png` without console errors.

> ### 🛑 HUMAN GATE B
> **Open `shots/02-ball-tee.png` and `shots/03-occlusion.png`.**
> - Ball sits ON the tee — not sunk into the ground, not hovering above it?
> - Ball is roughly golf-ball-sized relative to the tee box (not a beach ball, not invisible)?
> - In `03-occlusion.png`, the ball is **hidden** behind the terrain?
>
> **If yes:** reply `Gate B passed, continue to Phase 5.`
> **If no:** describe it — "ball is underground", "ball is huge", "ball shows through the hill". Those three descriptions map to three different bugs and Fable will route each correctly.
>
> *Why this gate exists: the model matrix is the single highest-risk artifact in this project, and every one of its failure modes compiles cleanly.*

**Phase 5 — Physics** · `physics-specialist` (opus)
`game/ball.ts` + vitest suite. Then `implementer` wires `hit()` to a temporary UI control.
*Accept:* all unit tests pass; ball visibly flies and comes to rest.

**Phase 6 — Polish** · `implementer` (sonnet)
Sky layer, terrain exaggeration tuning, shadow blob under ball, camera framing from hole centerline.
*Accept:* `npm run verify` clean; screenshots regenerated.

### IOS workstream

**Phase 7 — MapKit preview** · `ios-implementer` (sonnet) — **RETIRED, skip**
Runs *after* Phase 3 (needs the hole-data schema locked) and is independent of Phases 4–6. Fable may run it in parallel with the web phases if you want wall-clock speed — at the cost of concurrent token burn.
*Accept:* project builds in Xcode; pitched flyover view with tee/green/arrows/ball renders.

> Note: there is **no human gate on iOS** in this plan. It's stock MapKit with overlays — low-risk, well-trodden. If it builds, it very likely looks right. You'll eyeball it in the simulator whenever you get to it.

---

## 9. Compute budget discipline

The single biggest cost risk is Fable reading files. Guardrails:

1. **Fable never gets Read/Grep/Glob directly.** In practice: instruct it (as the kickoff prompt does) to delegate all reads to `explorer`. If you want to enforce this harder, launch with `--agent` restrictions.
2. **Cap the retry loop.** The kickoff prompt says: fail twice → stop. Without this, an agent can burn an entire budget re-attempting a matrix bug it cannot see.
3. **Thinking off at the session level.** Subagents inherit it; a thinking Haiku formatter is pure waste. Fable reasons well without the session flag.
4. **`PROGRESS.md` is your resume point.** If you kill the run or hit a limit, restart with:
   ```
   Read docs/PROGRESS.md. Resume from the first phase not marked PASS.
   ```
   You do not re-pay for completed phases.
5. **Rough shape of the spend:** Phases 1 and 3's reads are Haiku pennies. Phases 4–5 (Opus) are the real cost centre and are *worth* it — a wrong model matrix costs you more in your own debugging time than Opus costs in tokens. Fable's own usage should be a small fraction of total if delegation is working. **If you check usage and Fable is the majority of spend, delegation has broken down — that's your signal to intervene.**
6. **Before vs. after July 13.** Running now: Fable comes out of your weekly plan pool (50% cap), so the cost of sloppy delegation is a burned week, not a bill. Running later: same tokens become dollars at $10/$50. Either way the guardrails are the same — the consequence just changes shape. Cached input reads (~90% off) and the Batch API (50% off) only matter after the flip, when they hit your credit balance directly.

---

## 10. Known failure modes and what they mean

| Symptom | Almost certainly |
|---|---|
| Terrain looks flat | DEM source failed silently. Check the raster-dem URL and `encoding: 'terrarium'`. |
| Ball is mirrored / rotated wrong | `modelMatrix` rotation axis. Diff against the official MapLibre example. |
| Ball sunk into ground / floating | `queryTerrainElevation` returned null before DEM tiles loaded, or exaggeration mismatch. |
| Ball visible through hills | `renderingMode` is `'2d'`, not `'3d'`. |
| Ball has a white halo | Premultiplied-alpha blend function. |
| Ball is enormous or invisible | `meterInMercatorCoordinateUnits()` scale not applied, or applied twice. |
| Overlay drifts during pan | Agent "fixed" the v5 render signature back to v4. Revert it. |
| Everything renders but nothing moves | `map.triggerRepaint()` missing from the render loop. |
| LiDAR course still looks flat | `course.terrainTiles` null/404, or `maxzoom` left at 15 not 18, or ground classify skipped. Do NOT raise exaggeration. Spec §4/§4b. |
| Green renders as flat plateaus w/ 10cm cliffs | Encoded Mapbox terrain-RGB (100mm quant) instead of Terrarium (4mm). Re-encode. |
| Slope arrows point random directions | Gradient taken from raw grid, not a smoothed surface. Noise ≈ signal. Spec §4b noise problem. |
| Tree canopy shows as bumps in fairway | Ground classification (ASPRS class 2) skipped in the PDAL pipeline. |

Paste any of these descriptions straight back at Fable at a gate; the table is deliberately written so a plain-language symptom maps to a single cause.

---

## 11. What is deliberately NOT automated

- **Satellite tile provider swap.** The spec uses Esri World Imagery as a dev placeholder. Moving to a production-licensed source (MapTiler, your own tiles) is a business decision with terms attached. An agent should not pick your vendor.
- **The two visual gates.** Covered above.
- **Xcode signing / App Store config.** Out of scope, and involves credentials.
- **Real course data ingestion.** Phase 3 uses one hand-picked hole. Wiring your full OSM baking pipeline is a separate project — do it after the viewer is proven on one hole.
```
