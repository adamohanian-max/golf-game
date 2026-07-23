# RESEARCH — Google Photorealistic 3D Tiles viewer

Phase-0 findings, verified against primary sources + the installed package
(not stale assumptions). Date: 2026-07-23.

## 1. Google Map Tiles API — Photorealistic 3D Tiles
- **Root tileset endpoint**: `https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_API_KEY`.
  We do **not** hand-build this — `GoogleCloudAuthPlugin` targets it and manages
  the session token internally.
- **API to enable**: **Map Tiles API** (Google Cloud console) on the key.
- **Key passing**: query param `?key=…`; the auth plugin also negotiates a
  session token per Google's session model.
- **Attribution (MANDATORY, Map Tiles API ToS)**: must display the Google logo
  **and** the data-attribution strings returned with the tiles. The renderer
  surfaces both via `tiles.getAttributions()` (typed entries: `image` = Google
  logo data-URI, `string` = credit text). We render them every frame into a
  fixed overlay (`#attribution`).
- **Key restriction**: restricted-key friendly — set an HTTP-referrer
  restriction to the dev/prod origin.

## 2. Renderer — NASA-AMMOS/3DTilesRendererJS
- **Package**: `3d-tiles-renderer` (npm, unscoped). **Installed version: 0.5.0**
  (Apache-2.0). `npm i 3d-tiles-renderer` (three is a peer; 0.179.1 already in web/).
- **Import surface (verified by runtime import against 0.5.0):**
  - `import { TilesRenderer, GlobeControls, WGS84_ELLIPSOID, GeoUtils } from "3d-tiles-renderer"`
  - `import { GoogleCloudAuthPlugin, ReorientationPlugin, TilesFadePlugin, TileCompressionPlugin, UpdateOnChangePlugin, UnloadTilesPlugin } from "3d-tiles-renderer/plugins"`
  - The bare `3d-tiles-renderer` barrel re-exports `./core` + `./three`;
    `/plugins` re-exports `./core/plugins` + `./three/plugins`.
- **Google auth**: `new GoogleCloudAuthPlugin({ apiToken, autoRefreshToken, logoUrl?, useRecommendedSettings?, sessionOptions? })`.
  (Name is `GoogleCloudAuthPlugin` — the older skill doc's `GoogleCloudPlugin`
  is stale.)
- **Per-frame REQUIRED** (LOD load/unload breaks otherwise):
  `controls.update(); camera.updateMatrixWorld(); tiles.setResolutionFromRenderer(camera, renderer); tiles.update(); renderer.render(scene, camera);`

## 3. Coordinate frame / re-centering
- Google tiles are ECEF / WGS84-ellipsoid (millions of meters from origin →
  float precision dies far out).
- **Re-center helper**: `ReorientationPlugin({ up:"+y", recenter:true, lat, lon, height })`
  — moves the ellipsoid so the chosen lat/lon sits at the scene origin, Y-up.
  `lat`/`lon` are in **radians** (multiply degrees by `MathUtils.DEG2RAD`).
  Runtime course-switch: `reorient.transformLatLonHeightToOrigin(lat, lon, height)`.
  (This supersedes the manual `getBoundingSphere → negate center` snippet in the
  older `.claude/skills/3d-tiles` doc.)
- **Camera controls**: `new GlobeControls(scene, camera, domElement)` then
  `controls.setEllipsoid(tiles.ellipsoid, tiles.group)`; globe-aware, adjusts
  near/far each frame.

## Perf knobs used (defaults in `viewer.ts` DEFAULT_PERF)
- `tiles.errorTarget` (screen-space error, px) — default 16.
- `tiles.lruCache.maxSize` / `minSize` — cache ceiling/floor (tile count).
- `UpdateOnChangePlugin` — re-render only on camera change (pause-when-idle).
- `TileCompressionPlugin`, `UnloadTilesPlugin`, `TilesFadePlugin` — memory + smoothing.

## Coverage reality
Google Photorealistic coverage is dense in cities, sparse/absent on rural golf
courses. The viewer detects empty geometry after `tiles-load-end`
(`getBoundingSphere` radius 0) and shows a non-fatal coverage banner. Use
`URBAN_FALLBACK` (Manhattan) to prove the pipeline when a course is sparse.
