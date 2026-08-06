---
name: lidar-terrain
description: Bake USGS 3DEP LiDAR into sharp per-course terrain — Terrarium tiles for the web viewer and the course.dem grid for the in-game engines — replacing the coarse AWS z14 (~10m) global DEM. Use to add real terrain undulations to a US course. Requires PDAL/GDAL/rio-rgbify.
---

# LiDAR terrain bake

The coarse **AWS Terrarium z=14 (~10 m/px)** DEM is the single quality ceiling shared by every render path (2D canvas, three3d, web viewer). USGS 3DEP LiDAR is **sub-metre** and free (US-only). This skill turns it into the two artifacts the game consumes.

`tools/bake_lidar.py` (already built) + `tools/lidar/ground_dem.json.tmpl` run the offline pipeline (spec `docs/web_course_viewer_spec.md` §4b): 3DEP EPT point cloud → PDAL (crop + ASPRS class-2 ground + reproject) → fill/smooth → **Terrarium tiles z10-18** + a **ground-DEM GeoTIFF** + per-green slope arrows.

## Install the toolchain (the gate)

Not in the repo by default:
```sh
conda install -c conda-forge pdal python-pdal gdal rio-rgbify
# or a venv with pdal + GDAL + rio-rgbify
```
`bake_lidar.py` guards each binary and aborts **BLOCKED** rather than emit a flat/fake tileset. US 3DEP only — international courses stay on the global DEM.

## Two consumers

**1. Web viewer (Terrarium tiles).** Already supported, just unfed.
```sh
python3 tools/bake_lidar.py --id <course> --boundary-rel <osm-rel>   # or --bbox
```
Drops tiles at `web/public/tiles/<course>/`; set `terrainTiles: "/tiles/<course>/{z}/{x}/{y}.png"` on that hole's `Course` record (`web/src/data/*.ts`). `web/src/map/terrain.ts` picks it up at `maxzoom:18` — zero renderer change. Pair with the `hillshade` layer (`addHillshade`) for relief lighting.

**2. In-game grid (`course.dem`).** The in-game engines read `course.dem {nx,ny,baseElevM,data}`, baked by `tools/fetch_course_global.py:bake_dem` from AWS Terrarium. Swap the sampler:
```sh
python3 tools/fetch_course_global.py ... --lidar-dem <ground_dem.tif>
```
The `--lidar-dem` path samples the LiDAR GeoTIFF onto the **same dict shape**, so every downstream consumer inherits it with NO edits: `game.js terrainZ/buildDEM`, `three3d/course3d.js buildTerrainGeometry`/`buildDEMShade`, `tools/downsample_dem.py`. Keep AWS as the nullable fallback.

> With a sharper DEM, bump `three3d/course3d.js buildTerrainGeometry` mesh density (it decimates to ~4 units/cell today) so the new detail actually shows.

## Verify
- `course.dem` dict shape unchanged; `python3 tools/downsample_dem.py <course.json> --dry-run` still parses.
- In-game: relief reads sharper than the AWS baseline (compare `buildDEMShade` + three3d mesh).
- Web: `cd web && npm run build && npm run shoot`; undulations sharper on the baked US hole. Do NOT raise `exaggeration` above ~1.3 to compensate — that means the DEM didn't load (spec §4).

## Notes
- Terrarium encoding (4mm quant), NOT Mapbox terrain-RGB (100mm) — greens go to cliffs otherwise.
- Slope arrows use a plane-fit over each green (noise ≈ signal on raw points).
- Photoreal *mesh* (not just terrain) → [[3d-tiles]] / [[drone-photogrammetry]].
