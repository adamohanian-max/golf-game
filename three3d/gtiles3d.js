// Google Photorealistic 3D Tiles ground engine for the main game (Pebble Beach).
//
// A ground backend beside course3d.js (Four Oaks three.js) and the Apple MapKit
// flyover — it replaced the old Mapbox GL ground (deleted 2026-07-24). Same
// compositing model: a full-screen 3D canvas (#cgt) sits behind the transparent
// #game canvas; all gameplay (cup/ball/aim/contours) keeps drawing on #game,
// glued to the photoreal ground by the projection bridge. game.js routes
// wx()/wy()/ws()/screenToWorld() through window.GTiles3D.project/unproject when
// view.gtilesProj is set (the same pattern the three.js/Apple grounds use).
//
// Streams Google's real-world photoreal mesh via 3d-tiles-renderer. Because the
// root app vendors three r160 but the renderer needs three >=0.167, the renderer
// AND its own three@0.179 are bundled into vendor/gtiles/gtiles.js (importmap key
// "gtiles"); this module imports THREE from there, NOT from the shared importmap.
// Safe: only screen-pixel numbers cross the bridge, never three objects.
//
// Reaches game.js state through window.GolfBridge (game.js is a classic script).
// WEB-ONLY prototype: Google tiles are online + billed, and Capacitor's offline
// CSP blocks them on native — gate keeps it off iOS.

import {
  THREE,
  TilesRenderer,
  WGS84_ELLIPSOID,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  UnloadTilesPlugin,
  TilesFadePlugin,
} from "gtiles";

const M_FALLBACK = 2.7432;   // metres per world unit (1 unit = 3 yd), matches game.js
const APPLE_CAM_K = 1.866;   // 1/(2·tan15°) — the FOV constant the game camera math uses
const DEG = Math.PI / 180;

let container = null;   // #cgt canvas
let renderer = null;
let scene = null;
let camera = null;
let tiles = null;
let reorient = null;
let ready = false;
let activeCourseId = null;
let pitchDeg = 55;      // camera pitch (0 = top-down, 90 = horizon)

// ---- bridge helpers ---------------------------------------------------------
function gb() { return window.GolfBridge; }
function M() { const g = gb(); return (g && g.M_PER_UNIT) || M_FALLBACK; }
function worldToLngLat(x, y) {
  const g = gb().geoAffine();
  return [g[0] * x + g[1] * y + g[2], g[3] * x + g[4] * y + g[5]];
}
function lngLatToWorld(lng, lat) {
  const g = gb().geoAffine();
  const det = g[0] * g[4] - g[1] * g[3] || 1;
  const dl = lng - g[2], dt = lat - g[5];
  return { x: (g[4] * dl - g[1] * dt) / det, y: (g[0] * dt - g[3] * dl) / det };
}

// ---- ECEF → scene ----------------------------------------------------------
// A [lng,lat] (degrees) + height (metres) → scene-space position. Tile geometry
// is raw ECEF; tiles.group.matrixWorld carries the ReorientationPlugin transform
// (ECEF → scene, our anchor at the origin, +Y up). Verified in the g3d viewer.
const _cart = new THREE.Vector3();
function sceneAt(lngDeg, latDeg, hM, out) {
  out = out || new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(latDeg * DEG, lngDeg * DEG, hM || 0, _cart);
  return out.copy(_cart).applyMatrix4(tiles.group.matrixWorld);
}

// ---- projection bridge -----------------------------------------------------
// World (game coords, zUnits = height above ground in WORLD units) → screen CSS
// px through the live three camera. Ground points arrive with zUnits already
// carrying the game DEM ground height (game.js passes terrainZ), like Course3D —
// so overlays sit on the LiDAR-derived elevation (close to Google's mesh at
// Pebble; may float slightly where they disagree — prototype tradeoff).
const _p = new THREE.Vector3();
function project(x, y, zUnits, out) {
  out = out || {};
  if (!ready || !tiles || !camera) { out.x = 0; out.y = 0; out.inFront = false; return out; }
  const ll = worldToLngLat(x, y);
  sceneAt(ll[0], ll[1], (zUnits || 0) * M(), _p);
  _p.project(camera); // → NDC
  out.inFront = _p.z < 1;
  out.x = (_p.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (1 - (_p.y * 0.5 + 0.5)) * window.innerHeight;
  return out;
}

// Screen CSS px → world: raycast the loaded mesh, invert to lng/lat → world.
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _mInv = new THREE.Matrix4();
const _hitCart = { lat: 0, lon: 0, height: 0 };
function unproject(sx, sy) {
  if (!ready || !tiles || !camera) return null;
  _ndc.set((sx / window.innerWidth) * 2 - 1, -((sy / window.innerHeight) * 2 - 1));
  _ray.setFromCamera(_ndc, camera);
  const hits = _ray.intersectObject(tiles.group, true);
  if (!hits.length) return null;
  _mInv.copy(tiles.group.matrixWorld).invert();
  const ecef = hits[0].point.clone().applyMatrix4(_mInv);
  WGS84_ELLIPSOID.getPositionToCartographic(ecef, _hitCart);
  return lngLatToWorld(_hitCart.lon / DEG, _hitCart.lat / DEG);
}

// ---- camera: drive the three camera from the game camera each frame ---------
// Look-at O from frameAnchors (ball↔reach convergence), distance from view.scale,
// bearing from cam.angle, pitch from the tilt slider — positions a free three
// PerspectiveCamera in the reoriented scene, using a local ENU basis measured by
// finite-differencing sceneAt() at O.
let _ctrBias = 0.5, _zAdj = 0;
const BALL_FRAC = 0.90;   // ball at 90% down
const REACH_FRAC = 0.15;  // club landing at 15% down
const _O = new THREE.Vector3();
const _up = new THREE.Vector3();
const _north = new THREE.Vector3();
const _east = new THREE.Vector3();
const _tmp = new THREE.Vector3();
function setCamera() {
  if (!ready || !tiles || !camera) return;
  const g = gb(), view = g.getView(), cam = g.getCamera(), m = M();
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const scale = view.scale || cam.scale || 8;
  const geo = g.geoAffine();
  const toLL = (x, y) => [geo[0] * x + geo[1] * y + geo[2], geo[3] * x + geo[4] * y + geo[5]];

  // Look-at world point O.
  let Ox, Oy;
  const A = g.frameAnchors ? g.frameAnchors() : null;
  if (A && !A.moving) {
    // Nudge pan-bias + zoom-offset from where ball/reach landed last frame.
    const bs = project(A.bx, A.by, g.terrainZ(A.bx, A.by));
    const rs = project(A.rx, A.ry, g.terrainZ(A.rx, A.ry));
    if (bs.inFront && rs.inFront) {
      const spanNow = bs.y - rs.y;
      const spanWant = (BALL_FRAC - REACH_FRAC) * H;
      _zAdj += 0.35 * Math.log2(spanWant / Math.max(spanNow, 8));
      _zAdj = Math.max(-3, Math.min(3, _zAdj));
      const eB = (bs.y - BALL_FRAC * H) / H;
      _ctrBias -= 0.35 * eB;
      _ctrBias = Math.max(-0.15, Math.min(1.15, _ctrBias));
    }
    Ox = A.bx + _ctrBias * (A.rx - A.bx);
    Oy = A.by + _ctrBias * (A.ry - A.by);
  } else {
    const det = view.a * view.e - view.b * view.d || 1;
    const sx0 = W / 2 - view.c, sy0 = H / 2 - view.f;
    Ox = (view.e * sx0 - view.b * sy0) / det;
    Oy = (-view.d * sx0 + view.a * sy0) / det;
  }

  // Metres of vertical world span the flat game shows → camera distance for a
  // 30° vertical FOV (matches the game's pinhole). _zAdj corrects framing drift.
  const mpp = m * dpr / scale;         // metres per CSS px
  const spanM = mpp * H;
  let D = spanM * APPLE_CAM_K * Math.pow(2, -_zAdj);
  D = Math.max(20, Math.min(6000, D));

  // O in scene + local ENU basis (finite differences of sceneAt around O).
  const [Olon, Olat] = toLL(Ox, Oy);
  const groundM = (g.terrainZ ? g.terrainZ(Ox, Oy) : 0) * m;
  sceneAt(Olon, Olat, groundM, _O);
  sceneAt(Olon, Olat, groundM + 1, _up).sub(_O).normalize();          // ellipsoid up
  sceneAt(Olon, Olat + 1e-5, groundM, _north).sub(_O).normalize();    // +lat = north
  sceneAt(Olon + 1e-5, Olat, groundM, _east).sub(_O).normalize();     // +lon = east

  // Screen-up world dir (toward reach) → scene horizontal. geo affine gives
  // x≈east, y≈south, so scene horiz = east·dx − north·dy.
  const a = cam.tAngle != null ? cam.tAngle : cam.angle;
  const dirX = -Math.sin(a), dirY = -Math.cos(a);
  _tmp.copy(_east).multiplyScalar(dirX).addScaledVector(_north, -dirY).normalize(); // fwdHoriz

  // pitch P (Mapbox sense): 0 = camera straight above O, 90 = level behind O.
  const P = Math.max(0, Math.min(85, pitchDeg)) * DEG;
  camera.position.copy(_O)
    .addScaledVector(_up, D * Math.cos(P))
    .addScaledVector(_tmp, -D * Math.sin(P));
  camera.up.copy(_up);
  camera.fov = 30;
  camera.near = Math.max(1, D / 500);
  camera.far = D * 60 + 8000;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  camera.lookAt(_O);
  camera.updateMatrixWorld();
}

// ---- lifecycle -------------------------------------------------------------
function ensureContainer() {
  if (container) return container;
  container = document.getElementById("cgt");
  if (!container) {
    container = document.createElement("canvas");
    container.id = "cgt";
    container.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;";
    const gEl = document.getElementById("game");
    if (gEl && gEl.parentNode) gEl.parentNode.insertBefore(container, gEl);
    else document.body.appendChild(container);
  }
  return container;
}

function buildRenderer() {
  if (renderer) return;
  ensureContainer();
  renderer = new THREE.WebGLRenderer({ canvas: container, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 40000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(1, 2, 1);
  scene.add(sun);
  resize();
}

function buildTiles() {
  const g = gb(), course = g.getCourse();
  const c = worldToLngLat(
    (course.world ? course.world.w : 100) / 2,
    (course.world ? course.world.h : 100) / 2,
  );
  tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({
    apiToken: window.GOOGLE_TILES_TOKEN, autoRefreshToken: true,
  }));
  reorient = new ReorientationPlugin({
    up: "+y", recenter: true, lat: c[1] * DEG, lon: c[0] * DEG, height: 0,
  });
  tiles.registerPlugin(reorient);
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UnloadTilesPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.errorTarget = 6;
  tiles.lruCache.maxSize = 800;
  tiles.lruCache.minSize = 600;
  tiles.setCamera(camera);
  scene.add(tiles.group);
  tiles.addEventListener("load-error", (e) => {
    try { console.warn("[gtiles3d]", (e && e.error && e.error.message) || e.url); } catch (err) {}
  });
}

function enter(opts) {
  activeCourseId = opts && opts.courseId;
  if (!window.GOOGLE_TILES_TOKEN) { try { console.warn("[gtiles3d] no GOOGLE_TILES_TOKEN"); } catch (e) {} return; }
  buildRenderer();
  container.style.display = "block";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  if (tiles) { return; } // resident across re-enters
  buildTiles();
}

function leave() {
  ready = false;
  if (container) container.style.display = "none";
  document.documentElement.style.background = "";
  document.body.style.background = "";
}

// Called each frame from game.js loop(): drive the camera, stream + render tiles.
function render() {
  if (!tiles || !camera || !renderer) return;
  setCamera();
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();
  tiles.group.updateMatrixWorld(true);
  renderer.render(scene, camera);
  // Ready once the root tileset has produced geometry near the anchor.
  if (!ready) {
    const s = new THREE.Sphere();
    ready = tiles.getBoundingSphere(s) && s.radius > 0;
  }
}

function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
}

function setPitch(deg) { pitchDeg = Math.max(0, Math.min(85, deg)); }
function isReady() { return ready; }

// Google logo + data-credit strings (MANDATORY per Map Tiles API ToS). Typed
// entries: image = logo (data URI), string = credits.
function getAttributions() {
  if (!tiles) return [];
  try { return tiles.getAttributions(); } catch (e) { return []; }
}

function debug() {
  return { ready, courseId: activeCourseId, pitch: pitchDeg,
    hasToken: !!window.GOOGLE_TILES_TOKEN, tiles: !!tiles };
}

window.GTiles3D = {
  enter, leave, render, resize, setPitch, project, unproject, isReady,
  getAttributions, worldToLngLat, lngLatToWorld, debug,
};
