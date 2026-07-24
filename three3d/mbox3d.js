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

// Two ground looks the user compares via the HUD toggle:
//  satellite = photoreal imagery, boundary-masked (spotlight the hole)
//  vector    = Mapbox Standard illustrated vector, faded + recolored to golf greens
const STYLE_URLS = {
  satellite: "mapbox://styles/mapbox/standard-satellite",
  vector: "mapbox://styles/mapbox/standard",
};
function readStyleMode() {
  try { const v = localStorage.getItem("golf.mboxStyle"); if (v === "vector" || v === "satellite") return v; } catch (e) {}
  return "satellite";
}
let styleMode = readStyleMode();
const OFF_COURSE = "#13351c"; // dark course-green wash the game already uses outside the aerial
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
// Framing: put the ball at BALL_FRAC down (bottom of screen) and the club's
// landing at REACH_FRAC (top). The ball is pinned deterministically with Mapbox
// map PADDING (center on the ball, pad the top so its "center" sits low), and a
// single-DOF zoom feedback slides the reach point to REACH_FRAC.
let _zAdj = 0;
const BALL_FRAC = 0.88;  // ball ~bottom 12%
const REACH_FRAC = 0.16; // club landing ~top 16%
function setCamera() {
  if (!ready || !map) return;
  const g = gb(), view = g.getView(), cam = g.getCamera(), geo = g.geoAffine(), m = M();
  const cssW = window.innerWidth, mapH = window.innerHeight, H = mapH;
  const scale = view.scale || cam.scale || 8;
  // view.scale is DEVICE px/world-unit; Mapbox zoom is CSS-px based → ÷dpr.
  const dpr = window.devicePixelRatio || 1;
  const mpp = m * dpr / scale; // metres per CSS pixel
  const boost = typeof window.__mboxZoomBoost === "number" ? window.__mboxZoomBoost : 0;
  const baseZoom = (lat) => Math.log2(EARTH_C * Math.cos(lat * Math.PI / 180) / (512 * mpp)) + boost;
  const toLL = (x, y) => [geo[0] * x + geo[1] * y + geo[2], geo[3] * x + geo[4] * y + geo[5]];

  let reqLon, reqLat, zoom, padding = null;
  const A = g.frameAnchors ? g.frameAnchors() : null;
  if (A && !A.moving) {
    // Center on the BALL. Top padding = 2*BALL_FRAC-1 of the height puts the
    // padded-region center (= the ball) at BALL_FRAC down the real viewport.
    [reqLon, reqLat] = toLL(A.bx, A.by);
    padding = { top: (2 * BALL_FRAC - 1) * H, bottom: 0, left: 0, right: 0 };
    // Single-DOF zoom feedback: slide the reach point to REACH_FRAC.
    if (_projMatrix) {
      const rs = project(A.rx, A.ry, 0);
      if (rs.inFront) {
        const eR = (rs.y - REACH_FRAC * H) / H;     // >0 reach too low → zoom IN
        _zAdj += 0.85 * eR;                         // (ball pinned at center → higher zoom pushes reach up)
        _zAdj = Math.max(-6, Math.min(6, _zAdj));
      }
    }
    zoom = baseZoom(reqLat) + _zAdj;
  } else {
    // Flight / no hole: center on the flat view's screen-center world point.
    const det = view.a * view.e - view.b * view.d || 1;
    const sx0 = cssW / 2 - view.c, sy0 = mapH / 2 - view.f;
    const Ox = (view.e * sx0 - view.b * sy0) / det, Oy = (-view.d * sx0 + view.a * sy0) / det;
    [reqLon, reqLat] = toLL(Ox, Oy);
    zoom = baseZoom(reqLat);
  }
  zoom = Math.max(12, Math.min(20.5, zoom));
  const bearing = (((-cam.angle) * 180 / Math.PI) % 360 + 360) % 360;
  const pitch = Math.min(85, pitchDeg);
  const padTop = padding ? padding.top : 0;
  // Only move the map when the camera ACTUALLY changed — a per-frame jumpTo (even
  // to identical values) keeps Mapbox "moving" and tiles never finish loading.
  const L = _lastCam;
  const changed = !L ||
    Math.abs(reqLon - L.lon) > 1e-7 || Math.abs(reqLat - L.lat) > 1e-7 ||
    Math.abs(zoom - L.zoom) > 0.01 || Math.abs(pitch - L.pitch) > 0.1 ||
    Math.abs(padTop - L.padTop) > 1 ||
    Math.abs(((bearing - L.bearing + 540) % 360) - 180) > 0.1;
  if (changed) {
    map.jumpTo({ center: [reqLon, reqLat], zoom, pitch, bearing, padding: padding || { top: 0, bottom: 0, left: 0, right: 0 } });
    _lastCam = { lon: reqLon, lat: reqLat, zoom, pitch, bearing, padTop };
  }
  return changed;
}
let _lastCam = null;

// Standard style config: strip the map furniture (POI / place / road / transit
// labels — this is a golf course, not a street map) and turn ON Mapbox's global
// 3D objects (buildings + trees + landmarks), so the clubhouse and canopy stand
// up over the satellite like Apple Flyover.
function configureBasemap() {
  const set = (k, v) => { try { map.setConfigProperty("basemap", k, v); } catch (e) {} };
  // Both modes: strip labels (golf course, not a street map).
  set("showPointOfInterestLabels", false);
  set("showPlaceLabels", false);
  set("showRoadLabels", false);
  set("showTransitLabels", false);
  if (styleMode === "vector") {
    // Clean illustrated look: faded theme, recolor land/greenspace/water to golf
    // tones, and paint roads INTO the land tone so they disappear (roads can't be
    // fully hidden in Standard). We draw our own trees, so kill Mapbox's 3D objects.
    set("theme", "faded");
    set("show3dObjects", false);
    const land = "#2c6e30";
    set("colorLand", land);
    set("colorGreenspace", "#357a39");
    set("colorWater", "#1f6f8b");
    set("colorRoads", land);
    set("colorMotorways", land);
    set("colorTrunks", land);
    set("showPedestrianRoads", false);
    set("showAdminBoundaries", false);
  }
  // NOTE (satellite mode): Mapbox's own show3dObjects does NOT render over the
  // satellite style, so buildings + trees are our own geometry.
}

// Point-in-polygon (ray cast) over a ring of {x,y} — for the tree boundary filter.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Focus on the course: a fill covering the whole map EXCEPT the course boundary
// (huge outer box with the boundary ring as an interior hole), colored the dark
// off-course green. Everything outside the course is hidden in BOTH modes.
function addBoundaryMask() {
  const course = gb().getCourse();
  const b = course && course.boundary && course.boundary[0];
  if (!b || b.length < 3) return;
  const hole = b.map((pt) => worldToLngLat(pt.x, pt.y));
  if (hole[0][0] !== hole[hole.length - 1][0] || hole[0][1] !== hole[hole.length - 1][1]) hole.push(hole[0]);
  // Outer box around the course center, big enough to cover the whole visible map.
  const c = worldToLngLat((course.world ? course.world.w : 100) / 2, (course.world ? course.world.h : 100) / 2);
  const D = 0.35;
  const outer = [
    [c[0] - D, c[1] - D], [c[0] + D, c[1] - D], [c[0] + D, c[1] + D], [c[0] - D, c[1] + D], [c[0] - D, c[1] - D],
  ];
  map.addSource("coursemask", { type: "geojson", data: {
    type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [outer, hole] },
  } });
  map.addLayer({ id: "coursemask-fill", type: "fill", source: "coursemask",
    paint: { "fill-color": OFF_COURSE, "fill-opacity": 0.94 } });
}

// Buildings: OSM footprints (world units, tools/fetch_buildings.py -> courses/
// buildings/<id>.json) -> native fill-extrusion. Heights nudged up + floored so
// low OSM defaults still read as buildings.
async function addBuildings() {
  try {
    const r = await fetch("/courses/buildings/" + activeCourseId + ".json");
    if (!r.ok) return;
    const data = await r.json();
    const list = (data && data.buildings) || [];
    const feats = [];
    // Warm, slightly varied wall/roof palette so the extrusions read as a
    // residential/clubhouse cluster instead of one flat gray block.
    const PALETTE = ["#d8cbb2", "#cdb79a", "#c9c3b6", "#d9d2c4", "#c2a888", "#bfb49c"];
    const course = gb().getCourse();
    const bring = course && course.boundary && course.boundary[0];
    let n = 0;
    for (const b of list) {
      if (!b.poly || b.poly.length < 3) continue;
      // Skip buildings outside the course boundary (they'd poke over the mask).
      if (bring && bring.length > 2) {
        const cx = b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length;
        const cy = b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length;
        if (!pointInRing(cx, cy, bring)) continue;
      }
      const ring = b.poly.map((pt) => worldToLngLat(pt[0], pt[1]));
      ring.push(ring[0]);
      // Deterministic per-building jitter (index hash) — height + color variety.
      const hsh = ((n * 2654435761) >>> 0) / 4294967295;
      const h = Math.max(b.h || 4, 4) * (1.5 + hsh * 1.1); // taller + varied
      feats.push({ type: "Feature", properties: { h, c: PALETTE[n % PALETTE.length] },
        geometry: { type: "Polygon", coordinates: [ring] } });
      n++;
    }
    if (!feats.length || !map) return;
    map.addSource("buildings", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
    map.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: "buildings",
      paint: {
        "fill-extrusion-color": ["get", "c"], "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.95,
        "fill-extrusion-vertical-gradient": true,
      },
    });
  } catch (e) { /* no buildings file / offline */ }
}

// Trees: the game's own tree instances (GolfBridge.getTrees, world units) as
// textured CROSSED-QUAD BILLBOARDS in a three.js custom layer sharing Mapbox's GL
// context (the ball-layer technique). Crossed quads + an alpha foliage texture
// read as real canopy from every angle (vs the old flat cones); per-instance
// scale/rotation/tint jitter + soft ground shadows + a little clump density kill
// the "cardboard" look. Instance matrices baked in mercator space so the shared
// projection matrix places them; elevation from the Mapbox terrain.
let _treeRenderer = null, _treeScene = null, _treeCam = null, _treeInst = null, _treeTries = 0;

// Canvas-drawn soft foliage sprite (alpha) — self-contained, no external asset
// (works offline in Capacitor). Layered green clumps over a short trunk.
function foliageTexture() {
  const S = 256, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const c = cv.getContext("2d");
  // trunk
  c.fillStyle = "#5b4327";
  c.fillRect(S * 0.46, S * 0.62, S * 0.08, S * 0.36);
  // canopy: many soft radial blobs, 3 green shades, denser in the middle
  const greens = ["#2f5230", "#3c6a37", "#4f7d41", "#274a29"];
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 220; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.6) * S * 0.34;
    const cx = S * 0.5 + Math.cos(a) * rr, cy = S * 0.36 + Math.sin(a) * rr * 0.9;
    const rad = S * (0.05 + rnd() * 0.09);
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
    const col = greens[(rnd() * greens.length) | 0];
    g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.globalAlpha = 0.55 + rnd() * 0.4;
    c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Soft radial ground-shadow sprite (dark -> transparent).
function shadowTexture() {
  const S = 128, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(0.7, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}
// Two vertical quads crossed at 90° (base y=0, top y=1, width 1 about x). Gives
// the billboard volume from any viewing angle without per-frame facing.
function crossedQuadGeometry() {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,   // quad A (faces z)
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,   // quad B (faces x)
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function addTreeLayer() {
  map.addLayer({
    id: "trees3d", type: "custom", renderingMode: "3d",
    onAdd(m, gl) {
      _treeRenderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      _treeRenderer.autoClear = false;
      _treeScene = new THREE.Scene();
      _treeScene.add(new THREE.AmbientLight(0xffffff, 1.25));
      const sun = new THREE.DirectionalLight(0xfff2e0, 0.9); sun.position.set(-0.6, -1, 0.8); _treeScene.add(sun);
      _treeCam = new THREE.Camera();
    },
    render(_gl, matrix) {
      if (!_treeInst) buildTreeInstances();
      if (!_treeInst) return;
      _treeCam.projectionMatrix.fromArray(matrix);
      _treeRenderer.resetState();
      _treeRenderer.render(_treeScene, _treeCam);
    },
  });
}
function buildTreeInstances() {
  if (_treeTries > 600 || !_treeScene) return;
  _treeTries++;
  let src = (gb().getTrees && gb().getTrees()) || [];
  if (!src.length) return;
  // Keep only trees inside the course boundary so canopy never pokes over the
  // off-course mask. (Fallback: keep all if no boundary.)
  const course = gb().getCourse();
  const bring = course && course.boundary && course.boundary[0];
  if (bring && bring.length > 2) src = src.filter((t) => pointInRing(t.x, t.y, bring));
  if (!src.length) return;
  const MC = window.mapboxgl.MercatorCoordinate;
  const probe = map.queryTerrainElevation ? map.queryTerrainElevation(worldToLngLat(src[0].x, src[0].y)) : 0;
  if (probe == null) return; // DEM not loaded yet — try again next frame
  const m = M();
  // Densify: each source tree spawns a small clump so the woods read full.
  const DENS = 3;
  let seed = 99887766;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const N = src.length * DENS;

  // Canopy billboards
  const geo = crossedQuadGeometry();
  const mat = new THREE.MeshLambertMaterial({ map: foliageTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, N);
  // Ground shadows
  const sgeo = new THREE.PlaneGeometry(1, 1);
  const smat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 });
  const shad = new THREE.InstancedMesh(sgeo, smat, N);

  const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const rotY = new THREE.Matrix4(), trn = new THREE.Matrix4(), scl = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const col = new THREE.Color();
  let k = 0;
  for (let i = 0; i < src.length; i++) {
    const t = src[i];
    const baseH = t.h || 3, baseR = t.r || baseH * 0.42;
    for (let d = 0; d < DENS; d++) {
      // clump offset in world units (except the first, which sits on the point)
      const ox = d === 0 ? 0 : (rnd() - 0.5) * baseR * 1.6;
      const oy = d === 0 ? 0 : (rnd() - 0.5) * baseR * 1.6;
      const ll = worldToLngLat(t.x + ox, t.y + oy);
      const g = (map.queryTerrainElevation ? map.queryTerrainElevation(ll) : 0) || 0;
      const mc = MC.fromLngLat(ll, g);
      const s = mc.meterInMercatorCoordinateUnits();
      const sizeJ = 0.8 + rnd() * 0.5;
      const hM = baseH * sizeJ * m, rM = baseR * sizeJ * m;
      trn.makeTranslation(mc.x, mc.y, mc.z);
      rotY.makeRotationAxis(new THREE.Vector3(0, 1, 0), rnd() * Math.PI); // yaw variety
      // canopy: T * rotX(up) * rotY(yaw) * scale(r,h,r)
      scl.makeScale(rM * s, hM * s, rM * s);
      tmp.multiplyMatrices(trn, rotX).multiply(rotY).multiply(scl);
      inst.setMatrixAt(k, tmp);
      // green tint jitter
      col.setHSL(0.28 + (rnd() - 0.5) * 0.05, 0.45, 0.42 + (rnd() - 0.5) * 0.12);
      inst.setColorAt(k, col);
      // shadow: flat on ground, radius ~ canopy
      const sR = rM * 1.5 * s;
      scl.makeScale(sR, sR, sR);
      trn.makeTranslation(mc.x, mc.y, mc.z);
      tmp.multiplyMatrices(trn, rotX).multiply(scl); // PlaneGeometry(z-facing) -> rotX -> lies flat
      shad.setMatrixAt(k, tmp);
      k++;
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  shad.instanceMatrix.needsUpdate = true;
  shad.renderOrder = -1; // draw shadows under canopy
  _treeScene.add(shad);
  _treeScene.add(inst);
  _treeInst = inst;
}

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
  const vec = styleMode === "vector";
  // Both modes get a rough/grass base now — in satellite it's a translucent wash
  // that UNIFIES the varied aerial greens toward one clean tone (user wanted the
  // vector uniformity kept). Vector paints the palette opaquely.
  pushPolys(surf.rough, "rough");
  pushPolys(surf.grass, "grass");
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
  if (vec) {
    // clean stylized golf palette (mirrors drawVectorSurfaces)
    fill("rough-fill", "rough", "#2c6e30", 0.95);
    fill("grass-fill", "grass", "#3a9440", 0.9);
    fill("fairway-fill", "fairway", "#4eb053", 0.92);
    fill("water-fill", "water", "#2a93d8", 0.9);
    fill("bunker-fill", "bunker", "#f1e6c4", 0.92);
    fill("green-fill", "green", "#8fce8f", 0.95);
    map.addLayer({ id: "green-outline", type: "line", source: "holes",
      filter: ["==", ["get", "kind"], "green"], paint: { "line-color": "#eafff0", "line-width": 1.5, "line-opacity": 0.7 } });
    fill("tee-fill", "tee", "#5cbf61", 0.92);
  } else {
    // Satellite: translucent game palette over the photo — stronger + a rough/
    // grass unify wash so the varied aerial greens read as one clean surface.
    fill("rough-fill", "rough", "#2f7233", 0.2);
    fill("grass-fill", "grass", "#3a9440", 0.16);
    fill("fairway-fill", "fairway", "#4eb053", 0.24);
    fill("water-fill", "water", "#1f6f8b", 0.38);
    fill("bunker-fill", "bunker", "#e8d9a0", 0.24);
    fill("green-fill", "green", "#6fbb79", 0.3);
    map.addLayer({ id: "green-outline", type: "line", source: "holes",
      filter: ["==", ["get", "kind"], "green"], paint: { "line-color": "#eafff0", "line-width": 1.5, "line-opacity": 0.5 } });
    fill("tee-fill", "tee", "#5cbf61", 0.26);
  }
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
    style: STYLE_URLS[styleMode],
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
  // Re-runs on every setStyle() too, so one handler serves both style modes.
  map.on("style.load", () => {
    addTerrain();
    addHillshade();
    addSurfaceTints();
    // addBuildings(): DISABLED — fill-extrusion over 3D terrain spikes into giant
    // columns (known Mapbox bug, #11516). Boxes weren't photoreal anyway; revisit
    // with real 3D models or a terrain-relative base later.
    addTreeLayer();   // 3D tree canopy (three.js custom layer)
    addProjProbe();
    ready = true;
    configureBasemap(); // labels off / vector recolor — after our layers, guarded
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
  if (changed || !_projMatrix || !_treeInst || !map.areTilesLoaded()) map.triggerRepaint();
}

function setPitch(deg) { pitchDeg = Math.max(0, Math.min(85, deg)); }
function resize() { if (map) map.resize(); }
function isReady() { return ready && !!_projMatrix; }

// Flip between the two ground looks (satellite ⇄ vector). setStyle() clears the
// style's layers/sources, so reset our per-style state and let the shared
// style.load handler rebuild terrain/tints/buildings/trees/mask/probe.
function setStyleMode(mode) {
  if (mode !== "vector" && mode !== "satellite") return;
  styleMode = mode;
  try { localStorage.setItem("golf.mboxStyle", mode); } catch (e) {}
  if (!map) return;
  ready = false; _projMatrix = null;
  _treeInst = null; _treeTries = 0; _treeScene = null; // trees3d re-created on style.load
  _lastCam = null; _zAdj = 0; // force a camera resync on the new style
  map.setStyle(STYLE_URLS[styleMode]);
}
function getStyleMode() { return styleMode; }

function debug() {
  return { ready, hasMatrix: !!_projMatrix, courseId: activeCourseId, pitch: pitchDeg,
    center: map && map.getCenter(), zoom: map && map.getZoom(),
    trees: _treeInst ? _treeInst.count : 0, treeTries: _treeTries,
    buildings: !!(map && map.getLayer && map.getLayer("buildings-3d")) };
}

window.Mbox3D = { enter, leave, render, resize, setPitch, project, unproject, isReady, debug,
  worldToLngLat, lngLatToWorld, setStyleMode, getStyleMode };
