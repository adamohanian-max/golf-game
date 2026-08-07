# Web Course Viewer — Implementation Brief

**Target:** browser-based 3D golf hole viewer with a light gameplay overlay (ball, tee box, green, slope arrows) rendered over satellite imagery draped on real terrain.

**Stack:** MapLibre GL JS v5 (base map + terrain + draped course furniture) + Three.js (the ball as a real 3D object, correctly depth-tested against terrain).

**Reusability note:** this code is the shared gameplay engine. (The iOS app was once planned to use native MapKit for a lighter static preview — retired 2026-08-05; the native Apple ground is gone and iOS is a webview onto the same JS.) The real ball-flight logic lives here so it isn't written twice. Keep the physics/ball module framework-agnostic (plain TS, no MapLibre imports) so it can be lifted out.

---

## 1. Architecture

Two rendering tiers on one map, chosen to minimize code:

1. **Course furniture = GeoJSON layers** (`fill`, `line`, `symbol`). Tee box, green, and slope arrows are flat-on-ground features. MapLibre drapes `fill`/`line`/`symbol` layers onto 3D terrain automatically once terrain is enabled — so these need *zero* custom WebGL. This is the cheapest path and looks clean.
2. **Ball (and ball flight) = one Three.js custom layer** with `renderingMode: '3d'`. The ball is the only thing that needs to move through 3D space with an arc and be occluded by hills, so it's the only thing that justifies Three.js.

Do **not** put the tee/green/arrows in Three.js for the MVP. Move them there later only if you want raised 3D pads or extruded green surfaces.

### Projection lock
Force **mercator** projection. MapLibre v5 supports globe, and the globe↔mercator transition breaks naive custom-layer matrix math (known issue). Set `projection: { type: 'mercator' }` in the style so `args.defaultProjectionData.mainMatrix` is stable at all zooms.

---

## 2. Versions & dependencies

- `maplibre-gl@^5.24` (pin the exact minor; the custom-layer render signature is v5-specific).
- `three@^0.169` (r169+). For a sphere ball you do **not** need `GLTFLoader`.
- Use an import map or a bundler (Vite recommended). Match the MapLibre CSS version to the JS version.

Authoritative references to diff against if anything misaligns (the matrix code is fiddly — cross-check, don't trust this brief blindly):
- MapLibre "Add a 3D model using three.js" example (v5).
- `CustomLayerInterface` and `CustomRenderMethodInput` API docs (for `render(gl, args)` and `args.defaultProjectionData`).

---

## 3. File structure

```
/src
  main.ts                 # boot map, wire layers
  map/
    style.ts              # satellite + terrain style object
    terrain.ts            # DEM source + setTerrain helper
    holeLayers.ts         # GeoJSON fill/line/symbol for tee/green/arrows
  three/
    ballLayer.ts          # Three.js custom layer (ball only)
    modelMatrix.ts        # lngLat+alt -> model matrix helper
  game/
    ball.ts               # framework-agnostic ball state + physics (REUSABLE)
    types.ts              # Hole, SlopeArrow, etc.
  data/
    hole-1.json           # sample hole (from OSM + your slope data)
```

---

## 4. Base map + terrain

```ts
// map/style.ts
export const style = {
  version: 8,
  projection: { type: 'mercator' }, // lock — do not use globe
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        // DEV ONLY — Esri World Imagery, check their terms before production.
        // Swap for MapTiler Satellite (keyed) or your own tiles for production.
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Imagery © Esri'
    }
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' }
  ]
};
```

```ts
// map/terrain.ts
//
// TERRAIN IS THE WHOLE BALLGAME. A coarse global DEM (~10-30m effective
// resolution) renders a golf course as a nearly flat plane. No amount of
// shading, PBR grass, or lighting fixes flat ground. We bake our own terrain
// tiles from LiDAR per course (see §4b) and fall back to the global DEM only
// where we have no LiDAR.
//
// MapLibre's setTerrain accepts exactly ONE source. So we do NOT stack two DEM
// sources — the bake step composites LiDAR over global fill and emits a single
// per-course tileset with a surrounding buffer. Switching courses = switching
// the terrain source.

const GLOBAL_DEM = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 15,
  attribution: 'Elevation: Terrain Tiles / AWS Open Data'
};

export function addTerrain(map: maplibregl.Map, course: Course) {
  if (course.terrainTiles) {
    // LiDAR-baked, Terrarium-encoded, per-course. maxzoom is high because the
    // whole point is detail — z18 is roughly sub-meter per pixel.
    map.addSource('dem', {
      type: 'raster-dem',
      tiles: [course.terrainTiles],          // e.g. /tiles/{courseId}/{z}/{x}/{y}.png
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Elevation: USGS 3DEP LiDAR'
    });
  } else {
    map.addSource('dem', GLOBAL_DEM);        // fallback: coarse, will look flat
  }

  // Start at 1.0. Real LiDAR terrain does NOT need exaggeration to read well —
  // if you find yourself pushing this above ~1.3 to see relief, your DEM is
  // wrong, not your exaggeration.
  map.setTerrain({ source: 'dem', exaggeration: 1.0 });
}
```

**Encoding choice matters more than it looks.** Use **Terrarium**, not Mapbox terrain-RGB.

- Terrarium: `(R * 256 + G + B / 256) - 32768` → vertical quantization of **1/256 m ≈ 4mm**
- Mapbox terrain-RGB: `-10000 + ((R * 65536 + G * 256 + B) * 0.1)` → quantization of **0.1 m**

A 10cm quantization step is catastrophic on a putting surface — a green with 2% fall over 3m rises about 6cm total, which is *less than one quantization step*. It would render as a flat plateau with occasional 10cm cliffs. Terrarium's 4mm step is fine. This single line is the difference between usable green contours and garbage.

```ts
// main.ts
const map = new maplibregl.Map({
  container: 'map',
  style,
  center: [LNG, LAT],
  zoom: 16.5,
  pitch: 72,      // the Shot-Pattern-style tilted look
  bearing: 0,
  antialias: true // required for clean Three.js edges
});

map.on('style.load', () => {
  addTerrain(map, course);
  addHoleLayers(map, holeData);
  map.addLayer(makeBallLayer(holeData));
});
```

---

## 4b. LiDAR terrain bake (offline pipeline, run once per course)

This runs on your machine, not in the browser. Output is a static tile pyramid you host.

### Inputs
- **USGS 3DEP LiDAR** point clouds (free). QL2 ≈ 2 pts/m², QL1 ≈ 8 pts/m²; vertical accuracy in the ~10cm RMSE range. Available as public cloud-optimized point clouds (EPT/COPC) on AWS Open Data — query by course bounding box, don't download state-sized tiles.
- Course boundary polygon (from OSM, `leisure=golf_course`), buffered ~200m so the horizon doesn't cliff off.

### Steps

```
1. FETCH      Clip 3DEP point cloud to course bbox + 200m buffer.
2. CLASSIFY   Keep ground returns only (ASPRS class 2). This is the step that
              removes trees, carts, buildings, and golfers. Skipping it puts
              tree canopy into your fairway.
3. GRID       Rasterize ground points to a DEM GeoTIFF.
              - 0.5m cell for the course itself (QL2 supports this comfortably)
              - Fill gaps by IDW/TIN interpolation; bunkers and water have
                sparse or zero returns and WILL leave holes.
4. COMPOSITE  Merge onto the global DEM for the buffer ring, so the surrounding
              landscape doesn't drop to zero at the LiDAR boundary. Feather the seam.
5. SMOOTH     See "the noise problem" below. Do this BEFORE encoding.
6. ENCODE     DEM -> Terrarium RGB PNG tiles, z10..z18.
7. SERVE      Static tiles at /tiles/{courseId}/{z}/{x}/{y}.png
```

Tooling: **PDAL** for steps 1–3 (pipeline JSON), **GDAL** for 4, **rio-rgbify** for 6. All open source, all scriptable. This is a `Makefile`, not an application.

### The noise problem (read this before trusting any slope you compute)

Your per-point vertical error (~10cm) is the **same order of magnitude as your signal**. A 2% slope across 3 meters rises about 6cm. That's *below* your noise floor per point.

Therefore: **never compute slope from raw point-to-point differences.** It will produce arrows that look plausible and point in essentially random directions.

Instead:
1. Fit a smoothed surface over the green polygon — moving-window plane fit, or a thin-plate spline. Averaging many points is what recovers signal from noise.
2. Take the gradient **of the smoothed surface**, not of the raw grid.
3. Sample the gradient on a grid (~2–3m spacing is plenty for arrow display).

The smoothing is doing the real work here. It is not a cosmetic step.

### Slope arrow extraction

```
For each green polygon:
  - clip smoothed DEM to the polygon
  - compute gradient (dz/dx, dz/dy) per cell
  - bearing   = downhill direction, degrees from north
  - magnitude = slope percent = 100 * sqrt((dz/dx)^2 + (dz/dy)^2)
  - emit GeoJSON Point features { kind: 'slope', bearing, magnitude }
```

These feed the `slope-arrows` symbol layer in §5 directly. Same schema, no adapter.

### Storage & scope

A single course at z10–z18 over ~2km² is on the order of a few MB of tiles. Cheap per course — but 40,000 courses is not. **Bake LiDAR terrain only for courses where you have coverage and where it matters** (US 3DEP coverage, hero courses, courses with real elevation change). Everything else falls back to the global DEM. The `course.terrainTiles` field being nullable is what makes this graceful.

### Known gotchas

- **Check the flight date.** Greens get rebuilt and bunkers get renovated. A 2019 acquisition doesn't know about a 2023 redesign. Store the date and surface it when it's stale.
- **Water and bunkers have sparse returns.** LiDAR doesn't reflect well off water at all. Expect voids; interpolate and move on. Don't chase perfection in a pond.
- **3DEP is US-only.** International courses fall back to the global DEM, or to national LiDAR programs where they exist (UK EA, NL AHN, ES PNOA — all free, all different formats).
- **Don't exaggerate.** Real terrain at 1.0 reads correctly. Cranking exaggeration to "make it pop" is a tell that the DEM is wrong.

---

## 5. Course furniture (GeoJSON, draped on terrain)

```ts
// map/holeLayers.ts
export function addHoleLayers(map: maplibregl.Map, hole: Hole) {
  map.addSource('hole', { type: 'geojson', data: hole.featureCollection });

  map.addLayer({
    id: 'green-fill', type: 'fill', source: 'hole',
    filter: ['==', ['get', 'kind'], 'green'],
    paint: { 'fill-color': '#4ea24e', 'fill-opacity': 0.55 }
  });
  map.addLayer({
    id: 'tee-fill', type: 'fill', source: 'hole',
    filter: ['==', ['get', 'kind'], 'tee'],
    paint: { 'fill-color': '#2b6cb0', 'fill-opacity': 0.6 }
  });

  // Slope arrows: a small arrow icon rotated by bearing, scaled by magnitude.
  // Register the arrow image first (map.addImage) from an SVG/PNG.
  map.addLayer({
    id: 'slope-arrows', type: 'symbol', source: 'hole',
    filter: ['==', ['get', 'kind'], 'slope'],
    layout: {
      'icon-image': 'slope-arrow',
      'icon-rotate': ['get', 'bearing'],       // degrees, downhill direction
      'icon-size': ['*', 0.4, ['get', 'magnitude']],
      'icon-allow-overlap': true,
      'icon-rotation-alignment': 'map'          // rotate with the map, not the screen
    }
  });
}
```

Slope arrows are generated by the LiDAR bake (§4b), not by any commercial green-reading provider and not from the global DEM. Each arrow is a point with `bearing` (downhill, degrees from north) and `magnitude` (slope %). Tolerances are deliberately loose right now — the goal is "which way and roughly how much," not tournament-grade break reading.

---

## 6. The ball (Three.js custom layer)

```ts
// three/modelMatrix.ts
import * as THREE from 'three';

// Build a model matrix that places a Three.js object (Y-up, meters) at a
// geographic location on the mercator map. Cross-check axis signs against the
// official MapLibre three.js example if the ball appears mirrored/tilted.
export function modelMatrix(lngLat: [number, number], altitudeM: number): THREE.Matrix4 {
  const mc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, altitudeM);
  const s = mc.meterInMercatorCoordinateUnits();

  const translate = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z);
  const rotateX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const scale = new THREE.Matrix4().makeScale(s, s, s);

  return translate.multiply(rotateX).multiply(scale);
}
```

```ts
// three/ballLayer.ts
import * as THREE from 'three';
import { modelMatrix } from './modelMatrix';
import { Ball } from '../game/ball';

export function makeBallLayer(hole: Hole) {
  const ball = new Ball(hole.ballStart);   // framework-agnostic state
  let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mesh: THREE.Mesh;

  return {
    id: 'ball',
    type: 'custom' as const,
    renderingMode: '3d' as const,          // MUST be '3d' for terrain depth/occlusion

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(0, -1, 1).normalize();
      scene.add(sun);

      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 24),           // radius 1 meter (scaled by matrix)
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
      );
      scene.add(mesh);

      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      (this as any).map = map;
    },

    render(gl: WebGLRenderingContext, args: any) {
      const map = (this as any).map as maplibregl.Map;

      // Advance ball state; sample terrain height so the ball sits on the ground.
      ball.update();
      const groundM = map.queryTerrainElevation(ball.lngLat, { exaggerated: true }) ?? 0;
      const alt = groundM + ball.heightAboveGround; // heightAboveGround > 0 during flight

      const l = modelMatrix(ball.lngLat, alt);
      const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint();                 // keeps the animation loop alive
    }
  };
}
```

Key v5 gotchas baked in above:
- `render(gl, args)` — use `args.defaultProjectionData.mainMatrix`, **not** the old v4 `matrix` positional arg.
- `renderingMode: '3d'` is required so the custom layer participates in the depth buffer and the ball is correctly occluded by terrain.
- `renderer.autoClear = false` and `renderer.resetState()` every frame, or MapLibre's GL state and yours will fight.
- Blend is premultiplied alpha (`gl.ONE, gl.ONE_MINUS_SRC_ALPHA`); if the ball looks haloed, that's why.

---

## 7. Ball module (reusable, no MapLibre imports)

```ts
// game/ball.ts
// Keep this pure so iOS/other renderers can reuse it. It knows geography + physics,
// nothing about MapLibre or Three.js.
export class Ball {
  lngLat: [number, number];
  heightAboveGround = 0;
  // ...velocity, state (teed | flying | rolling | holed)...

  constructor(start: [number, number]) { this.lngLat = start; }

  update() {
    // integrate flight arc / roll; update lngLat + heightAboveGround
  }

  hit(bearingDeg: number, speed: number, launchDeg: number) { /* ... */ }
}
```

---

## 8. Hole data model

Source tee/green polygons from **OSM** (your existing baking pipeline). Relevant tags:
- `golf=green` → green polygon
- `golf=tee` → tee box polygon
- `golf=fairway`, `golf=bunker`, `golf=water_hazard` → optional extra furniture
- `golf=hole` → hole centerline (tee→green), useful for default camera framing

Slope arrows are **your** data, not OSM.

```json
// data/hole-1.json (shape; store as a real GeoJSON FeatureCollection in code)
{
  "id": "hole-1",
  "ballStart": [-71.0, 42.0],
  "pin": [-71.001, 42.002],
  "featureCollection": {
    "type": "FeatureCollection",
    "features": [
      { "type": "Feature", "properties": { "kind": "tee" },   "geometry": { "type": "Polygon", "coordinates": [] } },
      { "type": "Feature", "properties": { "kind": "green" },  "geometry": { "type": "Polygon", "coordinates": [] } },
      { "type": "Feature", "properties": { "kind": "slope", "bearing": 210, "magnitude": 2.5 },
        "geometry": { "type": "Point", "coordinates": [-71.001, 42.002] } }
    ]
  }
}
```

---

## 9. Build order (milestones)

1. **Map + terrain renders.** Satellite draped on DEM, pitched camera, you can pan/zoom/rotate. No overlay yet.
2. **Furniture drapes correctly.** Tee/green fills and slope-arrow symbols sit on the terrain and track through camera moves.
3. **Static ball.** A white sphere sits on the tee at correct ground height, correct size, correct perspective through camera moves. *This proves the matrix math — get it perfect before physics.*
4. **Occlusion check.** Move the camera so a hill is between camera and ball; confirm the ball hides behind terrain. If not, revisit `renderingMode: '3d'` and depth settings.
5. **Ball flight.** Wire `Ball.hit()` → arc → roll → rest on green. Keep `ball.ts` renderer-agnostic.
6. **Polish.** Sky layer, terrain exaggeration tuning, shadow blob under ball, camera framing from the hole centerline.

---

## 10. Known caveats / watch-list

- **`queryTerrainElevation` returns `null` until DEM tiles for that area load.** Guard with `?? 0` and don't place the ball until tiles are in; otherwise it snaps from 0 to ground height on first load.
- **Matrix axis conventions are the #1 source of bugs.** If the ball is mirrored, sunk into the ground, or floating, it's the `modelMatrix` — diff against the official example rather than guessing.
- **Satellite tiles:** Esri World Imagery is fine for dev but check terms before shipping; move to MapTiler Satellite (keyed) or your own tiles for production. Keep the attribution control visible.
- **Cost:** MapLibre lib is free; LiDAR (3DEP) is free; the bake is compute-on-your-own-machine; satellite tiles are the only metered line item and have free tiers before any bill. This whole stack is effectively $0 at your scale.
- **Don't enable globe.** Every globe/mercator transition invalidates the naive matrix path. Mercator-locked keeps this simple.
- **Terrarium encoding, not Mapbox terrain-RGB.** 4mm vs 100mm vertical quantization. On greens this is the difference between contours and cliffs. See §4.
- **If the terrain looks flat, the DEM is wrong — do not compensate with exaggeration.** Check that the LiDAR tileset actually loaded (network tab), that `maxzoom` is 18 not 15, and that ground classification ran.

---

## 11. Out of scope (for now)

Multiplayer, real physics tuning, wind, multiple holes/course routing, and moving the tee/green into extruded 3D. Ship the single-hole viewer with a rolling ball first.
