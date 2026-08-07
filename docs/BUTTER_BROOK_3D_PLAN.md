# Photoreal 3D for Butter Brook — self-hosted drone tileset

**Status:** plan, nothing built. Written 2026-08-06.

## Why

Butter Brook has no Google photogrammetry. Measured off the live engine, its
tiles are **85 verts/mesh** against Pebble's 1519 — aerial imagery draped on
near-flat ground, which is what the baked NAIP aerial already gives for free.
It was on `GTILES_IDS` for one day and came back out (commit `68f6630`).
Google will not fix this; the area simply hasn't been flown for photogrammetry.

The only route to real 3D there is to capture it ourselves. That also *beats*
Google rather than matching it: we fly at the altitude we want, at the time of
year we want, on a day the course looks its best.

**Verify the premise before spending a capture day:** re-run
`node tools/gtiles_geom_probe.mjs --course butter-brook-golf-club`. If Google
has since flown the area it'll read >600 verts/mesh and this whole plan is moot.

## What already exists (the cheap part)

The rendering half is **done**. `three3d/gtiles3d.js` is a `TilesRenderer` with
the full game integration already solved: projection seam (`wx`/`wy`/
`screenToWorld` via `view.gtilesProj`), mesh-anchored overlay heights, the
two-anchor camera solve, the ball-flight camera latch, occlusion, the park gate,
the 2D fallback. A self-hosted tileset swaps *which URL it loads* — it does not
need a new engine.

This is a **data acquisition problem**, not an engine problem. Budget accordingly.

---

## Delivery plan — sequence, owners, gates

### You do not need a drone, and probably should not fly one

Commercial drone work in the US needs an **FAA Part 107** certificate — flying
this yourself for a shipping product means certifying yourself. **Hire a drone
mapping vendor.** This is a commodity service; aerial mapping of golf courses is
an established niche (yardage books, GPS mapping, club marketing all use it).
Rough US cost for ~80 ha with obliques: **$500–2,000**.

**Ask the course first.** Butter Brook may already have suitable imagery from a
yardage-book vendor, a GPS-mapping supplier, or marketing photography. If the
raw image set exists, the capture cost drops to zero. Worth one phone call
before spending anything.

**What to specify to a vendor** — most deliver a finished orthophoto or a video,
and neither can be used to build a mesh:

- **The RAW geotagged image set**, delivered to you. This is the deliverable that
  matters; an ortho alone is useless here.
- Nadir pass **plus 2 oblique passes at 45°**, flown perpendicular to each other.
- **2–3 cm GSD**, 80% front / 70% side overlap.
- **RTK or PPK** positioning (else GCPs, which cost a second day).
- Overcast/diffuse light, leaf-on, low wind, empty course.
- **Commercial usage rights assigned or licensed to you in writing.** Easy to
  forget and expensive to discover later — a vendor's default contract often
  retains copyright.

### Free win available today, no flight required

**USGS 3DEP LiDAR covers this course** — verified 2026-08-06 via The National Map
API: `MA_CentralEastern_2021_B21`, 6 LAZ tiles plus a **1 m DEM GeoTIFF**
(published 2023-01-15).

That means the *terrain* half of the drone flight's value is already available,
free, with no capture at all. The current `course.dem` comes from the global AWS
z14 grid at ~10 m; 3DEP is 1 m. The `lidar-terrain` skill exists for exactly this
bake (needs PDAL/GDAL).

So the drone flight's **unique** contribution narrows to: photoreal *texture* and
*tree geometry*. Terrain is free. Sequence accordingly — bank the free win first
and let it inform whether the paid capture is still worth it.

### Owners

| work | owner | notes |
|---|---|---|
| Course permission, airspace/LAANC check | **You** | needed before anything is booked |
| Hiring the vendor, contract + usage rights | **You** | spend approval, licensing signature |
| Cloudflare R2 account + spend | **You** | ~$0.30/mo at 20 GB |
| Everything else — LiDAR bake, engine changes, processing config, probes, verification, docs | **Me** | |
| WebODM processing run | **Me**, your hardware or a rented box | 64 GB+ RAM for a day; needs your cloud spend if rented |

### Sequence and gates

Each gate is a genuine stop point with a stated kill criterion, so the project
can die cheaply rather than expensively.

**G0 — Re-verify the premise.** *(me, minutes, $0)*
`node tools/gtiles_geom_probe.mjs --course butter-brook-golf-club`.
**Kill if** >600 verts/mesh — Google has since flown it; just re-add the id.

**Stage 1 — LiDAR terrain.** *(me, ~a day, $0)* — **no dependency on anything else**
Bake 3DEP `MA_CentralEastern_2021` into `course.dem` via the `lidar-terrain` path.
Ships on its own: sharper terrain for the existing 2D course, better green macro
tilt, no hosting bill, no engine change.
**Gate:** `putt_matrix --gate` and `shot_matrix --gate` still pass; green grade
census stays inside `greenGradCap()`. **Value banked regardless of what follows.**

**Stage 2 — Self-hosted tileset support.** *(me, ~a day, $0)* — **parallel with 1, no flight needed**
The Phase 5 engine changes, developed against a **stub tileset** (any small
public 3D Tiles set, or an ODM sample) so the code is proven before a single
image is captured. `buildTiles()` takes a URL and skips `GoogleCloudAuthPlugin`;
`enter()`/`gtilesGroundActive()` stop requiring a token; `failed()` stops
treating offline as failure; `getAttributions()` credits our capture.
**Gate:** Pebble/Liberty/Torrey completely unchanged (they must keep the Google
path byte-for-byte); stub course renders and falls back cleanly.

**G1 — Go/no-go on capture.** *(you)*
Permission granted, airspace clear, vendor quoted, usage rights agreed, weather
window identified. **Kill if** the course says no or the quote exceeds what the
result is worth — Stages 1 and 2 have already shipped and lose nothing.

**Stage 3 — Capture.** *(vendor, 1 day on site)*
Deliverable is the raw geotagged image set.

**Stage 4 — Process.** *(me, ~1 day compute)*
WebODM with split-merge; export 3D Tiles + DSM + orthophoto.

**G2 — Mesh quality inspection.** *(me + you, the real gate)*
Load the mesh and **look at the trees**. Photogrammetry melts thin foliage; on a
wooded New England course this is the single most likely way the result
disappoints. Compare side by side against the current 2D aerial at real
gameplay camera angles.
**Kill or pivot if** the trees read worse than the flat aerial — pivot option is
3D Gaussian Splatting from the *same imagery*, which reconstructs vegetation far
better. Note the orthophoto is still a win at this point even if the mesh is
scrapped: it replaces the baked NAIP aerial with fresher, self-licensed imagery.

**Stage 5 — Align.** *(me)*
Refit `course.geo` against green centroids from **our orthophoto** rather than
OSM (extend `geo_anchor_course.py` alongside `--greens`).
**Gate:** `tools/playthrough_probe.mjs` — ball/pin gaps, jitter, pops at or
better than the Google courses.

**Stage 6 — Host + wire.** *(me; you own the R2 account)*
Upload to R2 with CORS; point `course.tiles3d.url` at it; enable the course.
**Gate:** `framing_probe` + `flight_probe` on Butter Brook — the witness
assertion (a fixed world point projects to the same pixel every frame of a shot)
is the load-bearing one.

**G3 — On-device performance.** *(you + me, the second real gate)*
**This is a genuine risk and has no desktop proxy.** Google's tileset is
LOD-managed and tuned for streaming; ours will be whatever ODM produced. A
too-heavy mesh will crawl or crash WKWebView on the iPhone, and the earlier
Butter Brook episode is a reminder that device behaviour is not inferable from
desktop.
Test on the real phone via the `?devdrive=1` rig against a local HTTP server
(real iOS WebKit, JS eval over `curl 127.0.0.1:8787/run`).
**Kill/iterate if** frame rate or memory fails — remedy is decimation and a
tighter LOD pyramid at the ODM export step, i.e. back to Stage 4, not a redesign.

**Stage 7 — optional, later: 3D Gaussian Splatting** from the same imagery.
Only after Path A ships. Mobile memory is the gate, not quality.

### Cost and calendar

| | cost | elapsed |
|---|---|---|
| G0 + Stage 1 + Stage 2 | **$0** | ~2 days of my work, in parallel |
| Capture (vendor) | **$500–2,000**, or $0 if the course already has imagery | 1 day, weather-dependent |
| Processing | $0 self-hosted, or ~$50 for a rented 64 GB box for a day | ~1 day |
| Hosting | **~$0.30/month** (R2, 20 GB, zero egress) | — |
| Per-play cost | **$0** vs Google's ~$6 CPM | — |

**The shape of this plan is that everything free happens first.** Stages 1 and 2
ship real improvements with no flight, no vendor and no hosting bill, and G1 is
the first point where any money is committed.

---

## Phase 1 — Capture

### Site

Butter Brook world bounds are 570 × 425 units at ~3 yd/unit ≈ **1.56 × 1.17 km
(≈182 ha)** for the full box including surrounding woods. The *playable*
corridor is far smaller — fly the corridor plus a generous margin (trees framing
each hole matter visually), not the whole rectangle. Budget ~60–80 ha.

### Aircraft

**Flown by a hired vendor, not by us** — see the delivery plan above. Specify
RTK (DJI Mavic 3E RTK or a Matrice with an RTK module). **Reason is alignment,
not survey pride:** without RTK someone must lay and survey ground control
points across 80 ha, which is most of a second day and a line item on the quote.
With RTK the tileset lands at true WGS84 and Phase 3 gets much easier.

### Flight parameters

| parameter | value | why |
|---|---|---|
| target GSD | **2–3 cm/px** | below ~3 cm, turf reads as texture rather than mush at golf camera distances |
| altitude | ~90–110 m (Mavic 3E) | derives from GSD + sensor; recompute for your aircraft |
| nadir overlap | **80% front / 70% side** | ODM tolerates less, trees do not |
| oblique passes | **2 passes at 45°**, flown perpendicular to each other | this is what reconstructs tree silhouettes and bunker faces; nadir-only gives melted trees |
| speed | slow enough to avoid motion blur | blur destroys feature matching more than any other single factor |

Expect roughly **400–600 nadir + 800–1200 oblique** images for the corridor.
4–6 batteries; realistically a half to full day on site.

### Conditions — these matter more than the drone

- **Overcast / high thin cloud is ideal.** Hard shadows bake into the texture and
  cannot be removed later. A bright overcast day beats blue sky for a mesh.
- **Leaf-on**, low wind (<15 mph). Moving foliage is the top cause of tree
  artifacts.
- **Empty course.** Monday mornings (typical maintenance day) or a dawn slot.
  Moving carts/players become floaters or smears.
- **Fresh mow** if you can time it — mowing stripes read beautifully.
- Get **course permission in writing** and check airspace (Westford MA — verify
  LAANC/controlled airspace before the day, not on it).

---

## Phase 2 — Process

**WebODM / OpenDroneMap**, self-hosted, free.

- 1500+ images at this GSD will not fit in a typical desktop's RAM in one pass.
  Use ODM's **split-merge** (`--split`/`--split-overlap`) or process per-region
  and merge. Plan for 64 GB+ RAM or a rented cloud box for a day.
- Enable the **3D Tiles export** (`--3d-tiles`) — ODM emits OGC 3D Tiles
  directly, so there's no separate tiling step.
- Keep the **DSM** output — but note **free USGS 3DEP LiDAR already covers this
  course at 1 m** (`MA_CentralEastern_2021_B21`, verified 2026-08-06), so the
  terrain win does not depend on flying at all. Bake 3DEP first (Stage 1); treat
  the drone DSM as a refinement, not the reason to fly.
- Keep the **orthophoto**. Phase 3 needs it, and it can also replace the baked
  NAIP aerial for the 2D fallback (fresher, sharper, and ours to license).

---

## Phase 3 — Align (do not skip; this is where it goes wrong)

The game's `course.geo.toLonLat` was refit on 2026-08-06 against **OSM green
polygons** (exact — 0.00 m residual, LOO 0.002 m; see `--greens` in
`tools/geo_anchor_course.py`). That makes it exact *relative to OSM*, and OSM
greens are themselves traced from satellite imagery carrying its own 1–5 m
georegistration error.

The drone tileset will be at **true WGS84** (RTK). So world→scene may sit a few
metres off the new mesh even though the affine is "exact".

**This is the same class of bug as the deleted Apple imagery-correction
pipeline** — and this time it's correctable properly, because the drone
orthophoto *is* ground truth rather than another vendor's guess.

Fix: refit `course.geo` against green centroids digitised from **our own
orthophoto** instead of OSM. Concretely, extend `tools/geo_anchor_course.py`
with an ortho-based source alongside `--greens`; the fitting maths is unchanged,
only the target coordinates differ. Verify with `tools/playthrough_probe.mjs`
(ball/pin gaps, jitter, pops) exactly as the Google courses are verified.

---

## Phase 4 — Host

**GitHub Pages will not work.** It has a ~1 GB soft site limit and a 100 MB
per-file limit; a course tileset at this GSD is realistically **5–40 GB**. The
game's static site can stay on Pages, but the tiles cannot.

Recommended: **Cloudflare R2** — ~$0.015/GB-month and **zero egress fees**, so
20 GB is roughly **$0.30/month** with no bandwidth risk. (Backblaze B2 + a CDN
is the equivalent alternative.) Two requirements:

- **CORS headers** on the bucket, or the browser refuses the tileset fetch.
- A stable base URL per course, e.g. `https://tiles.yo-golf.com/butter-brook/tileset.json`.

Self-hosted tiles carry **no API key, no per-session billing, and no ToS
attribution** beyond crediting our own capture — and unlike Google, whose terms
explicitly forbid caching and offline use, they *can* be service-worker cached
for offline play. That last point is strategically significant for the iOS app.

---

## Phase 5 — Wire it in

Small, contained changes — the engine is already right.

**Per-course config.** Add to `courses/butter-brook-golf-club.json`:

```json
"tiles3d": { "url": "https://tiles.yo-golf.com/butter-brook/tileset.json",
             "source": "self", "credit": "Aerial capture © Yo Golf" }
```

**`three3d/gtiles3d.js` — `buildTiles()`** (currently hardcodes Google):
construct `new TilesRenderer(course.tiles3d.url)` and **skip
`GoogleCloudAuthPlugin`** when `tiles3d.source === "self"`. Everything else —
`ReorientationPlugin` (the tileset is geo-referenced, so the same lat/lon
recentre applies), `TileCompressionPlugin`, `UnloadTilesPlugin`,
`TilesFadePlugin`, `errorTarget`, the LRU sizes, every event handler — is
unchanged.

**`enter()`**: its first line is `if (!window.GOOGLE_TILES_TOKEN) return;`.
That must not gate a self-hosted course.

**`gtilesGroundActive()` in game.js**: same — the token requirement becomes
"token *or* `course.tiles3d`". Keep `GTILES_IDS` for Google courses and let a
`tiles3d` block opt a course in independently.

**`getAttributions()`**: emit the course's own credit, not Google's.

**Offline**: `failed()` currently trips on `navigator.onLine === false`. For a
self-hosted, service-worker-cached tileset that's wrong — offline is exactly
when it should still work. Gate that check on the Google path.

**Re-tune framing:** `gtiles3d.js` `D_MAX_*`, `SPAN_MAX_U_*`, `REACH_F`/`BALL_F`
were measured on Pebble's 18 holes. Re-run `web/scripts/framing_probe.mjs` and
`flight_probe.mjs` against Butter Brook — `flight_probe`'s witness assertion
(a fixed world point must project to the same pixel every frame of a shot) is
the load-bearing one.

---

## Cost summary

| item | cost |
|---|---|
| WebODM / OpenDroneMap | $0 (open source, self-host) |
| Drone time | 1 day on site (own or rent) |
| Processing | 1 day compute; possibly a rented 64 GB box |
| Hosting (R2, ~20 GB) | ~$0.30/month, no egress |
| Per-play cost | **$0** — vs Google's ~$6 CPM |
| Recurring API keys / attribution | none |

## Alternative worth knowing: 3D Gaussian Splatting

Apple Flyover is moving to 3DGS (WWDC 2026), and it reconstructs **vegetation**
— thin leaves, tree silhouettes — far better than a photogrammetry mesh, which
is precisely Butter Brook's weakness as a wooded New England course.

**The same flight feeds both**, so this is not a fork in the road at capture
time — only at processing. Train with Nerfstudio/`gsplat` (Apache-2.0, needs
CUDA); render in three.js with **Spark** (`sparkjsdev/spark`, MIT), which
Z-buffer-merges splats with opaque meshes so **ball occlusion comes free**.

**The gate is mobile memory, not quality:** WKWebView has a hard per-process cap
and multi-million-splat scenes crash it. Needs Spark 2.0 LoD with a conservative
~500K–1M splat budget streamed per hole. Treat as a hero-course experiment after
Path A ships, not as the first attempt.

## Recommended sequence

Superseded by the **Delivery plan** section above, which carries the owners and
the kill criteria. In one line: do the free things first (3DEP terrain bake +
self-hosted tileset support against a stub), and only commit money at G1.
