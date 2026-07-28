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
let ready = false;    // real rendered geometry (gates the game's overlays)
let _placed = false;  // tileset bounds known (enough to aim the camera)
let activeCourseId = null;
let pitchDeg = 55;      // camera pitch (0 = top-down, 90 = horizon)
// Offline / weak-signal fallback: Google tiles can't be cached or used offline
// (ToS). When they can't load, failed() flips true and game.js drops back to the
// 2D baked aerial instead of showing a blank ground.
let _failed = false;
let _errCount = 0;
let _enterAt = 0;
const _evt = { loadModel: 0, disposeModel: 0, loadTileSet: 0, loadEnd: 0, err: 0 };
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
  // Of all surfaces pierced (canopy blobs first, turf below), keep the hit whose
  // height lands closest to the EXPECTED ground (DEM + a LOCAL offset). Top-hit
  // alone parked the ball on tree canopy at treed lies; where photogrammetry
  // fuses canopy to ground, the canopy is the only hit and still wins.
  //
  // Expected offset = LOCAL cell, CLAMPED to ±15m of the global mean. Local
  // alone is self-poisoning at the coast: Google's mesh includes the SEABED
  // (~50m below the water line at Pebble), so cells over water latch seabed
  // offsets (−90m vs land −35m), and an unclamped local reference then makes
  // every neighbouring sample pick the seabed hit to match — the poison
  // spreads. The true local variation of (mesh − DEM) is small (geoid + DEM
  // error, ±10m); anything further from the global mean is contamination.
  const g = gb();
  const lo = _localOff(x, y);
  const loc = Math.max(_gridMean - 15, Math.min(_gridMean + 15, lo));
  const expected = (g && g.terrainZ ? g.terrainZ(x, y) : 0) * M() + loc;
  let best = null, bestErr = Infinity;
  for (const h of hits) {
    const ecef = h.point.clone().applyMatrix4(_hInv);
    WGS84_ELLIPSOID.getPositionToCartographic(ecef, _hCart);
    const err = Math.abs(_hCart.height - expected);
    if (err < bestErr) { bestErr = err; best = _hCart.height; }
  }
  return best;
}
// Height-offset field (metres, = meshHeight − terrainZ*M) sampled on a grid over
// the whole hole world, so overlays lock to the real mesh everywhere — not just
// near two anchors (a linear ball→pin lerp still drifted ~26yd mid-hole where the
// real terrain isn't linear). Cells refresh round-robin (~24/frame) so cost stays
// tiny and the field fills in / self-heals as tiles stream. Terrain is static, so
// a cell keeps its last good value; only null-until-loaded cells read 0.
// Mesh-vs-DEM offset is the geoid separation plus terrain error — tens of
// metres. Anything beyond this is a coarse-LOD artefact, not real ground.
const MAX_ABS_OFFSET_M = 120;
// Hysteresis on every stored height/offset: re-sampling a static mesh returns
// cm-different values each pass, and anything that consumes those (green sheet,
// ball/pin anchors, the camera's own look-at height) visibly pulsed on a static
// camera. Corrections smaller than this are absorbed; real LOD fixes (metres)
// still pass through.
const OFF_DEADBAND_M = 0.6;
const GRID_SPACING = 14;   // world units between samples (~42 yд)
let _grid = null;          // { x0,y0,dx,nx,ny, off:Float32Array, ok:Uint8Array }
let _gridCursor = 0;
// Nearest FILLED grid cell's offset (spiral out to radius 3 cells), falling back
// to the global mean. Feeds meshHeightAt's expected height — must be LOCAL so a
// coastal hole's ocean cells can't drag the expectation off a cliff top.
function _localOff(x, y) {
  const gr = _grid;
  if (!gr) return _gridMean;
  const cx = Math.round((x - gr.x0) / gr.dx), cy = Math.round((y - gr.y0) / gr.dy);
  for (let r = 0; r <= 3; r++) {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;   // ring only
      const gx = cx + i, gy = cy + j;
      if (gx < 0 || gy < 0 || gx >= gr.nx || gy >= gr.ny) continue;
      const idx = gy * gr.nx + gx;
      if (gr.ok[idx]) return gr.off[idx];
    }
  }
  return _gridMean;
}
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
    if (mh != null) {
      const off = mh - (tz ? tz(wx, wy) : 0) * m;
      // SANITY BAND — do not let a bad sample latch. Early on, the only geometry
      // loaded can be a continent-scale low-LOD tile whose surface is hundreds of
      // metres off. Storing that offset drove the camera ~270m UNDERGROUND, so no
      // tile was ever visible, the group emptied, every later raycast returned
      // null, and the stale cell values could never be corrected: a permanent
      // blank-ground deadlock (and the source of the intermittent white screen —
      // it's a race on whether a coarse tile is sampled before a real one).
      // The genuine offset here is the geoid separation, tens of metres.
      // Dead-band refills: cells are resampled round-robin forever (so they
      // self-heal as LOD refines), but each pass returns cm-different heights —
      // and the camera's look-at height reads this field, so the churn made the
      // WHOLE FRAME pulse (worst at top-down). Only overwrite on real change.
      if (Math.abs(off) <= MAX_ABS_OFFSET_M &&
          (!gr.ok[i] || Math.abs(off - gr.off[i]) > OFF_DEADBAND_M)) {
        gr.off[i] = off; gr.ok[i] = 1;
      }
    }
  }
  // Running MEDIAN of filled cells — the fallback for unfilled corners and the
  // trust reference for meshHeightAt's expected-height clamp. Median, not mean:
  // on coastal holes a minority of cells latch SEABED offsets (~55m below the
  // land offsets) and a mean drifts toward them; the land majority owns the
  // median. Dead-banded like every stored value (drift = whole-frame pulse).
  const filled = [];
  for (let i = 0; i < total; i++) if (gr.ok[i]) filled.push(gr.off[i]);
  if (filled.length) {
    filled.sort((a, b) => a - b);
    const med = filled[Math.floor(filled.length / 2)];
    if (Math.abs(med - _gridMean) > OFF_DEADBAND_M) _gridMean = med;
  }
}
// ---- precision anchors over the coarse grid ---------------------------------
// The 14u grid + bilinear leaves ~1-2m height error, which at a 55° camera slides
// overlays a few YARDS along the ground — measured 0.6u at the pin / up to 0.5u
// at green edges (the "green floating off the mesh"), ~1u at the tee ball (the
// "ball moves when the camera moves" parallax). Two upgrades:
//
//  _ballOff / _pinOff — EXACT column raycasts refreshed every frame (2 rays,
//    cheap). offsetAt uses the exact ball offset within BALL_EXACT_R of the ball
//    (blended over the last unit so there's no step in the fairway tint).
//  _greenOffs — ONE RIGID offset per green: sample the green's poly vertices +
//    centroid over frames, and once ≥12 samples land take the MEDIAN (robust to
//    canopy strikes from the trees ringing greens — meshHeightAt reads the top
//    hit). The whole tint/contour/relief patch then sits as a single sheet ON
//    the mesh instead of per-cell swimming. Until settled: coarse grid.
const BALL_EXACT_R = 4;    // world units of exact-ball influence
let _ballOff = null;       // { x, y, off } exact ball column (this frame)
let _ballRejN = 0;         // consecutive temporal-guard rejections (self-heal cap)
let _pinOff = null;        // { x, y, off } exact pin column
let _greenOffs = new Map();// green object -> { samples: [], off: number|null, cursor }
function _greenRec(g) {
  let r = _greenOffs.get(g);
  if (!r) { r = { samples: [], off: null, disp: null, cursor: 0 }; _greenOffs.set(g, r); }
  return r;
}
// A green is "in play" when the ball or pin sits inside its bbox (+margin) —
// mirrors game.js greensInPlay without needing pointInPoly across the bridge.
function _greenBBox(g) {
  if (!g._bbox) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of g.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    g._bbox = { x0, y0, x1, y1 };
  }
  return g._bbox;
}
function _inBBox(x, y, bb, m) { return x >= bb.x0 - m && x <= bb.x1 + m && y >= bb.y0 - m && y <= bb.y1 + m; }
function refreshPrecisionAnchors() {
  const g = gb(); if (!g) return;
  const nowA = performance.now();
  const dtA = _anchT ? Math.min(nowA - _anchT, 100) : 16.7;
  _anchT = nowA;
  const m = M(), tz = g.terrainZ;
  const S = g.getState(), H = g.getHole();
  const exact = (x, y) => {
    const mh = meshHeightAt(x, y);
    if (mh == null) return null;
    const off = mh - (tz ? tz(x, y) : 0) * m;
    return Math.abs(off) <= MAX_ABS_OFFSET_M ? { x, y, off } : null;
  };
  // Same dead-band for the per-frame ball/pin raycasts: the mesh height under a
  // FIXED column still varies a few cm frame-to-frame as neighbouring tiles
  // stream (measured: pin pixel jittered 3.4px on a static camera). Replace the
  // stored anchor only when the column moved or the height genuinely changed.
  const keep = (prev, next) =>
    next == null ? prev
    : (prev && prev.x === next.x && prev.y === next.y &&
       Math.abs(next.off - prev.off) <= OFF_DEADBAND_M) ? prev : next;
  if (S && S.ball) {
    let nb = exact(S.ball.x, S.ball.y);
    // Temporal coherence at cliff edges: a rolling/settled ball's column height
    // cannot step by a cliff face between frames. If the ball barely moved but
    // the new offset jumps > 8m (edge raycast caught the water plane / cliff
    // bottom), reject the sample — this is what put the ball out over the ocean.
    // BUT a persistent disagreement means the stored anchor is the wrong one
    // (e.g. it was taken against the coarse motion-LOD mesh): after ~30
    // consecutive rejections, accept the new value so the anchor can self-heal.
    if (nb && _ballOff &&
        Math.hypot(S.ball.x - _ballOff.x, S.ball.y - _ballOff.y) < 5 &&
        Math.abs(nb.off - _ballOff.off) > 8) {
      if (++_ballRejN < 30) nb = null; else _ballRejN = 0;
    } else _ballRejN = 0;
    _ballOff = keep(_ballOff, nb);
  }
  if (H && H.holePos) _pinOff = keep(_pinOff, exact(H.holePos.x, H.holePos.y));
  // Per-green rigid offsets: a couple of samples per frame for in-play greens.
  const greens = (H && H._greens) || [];
  for (const gr of greens) {
    const bb = _greenBBox(gr);
    const inPlay = (S && S.ball && _inBBox(S.ball.x, S.ball.y, bb, 12)) ||
                   (H.holePos && _inBBox(H.holePos.x, H.holePos.y, bb, 12));
    if (!inPlay) continue;
    const rec = _greenRec(gr);
    // Rolling, strided sampling — NEVER settles permanently. Early samples land
    // on coarse far-LOD (and sometimes canopy); locking their median in shifted
    // the green ~10u. Stride 7 spreads samples around the poly instead of one
    // contiguous (possibly all-canopy) arc; the window keeps only the freshest
    // 40 so the median self-heals as the mesh refines under the camera.
    // Reference height for sample rejection: greens can OVERHANG water (Pebble
    // h7 hangs over the Pacific) — boundary-vertex raycasts strike the ocean
    // 40m+ below and can capture the MEDIAN, sliding the whole overlay down the
    // cliff. The pin is always cut into the green's turf, so when this is the
    // pin's green its exact column is ground truth; otherwise the local grid.
    const ccx = (bb.x0 + bb.x1) / 2, ccy = (bb.y0 + bb.y1) / 2;
    const ref = (H.holePos && _inBBox(H.holePos.x, H.holePos.y, bb, 0) && _pinOff)
      ? _pinOff.off : _localOff(ccx, ccy);
    for (let k = 0; k < 2; k++) {                        // 2 samples/frame/green
      const n = gr.poly.length;
      const idx = (rec.cursor * 7) % (n + 1);
      let p = idx === n ? { x: ccx, y: ccy } : gr.poly[idx];
      // Inset boundary verts 15% toward the centroid — edge columns at an
      // overhanging green sit past the turf, over the cliff face.
      if (idx !== n) p = { x: ccx + (p.x - ccx) * 0.85, y: ccy + (p.y - ccy) * 0.85 };
      rec.cursor++;
      const e = exact(p.x, p.y);
      // Reject water/cliff-face strikes outright (> 6m from the reference).
      if (e && Math.abs(e.off - ref) <= 6) {
        rec.samples.push(e.off);
        if (rec.samples.length > 40) rec.samples.shift();
      }
    }
    if (rec.samples.length >= 12) {
      const s = rec.samples.slice().sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)];           // median beats canopy strikes
      // First settle: EARLY (within the hole's first seconds) adopt the median
      // directly — it lands inside the overlay's fade-in, invisible. LATE
      // (slow tile streaming; overlay already fully faded in) an instant adopt
      // stepped the sheet ~45px — start from the rendered base and latch the
      // fast settle-swoosh instead (~1s, then locked).
      if (rec.off == null && rec.disp == null) {
        if (performance.now() - _holeLoadT < 6000) rec.disp = med;
        else {
          const bb2 = _greenBBox(gr);
          rec.disp = _offsetBase((bb2.x0 + bb2.x1) / 2, (bb2.y0 + bb2.y1) / 2);
          rec._settling = true;
        }
      }
      rec.off = med;   // live target — the rolling window already smooths it
    }
    // CONTINUOUS ease toward the live median, frozen only inside a small noise
    // floor. The previous scheme dead-banded the TARGET (0.6m quanta) and eased
    // each step over 300ms — on coastal holes the early heal walks the median
    // several metres in alternating steps, so the whole frame visibly slid
    // down-up-up-up: the reported "hole 4 is bouncing". One slow continuous
    // glide replaces the step train; the 0.25m freeze keeps the parked frame
    // pixel-static (the original anti-pulse requirement).
    if (rec.off != null) {
      if (rec.disp == null) rec.disp = rec.off;
      else {
        const err = rec.off - rec.disp;
        // PARKED CAMERA = FROZEN SHEET (playtest: "no drifting after the
        // camera moves over the ball"). Corrections flow only while the
        // camera itself moves (a glide masks them completely) — except a
        // SEVERE misplacement (>3m, the boot heal) which latches one
        // settle-glide and then locks for good at 0.5m.
        if (Math.abs(err) > 3) rec._settling = true;
        const track = !_camParked || rec._settling;
        const floor = _camParked ? 0.5 : 0.25;
        if (rec._settling && Math.abs(err) <= 0.5) rec._settling = false;
        if (track && Math.abs(err) > floor) {
          if (rec._settling) {
            // severe settle: UNCAPPED 400ms-tc ease — one fast swoosh that
            // finishes in ~1s no matter how big the correction (a rate cap
            // turned a 50m boot error into a 13s crawl)
            rec.disp += err * (1 - Math.exp(-dtA / 400));
          } else {
            // riding camera motion: slew-capped gentle correction (0.8 m/s)
            const step = err * (1 - Math.exp(-dtA / 450));
            const cap = 0.8 * dtA / 1000;
            rec.disp += Math.max(-cap, Math.min(cap, step));
          }
        }
      }
    }
  }
}
let _anchT = 0;
// Bilinear height correction (metres) at world (x,y): exact ball column first,
// then the containing settled green's rigid offset, then the coarse grid (with
// unfilled corners falling back to the field's running mean).
let _gridMean = 0;
function offsetAt(x, y) {
  // SETTLED GREEN FIRST — before the ball-exact anchor. When the ball is on the
  // green, letting the ball anchor win carved a 4u bubble of different height
  // around it, warping the sheet locally — contours/tint visibly reshaped as
  // the ball moved across the green. One rigid offset for everything inside the
  // green bbox (contours, tint, relief, cup, and the ball itself); the ball
  // anchor only glues OFF-green lies (fairway/tee), where it's needed.
  for (const [gr, rec] of _greenOffs) {
    if (rec.disp == null) continue;
    const bb = _greenBBox(gr);
    if (!_inBBox(x, y, bb, 2)) continue;
    // FEATHER the bbox edge: the hard rectangle stepped the sheet — and the
    // camera look-at height, which also queries offsetAt() — the exact frame a
    // point crossed it (measured 30–65px whole-frame jump at landing). Blend
    // rigid-green ↔ grid base over the outer 3u so crossings are continuous.
    const inD = Math.min(x - (bb.x0 - 2), (bb.x1 + 2) - x, y - (bb.y0 - 2), (bb.y1 + 2) - y);
    if (inD >= 3) return rec.disp;
    const t = inD / 3;
    return rec.disp * t + _offsetBase(x, y) * (1 - t);
  }
  const bo = _fro ? _fro.ball : _ballOff;   // parked → park-edge snapshot
  if (bo) {
    const d = Math.hypot(x - bo.x, y - bo.y);
    if (d < BALL_EXACT_R) {
      const base = _offsetBase(x, y);
      const t = d <= BALL_EXACT_R - 1 ? 1 : BALL_EXACT_R - d;  // blend the last unit
      return bo.off * t + base * (1 - t);
    }
  }
  // Pin exact = pre-settle fallback only (the rigid green wins once settled).
  const po = _fro ? _fro.pin : _pinOff;
  if (po && Math.hypot(x - po.x, y - po.y) < 3) return po.off;
  return _offsetBase(x, y);
}
function _offsetBase(x, y) {
  const gr = _grid; if (!gr) return 0;
  const fx = (x - gr.x0) / gr.dx, fy = (y - gr.y0) / gr.dy;
  const ix = Math.min(gr.nx - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(gr.ny - 2, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
  // While parked, sample the park-edge snapshot — live cell refills keep
  // healing underneath but must not move rendered pixels.
  const ok = _fro ? _fro.ok : gr.ok, off = _fro ? _fro.off : gr.off;
  const mean = _fro ? _fro.mean : _gridMean;
  const at = (cx, cy) => { const i = cy * gr.nx + cx; return ok[i] ? off[i] : mean; };
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

// Metres from the live camera to world point (x, y, zUnits above ground).
// Same world→scene path as project() (geo affine → ellipsoid → mesh-anchored
// height → reoriented scene), so it's consistent with what's rendered. The
// camera's pointing angle is already folded into its POSITION — setCamera
// places it back along the view direction — and at the fixed 30° FOV the
// on-screen size of a ground object is purely ∝ 1/this distance. That's what
// drives the perspective ball radius (game.js ballDrawRadius).
const _dp = new THREE.Vector3();
function distanceTo(x, y, zUnits) {
  if (!_placed || !tiles || !camera) return null;
  const ll = worldToLngLat(x, y);
  sceneAt(ll[0], ll[1], (zUnits || 0) * M() + offsetAt(x, y), _dp);
  return camera.position.distanceTo(_dp);
}

// Screen pixels per metre of ground AT a specific world point — the local
// perspective scale. This is the one sizing law for every world-anchored mark
// (ball, cup, flag, tee markers): real size × local scale × small exaggeration.
// The game's ws() samples ONE scale at the ball and applies it everywhere; under
// a perspective camera that made the cup's size depend on where the BALL was.
function pxPerMeterAt(x, y, zUnits) {
  const d = distanceTo(x, y, zUnits);
  if (!d) return null;
  return window.innerHeight / (2 * d * Math.tan(15 * DEG));  // 30° vertical FOV
}

// Vertical squash for circles lying ON the ground (cup, shadows) under the
// pitched camera: pitch 0 = top-down = true circle (1), pitch 85 ≈ horizon =
// near-flat. The flat game used view.tilt for this, but gtiles pins tilt to 1,
// so ground circles were drawing as perfect circles under a 55° camera.
function groundSquash() { return Math.cos(pitchDeg * DEG); }

// Terrain occlusion test: is the mesh between the camera and this world point?
// The gameplay canvas has no depth buffer against the WebGL tiles, so a ball
// behind a cliff lip otherwise paints full-strength over the ocean beyond it.
// One ray per query — game.js asks about the ball and the pin, ≤2/frame.
const _oRay = new THREE.Raycaster();
const _oP = new THREE.Vector3();
const _oDir = new THREE.Vector3();
function occludedAt(x, y, zUnits) {
  if (!_placed || !tiles || !camera) return false;
  // Only trust the FULL-DETAIL mesh: while the camera glides, motion-coarse LOD
  // (errorTarget 12) swaps in low-poly blobs whose surfaces sit metres off — an
  // occlusion ray against those flickers false "behind terrain" verdicts.
  if (tiles.errorTarget > 6) return false;
  const ll = worldToLngLat(x, y);
  sceneAt(ll[0], ll[1], (zUnits || 0) * M() + offsetAt(x, y), _oP);
  _oDir.copy(_oP).sub(camera.position);
  const d = _oDir.length();
  if (d < 1e-3) return false;
  _oDir.multiplyScalar(1 / d);
  _oRay.set(camera.position, _oDir);
  _oRay.far = Math.max(0, d - 3);   // ignore hits within 3m of the point (its own ground)
  return _oRay.intersectObject(tiles.group, true).length > 0;
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
let _groundMEase = null; // slew-capped look-at ground height (anti frame-bounce)
let _lastOxy = null;     // last look-at (for the motion-scaled height cap)
let _camParked = false;  // eased camera exactly at target, ball at rest
let _gSettling = false;  // severe-error settle-glide latch (boot heal)
let _fro = null;         // park-edge field snapshot (rendered while parked)
let _holeLoadT = 0;      // hole-change timestamp (early-settle window)
let _introPending = false; // set by enter(): arm the opening pull-back intro
let _introSeed = false;    // consume on the first frame with a real target framing
let _introUntil = 0;       // slow-glide window end (intro active while now < this)
let _aimUx = 0, _aimUy = -1; // last solved aim unit vector (intro pull-back dir)
const INTRO_ZOOM = 2.0;    // opening framing distance × the tee framing
const INTRO_MS = 3000;     // cinematic glide duration
let _camEaseT = 0;
function setCamera() {
  if (!_placed || !tiles || !camera) return;
  const g = gb(), view = g.getView(), cam = g.getCamera(), m = M();
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const scale = view.scale || cam.scale || 8;
  const geo = g.geoAffine();
  const toLL = (x, y) => [geo[0] * x + geo[1] * y + geo[2], geo[3] * x + geo[4] * y + geo[5]];

  // TARGET framing — exact two-anchor pinhole solve, same math as the flat
  // camera's frameClubReach (game.js): the ball pins at BALL_F of the USABLE
  // play area (viewport minus the HUD bands) and the shot's reach line at
  // REACH_F, solved at the LIVE pitch. Exact at every pitch by construction —
  // this replaces the FRAME_K/pf/bias empirical trio, which undershot the
  // forward span at low pitch (2D drives clipped the last ~50yd off the top
  // while the ball idled at 0.73) and overran the look-at on long putts (the
  // 40-62ft band pushed the ball past the bottom edge, snapping back at 62ft).
  // In flight the target is FROZEN (_hold); cleared on hole change (render).
  const A = g.frameAnchors ? g.frameAnchors() : null;
  const SPAN_MAX_U = 100;  // frame ≤ ~300yd of shot line — a full driver fits
  const SPAN_MIN_M = 14;   // tap-in floor: tight putt framing, ball + cup clear
  const REACH_F = 0.15, BALL_F = 0.85;  // anchor fractions of the play area
  let tOx, tOy, tD;
  if (A && A.moving && _hold) {
    ({ Ox: tOx, Oy: tOy, D: tD } = _hold);   // FROZEN target while the ball is in flight
  } else {
    if (A) {
      const rsv = g.hudReserve ? g.hudReserve() : { top: 0, bot: 0 };
      const availH = Math.max(120, H - rsv.top - rsv.bot);
      const uR = H / 2 - (rsv.top + REACH_F * availH);  // px above raw center
      const uB = H / 2 - (rsv.top + BALL_F * availH);   // negative = below center
      const f = (H / 2) / Math.tan(15 * DEG);           // fov 30° vertical
      const p = Math.max(0, Math.min(85, pitchDeg)) * DEG;
      const cp = Math.cos(p), sp = Math.sin(p);
      const rd = Math.hypot(A.rx - A.bx, A.ry - A.by);
      const ux = rd > 1e-6 ? (A.rx - A.bx) / rd : 0;
      const uy = rd > 1e-6 ? (A.ry - A.by) / rd : 0;
      const Rm = Math.max(Math.min(rd, SPAN_MAX_U) * m, SPAN_MIN_M);
      const AA = (u) => f * cp - u * sp;
      let D = Rm / (uR / AA(uR) - uB / AA(uB));
      if (!isFinite(D) || D <= 0) D = Rm * 3;           // degenerate-pitch guard
      const sR = uR * D / AA(uR);          // reach anchor, metres ahead of look-at
      tOx = A.bx + ux * (Rm - sR) / m;     // look-at = reach point − sR along aim
      tOy = A.by + uy * (Rm - sR) / m;
      tD = D;
      _aimUx = ux; _aimUy = uy;            // for the opening pull-back seed
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
  // Slow cinematic rate during the opening pull-back, normal glide otherwise.
  const es = 1 - Math.pow(now < _introUntil ? 0.965 : 0.86, dt / 16.7);
  if (_introSeed) {
    // OPENING PULL-BACK: start ~2× the tee framing's distance, pulled back
    // along the aim line, and glide in (slow ease below). Deliberately modest
    // — a whole-course overview was tried and Google served space-level
    // bathymetry for ~10s AND starved the tee's fine tiles (measured); at 2×
    // the mesh is already photoreal, so this reads cinematic and lands sharp.
    // Bonus: the offset field heals DURING the glide, where corrections are
    // invisible, so the camera parks on a converged, pixel-static frame.
    _introSeed = false;
    const back = (tD * INTRO_ZOOM - tD) / m;   // world units to pull back
    _camEase = { Ox: tOx - _aimUx * back, Oy: tOy - _aimUy * back, D: tD * INTRO_ZOOM };
    _introUntil = now + INTRO_MS;
  }
  if (!_camEase) _camEase = { Ox: tOx, Oy: tOy, D: tD };
  else {
    _camEase.Ox += (tOx - _camEase.Ox) * es;
    _camEase.Oy += (tOy - _camEase.Oy) * es;
    _camEase.D  += (tD  - _camEase.D)  * es;
    // SNAP the asymptotic tail (same trick as the flat camera's updateCamera):
    // without it the ease approaches the target forever at mm/frame, the camera
    // never goes exactly static, and everything derived from its position (ball
    // radius via distanceTo, tile LOD churn) micro-pulses indefinitely.
    const m2 = M();
    if (Math.hypot(tOx - _camEase.Ox, tOy - _camEase.Oy) * m2 < 0.3 &&
        Math.abs(tD - _camEase.D) < 0.3) {
      _camEase.Ox = tOx; _camEase.Oy = tOy; _camEase.D = tD;
    }
  }
  // OFF-SCREEN SAFEGUARD (hard invariant, both pitch modes): if the LIVE
  // ball's projection leaves the vertical band, widen the framing —
  // multiplicative, widen-only while the ball moves, eased back + snapped at
  // rest. Catches whatever the predicted framing missed (apex overshoot, wind,
  // cart-path deflections, unusual aspect ratios). Uses last frame's camera —
  // one frame of lag, converges in a few frames.
  const S = g.getState && g.getState();
  if (S && S.ball && ready) {
    const bp = project(S.ball.x, S.ball.y,
      (g.terrainZ ? g.terrainZ(S.ball.x, S.ball.y) : 0) + (S.ball.z || 0));
    const yf = bp.y / H;
    const off = !bp.inFront || yf < 0.05 || yf > 0.95 || bp.x < -40 || bp.x > W + 40;
    // fully LOST (not merely at the band edge) — happens at rest too, e.g. the
    // first seconds on a coastal hole while the height field heals under the
    // camera and the look-at sits metres off (measured h6 address yf 1.18)
    const lost = !bp.inFront || yf < 0.02 || yf > 0.98 || bp.x < -60 || bp.x > W + 60;
    // rest-lost must PERSIST a few frames before widening (a single boundary
    // graze would otherwise alternate widen/ease every frame — a shimmer),
    // and the moving band vs rest band differ so the two can't fight.
    // (suspended during the opening flyover — the ball is legitimately far
    // off-frame while the whole course is in view)
    _guardLostN = (lost && performance.now() > _introUntil) ? _guardLostN + 1 : 0;
    if ((off && S.moving) || _guardLostN >= 5) _guardK = Math.min(_guardK * 1.04, 2.5);
    else if (!S.moving && !lost) {
      _guardK += (1 - _guardK) * es;
      if (Math.abs(_guardK - 1) < 0.01) _guardK = 1;   // snap — no perpetual micro-pulse
    }
  }
  const Ox = _camEase.Ox, Oy = _camEase.Oy, D = _camEase.D * _guardK;

  // O in scene + local ENU basis (finite differences of sceneAt around O).
  // Height MUST include offsetAt() — same mesh-anchoring project() uses — so the
  // look-at sits on the real photoreal ground, not the game DEM (~40m off). Skip
  // it and the close putting camera aims tens of metres off and throws the ball
  // off-screen.
  const [Olon, Olat] = toLL(Ox, Oy);
  // Look-at ground height is the WHOLE-FRAME mover: any offset store stepping
  // under it (grid cell refill, pin anchor, green median) used to shift every
  // pixel at once — the "hole is bouncing" reports (h4, h13) during the early
  // heal. Slew-cap it (0.8 m/s, snap inside 5cm) so corrections read as a
  // gentle drift; the target still converges to the exact same value.
  // Camera parked = eased state exactly at target (the snap makes strict
  // equality reachable) and no ball in flight. Consumed by the height ease
  // below AND by refreshPrecisionAnchors' green-sheet freeze (runs after
  // setCamera each frame).
  _camParked = !!(_camEase && _camEase.Ox === tOx && _camEase.Oy === tOy &&
                  _camEase.D === tD && !(A && A.moving));
  // Park-edge SNAPSHOT of the offset field. The stores keep healing underneath
  // (frozen stores poisoned the sampler's reference height and stalled the
  // heal entirely) — but everything RENDERED reads the snapshot, so a parked
  // frame is pixel-static: no cell refill, anchor step, or feather blend can
  // drift the flag/cup/ball while the player lines up. Discarded on any
  // camera motion — the accumulated heal lands during the glide, invisibly.
  if (_camParked) {
    if (!_fro && _grid) _fro = {
      off: _grid.off.slice(), ok: _grid.ok.slice(), mean: _gridMean,
      ball: _ballOff ? Object.assign({}, _ballOff) : null,
      pin: _pinOff ? Object.assign({}, _pinOff) : null,
    };
  } else _fro = null;
  const gTarget = ((g.terrainZRender || g.terrainZ || (() => 0))(Ox, Oy)) * m + offsetAt(Ox, Oy);
  if (_groundMEase == null) _groundMEase = gTarget;
  else {
    const gd = gTarget - _groundMEase;
    // PARKED = FROZEN (no visible drift once the camera sits over the ball);
    // corrections ride camera motion instead. A severe boot-heal error (>3m)
    // latches one slew-capped settle-glide, then locks at 0.1m.
    if (Math.abs(gd) > 3) _gSettling = true;
    if (_gSettling && Math.abs(gd) <= 0.1) _gSettling = false;
    if (_gSettling) {
      // severe settle: fast uncapped ease (~1s at any error size), then lock
      _groundMEase += Math.abs(gd) < 0.1 ? gd : gd * (1 - Math.exp(-dt / 400));
    } else if (!_camParked) {
      // cap widens with the look-at's own horizontal motion (60% grade
      // allowance) so a glide onto an elevated green keeps height in step.
      const dOh = _lastOxy ? Math.hypot(Ox - _lastOxy.x, Oy - _lastOxy.y) * m : 0;
      const gCap = 0.8 * dt / 1000 + dOh * 0.6;
      _groundMEase += Math.abs(gd) < 0.05 ? gd : Math.max(-gCap, Math.min(gCap, gd));
    }
  }
  _lastOxy = { x: Ox, y: Oy };
  const groundM = _groundMEase;
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
  // Opaque scene background: an unstreamed-tile gap must read as dark ground
  // tone (tokens --green-900), never the page behind the canvas.
  scene.background = new THREE.Color(0x0e1f16);
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
  // Longer cross-fade (default 250ms) — softens the LOD pop that's severe on
  // coastal holes (Pebble h4) where big cliff/ocean tiles swap during the glide.
  tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 500 }));
  tiles.errorTarget = 6;
  tiles.lruCache.maxSize = 800;
  tiles.lruCache.minSize = 600;
  tiles.setCamera(camera);
  scene.add(tiles.group);
  tiles.addEventListener("load-model", () => { _evt.loadModel++; });
  tiles.addEventListener("dispose-model", () => { _evt.disposeModel++; });
  tiles.addEventListener("load-tile-set", () => { _evt.loadTileSet++; });
  tiles.addEventListener("tiles-load-end", () => { _evt.loadEnd++; });
  tiles.addEventListener("load-error", (e) => {
    _evt.err++;
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
  _failed = false; _errCount = 0; _enterAt = performance.now(); _placed = false; ready = false;
  _introPending = true;   // round entry → opening whole-course flyover to the tee
  buildRenderer();
  container.style.display = "block"; _hidden = false;
  // Dark backdrop, NOT transparent: with html+body cleared the UA default
  // (pure white) painted through every Google mesh gap — the "white ground at
  // the h7 tee". #0e1f16 = tokens --green-900, same tone base.css already uses.
  document.documentElement.style.background = "#0e1f16";
  document.body.style.background = "#0e1f16";
  if (tiles) { return; } // resident across re-enters
  buildTiles();
}

function leave() {
  ready = false; _placed = false;
  // NOTE: do NOT reset _failed here. leave() fires when gtilesGroundActive() flips
  // false — which, on a failure, is BECAUSE _failed is true. Clearing it would
  // re-enable the gate and re-enter next frame (flip-flop). _failed is sticky for
  // the session; enter() clears it on a fresh course (a genuine retry).
  if (container) { container.style.display = "none"; _hidden = true; }
  document.documentElement.style.background = "";
  document.body.style.background = "";
}

// Called each frame from game.js loop(): stream + render tiles, drive the camera.
// Order matters: refresh the mesh + group matrix FIRST, then sample the mesh-
// height anchors, THEN setCamera() — its framing convergence calls project(),
// which needs this frame's height offset ready.
function render() {
  if (!tiles || !camera || !renderer) return;
  // ORDER IS LOAD-BEARING: aim the camera BEFORE tiles.update().
  // update() runs the LOD traversal, and this library only adds a tile's scene
  // to tiles.group once traversal marks it visible — which is decided from the
  // camera. Updating first meant traversal always ran against an unpositioned
  // camera: 224 models parsed fine, none were ever marked visible, the group
  // stayed empty and the course rendered as a blank white ground. (The working
  // standalone viewer positions its camera first for exactly this reason.)
  setCamera();
  camera.updateMatrixWorld();
  // Motion-coarse LOD: while the camera is gliding, chasing fine refinements
  // just churns tiles that are about to be replaced again — the main source of
  // visible popping on long coastal glides (Pebble h4). Coarsen the target
  // while moving; restore full detail once parked (one settle refine).
  // _justResumed: first frame after setHidden(false) — the camera legitimately
  // jumped while render() was stopped (cine cut to the next framing); reading
  // that as "motion" coarsened to 12 then refined back = a pop right as the
  // player's eye returns to the course. Adopt the new position silently.
  const camMoved = !_justResumed && _lastCamPos
    ? camera.position.distanceTo(_lastCamPos) > 0.5 : false;
  _justResumed = false;
  (_lastCamPos = _lastCamPos || new THREE.Vector3()).copy(camera.position);
  // errorTarget RAMP, not a binary flip: the old 6↔12 switch made every tile
  // needing refinement swap in the SAME frame — the "refine wave a beat after
  // rest" pop. Coarsen instantly on motion; walk back 12→6 over ~0.8s parked so
  // refinements trickle in (each one individually faded by TilesFadePlugin).
  const nowR = performance.now();
  const dtR = _errTAt ? Math.min(nowR - _errTAt, 100) : 16.7;
  _errTAt = nowR;
  _errT = camMoved ? 12 : Math.max(6, _errT - 6 * dtR / 800);
  tiles.errorTarget = _errT;
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.update();
  tiles.group.updateMatrixWorld(true);
  // TWO readiness stages, deliberately separate:
  //
  //  _placed = the tileset has a bounding volume (root.json parsed). Enough to
  //     aim the camera — and we MUST aim it before anything can render, so this
  //     is what gates setCamera(). (Gating that on real geometry deadlocks: no
  //     camera → nothing in frustum → no geometry → never ready.)
  //  ready  = the renderer actually DREW triangles last frame, i.e. there is
  //     visible mesh. This is what the game gates its overlays on.
  //
  // The old code used _placed for both. Since the bounding volume exists the
  // moment root.json parses, `ready` went true even when tiles downloaded 200 OK
  // but never rendered — so the failure timeout never armed and the course sat
  // on a blank white ground with no fallback. That was the white-screen bug.
  if (!_placed) {
    const s = new THREE.Sphere();
    _placed = tiles.getBoundingSphere(s) && s.radius > 0;
  }
  if (!ready) ready = renderer.info.render.triangles > 0;   // previous frame's draw
  // No visible geometry within the timeout (weak/no signal, or tiles that load
  // but never render) → give up so game.js falls back to the 2D aerial.
  if (!ready && _enterAt && performance.now() - _enterAt > FAIL_TIMEOUT_MS) _failed = true;
  // Height field runs off _placed, NOT ready — deliberately. setCamera()'s
  // look-at height comes from offsetAt(), so gating the grid on rendered
  // geometry deadlocks: no grid → the camera aims ~40m off the real mesh →
  // nothing in frustum → no triangles → ready never flips → grid never fills.
  // meshHeightAt() just returns null for columns whose tiles haven't streamed
  // yet, so sampling early is harmless and self-heals as they arrive.
  if (_placed) {
    // Reset the height field + flight-hold + eased camera on a hole change (per-
    // hole WORLD). Nulling _camEase makes the new hole SNAP into frame (no glide
    // across the whole course from the old hole).
    const H = gb() && gb().getHole();
    if (H !== _lastHole) {
      _grid = null; _hold = null; _camEase = null; _groundMEase = null; _lastHole = H; _guardK = 1;
      _holeLoadT = performance.now();
      _ballOff = null; _pinOff = null; _greenOffs = new Map();
      _introSeed = _introPending;   // seed on the first frame that HAS a target
      _introPending = false;
    }
    refreshGridBatch(24);
    refreshPrecisionAnchors();   // exact ball/pin columns + rigid per-green offsets
  }
  renderer.render(scene, camera);   // camera was aimed at the top of this frame
}
let _lastHole = null;
let _lastCamPos = null;
let _errT = 6, _errTAt = 0;   // ramped errorTarget (motion-coarse LOD)
let _justResumed = false;     // set by setHidden(false); one-frame motion amnesty
let _guardK = 1;              // off-screen-ball framing widener (≥1, eased back at rest)
let _guardLostN = 0;          // consecutive rest-lost frames (anti-flicker latch)

function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (camera) { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); }
}

function setPitch(deg) { pitchDeg = Math.max(0, Math.min(85, deg)); }
// Hide the tiles canvas while a full-screen 2D overlay (cinematic landing, 3D
// green inspect) is up. Those paint an 0.88 scrim on the TRANSPARENT #game
// canvas, so without this the live photoreal ground ghosts through and keeps
// moving behind the overlay. Only touches the DOM on a change.
let _hidden = false;
function setHidden(h) {
  h = !!h;
  if (h === _hidden || !container) return;
  _hidden = h;
  container.style.display = h ? "none" : "block";
  if (!h) {
    // Resuming after cine/green-view: render() stopped while hidden, so the
    // eased camera + last-position are stale. Null _camEase → next setCamera
    // SNAPS to the new framing (a cut, not a cross-course glide), and
    // _justResumed keeps that snap from tripping the motion-coarse LOD.
    _camEase = null; _camEaseT = 0; _groundMEase = null; _justResumed = true;
  }
}
function isReady() { return ready; }
function failed() { return _failed; }  // Google unavailable → game.js uses 2D aerial

// Google logo + data-credit strings (MANDATORY per Map Tiles API ToS). Typed
// entries: image = logo (data URI), string = credits.
function getAttributions() {
  if (!tiles) return [];
  try { return tiles.getAttributions(); } catch (e) { return []; }
}

function anchorDiag() {
  const g = gb(), H = g && g.getHole();
  const pin = H && H.holePos;
  const recs = [];
  for (const [gr, rec] of _greenOffs) recs.push({ n: rec.samples.length, off: rec.off == null ? null : +rec.off.toFixed(1) });
  return {
    ballOff: _ballOff ? +_ballOff.off.toFixed(1) : null,
    pinOff: _pinOff ? +_pinOff.off.toFixed(1) : null,
    pinMesh: pin ? (() => { const mh = meshHeightAt(pin.x, pin.y); return mh == null ? null : +mh.toFixed(1); })() : null,
    pinDem: pin ? +((g.terrainZ(pin.x, pin.y)) * M()).toFixed(1) : null,
    pinLocalOff: pin ? +_localOff(pin.x, pin.y).toFixed(1) : null,
    gridMean: +_gridMean.toFixed(1),
    greens: recs,
    offAtPin: pin ? +offsetAt(pin.x, pin.y).toFixed(1) : null,
  };
}
function debug() {
  let meshes = 0, verts = 0;
  if (tiles && tiles.group) tiles.group.traverse((o) => {
    if (o.isMesh) { meshes++; verts += (o.geometry && o.geometry.attributes && o.geometry.attributes.position) ? o.geometry.attributes.position.count : 0; }
  });
  return { ready, placed: _placed, failed: _failed, courseId: activeCourseId, pitch: pitchDeg,
    guardK: +_guardK.toFixed(3), easeD: _camEase ? +_camEase.D.toFixed(1) : null,
    hasToken: !!window.GOOGLE_TILES_TOKEN, tiles: !!tiles,
    tris: renderer ? renderer.info.render.triangles : -1,
    drawCalls: renderer ? renderer.info.render.calls : -1,
    evt: JSON.parse(JSON.stringify(_evt)),
    visible: tiles && tiles.visibleTiles ? tiles.visibleTiles.size : -1,
    active: tiles && tiles.activeTiles ? tiles.activeTiles.size : -1,
    lru: tiles && tiles.lruCache ? (tiles.lruCache.itemList ? tiles.lruCache.itemList.length : -1) : -1,
    cams: tiles && tiles.cameras ? tiles.cameras.length : -1,
    hasRoot: !!(tiles && tiles.root),
    errTarget: tiles ? tiles.errorTarget : -1,
    camPos: camera ? camera.position.toArray().map(n=>Math.round(n)) : null,
    rendSize: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    meshes, verts, groupChildren: tiles && tiles.group ? tiles.group.children.length : -1 };
}

window.GTiles3D = {
  enter, leave, render, resize, setPitch, setHidden, project, unproject, distanceTo, pxPerMeterAt, groundSquash, occludedAt, isReady, failed,
  getAttributions, worldToLngLat, lngLatToWorld, debug, anchorDiag,
};
