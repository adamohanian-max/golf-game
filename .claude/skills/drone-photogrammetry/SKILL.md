---
name: drone-photogrammetry
description: Capture a single golf course in photoreal 3D beyond what Apple/Google cover — drone imagery → WebODM/OpenDroneMap → OGC 3D Tiles (self-host) or 3D Gaussian Splatting → render in three.js. Use for hero-course 3D that matches or beats Apple Flyover.
---

# Per-course photoreal 3D (drone capture)

Neither Apple Flyover nor Google Photorealistic 3D Tiles cover most **rural golf courses** — both are city-focused. To get photoreal 3D of an actual course you must **capture it yourself**. This is the only route that can *match or beat* Apple on a specific hero course, and it's fully self-hostable at $0 recurring.

## Path A — Photogrammetry mesh → OGC 3D Tiles (recommended, stable)

1. **Capture**: drone flight, nadir + oblique passes, ~70-80% overlap. A single 18-hole course is large — capture per-hole or per-region to keep processing tractable.
2. **Process**: **WebODM / OpenDroneMap** (free, open source, self-host). Produces orthophoto, DSM/DTM, textured mesh, and — with the export option on — **OGC 3D Tiles**.
3. **Export & host**: WebODM exports 3D Tiles (or `.OBJ` you tile). Drop the static tree under `web/public/tiles/<course>/`. No Cesium ion needed (its WebODM plugin is a convenience, but self-hosting avoids the $149/mo commercial tier).
4. **Render**: load `tileset.json` with `3d-tiles-renderer` into the existing three.js scene — see [[3d-tiles]] for the exact setup. Position with the course world→scene affine.

The DSM from the same flight can also feed [[lidar-terrain]]'s `course.dem` path (GeoTIFF sampler) for the in-game 2D/three3d engines.

## Path B — 3D Gaussian Splatting (Apple's new direction, experimental)

Apple Maps Flyover is moving to **3D Gaussian Splatting** (WWDC 2026) — that neural look is *why* it reads better than a textured mesh. We can do the same per course:
- Train a splat from drone/ground photos (any 3DGS trainer; DroneSplat targets in-the-wild drone imagery).
- Render in three.js with **`@mkkellogg/gaussian-splats-3d`** (self-hosted viewer, npm).
- Caveats: CPU splat sorting artifacts, **sub-optimal mobile performance**, large-scale scenes still maturing. Treat as a hero-course experiment, not the default for the mobile game yet.

## Licensing / cost
- WebODM + OpenDroneMap: free, open source, self-host.
- Self-hosted tiles/splats: **$0 recurring**, no API key, only your own capture to credit.
- Drone ops: check local rules + course permission before flying.

## When NOT to use this
- Just need sharper undulations, not a photoreal mesh → cheaper to bake a DEM: [[lidar-terrain]].
- Photoreal context in a city where coverage exists → Google via [[3d-tiles]].
- Apple-grade 3D on iPhone with zero capture → [[mapkit-flyover]] (uses Apple's own mesh where covered).
