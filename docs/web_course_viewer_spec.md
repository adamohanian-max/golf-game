# Web Course Viewer — Implementation Brief

**Target:** browser-based 3D golf hole viewer with a light gameplay overlay (ball, tee box, green, slope arrows) rendered over satellite imagery draped on real terrain.

**Stack:** MapLibre GL JS v5 (base map + terrain + draped course furniture) + Three.js (the ball as a real 3D object, correctly depth-tested against terrain).

**Reusability note:** this code is the shared gameplay engine. The iOS app uses native MapKit for a lighter static preview; the real ball-flight logic lives here so it isn't written twice. Keep the physics/ball module framework-agnostic (plain TS, no MapLibre imports) so it can be lifted out.

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
export function addTerrain(map: maplibregl.Map) {
  map.addSource('dem', {
    type: 'raster-dem',
    // AWS Open Data "Terrain Tiles" (Terrarium encoding). Free; verify endpoint.
    // Alternative: MapTiler terrain-rgb (encoding: 'mapbox', needs key).
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15,
    attribution: 'Elevation: Terrain Tiles / AWS Open Data'
  });
  map.setTerrain({ source: 'dem', exaggeration: 1.0 });
}
```

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
  addTerrain(map);
  addHoleLayers(map, holeData);
  map.addLayer(makeBallLayer(holeData));
});
```

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

Slope arrows come from **your** green-reading data (like Shot Pattern leaning on StrackaLine), not from the DEM — Apple's/AWS terrain mesh is too coarse for green micro-contours. Model each arrow as a point with `bearing` (downhill, degrees) and `magnitude` (slope %).

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
- **Cost:** MapLibre lib is free; DEM (Terrain Tiles) is free; satellite tiles are the only metered line item and have free tiers before any bill.
- **Don't enable globe.** Every globe/mercator transition invalidates the naive matrix path. Mercator-locked keeps this simple.
- **Green micro-contours:** slope arrows must come from your own green data; neither the AWS DEM nor Apple's mesh resolves putting-surface break.

---

## 11. Out of scope (for now)

Multiplayer, real physics tuning, wind, multiple holes/course routing, and moving the tee/green into extruded 3D. Ship the single-hole viewer with a rolling ball first.
