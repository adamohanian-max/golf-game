// Mapbox GL 3D ground engine for the main game (Pebble Beach).
//
// Mirrors three3d/course3d.js: a WEB-side 3D ground renderer with the 2D
// gameplay canvas (#game) drawn OVER it, projected through the live 3D camera.
// game.js's wx()/wy()/ws()/screenToWorld() route through window.Mbox3D.project/
// unproject when view.mboxProj is set — exactly like view.threeProj (Four Oaks
// three.js) and view.appleProj (iOS MapKit). Unlike Apple, this runs on web AND
// in the iOS webview (online), and the camera is fully known so projection is
// exact (no probe calibration).
//
// A Mapbox map (standard-satellite + LiDAR/global terrain) fills #cmbox, sitting
// behind the transparent-there #game canvas — same compositing model as the
// native MKMapView. All gameplay (cup/ball/aim/contours/relief/flow dots/tees)
// keeps drawing on #game, glued to the Mapbox ground by the projection bridge.
//
// This is an ES module (loaded via <script type="module"> with three in the
// importmap); it reaches game.js's state through window.GolfBridge (game.js is a
// classic script — the two can't see each other's scopes directly).

import * as THREE from "three";

const STYLE_URL = "mapbox://styles/mapbox/standard-satellite";
const APPLE_CAM_K = 1.866; // 1/(2·tan15°) — the FOV constant the game camera math uses
const M_FALLBACK = 2.7432; // metres per world unit (1 unit = 3 yd), matches game.js M_PER_UNIT

// AWS Terrain Tiles: free, global, coarse (~10 m). Fallback when a course has no
// baked LiDAR Terrarium pyramid (course.terrainTiles).
const GLOBAL_DEM = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Elevation: Terrain Tiles / AWS Open Data",
};

let map = null;         // the mapboxgl.Map
let container = null;    // #cmbox div
let ready = false;       // style + terrain loaded
let activeCourseId = null;
let pitchDeg = 55;       // camera pitch, driven by the tilt slider via setPitch()
let _projMatrix = null;  // last projection matrix captured from the probe custom layer
let _treeLayerAdded = false;

function gb() { return window.GolfBridge; }
function M() { const g = gb(); return (g && g.M_PER_UNIT) || M_FALLBACK; }

// world (game units) -> [lng, lat] via the course geo affine (lon = a·x+b·y+c,
// lat = d·x+e·y+f). Same affine the Apple ground uses (appleGeoAffine).
function worldToLngLat(x, y) {
  const g = gb().geoAffine();
  return [g[0] * x + g[1] * y + g[2], g[3] * x + g[4] * y + g[5]];
}
// [lng,lat] -> world (invert the affine's 2×2). No JS inverse exists elsewhere.
function lngLatToWorld(lng, lat) {
  const g = gb().geoAffine();
  const det = g[0] * g[4] - g[1] * g[3] || 1;
  const dl = lng - g[2], dt = lat - g[5];
  return { x: (g[4] * dl - g[1] * dt) / det, y: (g[0] * dt - g[3] * dl) / det };
}

// ---- projection bridge (the Course3D.project analog) -----------------------
// World (game coords, zUnits = height above ground in world units) -> screen CSS
// px through the LIVE Mapbox camera. Uses the projection matrix captured each
// frame from an invisible custom layer (the only reliable elevated-projection
// path under terrain — map.project() ignores altitude). Ground height comes from
// the Mapbox terrain itself (queryTerrainElevation) so overlays glue to the
// VISIBLE ground, not the game's separate DEM.
function project(x, y, zUnits, out) {
  out = out || {};
  if (!_projMatrix || !map) { out.x = 0; out.y = 0; out.inFront = false; return out; }
  const ll = worldToLngLat(x, y);
  const groundM = (map.queryTerrainElevation ? map.queryTerrainElevation(ll) : 0) || 0;
  const alt = groundM + (zUnits || 0) * M();
  const mc = window.mapboxgl.MercatorCoordinate.fromLngLat(ll, alt);
  const X = mc.x, Y = mc.y, Z = mc.z, m = _projMatrix;
  // column-major 4x4 · [X,Y,Z,1] -> clip space
  const cx = m[0] * X + m[4] * Y + m[8] * Z + m[12];
  const cy = m[1] * X + m[5] * Y + m[9] * Z + m[13];
  const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
  out.inFront = cw > 0;
  const w = cw || 1e-6;
  out.x = (cx / w * 0.5 + 0.5) * window.innerWidth;
  out.y = (1 - (cy / w * 0.5 + 0.5)) * window.innerHeight;
  return out;
}

// Screen CSS px -> world (game coords) on the terrain. map.unproject casts onto
// the rendered terrain in v3, so this is terrain-aware for taps / range finder.
function unproject(sx, sy) {
  if (!map) return null;
  const ll = map.unproject([sx, sy]);
  return lngLatToWorld(ll.lng, ll.lat);
}

// ---- camera: drive Mapbox from the game camera each frame -------------------
// Reuses the Apple pinhole camera math (buildAppleProj): look-at O = world point
// at screen center under the flat view; distM from camera.scale; heading from
// camera.angle; pitch from the tilt slider. Fed to Mapbox via setFreeCameraOptions
// (position + lookAtPoint) for exact framing parity.
const EARTH_C = 40075016.686; // equatorial circumference (m)
function setCamera() {
  if (!ready || !map) return;
  const g = gb(), view = g.getView(), cam = g.getCamera(), geo = g.geoAffine(), m = M();
  const cssW = window.innerWidth, mapH = window.innerHeight;
  // Look-at O = world point at screen center under the flat view (game camera).
  const det = view.a * view.e - view.b * view.d || 1;
  const sx0 = cssW / 2 - view.c, sy0 = mapH / 2 - view.f;
  const Ox = (view.e * sx0 - view.b * sy0) / det;
  const Oy = (-view.d * sx0 + view.a * sy0) / det;
  const reqLon = geo[0] * Ox + geo[1] * Oy + geo[2];
  const reqLat = geo[3] * Ox + geo[4] * Oy + geo[5];
  // Zoom from the flat view scale (px per world unit). Mapbox center ground
  // resolution mpp = EARTH_C·cos(lat)/(512·2^zoom); match it to the game's mpp so
  // the framing tracks the game camera. (center+zoom+pitch+bearing keeps Mapbox
  // requesting tiles — setFreeCameraOptions per-frame stalled tile loading.)
  const scale = view.scale || cam.scale || 8;
  const mpp = m / scale; // metres per screen pixel (flat)
  let zoom = Math.log2(EARTH_C * Math.cos(reqLat * Math.PI / 180) / (512 * mpp));
  zoom = Math.max(12, Math.min(20, zoom));
  const bearing = (((-cam.angle) * 180 / Math.PI) % 360 + 360) % 360;
  const pitch = Math.min(85, pitchDeg);
  // Only move the map when the camera ACTUALLY changed — a per-frame jumpTo (even
  // to identical values) keeps Mapbox in a perpetual "moving" state and tiles
  // never finish loading (measured: freezing the per-frame call flips
  // areTilesLoaded false->true). So a resting camera settles + loads imagery.
  const L = _lastCam;
  const changed = !L ||
    Math.abs(reqLon - L.lon) > 1e-7 || Math.abs(reqLat - L.lat) > 1e-7 ||
    Math.abs(zoom - L.zoom) > 0.01 || Math.abs(pitch - L.pitch) > 0.1 ||
    Math.abs(((bearing - L.bearing + 540) % 360) - 180) > 0.1;
  if (changed) {
    map.jumpTo({ center: [reqLon, reqLat], zoom, pitch, bearing });
    _lastCam = { lon: reqLon, lat: reqLat, zoom, pitch, bearing };
  }
  return changed;
}
let _lastCam = null;

// ---- terrain + overlays -----------------------------------------------------
function addTerrain() {
  const course = gb().getCourse();
  if (course && course.terrainTiles) {
    map.addSource("dem", {
      type: "raster-dem", tiles: [course.terrainTiles], encoding: "terrarium",
      tileSize: 256, maxzoom: 18, attribution: "Elevation: USGS 3DEP LiDAR",
    });
  } else {
    map.addSource("dem", GLOBAL_DEM);
  }
  map.setTerrain({ source: "dem", exaggeration: 1.0 });
}

function addHillshade() {
  map.addLayer({
    id: "hillshade", type: "hillshade", source: "dem",
    paint: {
      "hillshade-exaggeration": 0.45,
      "hillshade-illumination-direction": 315,
      "hillshade-illumination-anchor": "map",
      "hillshade-shadow-color": "#37302b",
      "hillshade-highlight-color": "#fff4e0",
      "hillshade-accent-color": "#4a3f38",
    },
  });
}

// Course surface polygons (world units) -> draped translucent GeoJSON tints, so
// fairway/green/bunker/water read through the satellite (mirrors the game's
// photoreal overlay + web/ viewer holeLayers). Kind-filtered fills.
function addSurfaceTints() {
  const course = gb().getCourse();
  const surf = course && course.surfaces;
  if (!surf) return;
  const feats = [];
  const pushPolys = (polys, kind) => {
    if (!polys) return;
    for (const poly of polys) {
      if (!poly || poly.length < 3) continue;
      const ring = poly.map((pt) => worldToLngLat(pt.x != null ? pt.x : pt[0], pt.y != null ? pt.y : pt[1]));
      ring.push(ring[0]);
      feats.push({ type: "Feature", properties: { kind }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
  };
  pushPolys(surf.fairway, "fairway");
  pushPolys(surf.water, "water");
  pushPolys(surf.bunker, "bunker");
  pushPolys(surf.green, "green");
  pushPolys(surf.tee, "tee");
  map.addSource("holes", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
  const fill = (id, kind, color, op) => map.addLayer({
    id, type: "fill", source: "holes", filter: ["==", ["get", "kind"], kind],
    paint: { "fill-color": color, "fill-opacity": op },
  });
  fill("fairway-fill", "fairway", "#8ad98f", 0.13);
  fill("water-fill", "water", "#1f6f8b", 0.35);
  fill("bunker-fill", "bunker", "#e8d9a0", 0.26);
  fill("green-fill", "green", "#4ea24e", 0.30);
  map.addLayer({
    id: "green-outline", type: "line", source: "holes", filter: ["==", ["get", "kind"], "green"],
    paint: { "line-color": "#eafff0", "line-width": 1.5, "line-opacity": 0.55 },
  });
  fill("tee-fill", "tee", "#2b6cb0", 0.45);
}

// Invisible custom layer whose render(gl, matrix) captures the current projection
// matrix each Mapbox paint (Mapbox v3 passes it positionally). project() reads it.
function addProjProbe() {
  map.addLayer({
    id: "proj-probe", type: "custom", renderingMode: "3d",
    onAdd() {}, prerender() {},
    render(_gl, matrix) { _projMatrix = matrix; },
  });
}

// ---- lifecycle --------------------------------------------------------------
function ensureContainer() {
  if (container) return container;
  container = document.getElementById("cmbox");
  if (!container) {
    container = document.createElement("div");
    container.id = "cmbox";
    // Behind #game (which paints on top for input). Same fixed/inset stacking
    // the #c3d canvas uses; DOM order + no z-index decides it, so insert before #game.
    const g = document.getElementById("game");
    if (g && g.parentNode) g.parentNode.insertBefore(container, g);
    else document.body.appendChild(container);
  }
  return container;
}

function enter(opts) {
  const courseId = opts && opts.courseId;
  activeCourseId = courseId;
  if (!window.MAPBOX_TOKEN || !window.mapboxgl) return;
  ensureContainer();
  container.style.display = "block";
  // #game must be transparent so the map shows through (draw() clears it each frame).
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  if (map) { ready = true; return; } // resident across re-enters
  window.mapboxgl.accessToken = window.MAPBOX_TOKEN;
  const g = gb(), course = g.getCourse();
  const center = worldToLngLat(
    (course.world ? course.world.w : 100) / 2,
    (course.world ? course.world.h : 100) / 2
  );
  map = new window.mapboxgl.Map({
    container,
    style: STYLE_URL,
    center,
    zoom: 16,
    pitch: Math.min(85, pitchDeg),
    projection: "mercator", // REQUIRED — globe breaks the projection matrix
    antialias: true,
    preserveDrawingBuffer: true,
    attributionControl: false,
  });
  map.addControl(new window.mapboxgl.AttributionControl({ compact: true }));
  window.__mbmap = map; // debug handle
  map.on("style.load", () => {
    addTerrain();
    addHillshade();
    addSurfaceTints();
    addProjProbe();
    ready = true;
  });
  map.on("error", (ev) => { try { console.warn("[mbox3d]", ev && ev.error && ev.error.message || ev); } catch (e) {} });
}

function leave() {
  ready = false;
  if (container) container.style.display = "none";
  // restore the app background the game normally paints
  document.documentElement.style.background = "";
  document.body.style.background = "";
}

// Called once per game frame (loop, before draw) so the map camera + matrix are
// current when game.js's wx()/wy() project this frame.
function render() {
  if (!ready || !map) return;
  const changed = setCamera();
  // Repaint (refreshes the captured projection matrix) when the camera moved, we
  // don't yet have a matrix, or tiles are still streaming in — so late-arriving
  // imagery actually composites. Once tiles are loaded AND the camera is parked,
  // stop repainting so the map idles (and tiles finish loading in the first place).
  if (changed || !_projMatrix || !map.areTilesLoaded()) map.triggerRepaint();
}

function setPitch(deg) { pitchDeg = Math.max(0, Math.min(85, deg)); }
function resize() { if (map) map.resize(); }
function isReady() { return ready && !!_projMatrix; }

function debug() {
  return { ready, hasMatrix: !!_projMatrix, courseId: activeCourseId, pitch: pitchDeg,
    center: map && map.getCenter(), zoom: map && map.getZoom() };
}

window.Mbox3D = { enter, leave, render, resize, setPitch, project, unproject, isReady, debug,
  worldToLngLat, lngLatToWorld };
