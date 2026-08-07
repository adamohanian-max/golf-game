# 3D for Butter Brook — zero-capture plan

**Status:** plan, nothing built. Written 2026-08-06, rewritten the same day once
drone capture was ruled out.

## Constraint

**No drone capture, no hired pilot, no paid imagery.** That removes
photogrammetry entirely, and with it any Google-style photoreal mesh.

Google has none of its own here: measured off the live engine, Butter Brook's
tiles are **85 verts/mesh** against Pebble's 1519 — aerial imagery draped on
near-flat ground. It sat on `GTILES_IDS` for one day and came back out
(`68f6630`). Not fixable from our side, and not worth paying for.

So the question is not "how do we get photoreal 3D" but **"how much real 3D can
we get from data we already have, for $0?"** Quite a lot — because the renderer
already exists and is switched off.

## What we already own

| asset | state | where |
|---|---|---|
| **2.5D tilted renderer** — DEM terrain lift, column-band warp + cache, standing trees from the woods mask (3 canopy tiers), DEM hillshade, viewpoint punch-out, motion degrade | **built, perf-tuned, switched OFF** | `game.js`, gated by `tiltView` |
| **Full three.js engine** — sky, fog, shadows, procedural "bumpy crown" trees | **built, dormant** | `three3d/course3d.js`, gated by `render3DWanted()` |
| Butter Brook DEM | 286 × 213 grid, baseElev 50.6 m | `courses/butter-brook-golf-club.json` |
| Surface mask + 41 woods polygons | baked | same |
| **Free USGS 3DEP LiDAR over the course** | 1 m DEM + 6 LAZ tiles, `MA_CentralEastern_2021_B21` | The National Map, verified 2026-08-06 |

None of this needs a flight, a vendor, an API key, or a hosting bill.

---

## Stage 1 — Real terrain from free LiDAR

`course.dem` comes from the global AWS z14 grid at **~10 m** cell size. USGS 3DEP
covers this course at **1 m** — 10× finer, already public, already verified
present.

- Bake through the existing `lidar-terrain` skill path (needs PDAL/GDAL).
- Sharpens `terrainZ` everywhere it is read: the plays-like readout
  ("PLAYS 505 yds (+9 ft)"), green macro tilt via `demPlaneTilt`, and — the
  reason it goes first — **the relief Stage 2 leans on**.

**Gate:** `shot_matrix --gate`, plus `putt_matrix --gate` on this course with the
grade census still inside `greenGradCap()`. This is a real regression risk, not a
formality: `gMacroCap`'s tanh squash exists *because* coarse-DEM green plane fits
are noisy, so better data may want that constant re-examined rather than trusted.

**Ships on its own** — better terrain on the existing 2D course, no UI change.

## Stage 2 — Turn the 2.5D renderer back on

`tiltView` is a `let` permanently `false` (game.js:1435), so `camera.tilt` stays
1, `view.kz` stays 0, and every lean/warp branch is skipped — "bit-identical to
the kz=0 fast path", as the comment there says. The implementation is intact and
was measured at **45→60fps parked** after the 2026-07-07 perf pass.

What Butter Brook gets, from data it already has:

- Camera **leans** (`TUNE.tiltCos`); ground gains real relief from the DEM
  (`terrainZ` → `wyg`, exaggerated by `TUNE.tExag`)
- **Trees stand up** from the mask's woods cells — 3 clump-scale height tiers,
  feathered alpha, painter-sorted, baked into the warp cache
- Course-wide **DEM hillshade** composited while tilted
- Ground-anchored overlays (cup, flag, ball shadow, flow dots) follow the lift

**Work:**

1. **Re-enable the flag** — `tiltView` needs a writer again, per-device persisted
   (`golf.tiltView`), defaulting **off**.
2. **Give it a control** — `#tilt-slider` already exists and currently shows only
   when `gtilesGround` (`updateTiltBtn`). Extend to: gtiles courses (real camera
   pitch, unchanged) **or** DEM courses (drives `camera.tTilt`/`tiltView`). One
   widget, two meanings — keep the branches explicit; they are not the same
   camera.
3. **Bit-rot check** — these branches have not executed since the tilt button was
   removed, and the aim roller, gtiles ground and render-pace gate all landed
   afterwards. Specifically re-verify the two CLAUDE.md calls out: the
   `bucketBlend` gate must take the roller terms (otherwise spinning on a tilted
   course rebuilds the ground raster every frame), and `renderPace()` must report
   ACTIVE through a tilt tween.
4. **Scope it deliberately** — enabling `tiltView` affects *every* DEM course, not
   just Butter Brook. Probably desirable, but it makes this a global change with
   a global blast radius, so it ships behind a default-off toggle.

**Gates:** with the toggle off, flat mode must stay byte-identical (`view.kz === 0`
is the documented fast path — assert it); `shot_matrix`/`putt_matrix` unaffected
(rendering only, physics untouched); frame rate on a real device via the
`?devdrive=1` rig against a **local http://** server. Watch the warp cache — a
cache that never parks was the original 6fps death spiral.

## Stage 3 (optional, later) — the full three.js engine

`three3d/course3d.js` renders true 3D: sky, fog, shadows, procedural
noise-displaced "bumpy crown" trees, aerial draped on the DEM. Built for Four
Oaks, dormant behind `render3DWanted() { return false; }`.

Bigger lift than Stage 2 and heavily overlapping it — same inputs (DEM + aerial +
woods), better output, much more integration surface. **Do not start here.**
Stage 2 is cheap, and its result tells you whether the extra fidelity justifies
re-opening a whole engine.

---

## What this will NOT give you

Stated plainly so the result isn't a disappointment:

- **Not photoreal.** Ground is the baked NAIP aerial draped on terrain; trees are
  procedural, driven by a woods mask. It will read as a good stylised 3D golf
  view — not as Pebble's photogrammetry.
- **Tree placement is inferred, not surveyed.** It comes from the mask, so trees
  won't match the real course tree-for-tree.
- **No building geometry.** The clubhouse stays a flat photo.

If genuinely photoreal 3D here ever becomes a priority, drone capture is the only
route, and the archive below records what it takes. Until then Stages 1–2 are the
honest ceiling — and they cost nothing.

---

## Archived: the drone path (ruled out 2026-08-06 — no capture)

Kept in case the constraint changes.

Capture would be **hired, not flown by us** — US commercial drone work needs an
FAA Part 107 certificate. Roughly $500–2,000 for ~80 ha. Ask the course first: a
yardage-book or marketing vendor may already hold usable imagery.

The specification that matters, because most vendors deliver the wrong thing:
**the raw geotagged image set** (an orthophoto alone cannot build a mesh),
**nadir plus two 45° oblique passes** flown perpendicular (nadir-only melts
trees), **2–3 cm GSD**, 80/70 overlap, **RTK**, overcast / leaf-on / low-wind /
empty course, and **commercial usage rights assigned in writing**.

Then WebODM (free, self-host, split-merge for RAM) → 3D Tiles + DSM + orthophoto.
Host on **Cloudflare R2** (~$0.30/mo at 20 GB, zero egress); GitHub Pages cannot
hold a multi-GB tileset (~1 GB site cap, 100 MB per file). Bucket needs CORS.

Engine changes would be small — `gtiles3d.js` is already a `TilesRenderer`:
`buildTiles()` takes a URL and skips `GoogleCloudAuthPlugin`; `enter()` and
`gtilesGroundActive()` stop requiring a token; `failed()` stops treating offline
as failure; `getAttributions()` credits our capture. A `course.tiles3d` block
would opt a course in independently of `GTILES_IDS`.

Two traps found in the analysis. **Georeferencing:** `course.geo` is exact
relative to *OSM* greens, and OSM carries its own 1–5 m error, so a true-WGS84
RTK tileset needs the affine refit against our own orthophoto (same maths as
`geo_anchor_course.py --greens`, different target). **On-device weight:** Google's
tileset is LOD-tuned, ODM's output is not, and WKWebView has a hard per-process
memory cap.

**3D Gaussian Splatting** from the same imagery is the better answer for
vegetation (Spark, MIT — Z-buffer-merges with meshes, so ball occlusion is free),
but mobile memory is the gate: needs Spark 2.0 LoD at a ~500K–1M splat budget.
