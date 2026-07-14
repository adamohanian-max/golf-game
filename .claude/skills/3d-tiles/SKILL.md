---
name: 3d-tiles
description: Render OGC 3D Tiles (Google Photorealistic, Cesium Ion, or self-hosted per-course tilesets) inside a three.js scene via the 3d-tiles-renderer library. Use for photoreal city context, or per-course drone/photogrammetry tilesets, in course3d.js or the web viewer.
---

# OGC 3D Tiles in three.js

3D Tiles is the open (OGC) streaming format for massive 3D geospatial data — the same format Google Photorealistic 3D Tiles and Cesium ship. Because both `three3d/course3d.js` and `web/` are three.js, we can drop a tileset straight into the existing scene.

**Library: `3d-tiles-renderer`** (NASA-AMMOS / JPL, Apache-2.0). `npm i 3d-tiles-renderer three`. Import three.js bindings from `3d-tiles-renderer/three` and plugins from `3d-tiles-renderer/plugins`.

## Minimal setup (local / self-hosted tileset)

```js
import { TilesRenderer } from "3d-tiles-renderer";

const tiles = new TilesRenderer("/tiles/<course>/tileset.json");
tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);
scene.add(tiles.group);

// recentre if the tileset is far off the scene origin (ECEF datasets are)
import { Sphere } from "three";
const sphere = new Sphere();
tiles.getBoundingSphere(sphere);
tiles.group.position.copy(sphere.center).multiplyScalar(-1);

function frame() {
  requestAnimationFrame(frame);
  camera.updateMatrixWorld();
  tiles.update();            // drives LOD load/unload — REQUIRED each frame
  renderer.render(scene, camera);
}
```

Position/orient the group to match our world frame with a normal three.js transform (the same `worldToAerialPx`-style affine `course3d.js` already uses to place the aerial). For a golf hole you typically want ONE local tileset over the course bbox, not a globe.

## Provider plugins

```js
import { GoogleCloudPlugin, CesiumIonPlugin } from "3d-tiles-renderer/plugins";
tiles.registerPlugin(new GoogleCloudPlugin({ apiToken: GOOGLE_KEY }));   // Google Photorealistic
// or
tiles.registerPlugin(new CesiumIonPlugin({ apiToken: ION_KEY, assetId })); // Cesium ion asset
```

## Coverage, cost, licensing — READ before choosing a source

- **Google Photorealistic 3D Tiles**: cities/high-density only — **NO rural golf-course coverage**. Billed per root-tile session, ~$6 CPM (1000 free/mo). MUST display the Google logo + aggregated `asset.copyright` attributions. Good for a clubhouse/urban-course skyline, useless for a rural fairway.
- **Cesium ion**: can tile your own LiDAR/drone data to 3D Tiles; Community tier is non-commercial, Commercial is **$149/mo**. Self-hosting avoids the fee.
- **Self-hosted (recommended for courses)**: export OGC 3D Tiles from WebODM (see [[drone-photogrammetry]]) or any tiler, drop the static tree under `web/public/tiles/<course>/`, point `TilesRenderer` at `tileset.json`. **$0 recurring, no key, no attribution beyond your own capture.**

## Attribution
The renderer surfaces per-tile copyright; display it. For Google, the logo + credits are mandatory. Self-hosted data needs only your own credit line (fold into `drawAttribution` in game.js for the in-game path).

## When to use vs alternatives
- Photoreal **buildings/trees/context** where coverage exists → Google via this lib.
- Photoreal **whole hero course** anywhere → self-host drone tiles ([[drone-photogrammetry]]).
- Sharp **terrain undulations only** (no photoreal mesh) → cheaper to bake a DEM: [[lidar-terrain]].
- Apple-grade native 3D on iPhone → [[mapkit-flyover]] (not this).
