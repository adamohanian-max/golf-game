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
// Offline / weak-signal fallback: Google tiles can't be cached or used offline
// (ToS). When they can't load, failed() flips true and game.js drops back to the
// 2D baked aerial instead of showing a blank ground.
let _failed = false;
let _errCount = 0;
let _enterAt = 0;
const FAIL_ERRS = 8;        // this many load-errors before ready → give up
const FAIL_TIMEOUT_MS = 9000; // no geometry within this after enter → give up

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

// ---- mesh-height anchoring --------------------------------------------------
// The game DEM (terrainZ) is a LOCAL, relative field — NOT the mesh's absolute
// ellipsoidal height. At Pebble the Google mesh sits ~40m off what terrainZ*M
// implies (orthometric sea-level minus the ~+32m geoid separation), and at the
// oblique camera that vertical gap smears overlays ~37yd horizontally off the
// ground. Fix: measure the REAL mesh height at two anchors (ball + pin) each
// frame and correct project()'s height by the (mesh − DEM) offset, lerped
// between them. unproject() (a mesh raycast) is already truthful.
const _mUp = new THREE.Vector3();
const _mA = new THREE.Vector3();
const _mB = new THREE.Vector3();
const _mOrigin = new THREE.Vector3();
const _mDown = new THREE.Vector3();
const _hRay = new THREE.Raycaster();
const _hInv = new THREE.Matrix4();
const _hCart = { lat: 0, lon: 0, height: 0 };
// Raycast the mesh straight down at world (x,y); return the surface ellipsoidal
// height in metres, or null if no tile is loaded there yet. Takes the nearest
// (top) hit — the photogrammetry mesh is effectively a single 2.5D surface (its
// skirts/back-faces make "lowest hit" grab bogus points), so the top surface is
// the right height; over dense tree columns it reads canopy, but those are
// off-fairway and the grid neighbours keep the playable corridor accurate.
function meshHeightAt(x, y) {
  if (!tiles || !tiles.group) return null;
  const ll = worldToLngLat(x, y);
  sceneAt(ll[0], ll[1], 0, _mA);
  sceneAt(ll[0], ll[1], 1, _mB);
  _mUp.copy(_mB).sub(_mA).normalize();           // ellipsoid up at this column
  _mOrigin.copy(_mA).addScaledVector(_mUp, 6000); // 6km above the surface
  _mDown.copy(_mUp).multiplyScalar(-1);
  _hRay.set(_mOrigin, _mDown);
  _hRay.far = 12000;
  const hits = _hRay.intersectObject(tiles.group, true);
  if (!hits.length) return null;
  _hInv.copy(tiles.group.matrixWorld).invert();
  const ecef = hits[0].point.clone().applyMatrix4(_hInv);
  WGS84_ELLIPSOID.getPositionToCartographic(ecef, _hCart);
  return _hCart.height;
}
// Height-offset field (metres, = meshHeight − terrainZ*M) sampled on a grid over
// the whole hole world, so overlays lock to the real mesh everywhere — not just
// near two anchors (a linear ball→pin lerp still drifted ~26yd mid-hole where the
// real terrain isn't linear). Cells refresh round-robin (~24/frame) so cost stays
// tiny and the field fills in / self-heals as tiles stream. Terrain is static, so
// a cell keeps its last good value; only null-until-loaded cells read 0.
const GRID_SPACING = 14;   // world units between samples (~42 yд)
let _grid = null;          // { x0,y0,dx,nx,ny, off:Float32Array, ok:Uint8Array }
let _gridCursor = 0;
function ensureGrid() {
  const g = gb(); if (!g) return null;
  const W = g.getWorld();
  const w = (W && W.w) || 200, h = (W && W.h) || 200;
  const nx = Math.max(2, Math.ceil(w / GRID_SPACING) + 1);
  const ny = Math.max(2, Math.ceil(h / GRID_SPACING) + 1);
  if (_grid && _grid.nx === nx && _grid.ny === ny) return _grid;
  _grid = { x0: 0, y0: 0, dx: w / (nx - 1), dy: h / (ny - 1), nx, ny,
    off: new Float32Array(nx * ny), ok: new Uint8Array(nx * ny) };
  _gridCursor = 0;
  return _grid;
}
function refreshGridBatch(n) {
  const gr = ensureGrid(); if (!gr) return;
  const g = gb(), m = M(), tz = g.terrainZ, total = gr.nx * gr.ny;
  for (let k = 0; k < n; k++) {
    const i = _gridCursor % total; _gridCursor++;
    const gx = i % gr.nx, gy = (i / gr.nx) | 0;
    const wx = gr.x0 + gx * gr.dx, wy = gr.y0 + gy * gr.dy;
    const mh = meshHeightAt(wx, wy);
    if (mh != null) { gr.off[i] = mh - (tz ? tz(wx, wy) : 0) * m; gr.ok[i] = 1; }
  }
  // Running mean of filled cells — the fallback for corners not yet sampled.
  let sum = 0, cnt = 0;
  for (let i = 0; i < total; i++) if (gr.ok[i]) { sum += gr.off[i]; cnt++; }
  if (cnt) _gridMean = sum / cnt;
}
// Bilinear height correction (metres) at world (x,y) from the grid; unfilled
// corners fall back to the field's running mean so early frames aren't at 0.
let _gridMean = 0;
function offsetAt(x, y) {
  const gr = _grid; if (!gr) return 0;
  const fx = (x - gr.x0) / gr.dx, fy = (y - gr.y0) / gr.dy;
  const ix = Math.min(gr.nx - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(gr.ny - 2, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
  const at = (cx, cy) => { const i = cy * gr.nx + cx; return gr.ok[i] ? gr.off[i] : _gridMean; };
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// ---- projection bridge -----------------------------------------------------
// World (game coords, zUnits = height above ground in WORLD units) → screen CSS
// px through the live three camera. Ground height is anchored to the REAL mesh
// via offsetAt() (see above) so overlays lock onto the photoreal ground, not the
// game DEM's relative elevation. Elevated points (ball arc) ride above it.
const _p = new THREE.Vector3();
function project(x, y, zUnits, out) {
  out = out || {};
  if (!ready || !tiles || !camera) { out.x = 0; out.y = 0; out.inFront = false; return out; }
  const ll = worldToLngLat(x, y);
  sceneAt(ll[0], ll[1], (zUnits || 0) * M() + offsetAt(x, y), _p);
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
// DETERMINISTIC framing (no feedback loop). Look-at O = the flat view's screen-
// centre world point — exactly what the 2D game centres on — so the 3D camera
// tracks the known-good flat framing (ball near the bottom, pin up) in every
// state and the ball can never fall behind the camera. Distance D comes straight
// from view.scale. Bearing from cam.angle, pitch from the tilt slider. Position
// is solved in a local ENU basis (finite differences of sceneAt at O).
// (Replaced a ball↔reach convergence that railed on long holes and deadlocked
// once the ball went behind the camera — see the camera audit.)
const _O = new THREE.Vector3();
const _up = new THREE.Vector3();
const _north = new THREE.Vector3();
const _east = new THREE.Vector3();
const _tmp = new THREE.Vector3();
let _hold = null;    // {Ox,Oy,D} target captured at rest, reused during flight (no follow)
let _camEase = null; // {Ox,Oy,D} EASED toward target each frame → glide between shots
let _camEaseT = 0;
function setCamera() {
  if (!ready || !tiles || !camera) return;
  const g = gb(), view = g.getView(), cam = g.getCamera(), m = M();
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const scale = view.scale || cam.scale || 8;
  const geo = g.geoAffine();
  const toLL = (x, y) => [geo[0] * x + geo[1] * y + geo[2], geo[3] * x + geo[4] * y + geo[5]];

  // TARGET framing. Look-at O = ball nudged a fixed fraction toward the shot's
  // landing (reach); D frames the ball→reach SHOT. The reach span is CAPPED
  // (MAX_FRAME_UNITS) so long clubs (driver) frame like a mid-iron instead of
  // zooming way out. In flight the target is FROZEN (_hold) so the camera holds
  // while the ball flies through; cleared on hole change (_lastHole in render).
  const A = g.frameAnchors ? g.frameAnchors() : null;
  const OY_BIAS = 0.45;         // look-at = ball + this·(capped reach−ball)
  const FRAME_K = 2.0;          // capped shot span × this → camera distance
  const MIN_SHOT_M = 55;        // floor so the green (reach≈ball) still frames sensibly
  const MAX_FRAME_UNITS = 60;   // ~180yд: cap the framed span so driver isn't too wide
  let tOx, tOy, tD;
  if (A && A.moving && _hold) {
    ({ Ox: tOx, Oy: tOy, D: tD } = _hold);   // FROZEN target while the ball is in flight
  } else {
    if (A) {
      const rd = Math.hypot(A.rx - A.bx, A.ry - A.by);
      const fx = rd > 1e-3 ? Math.min(rd, MAX_FRAME_UNITS) / rd : 0;  // cap the framed span
      tOx = A.bx + OY_BIAS * fx * (A.rx - A.bx);
      tOy = A.by + OY_BIAS * fx * (A.ry - A.by);
      tD = Math.max(Math.min(rd, MAX_FRAME_UNITS) * m, MIN_SHOT_M) * FRAME_K;
    } else {
      const det = view.a * view.e - view.b * view.d || 1;
      const sx0 = W / 2 - view.c, sy0 = H / 2 - view.f;
      tOx = (view.e * sx0 - view.b * sy0) / det;
      tOy = (-view.d * sx0 + view.a * sy0) / det;
      tD = (m * dpr / scale) * H * APPLE_CAM_K;   // flat-zoom fallback (no anchors)
    }
    if (!A || !A.moving) _hold = { Ox: tOx, Oy: tOy, D: tD };  // capture at-rest target
  }
  tD = Math.max(20, Math.min(6000, tD));

  // Ease the framing toward the target so the camera GLIDES between shots (the
  // flat camera eases too, but our O was raw-ball → snapped). Time-based factor,
  // fps-independent, mirrors updateCamera. First frame / hole change snaps.
  const now = performance.now();
  const dt = _camEaseT ? Math.min(now - _camEaseT, 100) : 16.7;
  _camEaseT = now;
  const es = 1 - Math.pow(0.86, dt / 16.7);   // ~0.14/frame at 60fps
  if (!_camEase) _camEase = { Ox: tOx, Oy: tOy, D: tD };
  else {
    _camEase.Ox += (tOx - _camEase.Ox) * es;
    _camEase.Oy += (tOy - _camEase.Oy) * es;
    _camEase.D  += (tD  - _camEase.D)  * es;
  }
  const Ox = _camEase.Ox, Oy = _camEase.Oy, D = _camEase.D;

  // O in scene + local ENU basis (finite differences of sceneAt around O).
  // Height MUST include offsetAt() — same mesh-anchoring project() uses — so the
  // look-at sits on the real photoreal ground, not the game DEM (~40m off). Skip
  // it and the close putting camera aims tens of metres off and throws the ball
  // off-screen.
  const [Olon, Olat] = toLL(Ox, Oy);
  const groundM = (g.terrainZ ? g.terrainZ(Ox, Oy) : 0) * m + offsetAt(Ox, Oy);
  sceneAt(Olon, Olat, groundM, _O);
  sceneAt(Olon, Olat, groundM + 1, _up).sub(_O).normalize();          // ellipsoid up
  sceneAt(Olon, Olat + 1e-5, groundM, _north).sub(_O).normalize();    // +lat = north
  sceneAt(Olon + 1e-5, Olat, groundM, _east).sub(_O).normalize();     // +lon = east

  // Screen-up world dir (toward reach) → scene horizontal. geo affine gives
  // x≈east, y≈south, so scene horiz = east·dx − north·dy. Use the EASED cam.angle
  // (not the target cam.tAngle) so turning the aim rotates smoothly, not snaps.
  const a = cam.angle != null ? cam.angle : cam.tAngle;
  const dirX = -Math.sin(a), dirY = -Math.cos(a);
  _tmp.copy(_east).multiplyScalar(dirX).addScaledVector(_north, -dirY).normalize(); // fwdHoriz

  // pitch P (Mapbox sense): 0 = camera straight above O, 90 = level behind O.
  const P = Math.max(0, Math.min(85, pitchDeg)) * DEG;
  camera.position.copy(_O)
    .addScaledVector(_up, D * Math.cos(P))
    .addScaledVector(_tmp, -D * Math.sin(P));
  // Up vector blended by pitch so it NEVER parallels the view direction (which
  // caused a 90° gimbal flip at full-2D/top-down): at P=0 up = fwdHoriz (screen-
  // up = play direction, matches the flat view heading), at high pitch → ellipsoid
  // up (level horizon).
  camera.up.copy(_tmp).multiplyScalar(Math.cos(P)).addScaledVector(_up, Math.sin(P)).normalize();
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
    // A burst of load-errors before any geometry = Google unreachable → fall back.
    if (!ready && ++_errCount >= FAIL_ERRS) _failed = true;
  });
}

function enter(opts) {
  activeCourseId = opts && opts.courseId;
  if (!window.GOOGLE_TILES_TOKEN) { try { console.warn("[gtiles3d] no GOOGLE_TILES_TOKEN"); } catch (e) {} return; }
  // Known-offline up front → don't even try; game.js keeps the 2D aerial.
  if (typeof navigator !== "undefined" && navigator.onLine === false) { _failed = true; return; }
  _failed = false; _errCount = 0; _enterAt = performance.now();
  buildRenderer();
  container.style.display = "block";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  if (tiles) { return; } // resident across re-enters
  buildTiles();
}

function leave() {
  ready = false;
  // NOTE: do NOT reset _failed here. leave() fires when gtilesGroundActive() flips
  // false — which, on a failure, is BECAUSE _failed is true. Clearing it would
  // re-enable the gate and re-enter next frame (flip-flop). _failed is sticky for
  // the session; enter() clears it on a fresh course (a genuine retry).
  if (container) container.style.display = "none";
  document.documentElement.style.background = "";
  document.body.style.background = "";
}

// Called each frame from game.js loop(): stream + render tiles, drive the camera.
// Order matters: refresh the mesh + group matrix FIRST, then sample the mesh-
// height anchors, THEN setCamera() — its framing convergence calls project(),
// which needs this frame's height offset ready.
function render() {
  if (!tiles || !camera || !renderer) return;
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();
  tiles.group.updateMatrixWorld(true);
  // Ready once the root tileset has produced geometry near the anchor.
  if (!ready) {
    const s = new THREE.Sphere();
    ready = tiles.getBoundingSphere(s) && s.radius > 0;
    // No geometry within the timeout (weak/no signal) → fall back to 2D aerial.
    if (!ready && _enterAt && performance.now() - _enterAt > FAIL_TIMEOUT_MS) _failed = true;
  }
  if (ready) {
    // Reset the height field + flight-hold + eased camera on a hole change (per-
    // hole WORLD). Nulling _camEase makes the new hole SNAP into frame (no glide
    // across the whole course from the old hole).
    const H = gb() && gb().getHole();
    if (H !== _lastHole) { _grid = null; _hold = null; _camEase = null; _lastHole = H; }
    refreshGridBatch(24);
  }
  setCamera();
  renderer.render(scene, camera);
}
let _lastHole = null;

function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
}

function setPitch(deg) { pitchDeg = Math.max(0, Math.min(85, deg)); }
function isReady() { return ready; }
function failed() { return _failed; }  // Google unavailable → game.js uses 2D aerial

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
  enter, leave, render, resize, setPitch, project, unproject, isReady, failed,
  getAttributions, worldToLngLat, lngLatToWorld, debug,
};
