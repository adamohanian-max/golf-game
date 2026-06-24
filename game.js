"use strict";

// =====================================================================
//  Tunables — tweak these to change game feel
// =====================================================================
const TUNE = {
  fullPowerSwipe: 1400,  // swipe speed (world units/sec) that produces max power
  wheelSensitivity: 1.0, // two-finger trackpad swipe -> swing power scaling
  wheelInvert: false,    // true if you use classic (non-natural) scrolling
  stopThreshold: 0.005,  // speed below this = ball stopped
  captureSpeed: 0.22,    // ball must be slower than this to drop in cup (low = hard)
  puttSensitivity: 1.0,    // putt power per unit of swipe (higher = more sensitive)

  // --- Two-phase swing: pull back (backswing), then swing forward & release.
  // Backswing LENGTH is the primary, precise power control (distance is linear in
  // pull-back); forward-swing speed is a secondary tempo modifier.
  backswingFull: 32,     // backswing distance (world units) = full power
  tempoSpeed: 500,       // forward-swing speed (world u/s) read as "normal" tempo
  tempoMin: 0.90,        // slow forward swing trims distance to this fraction
  tempoMax: 1.12,        // fast forward swing adds distance up to this fraction

  // --- Ball flight ---
  launchAngleDeg: 40,    // launch angle of a full shot (putts stay grounded)
  gravity: 0.011,        // downward accel (world units / frame^2) while airborne
  airDrag: 0.998,        // per-frame horizontal velocity bleed in the air
  spinFactor: 0.020,     // how hard a curved swipe bends flight (draw/fade)

  // Lie penalty: launch power multiplier by the surface you're hitting FROM.
  // Rough/sand grab the club and cost distance; clean lies (fairway/tee/green) full.
  lie: { fairway: 1.0, tee: 1.0, green: 1.0, rough: 0.72, bunker: 0.5, water: 0.5, woods: 0.5 },

  friction: {            // per-frame velocity multiplier by surface (rolling)
    fairway: 0.97,
    rough:   0.90,
    bunker:  0.55,       // sand grabs hard — the ball stops fast
    water:   0.80,       // ball decelerates fast in water before penalty
    woods:   0.45,       // trees/brush kill the ball fast (then OB penalty)
  },
  // The green rolls realistically: CONSTANT deceleration per frame (not a
  // velocity multiplier), so the ball holds speed and glides, then dies — the
  // way a real green / stimpmeter behaves. Derived from greenSpeed below.
  greenDecel: 0,
  // Slope-aware putting: a rolling ball is pushed downhill along the synthetic
  // green field's gradient. slopeAccel folds the field's vertical scale + gravity
  // into one knob (world-units/frame^2 per unit gradient); calibrate by feel.
  // Slope is ignored below slopeStopSpeed so a ball settles instead of creeping.
  slopeAccel: 0.0006,
  slopeStopSpeed: 0.02,
  // Landing behaviour per surface: e = vertical restitution (bounce height),
  // h = horizontal speed retained on impact (grab/check). Real per-course
  // values will come from the course API later.
  bounce: {
    green:   { e: 0.30, h: 0.35 },  // greens hold the ball
    fairway: { e: 0.40, h: 0.48 },  // firm, releases forward
    rough:   { e: 0.22, h: 0.28 },  // deadens the ball
    bunker:  { e: 0.05, h: 0.12 },  // plugs in the sand, almost no release
    water:   { e: 0.0,  h: 0.0  },  // splash (penalty handled on roll-stop)
    woods:   { e: 0.0,  h: 0.1  },  // trees stop it dead (OB penalty on stop)
  },
  bounceStopVz: 0.06,    // downward speed below which the ball stops bouncing

  // Full 14-club bag, each shot's trajectory mirrored to PGA Tour (Trackman)
  // averages: carry + max HEIGHT + LAND angle + ball speed. The flight follows a
  // per-club arc that hits all three (real balls launch low but land steep from
  // spin/lift — a plain projectile can't). PW and below from the table; SW/LW
  // extrapolated. Putter is the on-green roll (handled separately).
  clubs: {                                    // carry, maxH, land°, ballMph, spinRpm
    driver: { name: "Driver", carry: 282, maxH: 35, land: 39, ball: 171, spin: 2545 },
    "3w":   { name: "3 Wood", carry: 249, maxH: 32, land: 44, ball: 169, spin: 3663 },
    "5w":   { name: "5 Wood", carry: 236, maxH: 33, land: 48, ball: 156, spin: 4322 },
    hybrid: { name: "Hybrid", carry: 231, maxH: 31, land: 49, ball: 149, spin: 4587 },
    "3i":   { name: "3 Iron", carry: 218, maxH: 30, land: 48, ball: 145, spin: 4404 },
    "4i":   { name: "4 Iron", carry: 209, maxH: 31, land: 49, ball: 140, spin: 4782 },
    "5i":   { name: "5 Iron", carry: 199, maxH: 33, land: 50, ball: 135, spin: 5280 },
    "6i":   { name: "6 Iron", carry: 188, maxH: 32, land: 50, ball: 130, spin: 6204 },
    "7i":   { name: "7 Iron", carry: 176, maxH: 34, land: 51, ball: 123, spin: 7124 },
    "8i":   { name: "8 Iron", carry: 164, maxH: 33, land: 51, ball: 118, spin: 8078 },
    "9i":   { name: "9 Iron", carry: 152, maxH: 32, land: 52, ball: 112, spin: 8793 },
    pw:     { name: "PW",     carry: 142, maxH: 32, land: 52, ball: 104, spin: 9316 },
    sw:     { name: "SW",     carry: 115, maxH: 31, land: 53, ball: 95,  spin: 10500 },
    lw:     { name: "LW",     carry: 90,  maxH: 30, land: 55, ball: 82,  spin: 11500 },
  },

  // Backspin grip on landing, by surface (greens grab hardest -> can spin back;
  // rough is a flyer with little spin). 0..1 multiplier on the club's spin.
  spinGrip: { green: 1.0, fairway: 0.5, tee: 0.5, rough: 0.12, bunker: 0.3, woods: 0, water: 0 },
  rolloutK: 7.0,    // base release distance scale (× landing speed) with no spin
  spinCheckK: 1.2,  // how strongly backspin kills/reverses the release (>1 can back up)

  // powerFactor, maxPower, puttMaxPower, launchAngle are derived below.
  powerFactor: 0,
  maxPower: 0,
  puttMaxPower: 0,
  launchAngle: 0,
};

// Faster greens roll more (less deceleration) and are harder. Stimp -> green
// deceleration: decel = GREEN_DECEL_K / stimp (higher stimp = ball glides
// farther before stopping). Per-course later.
const GREEN_DECEL_K = 0.008;   // lower = greens roll out farther (more glide / less friction)

// Real-world yardages. A full swing CARRIES YARDS.maxCarry in the air (bounce +
// rollout add more); a full putt on the green rolls at most YARDS.maxPutt.
const YARDS = { maxCarry: 270, maxPutt: 50 };

// World bounds are per-hole (set when a hole loads); start with a sane default.
const WORLD = { w: 100, h: 180 };

// Fixed world scale: yards per world unit, CONSTANT across holes so a given
// swing means the same distance everywhere. Overridden by course.yardsPerUnit.
let YARDS_PER_UNIT = 3.0;
// Cup capture radius (world units) and default green speed — OSM carries no
// stimp rating, so we default it; per-course green speeds come later.
// Hole: real is 4.25" (~0.02 units) but that's brutal for feel-based putting, so
// the cup plays a bit larger / more forgiving on the green.
const HOLE_RADIUS_UNITS = 0.055;
// Real golf ball: 1.68" diameter -> ~0.023 yd radius -> ~0.008 units.
const BALL_RADIUS_UNITS = 0.008;
const DEFAULT_STIMP = 11;

// =====================================================================
//  Hole data
// =====================================================================
// The live hole (geometry in world units). Built by setHole() from loaded
// course data; surfaces are arrays of polygons keyed by surface type. A
// hardcoded fallback (FALLBACK_HOLE) is used if the course fetch fails.
//   { par, yards, teePos, holePos, holeRadius, greenSpeed, world:{w,h},
//     surfaces: { green:[poly], fairway:[poly], bunker:[poly], water:[poly],
//                 tee:[poly] } }   where poly = [{x,y}, ...]
let HOLE = null;

// =====================================================================
//  Derived power — FIXED across holes (so swing feel is consistent). Recomputed
//  only if the world scale or green speed changes.
// =====================================================================
let MAX_CARRY_UNITS = 0;
function recalcPower() {
  // Full shots follow a per-club arc (see setupFlight); only the putt cap is
  // derived here. Putts: roll distance D = v0^2 / (2*decel) -> v = sqrt(2*decel*D).
  TUNE.puttMaxPower = Math.sqrt(2 * TUNE.greenDecel * (YARDS.maxPutt / YARDS_PER_UNIT));
  // Normalize each club's spin (rpm) to 0..1 for the landing check/backspin.
  for (const c in TUNE.clubs) {
    TUNE.clubs[c].spinN = Math.max(0, Math.min(1, (TUNE.clubs[c].spin - 2500) / 7500));
  }
}
TUNE.greenDecel = GREEN_DECEL_K / DEFAULT_STIMP;
recalcPower();

// Bag order, longest carry -> shortest (for the +/- club selector).
const CLUB_ORDER = ["driver", "3w", "5w", "hybrid", "3i", "4i", "5i", "6i",
                    "7i", "8i", "9i", "pw", "sw", "lw"];
// Club whose full carry is closest to a distance (yards).
function clubForYards(y) {
  let best = CLUB_ORDER[0], bd = Infinity;
  for (const k of CLUB_ORDER) {
    const d = Math.abs(TUNE.clubs[k].carry - y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
// Auto-select the club for the current shot (course only; putter is auto on green).
function autoClub() {
  if (mode === "range" || !HOLE) return;
  selectedClub = clubForYards(dist(state.ball.x, state.ball.y,
                                   HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT);
}

// =====================================================================
//  State
// =====================================================================
let state;
function resetState() {
  state = {
    // z = height above ground, vz = vertical velocity, spin = sidespin (curve)
    ball: { x: HOLE.teePos.x, y: HOLE.teePos.y, vx: 0, vy: 0, z: 0, vz: 0, spin: 0 },
    flight: null,                                     // active per-club arc, or null
    lastSafe: { x: HOLE.teePos.x, y: HOLE.teePos.y }, // restore point for water
    moving: false,
    airborne: false,
    strokes: 0,
    inHole: false,
  };
}

// Game mode: "menu" (home) | "course" | "range". Input is off in the menu.
let mode = "menu";
let holeTransition = null; // active hole-change animation (fade + zoom-in), or null
let measureMode = false;   // range-finder: drag to measure distance from ball & pin
let measurePoint = null;   // world {x,y} of the dropped range-finder marker
let measureDragging = false;
let selectedClub = "driver"; // driver | iron | wedge (putter auto on the green)
let rangeTarget = 150; // driving-range target distance (yards)
// Last-shot stats for the HUD (carry / ball speed / total / dist-to-pin).
const shot = { startX: 0, startY: 0, mph: 0, carry: null, total: null, carried: false };

// =====================================================================
//  Geometry helpers (pure)
// =====================================================================
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
// Shortest distance from point P to segment A->B (for swept hole capture).
function segPointDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// ray-casting point-in-polygon
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function inAnyPoly(x, y, polys) {
  if (!polys) return false;
  for (let i = 0; i < polys.length; i++) {
    if (pointInPoly(x, y, polys[i])) return true;
  }
  return false;
}
// Surfaces tested by priority: a hazard wins over the grass it sits on, etc.
function surfaceAt(x, y) {
  const s = HOLE.surfaces;
  if (inAnyPoly(x, y, s.water)) return "water";
  if (inAnyPoly(x, y, s.bunker)) return "bunker"; // sand
  if (inAnyPoly(x, y, s.green)) return "green";
  // tee boxes play like fairway (short grass)
  if (inAnyPoly(x, y, s.fairway) || inAnyPoly(x, y, s.tee)) return "fairway";
  if (inAnyPoly(x, y, s.woods)) return "woods"; // trees = out of bounds (penalty)
  return "rough";
}
// Downhill slope (gradient of the synthetic height field) at a point, or null if
// not on a green. Same field that draws the contours (buildGreenTopo), so break
// follows what's drawn. Swap point for real LiDAR: set g.grad from baked elevation.
function greenSlopeAt(x, y) {
  for (const g of HOLE._greens || []) {
    if (g.grad && pointInPoly(x, y, g.poly)) return g.grad(x, y);
  }
  return null;
}

// =====================================================================
//  Physics
// =====================================================================
function update() {
  if (!state.moving || state.inHole) return;
  if (state.airborne) flightStep(state.ball);
  else rollStep(state.ball);
}

// Keep the ball inside the play area (gentle bounce off the boundary walls).
function clampToWorld(b) {
  if (b.x < 1) { b.x = 1; b.vx *= -0.5; }
  if (b.x > WORLD.w - 1) { b.x = WORLD.w - 1; b.vx *= -0.5; }
  if (b.y < 1) { b.y = 1; b.vy *= -0.5; }
  if (b.y > WORLD.h - 1) { b.y = WORLD.h - 1; b.vy *= -0.5; }
}

// Airborne dispatch: the initial shot follows the per-club arc (state.flight);
// any subsequent bounce is plain ballistic (gravity).
function flightStep(b) {
  if (state.flight) arcFlightStep(b);
  else ballisticFlightStep(b);
}

// Set up a per-club arc to hit `C` carry, `H` max height, `L` land angle (world
// units / radians). Two parabolas (ascent->apex->descent) make the descent
// steeper than the ascent, exactly like a real spinning ball.
function setupFlight(b, ang, C, H, L, spinN) {
  H = Math.max(H, 0.001);
  let xa = C - 2 * H / Math.tan(L);          // apex horizontal position
  xa = Math.max(xa, C * 0.15);               // guard (steep, short shots)
  const T = 2 * Math.sqrt(2 * H / TUNE.gravity); // hang time in frames (apex-based)
  const vh = C / Math.max(T, 1);             // constant horizontal speed
  state.flight = { ang, C, H, xa, L, vh, d: 0, spinN: spinN || 0 };
  b.vx = Math.cos(ang) * vh;
  b.vy = Math.sin(ang) * vh;
  b.z = 0.0001; b.vz = 0;
}

function arcFlightStep(b) {
  const fl = state.flight;
  fl.d += fl.vh;
  b.x += b.vx;
  b.y += b.vy;
  // sidespin curves the path (draw/fade); keep the arc advancing along its length
  if (b.spin) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const px = -b.vy / sp, py = b.vx / sp;
    const a = b.spin * TUNE.spinFactor * sp;
    b.vx += px * a; b.vy += py * a;
  }
  // height from the two-parabola arc
  const d = fl.d, C = fl.C, H = fl.H, xa = fl.xa;
  const t = d <= xa ? (d - xa) / xa : (d - xa) / (C - xa);
  const prevz = b.z;
  b.z = Math.max(H * (1 - t * t), 0);
  b.vz = b.z - prevz; // for the shadow/trail render
  clampToWorld(b);

  if (d >= C || (d > xa && b.z <= 0)) {
    // landed — record carry, then hand off to the surface bounce/roll
    b.z = 0;
    if (!shot.carried) {
      shot.carry = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
      shot.carried = true;
    }
    const surf = surfaceAt(b.x, b.y);
    const sp = Math.hypot(b.vx, b.vy) || 1, dx = b.vx / sp, dy = b.vy / sp; // travel dir
    state.flight = null;
    if (surf === "water" || surf === "woods") {
      b.vx = b.vy = b.vz = 0; state.airborne = false;
      return;
    }
    // Backspin check: a spinning ball grabs on landing. Low spin (driver) releases
    // and runs; high spin on receptive turf (wedge -> green) checks, and can roll
    // BACKWARD. Rough is a flyer (little grip) so it releases. `Dr` = rollout (units).
    const grip = TUNE.spinGrip[surf] ?? 0.3;
    const check = Math.min(1.1, fl.spinN * grip);
    const Dr = fl.vh * TUNE.rolloutK * (1 - check * TUNE.spinCheckK); // <0 = spins back
    let v;
    if (surf === "green") v = Math.sign(Dr) * Math.sqrt(2 * TUNE.greenDecel * Math.abs(Dr));
    else { const fr = TUNE.friction[surf] ?? 0.9; v = Dr * (1 - fr); }
    b.vx = dx * v; b.vy = dy * v; b.vz = 0; b.spin = 0; state.airborne = false;
  }
}

// --- Ballistic bounces after the first landing: projectile arc + land/settle ---
function ballisticFlightStep(b) {
  b.x += b.vx;
  b.y += b.vy;
  b.z += b.vz;
  b.vz -= TUNE.gravity;

  // sidespin curves the flight: accel perpendicular to travel, grows with speed
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 1e-4 && b.spin) {
    const px = -b.vy / sp, py = b.vx / sp; // unit left-perpendicular
    const a = b.spin * TUNE.spinFactor * sp;
    b.vx += px * a;
    b.vy += py * a;
  }
  b.vx *= TUNE.airDrag;
  b.vy *= TUNE.airDrag;

  clampToWorld(b);

  // landing
  if (b.z <= 0) {
    b.z = 0;
    if (!shot.carried) { // first ground contact = carry distance
      shot.carry = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
      shot.carried = true;
    }
    const surf = surfaceAt(b.x, b.y);
    const down = -b.vz; // downward speed at impact
    if (surf === "water" || surf === "woods") {
      // splash / into the trees — kill it here; roll-stop applies the penalty
      b.vx = b.vy = b.vz = 0;
      state.airborne = false;
    } else if (down > TUNE.bounceStopVz) {
      const bo = TUNE.bounce[surf] || TUNE.bounce.fairway;
      b.vz = down * bo.e;   // bounce back up
      b.vx *= bo.h;         // scrub/grab forward speed
      b.vy *= bo.h;
      b.spin *= 0.5;        // spin bleeds off with each bounce
    } else {
      // too low to bounce — settle and start rolling
      b.vz = 0;
      b.spin = 0;
      state.airborne = false;
    }
  }
}

// --- Grounded: roll with per-surface friction, hole capture, water penalty ---
function rollStep(b) {
  b.x += b.vx;
  b.y += b.vy;

  clampToWorld(b);

  const surf = surfaceAt(b.x, b.y);
  if (surf === "green") {
    // Realistic green roll: subtract a constant deceleration from the speed
    // (not a multiplier), so the ball glides and then stops crisply.
    const sp = Math.hypot(b.vx, b.vy);
    const k = sp > 0 ? Math.max(0, sp - TUNE.greenDecel) / sp : 0;
    b.vx *= k;
    b.vy *= k;
    // Slope-aware break: accelerate downhill along the same synthetic green field
    // that draws the contours. Gated above a stop speed so a ball that comes to
    // rest on a slope stays put (the synthetic tilt can exceed greenDecel).
    if (sp > TUNE.slopeStopSpeed) {
      const g = greenSlopeAt(b.x, b.y);
      if (g) { b.vx -= TUNE.slopeAccel * g.x; b.vy -= TUNE.slopeAccel * g.y; }
    }
  } else {
    const f = TUNE.friction[surf];
    b.vx *= f;
    b.vy *= f;
  }

  const speed = Math.hypot(b.vx, b.vy);

  // hole capture / lip-out (course only — the range has no cup). Test the ball's
  // PATH this frame against the cup (swept), so a putt rolling over the small
  // real-scale hole can't step past it between frames.
  if (!HOLE.isRange) {
    const px = b.x - b.vx, py = b.y - b.vy;            // last frame's position
    const capR = HOLE.holeRadius + BALL_RADIUS_UNITS;  // ball overlaps the cup edge
    const cd = segPointDist(HOLE.holePos.x, HOLE.holePos.y, px, py, b.x, b.y);
    if (cd <= capR) {
      if (speed < TUNE.captureSpeed) {
        // slow enough — drop in
        b.x = HOLE.holePos.x;
        b.y = HOLE.holePos.y;
        b.vx = b.vy = 0;
        state.moving = false;
        state.inHole = true;
        showResult();
        return;
      } else {
        // lip-out: ball crossed the cup too fast — reflect off the rim
        const hd = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) || 0.01;
        const nx = (b.x - HOLE.holePos.x) / hd, ny = (b.y - HOLE.holePos.y) / hd;
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { // only deflect if ball is still moving inward
          b.vx = (b.vx - 2 * dot * nx) * 0.5; // reflect + lose energy on the lip
          b.vy = (b.vy - 2 * dot * ny) * 0.5;
          b.x = HOLE.holePos.x + nx * (HOLE.holeRadius + 0.3);
          b.y = HOLE.holePos.y + ny * (HOLE.holeRadius + 0.3);
        }
      }
    }
  }

  // stopped
  if (speed < TUNE.stopThreshold) {
    b.vx = b.vy = 0;
    state.moving = false;
    shot.total = dist(shot.startX, shot.startY, b.x, b.y) * YARDS_PER_UNIT;
    if (HOLE.isRange) {
      // range: report the shot, then tee up a fresh ball for the next swing
      const delta = Math.round(shot.total - rangeTarget);
      rangeFeedback(`Total ${Math.round(shot.total)} yds · ${delta >= 0 ? "+" : ""}${delta} to target`);
      b.x = HOLE.teePos.x; b.y = HOLE.teePos.y; b.z = 0; b.vz = 0; b.spin = 0;
      state.lastSafe = { x: b.x, y: b.y };
      frameRange();
      return;
    }
    const rest = surfaceAt(b.x, b.y);
    if (rest === "water" || rest === "woods") {
      // hazard / out of bounds: +1 penalty, drop at last safe spot
      state.strokes += 1;
      b.x = state.lastSafe.x;
      b.y = state.lastSafe.y;
    } else {
      state.lastSafe = { x: b.x, y: b.y };
    }
    // reframe to fit the remaining shot and re-aim the camera up the line to the
    // pin (smoothly) so the next shot is already oriented toward the hole.
    frameRemaining();
    aimAtHole();
    autoClub(); // pick the club for the next shot's distance to the pin
    updateScorecard();
  }
}

// =====================================================================
//  Input — swipe swing (touch) with mouse fallback for desktop
// =====================================================================
let swipe = null;     // { x, y, t }
let swipePath = null; // sampled screen points of the in-progress swipe
// Fixed swipe->power scale (full-hole fit, set in resize). Using this instead of
// the live camera zoom keeps swing sensitivity identical at every stroke, so a
// full swing doesn't auto-scale to always reach the green.
let refScale = 1;
const canvas = document.getElementById("game");

function canSwing() {
  return mode !== "menu" && !state.moving && !state.inHole && !holeTransition;
}

// Signed curvature of a swipe path in [-1, 1] (0 = straight). Compares the
// first half of the gesture to the second half; a bend imparts draw/fade spin.
function curveFromPath(pts) {
  if (!pts || pts.length < 3) return 0;
  const a = pts[0], m = pts[pts.length >> 1], b = pts[pts.length - 1];
  const v1x = m.x - a.x, v1y = m.y - a.y;
  const v2x = b.x - m.x, v2y = b.y - m.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) return 0;
  return (v1x * v2y - v1y * v2x) / (m1 * m2); // sign of cross product
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src = e.touches && e.touches[0] ? e.touches[0]
            : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
            : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function swingStart(e) {
  if (measureMode) { const p = pointerPos(e); measurePoint = screenToWorld(p.x, p.y); measureDragging = true; return; }
  if (!canSwing()) return;
  const p = pointerPos(e);
  const now = performance.now();
  swipe = { x: p.x, y: p.y, t: now };
  swipePath = [{ x: p.x, y: p.y, t: now }];
}
function swingMove(e) {
  if (measureMode) { if (measureDragging) { e.preventDefault(); const p = pointerPos(e); measurePoint = screenToWorld(p.x, p.y); } return; }
  if (!swipe) return;
  e.preventDefault();
  const p = pointerPos(e);
  swipePath.push({ x: p.x, y: p.y, t: performance.now() });
}
// Backswing distance (world units) + forward-swing speed (world u/s) -> launch
// speed. Backswing length is the PRIMARY control: distance is ~linear in how far
// you pull back (half pull-back ≈ half distance), so medium shots are precise and
// repeatable. Forward-swing speed is a secondary tempo nudge (±). Capped per
// surface (gentle on the green).
// Swing -> fraction of a full shot (0..1). Backswing LENGTH is the primary,
// precise control (linear); forward-swing speed is a secondary tempo nudge.
function swingFraction(forwardSpeed, backDist) {
  const backFactor = Math.min(backDist / TUNE.backswingFull, 1);
  const tempo = Math.max(TUNE.tempoMin, Math.min(TUNE.tempoMax, forwardSpeed / TUNE.tempoSpeed));
  return Math.min(backFactor * tempo, 1);
}

// Fire the ball: `ang` direction, `frac` 0..1 swing fullness, `spin` (-1..1).
function launchShot(ang, frac, spin, onGreen) {
  if (!canSwing() || frac <= 0.02) return;
  const b = state.ball;
  shot.startX = b.x; shot.startY = b.y;
  shot.carry = null; shot.total = null; shot.carried = onGreen;
  state.flight = null;
  const f = Math.min(frac, 1);
  if (onGreen) {
    // putt: stays on the deck, pure roll (distance ∝ speed²)
    const power = TUNE.puttMaxPower * Math.sqrt(f);
    shot.mph = Math.round(power * YARDS_PER_UNIT * 60 * (3600 / 1760)); // units/frame -> mph
    b.vx = Math.cos(ang) * power; b.vy = Math.sin(ang) * power;
    b.vz = 0; b.z = 0; b.spin = 0;
    state.airborne = false;
  } else {
    // full shot: follow the selected club's real arc, scaled by how full the swing is
    const c = TUNE.clubs[selectedClub];
    const C = (c.carry / YARDS_PER_UNIT) * f;   // carry (world units)
    const H = (c.maxH / YARDS_PER_UNIT) * f;     // apex height (scales with the swing)
    shot.mph = Math.round(c.ball * f);           // real ball speed for the HUD
    b.spin = spin;
    setupFlight(b, ang, C, H, c.land * Math.PI / 180, c.spinN);
    state.airborne = true;
  }
  state.moving = true;
  state.strokes += 1;
  updateScorecard();
  hideHint();
}

// Launch from a single screen-space swipe vector (dxs, dys) over dt seconds —
// trackpad path: no backswing, so swipe speed maps straight to power.
function launch(dxs, dys, dt, spin = 0) {
  if (!canSwing()) return;
  // Convert via the fixed reference scale (NOT view.scale) so sensitivity is the
  // same regardless of how far the camera is zoomed in.
  const swipeSpeed = (Math.hypot(dxs, dys) / refScale) / Math.max(dt, 0.001);
  const onGreen = surfaceAt(state.ball.x, state.ball.y) === "green";
  const frac = Math.min(swipeSpeed / TUNE.fullPowerSwipe, 1); // full swing at fullPowerSwipe
  // screen direction -> world direction (undo the camera rotation)
  launchShot(Math.atan2(dys, dxs) - view.angle, frac, spin, onGreen);
}

// Two-phase touch/mouse swing: find the top of the backswing (apex), then the
// forward swing (apex -> release) gives the shot direction, speed, and spin.
function analyzeSwing(path) {
  if (!path || path.length < 2) return null;
  const start = path[0], end = path[path.length - 1];
  // apex = top of backswing: farthest point from start, up to the reversal.
  let apexIdx = 0, maxD = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - start.x, path[i].y - start.y);
    if (d > maxD) { maxD = d; apexIdx = i; }
    else if (maxD > 12 && d < maxD * 0.75) break; // reversed -> downswing started
  }
  if (apexIdx >= path.length - 1) { apexIdx = 0; maxD = 0; } // pure forward drag
  const fwd = path.slice(apexIdx);
  const fStart = fwd[0], fEnd = fwd[fwd.length - 1];
  let fdx = fEnd.x - fStart.x, fdy = fEnd.y - fStart.y;
  let fdist = Math.hypot(fdx, fdy);
  if (fdist < 1) {                          // no forward motion -> use whole gesture
    fdx = end.x - start.x; fdy = end.y - start.y; fdist = Math.hypot(fdx, fdy);
    if (fdist < 1) return null;
  }
  const fdt = Math.max((fEnd.t - fStart.t) / 1000, 0.001);
  return {
    ang: Math.atan2(fdy, fdx),
    forwardSpeed: (fdist / refScale) / fdt, // world units / sec
    backDist: maxD / refScale,              // world units
    spin: curveFromPath(fwd),
  };
}

function swingEnd(e) {
  if (measureMode) { measureDragging = false; return; }
  if (!swipe || !canSwing()) { swipe = null; swipePath = null; aimPreview = null; return; }
  const p = pointerPos(e);
  swipePath.push({ x: p.x, y: p.y, t: performance.now() });
  const sw = analyzeSwing(swipePath);
  swipe = null; swipePath = null; aimPreview = null;
  if (!sw) return;
  const onGreen = surfaceAt(state.ball.x, state.ball.y) === "green";
  // screen direction -> world direction (undo the camera rotation)
  launchShot(sw.ang - view.angle, swingFraction(sw.forwardSpeed, sw.backDist), sw.spin, onGreen);
}

canvas.addEventListener("touchstart", swingStart, { passive: true });
canvas.addEventListener("touchmove", swingMove, { passive: false });
canvas.addEventListener("touchend", swingEnd);
canvas.addEventListener("mousedown", swingStart);
canvas.addEventListener("mousemove", swingMove);
window.addEventListener("mouseup", swingEnd);

// --- Two-finger trackpad swipe (desktop) ---
// A two-finger swipe arrives as a stream of wheel events. We collect them for a
// short window from the first event, then launch in the swipe's direction. The
// shot goes opposite the scroll delta (swipe up = scroll-down delta = shoot up),
// matching natural scrolling; flip TUNE.wheelInvert for classic scrolling.
let wheelGesture = null;       // { sx, sy, t0 }
const WHEEL_WINDOW_MS = 140;   // collection window before the shot fires
const WHEEL_TAIL_MS = 220;     // swallow inertial momentum events within this gap
let wheelCooldownUntil = 0;    // ignore wheel events until this time (momentum tail)

function onWheel(e) {
  e.preventDefault();
  const now = performance.now();
  // A trackpad swipe keeps emitting inertial "momentum" wheel events after the
  // fingers lift. Without this, those would start a NEW gesture and fire phantom
  // "aftershock" shots (worst on short putts that stop before the tail dies).
  // Each tail event pushes the cooldown out, so the whole tail is swallowed.
  if (now < wheelCooldownUntil) { wheelCooldownUntil = now + WHEEL_TAIL_MS; return; }
  if (!canSwing()) return;
  if (!wheelGesture) {
    wheelGesture = { sx: 0, sy: 0, t0: now, path: [{ x: 0, y: 0 }] };
    setTimeout(finishWheelSwing, WHEEL_WINDOW_MS);
  }
  wheelGesture.sx += e.deltaX;
  wheelGesture.sy += e.deltaY;
  wheelGesture.path.push({ x: wheelGesture.sx, y: wheelGesture.sy });
}

function finishWheelSwing() {
  const g = wheelGesture;
  wheelGesture = null;
  if (!g) return;
  const sign = (TUNE.wheelInvert ? 1 : -1) * TUNE.wheelSensitivity;
  const dt = Math.max((performance.now() - g.t0) / 1000, 0.001);
  // curve sign is invariant to negating the path, so it matches the finger swoosh
  launch(sign * g.sx, sign * g.sy, dt, curveFromPath(g.path));
  wheelCooldownUntil = performance.now() + WHEEL_TAIL_MS; // start swallowing the tail
}

canvas.addEventListener("wheel", onWheel, { passive: false });

// =====================================================================
//  Rendering
// =====================================================================
const ctx = canvas.getContext("2d");
// World->screen as a full affine so the camera can ROTATE (each hole plays "up"
// even on the connected global map). screen.x = a*x + b*y + c, screen.y = d*x + e*y + f.
const view = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, scale: 1, angle: 0 };
let aimPreview = null;

const VIEW_PAD_MIN = 3;     // world-unit margin when ball is right by the cup
const VIEW_PAD_FRAC = 0.25; // extra margin as a fraction of the ball->cup span
const VIEW_MIN = 7;         // smallest framed dimension (caps how far we zoom in)
let holeFitW = 100, holeFitH = 100; // full-hole framing dims -> refScale

// Camera = a world focus point + a zoom scale + an angle. Rotation pivots around
// the focus and the target scale is measured at the TARGET angle, so re-aiming
// turns cleanly without wobbling the zoom or drifting the framing.
const camera = {
  focus: { x: WORLD.w / 2, y: WORLD.h / 2 }, scale: 1, angle: 0,
  tFocus: { x: WORLD.w / 2, y: WORLD.h / 2 }, tScale: 1, tAngle: 0,
  _w: 100, _h: 100, // last framing dims (for refScale)
};
let cameraAiming = false; // true while smoothly rotating toward camera.tAngle
let aimKey = 0;           // +1 left / -1 right while an arrow key is held (smooth aim)
const AIM_RATE = 1.4 * Math.PI / 180;  // radians/frame while held (~84°/s)
const AIM_NUDGE = 3 * Math.PI / 180;   // fixed step for a single arrow tap

// Target framing (focus = ball↔pin midpoint; scale = fit ball↔pin + pad at the
// target angle). Tight near the cup (putts), wide off the tee.
function frameTarget() {
  const a = camera.tAngle, cos = Math.cos(a), sin = Math.sin(a);
  const bx = cos * state.ball.x - sin * state.ball.y, by = sin * state.ball.x + cos * state.ball.y;
  const px = cos * HOLE.holePos.x - sin * HOLE.holePos.y, py = sin * HOLE.holePos.x + cos * HOLE.holePos.y;
  const span = Math.max(Math.abs(bx - px), Math.abs(by - py));
  const pad = Math.max(VIEW_PAD_MIN, span * VIEW_PAD_FRAC);
  const w = Math.max(Math.abs(bx - px) + 2 * pad, VIEW_MIN);
  const h = Math.max(Math.abs(by - py) + 2 * pad, VIEW_MIN);
  camera._w = w; camera._h = h;
  camera.tScale = Math.min(window.innerWidth / w, window.innerHeight / h);
  camera.tFocus.x = (state.ball.x + HOLE.holePos.x) / 2;
  camera.tFocus.y = (state.ball.y + HOLE.holePos.y) / 2;
}
function frameRemaining() { frameTarget(); }
// Jump the camera straight to its target (no easing).
function snapCamera() {
  camera.angle = camera.tAngle;
  camera.focus = { x: camera.tFocus.x, y: camera.tFocus.y };
  camera.scale = camera.tScale;
  cameraAiming = false;
}

// world->screen affine: screen = scale * R(angle) * (world - focus) + screenCenter.
function applyView() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  const s = camera.scale, cos = Math.cos(camera.angle), sin = Math.sin(camera.angle);
  view.scale = s; view.angle = camera.angle;
  view.a = s * cos; view.b = -s * sin;
  view.d = s * sin; view.e = s * cos;
  view.c = cssW / 2 - (view.a * camera.focus.x + view.b * camera.focus.y);
  view.f = cssH / 2 - (view.d * camera.focus.x + view.e * camera.focus.y);
}

function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

// Ease focus, scale and (while aiming) angle toward their targets each frame.
function updateCamera() {
  if (aimKey && (mode === "course" || mode === "range") && canSwing()) {
    camera.tAngle += aimKey * AIM_RATE;     // hold arrow -> rotate directly (stops on release)
    camera.angle = camera.tAngle;
    frameTarget();
    cameraAiming = false;
  } else if (cameraAiming) {
    const d = angDiff(camera.tAngle, camera.angle);
    if (Math.abs(d) < 0.004) { camera.angle = camera.tAngle; cameraAiming = false; }
    else camera.angle += d * 0.16;
  }
  const s = 0.12;
  camera.focus.x += (camera.tFocus.x - camera.focus.x) * s;
  camera.focus.y += (camera.tFocus.y - camera.focus.y) * s;
  camera.scale += (camera.tScale - camera.scale) * s;
  applyView();
}

// Visible world rect (axis-aligned; used by the vector renderer at angle≈0).
function visibleRect() {
  const s = camera.scale;
  return { x: camera.focus.x - window.innerWidth / (2 * s), w: window.innerWidth / s,
           y: camera.focus.y - window.innerHeight / (2 * s), h: window.innerHeight / s };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // fixed swing sensitivity: full-hole fit, independent of the camera zoom
  refScale = Math.min(cssW / holeFitW, cssH / holeFitH);
  applyView();
}
window.addEventListener("resize", resize);

function wx(x, y) { return view.a * x + view.b * y + view.c; }
function wy(x, y) { return view.d * x + view.e * y + view.f; }
function ws(v) { return v * view.scale; }
// Inverse: screen px -> world coords (for the range finder).
function screenToWorld(sx, sy) {
  const det = view.a * view.e - view.b * view.d || 1;
  const x = sx - view.c, y = sy - view.f;
  return { x: (view.e * x - view.b * y) / det, y: (-view.d * x + view.a * y) / det };
}
// Pill label centered at (x,y) — used by the range finder.
function drawLabel(x, y, text, color) {
  ctx.font = "600 13px -apple-system, BlinkMacSystemFont, sans-serif";
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 11, w, 22, 7);
  else ctx.rect(x - w / 2, y - 11, w, 22);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
}

// Off-screen culling: AABB of the (possibly rotated) viewport in world coords,
// recomputed once per frame. Polygons outside it are skipped — vital for the
// global connected course, which holds the WHOLE course's geometry.
let _viewAABB = null;
function computeViewAABB() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  const c = [screenToWorld(0, 0), screenToWorld(cssW, 0), screenToWorld(cssW, cssH), screenToWorld(0, cssH)];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of c) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  _viewAABB = { minx, miny, maxx, maxy };
}
function polyVisible(poly) {
  if (!_viewAABB || !poly || poly.length < 2) return true;
  const bb = poly._bb || (poly._bb = polyBBox(poly)); // memoized
  const v = _viewAABB;
  return bb.maxx >= v.minx && bb.minx <= v.maxx && bb.maxy >= v.miny && bb.miny <= v.maxy;
}

function fillPoly(poly, color) {
  if (!poly || poly.length < 2 || !polyVisible(poly)) return;
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function fillPolys(polys, color) {
  if (!polys) return;
  for (let i = 0; i < polys.length; i++) fillPoly(polys[i], color);
}

// --- Aesthetic helpers --------------------------------------------------
function tracePoly(poly) {
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.closePath();
}
// Run fn with the canvas clipped to a polygon (for textures/stripes/gradients).
function withClip(poly, fn) {
  if (!poly || poly.length < 2) return;
  ctx.save();
  tracePoly(poly);
  ctx.clip();
  fn();
  ctx.restore();
}
function polyBBox(poly) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, cx = 0, cy = 0;
  for (const p of poly) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
    cx += p.x; cy += p.y;
  }
  return { minx, miny, maxx, maxy, cx: cx / poly.length, cy: cy / poly.length };
}
// Mowing stripes: alternating bands across the currently visible world rect.
// axis "y" => horizontal bands; axis "x" => vertical bands.
function stripes(c1, c2, bandW, axis) {
  const r = visibleRect(), cssW = window.innerWidth, cssH = window.innerHeight;
  if (axis === "x") {
    for (let x = Math.floor(r.x / bandW) * bandW; x < r.x + r.w; x += bandW) {
      ctx.fillStyle = (Math.floor(x / bandW) & 1) ? c1 : c2;
      ctx.fillRect(wx(x, 0), 0, ws(bandW) + 1, cssH);
    }
  } else {
    for (let y = Math.floor(r.y / bandW) * bandW; y < r.y + r.h; y += bandW) {
      ctx.fillStyle = (Math.floor(y / bandW) & 1) ? c1 : c2;
      ctx.fillRect(0, wy(0, y), cssW, ws(bandW) + 1);
    }
  }
}

// --- Topographical green: synthesize a smooth height field + contour lines.
// OSM has no elevation, so we fabricate a gentle, DETERMINISTIC surface per
// green (stable across frames). This SAME field drives both the drawn contours
// and putting break (see greenSlopeAt / rollStep), so what you see is what
// breaks. Each green exposes h(x,y) and grad(x,y); a real LiDAR DEM can later
// replace those without touching anything downstream.
function hashSeed(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function lerpT(a, b, L) {
  const d = b - a;
  return d === 0 ? 0.5 : Math.min(1, Math.max(0, (L - a) / d));
}
// Marching squares over a world-space grid -> contour segments at each level.
function contourSegments(h, x0, y0, x1, y1, levels, nx, ny) {
  const segs = [];
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny;
  const H = [];
  for (let j = 0; j <= ny; j++) {
    H[j] = [];
    for (let i = 0; i <= nx; i++) H[j][i] = h(x0 + i * dx, y0 + j * dy);
  }
  for (const L of levels) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const xL = x0 + i * dx, yT = y0 + j * dy, xR = xL + dx, yB = yT + dy;
        const tl = H[j][i], tr = H[j][i + 1], br = H[j + 1][i + 1], bl = H[j + 1][i];
        const cT = (tl > L) !== (tr > L), cR = (tr > L) !== (br > L);
        const cB = (br > L) !== (bl > L), cLe = (bl > L) !== (tl > L);
        const pts = {};
        if (cT) pts.T = { x: xL + dx * lerpT(tl, tr, L), y: yT };
        if (cR) pts.R = { x: xR, y: yT + dy * lerpT(tr, br, L) };
        if (cB) pts.B = { x: xL + dx * lerpT(bl, br, L), y: yB };
        if (cLe) pts.L = { x: xL, y: yT + dy * lerpT(tl, bl, L) };
        const k = Object.keys(pts);
        if (k.length === 2) {
          segs.push({ ax: pts[k[0]].x, ay: pts[k[0]].y, bx: pts[k[1]].x, by: pts[k[1]].y });
        } else if (k.length === 4) { // saddle — connect T-R and B-L
          segs.push({ ax: pts.T.x, ay: pts.T.y, bx: pts.R.x, by: pts.R.y });
          segs.push({ ax: pts.B.x, ay: pts.B.y, bx: pts.L.x, by: pts.L.y });
        }
      }
    }
  }
  return segs;
}
// Precompute per-green topo (height tilt + contour segments in world coords).
function buildGreenTopo(polys) {
  const out = [];
  if (!polys) return out;
  for (const poly of polys) {
    if (poly.length < 3) continue;
    const bb = polyBBox(poly);
    const R = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2 || 1;
    const r1 = hashSeed(bb.cx, bb.cy), r2 = hashSeed(bb.cy, bb.cx), r3 = hashSeed(bb.cx + 7.3, bb.cy - 2.1);
    const theta = r1 * Math.PI * 2;     // downhill/tilt direction
    const tmag = 0.6 + 0.5 * r2;        // tilt strength
    const wl = R * (0.7 + 0.6 * r3);    // undulation wavelength
    const ph = r3 * 6.2831;
    const dirx = Math.cos(theta), diry = Math.sin(theta);
    const h = (x, y) => {
      const along = ((x - bb.cx) * dirx + (y - bb.cy) * diry) / R;
      const und = Math.sin((x - bb.cx) / wl + ph) * Math.cos((y - bb.cy) / wl - ph);
      return tmag * along + 0.5 * und;
    };
    // Analytic gradient of h (height-units per world-unit) — drives putting break.
    const grad = (x, y) => ({
      x: tmag * dirx / R + 0.5 * Math.cos((x - bb.cx) / wl + ph) * Math.cos((y - bb.cy) / wl - ph) / wl,
      y: tmag * diry / R - 0.5 * Math.sin((x - bb.cx) / wl + ph) * Math.sin((y - bb.cy) / wl - ph) / wl,
    });
    let hmin = Infinity, hmax = -Infinity;
    const N = 22;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const v = h(bb.minx + (bb.maxx - bb.minx) * i / N, bb.miny + (bb.maxy - bb.miny) * j / N);
      if (v < hmin) hmin = v; if (v > hmax) hmax = v;
    }
    const nL = 7, levels = [];
    for (let kk = 1; kk <= nL; kk++) levels.push(hmin + (hmax - hmin) * kk / (nL + 1));
    const contours = contourSegments(h, bb.minx, bb.miny, bb.maxx, bb.maxy, levels, 30, 30);
    out.push({
      poly, contours, h, grad,
      hi: { x: bb.cx + dirx * R, y: bb.cy + diry * R },  // high side (sunlit)
      lo: { x: bb.cx - dirx * R, y: bb.cy - diry * R },  // low side (shaded)
    });
  }
  return out;
}

function strokePolyline(poly) {
  if (!poly || poly.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(wx(poly[0].x, poly[0].y), wy(poly[0].x, poly[0].y));
  for (let i = 1; i < poly.length; i++) ctx.lineTo(wx(poly[i].x, poly[i].y), wy(poly[i].x, poly[i].y));
  ctx.stroke();
}

// Draw the baked north-up aerial as the hole base, mapped image-px -> world ->
// screen via the stored affine. The global canvas transform is dpr-scaled, so
// we compose dpr * (view ∘ toWorld) and draw the image, then restore.
// Bake the grade + course-green wash into the aerial ONCE (offscreen) so each
// frame is a plain drawImage — no per-frame ctx.filter / blend on a huge photo.
function processAerial(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.filter = "saturate(1.35) contrast(1.05) brightness(1.02)";
  g.drawImage(img, 0, 0);
  g.filter = "none";
  g.globalCompositeOperation = "color";       // recolor toward course-green
  g.globalAlpha = 0.45; g.fillStyle = "#5a8f3c"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "soft-light";  // deepen midtones
  g.globalAlpha = 0.5; g.fillStyle = "#3f7a34"; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over"; // faint darken
  g.globalAlpha = 0.08; g.fillStyle = "#23461e"; g.fillRect(0, 0, c.width, c.height);
  return c;
}

function drawAerial() {
  const a = HOLE.aerial, img = HOLE._img;
  if (!a || !img) return;
  const m = a.toWorld, dpr = window.devicePixelRatio || 1;
  // compose pixel -> world (m) with world -> screen (view affine): screen = view ∘ m
  const A = view.a * m[0] + view.b * m[3];        // px coef in screen.x
  const C = view.a * m[1] + view.b * m[4];        // py coef in screen.x
  const E = view.a * m[2] + view.b * m[5] + view.c;
  const B = view.d * m[0] + view.e * m[3];        // px coef in screen.y
  const D = view.d * m[1] + view.e * m[4];        // py coef in screen.y
  const F = view.d * m[2] + view.e * m[5] + view.f;
  ctx.save();
  ctx.setTransform(dpr * A, dpr * B, dpr * C, dpr * D, dpr * E, dpr * F);
  ctx.drawImage(img, 0, 0); // already graded + washed by processAerial
  ctx.restore();
}

// Green: collar + fill + topo contours. `photo` => translucent over the aerial.
function drawGreen(photo) {
  const cssW = window.innerWidth, cssH = window.innerHeight, s = HOLE.surfaces;
  ctx.strokeStyle = photo ? "rgba(190,235,195,0.7)" : "#5aa563";
  ctx.lineWidth = ws(photo ? 2 : 3);
  ctx.lineJoin = "round";
  for (const poly of s.green || []) { if (!polyVisible(poly)) continue; tracePoly(poly); ctx.stroke(); }
  for (const g of HOLE._greens || []) {
    if (!polyVisible(g.poly)) continue; // skip off-screen greens (incl. their topo)
    withClip(g.poly, () => {
      if (photo) {
        ctx.globalAlpha = 0.16;          // light tint — let the real turf show through
        ctx.fillStyle = "#7ecb86";
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 1;
      } else {
        const lg = ctx.createLinearGradient(wx(g.hi.x, g.hi.y), wy(g.hi.x, g.hi.y), wx(g.lo.x, g.lo.y), wy(g.lo.x, g.lo.y));
        lg.addColorStop(0, "#92d398");
        lg.addColorStop(1, "#6fbb79");
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.globalAlpha = 0.5;
        stripes("rgba(255,255,255,0.10)", "rgba(0,0,0,0.06)", 3, "x");
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = photo ? "rgba(30,60,35,0.32)" : "rgba(32,74,38,0.40)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const seg of g.contours) {
        ctx.moveTo(wx(seg.ax, seg.ay), wy(seg.ax, seg.ay));
        ctx.lineTo(wx(seg.bx, seg.by), wy(seg.bx, seg.by));
      }
      ctx.stroke();
    });
  }
}

// Stylized vector rendering (used when no aerial, e.g. offline / St Andrews).
function drawVectorSurfaces() {
  const cssW = window.innerWidth, cssH = window.innerHeight, s = HOLE.surfaces;
  const bg = ctx.createLinearGradient(0, 0, 0, cssH);
  bg.addColorStop(0, "#236425");
  bg.addColorStop(1, "#2c7e2f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.globalAlpha = 0.5;
  stripes("#2a7a2c", "#266e28", 9, "y");
  ctx.globalAlpha = 1;

  fillPolys(s.grass, "#3a9440");                 // mown turf between holes

  for (const poly of s.fairway || []) withClip(poly, () => stripes("#4eb053", "#46a44b", 7, "y"));
  ctx.strokeStyle = "rgba(28,66,30,0.45)"; ctx.lineWidth = 1.5;
  for (const poly of s.fairway || []) { tracePoly(poly); ctx.stroke(); }

  for (const poly of s.tee || []) withClip(poly, () => stripes("#5cbf61", "#54b659", 3, "x"));

  for (const poly of s.bunker || []) {
    const bb = polyBBox(poly);
    withClip(poly, () => {
      const scx = wx(bb.cx, bb.cy), scy = wy(bb.cx, bb.cy);
      const rad = ws(Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) / 2) || 1;
      const rg = ctx.createRadialGradient(scx, scy, rad * 0.1, scx, scy, rad * 1.05);
      rg.addColorStop(0, "#f1e6c4");
      rg.addColorStop(1, "#d4be8a");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, cssW, cssH);
    });
    tracePoly(poly);
    ctx.strokeStyle = "rgba(120,100,58,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  fillPolys(s.woods, "#2f5d34");                  // tree stands
  ctx.strokeStyle = "rgba(225,220,205,0.8)";       // cart paths
  ctx.lineWidth = Math.max(ws(0.8), 1);
  for (const poly of s.cartpath || []) strokePolyline(poly);

  drawGreen(false);

  for (const poly of s.water || []) {
    const r = visibleRect();
    withClip(poly, () => {
      const lg = ctx.createLinearGradient(0, wy(0, r.y), 0, wy(0, r.y + r.h));
      lg.addColorStop(0, "#34b3f1");
      lg.addColorStop(1, "#1666c1");
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, cssW, cssH);
    });
    tracePoly(poly);
    ctx.strokeStyle = "rgba(12,64,150,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

// Photoreal rendering: real aerial base + translucent play-surface overlays.
function drawPhotoSurfaces() {
  const s = HOLE.surfaces;
  drawAerial(); // grade + course-green wash are baked into the image (processAerial)
  ctx.globalAlpha = 0.16;                          // gentle fairway tint
  fillPolys(s.fairway, "#8ad98f");
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(60,48,18,0.45)";          // bunkers: outline (sand visible)
  ctx.lineWidth = 1.2;
  for (const poly of s.bunker || []) { if (!polyVisible(poly)) continue; tracePoly(poly); ctx.stroke(); }
  ctx.globalAlpha = 0.4;                           // water tint
  fillPolys(s.water, "#1f86d8");
  ctx.globalAlpha = 1;
  drawGreen(true);
}

let ballTrail = [];   // recent airborne ball positions (screen px) for motion trail
let _vignette = null; // cached edge-darkening gradient, keyed to viewport size
let _surround = null; // cached course-green surround gradient, keyed to viewport size
const FLAG_FAR = 70, FLAG_NEAR = 12; // world-unit range over which the flag shrinks

function draw() {
  const cssW = window.innerWidth, cssH = window.innerHeight;
  computeViewAABB(); // for off-screen polygon culling this frame
  if (HOLE._imgReady && HOLE.aerial) {
    // surround the aerial with a dark course-green wash (a gradient that reads as
    // the rest of the course) rather than a hard black box.
    if (!_surround || _surround.w !== cssW || _surround.h !== cssH) {
      const g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, "#13351c");
      g.addColorStop(1, "#0c2614");
      _surround = { w: cssW, h: cssH, grad: g };
    }
    ctx.fillStyle = _surround.grad;
    ctx.fillRect(0, 0, cssW, cssH);
    drawPhotoSurfaces();
  } else {
    drawVectorSurfaces();
  }

  // target rings on the range; the cup + flag on the course
  if (HOLE.isRange) {
    const tx = wx(HOLE.holePos.x, HOLE.holePos.y), ty = wy(HOLE.holePos.x, HOLE.holePos.y);
    ctx.lineWidth = 2;
    for (const rr of [9, 6, 3]) { // concentric yard rings
      ctx.beginPath();
      ctx.arc(tx, ty, ws(rr / YARDS_PER_UNIT), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(230,40,40,0.85)";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(tx, ty, Math.max(ws(1 / YARDS_PER_UNIT), 4), 0, Math.PI * 2);
    ctx.fillStyle = "#e02a25";
    ctx.fill();
  } else {
  // hole cup — dark hole with a bright rim so it reads on the photo
  const hx = wx(HOLE.holePos.x, HOLE.holePos.y), hy = wy(HOLE.holePos.x, HOLE.holePos.y), hr = Math.max(ws(HOLE.holeRadius), 3);
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fillStyle = "#0a1f0f";
  ctx.fill();
  ctx.lineWidth = Math.max(hr * 0.18, 1);
  ctx.strokeStyle = "rgba(245,245,235,0.85)";
  ctx.stroke();

  // flagstick: shrinks as the ball nears the cup, and is "pulled" (hidden, only
  // the hole shows) once the ball is on the green.
  const _b = state.ball;
  const ballOnGreen = surfaceAt(_b.x, _b.y) === "green";
  const dToHole = Math.hypot(_b.x - HOLE.holePos.x, _b.y - HOLE.holePos.y);
  if (!ballOnGreen) {
    let fs = (dToHole - FLAG_NEAR) / (FLAG_FAR - FLAG_NEAR);
    fs = 0.55 + 0.45 * Math.max(0, Math.min(1, fs)); // 0.55 (near) .. 1 (far)
    const poleH = Math.max(ws(0.78), 22) * fs, topX = hx, topY = hy - poleH;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";   // short ground shadow of the stick
    ctx.lineWidth = 2.5 * fs;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + ws(4) * fs, hy + ws(1));
    ctx.stroke();
    ctx.strokeStyle = "#f4f4f0";             // the pole
    ctx.lineWidth = 2 * fs;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(topX, topY);
    ctx.stroke();
    const t = performance.now() / 180;       // waving red pennant flying right
    const flagL = Math.max(ws(0.5), 15) * fs, flagH = Math.max(ws(0.32), 10) * fs;
    const w1 = Math.sin(t) * Math.max(ws(0.05), 1.6) * fs, w2 = Math.sin(t + 1.2) * Math.max(ws(0.06), 2) * fs;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(topX + flagL * 0.5, topY - w1, topX + flagL, topY + flagH * 0.5 + w2);
    ctx.quadraticCurveTo(topX + flagL * 0.5, topY + flagH * 0.5 + w1, topX, topY + flagH);
    ctx.closePath();
    ctx.fillStyle = "#e02a25";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,15,12,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();                         // finial
    ctx.arc(topX, topY, Math.max(ws(1), 1.5) * fs, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f4f0";
    ctx.fill();
  }
  }

  // (no aim line — feel-based: read the hole, not a guide line)

  // ball + shadow — shadow sits on the ground at (x,y), ball is lifted by height z
  if (!state.inHole) {
    const b = state.ball;
    const gx = wx(b.x, b.y), gy = wy(b.x, b.y); // ground (shadow) position
    const lift = ws(b.z);             // screen pixels the ball floats above ground
    // Keep the ball clearly visible at every zoom (floor in screen px); real
    // scale only takes over when zoomed in far enough to exceed the floor.
    const baseR = Math.max(ws(BALL_RADIUS_UNITS), 4);

    // motion trail while airborne — fades from tail to ball
    if (b.z > 0.4) {
      ballTrail.push({ x: gx, y: gy - lift });
      if (ballTrail.length > 10) ballTrail.shift();
    } else {
      ballTrail.length = 0;
    }
    for (let i = 1; i < ballTrail.length; i++) {
      const f = i / ballTrail.length;
      ctx.strokeStyle = `rgba(255,255,255,${f * 0.4})`;
      ctx.lineWidth = baseR * f * 1.2;
      ctx.beginPath();
      ctx.moveTo(ballTrail[i - 1].x, ballTrail[i - 1].y);
      ctx.lineTo(ballTrail[i].x, ballTrail[i].y);
      ctx.stroke();
    }

    // shadow shrinks slightly as the ball climbs
    const shR = baseR * Math.max(0.45, 1 - b.z * 0.012);
    ctx.beginPath();
    ctx.ellipse(gx, gy, shR, shR * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fill();

    // ball grows slightly with height; top-left highlight for a 3D feel
    const r = baseR * (1 + b.z * 0.012);
    const bx = gx, by = gy - lift;
    const rg = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(0.6, "#f2f2ee");
    rg.addColorStop(1, "#cfcfc7");
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.strokeStyle = "rgba(120,120,110,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // vignette — darken edges to draw the eye toward the hole
  if (!_vignette || _vignette.w !== cssW || _vignette.h !== cssH) {
    const g = ctx.createRadialGradient(cssW / 2, cssH * 0.45, Math.min(cssW, cssH) * 0.35,
                                       cssW / 2, cssH * 0.5, Math.max(cssW, cssH) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    _vignette = { w: cssW, h: cssH, grad: g };
  }
  ctx.fillStyle = _vignette.grad;
  ctx.fillRect(0, 0, cssW, cssH);

  // range finder: dashed lines ball->marker and marker->pin with yard labels
  if (measureMode && measurePoint) {
    const b = state.ball;
    const bx = wx(b.x, b.y), by = wy(b.x, b.y);
    const mx = wx(measurePoint.x, measurePoint.y), my = wy(measurePoint.x, measurePoint.y);
    const px = wx(HOLE.holePos.x, HOLE.holePos.y), py = wy(HOLE.holePos.x, HOLE.holePos.y);
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(mx, my); ctx.stroke();   // ball -> marker
    ctx.strokeStyle = "rgba(255,214,90,0.9)";
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(px, py); ctx.stroke();   // marker -> pin
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    const yBall = Math.round(dist(b.x, b.y, measurePoint.x, measurePoint.y) * YARDS_PER_UNIT);
    const yPin = Math.round(dist(measurePoint.x, measurePoint.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT);
    drawLabel((bx + mx) / 2, (by + my) / 2, yBall + " yds", "#fff");
    drawLabel((mx + px) / 2, (my + py) / 2, yPin + " yds", "#ffd65a");
  }

  // hole-change transition: fade out to course-green, swap the hole at the
  // midpoint (starting zoomed out so the camera eases in), then fade back.
  if (holeTransition) {
    const p = Math.min(1, (performance.now() - holeTransition.t0) / holeTransition.dur);
    const a = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5; // 0 -> 1 -> 0
    if (p >= 0.5 && !holeTransition.swapped) {
      holeTransition.advance();
      camera.scale = camera.tScale * 0.6; // start zoomed out, let updateCamera ease in
      holeTransition.swapped = true;
    }
    ctx.fillStyle = `rgba(11,40,21,${a.toFixed(3)})`;
    ctx.fillRect(0, 0, cssW, cssH);
    if (p >= 1) holeTransition = null;
  }
}

// Animate a hole change: `advanceFn` performs the actual setHole at the fade midpoint.
function advanceHole(advanceFn) {
  if (holeTransition) return;
  holeTransition = { t0: performance.now(), dur: 850, advance: advanceFn, swapped: false };
}

// =====================================================================
//  Scorecard / result UI
// =====================================================================
const elStrokes = document.getElementById("strokes");
const elScore = document.getElementById("score");
const elResult = document.getElementById("result");
const elHint = document.getElementById("hint");
const elHoleLabel = document.getElementById("holeLabel");
const elCourse = document.getElementById("course");
const elPar = document.getElementById("par");
const elYards = document.getElementById("yards");

// Running total across completed holes. Score shows E until a hole is finished.
const round = { score: 0, holesPlayed: 0 };

function formatToPar(d) {
  if (d === 0) return "E";
  return d > 0 ? "+" + d : String(d);
}
function updateScorecard() {
  if (elCourse) elCourse.textContent = course ? course.name : "";
  if (elHoleLabel) elHoleLabel.textContent = "Hole " + (HOLE.num || 1);
  elPar.textContent = HOLE.par;
  elYards.textContent = HOLE.yards;
  elStrokes.textContent = state.strokes;
  elScore.textContent = formatToPar(round.score);
  elScore.className = round.score < 0 ? "under" : round.score > 0 ? "over" : "even";
}
function hideHint() { elHint.classList.add("hidden"); }

function showResult() {
  const d = state.strokes - HOLE.par;
  // Hole done: fold this hole's result into the running round total.
  round.score += d;
  round.holesPlayed += 1;
  updateScorecard();
  const names = { "-3": "Albatross!", "-2": "Eagle!", "-1": "Birdie!",
                  "0": "Par", "1": "Bogey", "2": "Double bogey" };
  const title = state.strokes === 1 ? "Hole in one!" : (names[String(d)] || (d > 0 ? "+" + d : d));
  document.getElementById("result-title").textContent = title;
  document.getElementById("result-detail").textContent =
    `${state.strokes} stroke${state.strokes === 1 ? "" : "s"} · ${formatToPar(d)} this hole · ${formatToPar(round.score)} total`;
  elResult.classList.remove("hidden");
}

document.getElementById("play-again").addEventListener("click", () => {
  elResult.classList.add("hidden");
  advanceHole(() => {
    // advance to the next hole (wraps to #1 after the last)
    if (course) {
      holeIndex = (holeIndex + 1) % course.holes.length;
      setHole(course.holes[holeIndex]);
    } else {
      setHole(FALLBACK_HOLE);
    }
    elHint.classList.remove("hidden");
  });
});

// =====================================================================
//  Course loading & hole setup
// =====================================================================
let course = null;   // loaded course JSON ({ id, name, yardsPerUnit, holes:[] })
let holeIndex = 0;

// Build the live HOLE + WORLD from a course hole record and start it fresh.
// Global courses share one world/aerial/surfaces map across all holes (the hole
// rec only carries num/par/yards/tee/pin); standalone recs (range, fallback)
// carry their own world/surfaces/aerial.
function setHole(rec) {
  const glob = !!(course && course.global && !rec.world);
  const src = glob ? course : rec; // where world/surfaces/aerial come from
  HOLE = {
    num: rec.num || 1,
    par: rec.par,
    yards: rec.yards,
    teePos: { x: rec.tee.x, y: rec.tee.y },
    holePos: { x: rec.pin.x, y: rec.pin.y },
    holeRadius: HOLE_RADIUS_UNITS,
    greenSpeed: rec.greenSpeed || src.greenSpeed || DEFAULT_STIMP,
    world: src.world,
    surfaces: src.surfaces,
    aerial: src.aerial || null,
    isGlobal: glob,
  };
  if (glob) {
    // share precomputed topo + the one aerial across every hole (load once)
    if (!course._greens) course._greens = buildGreenTopo(course.surfaces.green);
    HOLE._greens = course._greens;
    if (course._img === undefined) {
      course._img = null; course._imgReady = false;
      if (src.aerial && src.aerial.file && typeof Image !== "undefined") {
        const img = new Image();
        img.onload = () => {
          const baked = processAerial(img);
          course._img = baked; course._imgReady = true;
          if (HOLE && HOLE.isGlobal) { HOLE._img = baked; HOLE._imgReady = true; }
        };
        img.src = "courses/" + src.aerial.file;
      }
    }
    HOLE._img = course._img; HOLE._imgReady = course._imgReady;
  } else {
    HOLE._greens = buildGreenTopo(HOLE.surfaces.green);
    HOLE._img = null; HOLE._imgReady = false;
    if (src.aerial && src.aerial.file && typeof Image !== "undefined") {
      const target = HOLE;
      const img = new Image();
      img.onload = () => { if (HOLE === target) { HOLE._img = processAerial(img); HOLE._imgReady = true; } };
      img.src = "courses/" + src.aerial.file;
    }
  }
  WORLD.w = src.world.w;
  WORLD.h = src.world.h;
  // green speed -> deceleration -> putt cap; then refresh power for this scale.
  TUNE.greenDecel = GREEN_DECEL_K / HOLE.greenSpeed;
  recalcPower();

  resetState();
  autoClub(); // tee club for the hole length (range lets the player choose)
  // rotate the camera so this hole's tee->pin points up the screen (plays "up"
  // even though the global map is north-up and holes face different ways).
  const alpha = Math.atan2(HOLE.holePos.y - HOLE.teePos.y, HOLE.holePos.x - HOLE.teePos.x);
  camera.tAngle = -Math.PI / 2 - alpha;
  camera.angle = camera.tAngle; cameraAiming = false; // instant orient on hole change
  frameTarget();
  holeFitW = camera._w; holeFitH = camera._h;          // full-hole fit -> refScale
  camera.focus = { x: camera.tFocus.x, y: camera.tFocus.y }; // snap, no ease-in
  camera.scale = camera.tScale;
  resize();
  updateScorecard();
  elResult.classList.add("hidden");
  elHint.classList.remove("hidden");
}

// Hardcoded fallback (offline / file:// or fetch failure): a simple par 4.
function circlePoly(cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}
const FALLBACK_HOLE = {
  num: 1, par: 4, yards: 450, world: { w: 100, h: 180 },
  tee: { x: 50, y: 165 }, pin: { x: 52, y: 22 }, greenSpeed: 12,
  surfaces: {
    green: [circlePoly(52, 22, 16, 28)],
    fairway: [[
      { x: 38, y: 168 }, { x: 62, y: 168 }, { x: 66, y: 110 }, { x: 70, y: 60 },
      { x: 64, y: 40 }, { x: 40, y: 40 }, { x: 34, y: 60 }, { x: 32, y: 110 },
    ]],
    bunker: [],
    water: [[{ x: 70, y: 95 }, { x: 88, y: 95 }, { x: 88, y: 55 }, { x: 72, y: 58 }]],
    tee: [],
  },
};

async function loadCourse(id) {
  const res = await fetch("courses/" + id + ".json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  course = await res.json();
  YARDS_PER_UNIT = course.yardsPerUnit || YARDS_PER_UNIT;
  course._greens = null; course._img = undefined; course._imgReady = false; // shared caches
  holeIndex = 0;
  setHole(course.holes[holeIndex]);
}

// =====================================================================
//  Menu, driving range & shot-stats HUD
// =====================================================================
const elMenu = document.getElementById("menu");
const elStats = document.getElementById("stats");
const elRangeUI = document.getElementById("range-ui");
const elScorecard = document.getElementById("scorecard");
const rangeSlider = document.getElementById("range-slider");
const elRangeYards = document.getElementById("range-yards");
const elRangeResult = document.getElementById("range-result");
const stLie = document.getElementById("st-lie");
const stLieNote = document.getElementById("st-lie-note");
const stCarry = document.getElementById("st-carry");
const stTotal = document.getElementById("st-total");
const stSpeed = document.getElementById("st-speed");
const stPin = document.getElementById("st-pin");
const rowCarry = stCarry.parentElement;

function rangeFeedback(msg) { if (elRangeResult) elRangeResult.textContent = msg; }

// Human label for the ball's current lie (Tee/Fairway/Rough/Sand/...).
const LIE_NAMES = { fairway: "Fairway", green: "Green", bunker: "Sand",
                    water: "Water", woods: "Trees", rough: "Rough", tee: "Tee" };
function lieLabel() {
  const b = state.ball;
  if (!HOLE.isRange &&
      (state.strokes === 0 || inAnyPoly(b.x, b.y, HOLE.surfaces.tee) ||
       dist(b.x, b.y, HOLE.teePos.x, HOLE.teePos.y) < 4)) return "Tee";
  return LIE_NAMES[surfaceAt(b.x, b.y)] || "Rough";
}
// Note under the lie. Distance is unaffected for now (every shot plays full), so
// this just flags the real hazards (water/trees penalty); other lies = no note.
function lieNote(label) {
  switch (label) {
    case "Green": return "Putting surface";
    case "Trees": return "Out of bounds · +1 penalty";
    case "Water": return "Water hazard · +1 penalty";
    default: return "";
  }
}

// Launch speed (units/frame) -> a believable ball speed, calibrated so a full
// swing reads ~175 mph (tour driver) and scales down with power.

// Shot stats HUD. Yards normally; feet (carry omitted) once on the green.
function updateStats() {
  if (mode === "menu") { elStats.classList.add("hidden"); return; }
  elStats.classList.remove("hidden");
  updateClubUI();
  const lie = lieLabel();
  stLie.textContent = lie;
  stLieNote.textContent = lieNote(lie);
  const b = state.ball;
  const onGreen = !HOLE.isRange && surfaceAt(b.x, b.y) === "green";
  const toPin = dist(b.x, b.y, HOLE.holePos.x, HOLE.holePos.y) * YARDS_PER_UNIT;
  const spd = shot.mph ? shot.mph + " mph" : "—";
  if (onGreen) {
    rowCarry.style.display = "none";                       // putting: feet, no carry
    stTotal.textContent = shot.total != null ? Math.round(shot.total * 3) + " ft" : "—";
    stSpeed.textContent = spd;
    stPin.textContent = Math.round(toPin * 3) + " ft";
  } else {
    rowCarry.style.display = "";
    stCarry.textContent = shot.carry != null ? Math.round(shot.carry) + " yds" : "—";
    stTotal.textContent = shot.total != null ? Math.round(shot.total) + " yds" : "—";
    stSpeed.textContent = spd;
    stPin.textContent = Math.round(toPin) + " yds";
  }
}

// Synthetic driving range: a long turf strip, tee at the bottom, a target ring
// `targetYds` up the range. No cup, no hazards.
function buildRangeRec(targetYds) {
  const ypu = YARDS_PER_UNIT;
  const w = 54, h = 300 / ypu + 28;     // fits up to a 300-yd target + margin
  const cx = w / 2, teeY = h - 12;
  const tgtY = teeY - targetYds / ypu;
  return {
    num: 1, par: 0, yards: targetYds, world: { w, h },
    tee: { x: cx, y: teeY }, pin: { x: cx, y: tgtY }, aerial: null,
    surfaces: {
      fairway: [[{ x: cx - 10, y: teeY + 4 }, { x: cx + 10, y: teeY + 4 },
                 { x: cx + 8, y: 6 }, { x: cx - 8, y: 6 }]],
      tee: [[{ x: cx - 2, y: teeY + 2 }, { x: cx + 2, y: teeY + 2 },
             { x: cx + 2, y: teeY - 2 }, { x: cx - 2, y: teeY - 2 }]],
      green: [], bunker: [], water: [], grass: [], woods: [], cartpath: [],
    },
  };
}

// Fixed range camera (angle 0): frame the tee and the target together.
function frameRange() {
  const t = HOLE.teePos, p = HOLE.holePos, pad = 8;
  const w = Math.abs(t.x - p.x) + 2 * pad, h = Math.abs(t.y - p.y) + 2 * pad;
  camera.tAngle = 0;
  camera._w = w; camera._h = h;
  camera.tScale = Math.min(window.innerWidth / w, window.innerHeight / h);
  camera.tFocus = { x: (t.x + p.x) / 2, y: (t.y + p.y) / 2 };
}

const elCourseMenu = document.getElementById("course-menu");
const elCourseMenuBtn = document.getElementById("course-menu-btn");
const elHoleGrid = document.getElementById("hole-grid");

function buildHoleGrid() {
  if (!course) return;
  elHoleGrid.innerHTML = "";
  course.holes.forEach((h, i) => {
    const cell = document.createElement("button");
    cell.className = "hole-cell" + (i === holeIndex ? " current" : "");
    cell.innerHTML = `<span class="hn">${h.num || i + 1}</span><span class="hp">Par ${h.par}</span>`;
    cell.addEventListener("click", () => {
      closeCourseMenu();
      advanceHole(() => { holeIndex = i; setHole(course.holes[i]); });
    });
    elHoleGrid.appendChild(cell);
  });
}
function openCourseMenu() { if (mode !== "course") return; buildHoleGrid(); elCourseMenu.classList.remove("hidden"); }
function closeCourseMenu() { elCourseMenu.classList.add("hidden"); }
elCourseMenuBtn.addEventListener("click", openCourseMenu);
document.getElementById("cm-resume").addEventListener("click", closeCourseMenu);
document.getElementById("cm-home").addEventListener("click", () => { closeCourseMenu(); showMenu(); });

// Bottom-right course controls: aim camera at hole, range finder.
const elCourseControls = document.getElementById("course-controls");
const elAimBtn = document.getElementById("aim-btn");
const elMeasureBtn = document.getElementById("measure-btn");
function aimAtHole() {
  // re-aim so "up" points from the BALL straight at the pin — smoothly (updateCamera eases)
  const a = Math.atan2(HOLE.holePos.y - state.ball.y, HOLE.holePos.x - state.ball.x);
  camera.tAngle = -Math.PI / 2 - a;
  frameTarget();          // recompute focus/scale for the new aim (stable during ease)
  cameraAiming = true;
}
function setMeasureMode(on) {
  measureMode = on;
  if (!on) { measurePoint = null; measureDragging = false; }
  elMeasureBtn.classList.toggle("active", on);
}
elAimBtn.addEventListener("click", aimAtHole);
elMeasureBtn.addEventListener("click", () => setMeasureMode(!measureMode));

// Club selector: +/- steps through the bag (putter is automatic on the green).
const elClubBar = document.getElementById("club-bar");
const elClubName = document.getElementById("club-name");
const elClubYds = document.getElementById("club-yds");
function updateClubUI() {
  const onGreen = HOLE && !HOLE.isRange && surfaceAt(state.ball.x, state.ball.y) === "green";
  elClubBar.classList.toggle("putting", !!onGreen);
  if (onGreen) { elClubName.textContent = "Putter"; elClubYds.textContent = ""; }
  else {
    const c = TUNE.clubs[selectedClub];
    elClubName.textContent = c.name; elClubYds.textContent = c.carry + "y";
  }
}
function stepClub(delta) { // +1 = longer club, -1 = shorter
  const i = CLUB_ORDER.indexOf(selectedClub);
  selectedClub = CLUB_ORDER[Math.max(0, Math.min(CLUB_ORDER.length - 1, i - delta))];
  updateClubUI();
}

// ← / → aim: a single tap is one small eased nudge; holding (OS auto-repeat)
// switches to a smooth continuous turn (updateCamera). Swipe up fires along it.
function aimNudge(dir) {
  if ((mode !== "course" && mode !== "range") || !canSwing()) return;
  camera.tAngle += dir * AIM_NUDGE;
  frameTarget();
  cameraAiming = true; // eased to the new target by updateCamera
}
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (e.repeat) return;              // one club step per tap
    stepClub(e.key === "ArrowUp" ? 1 : -1); // up = longer club, down = shorter
    return;
  }
  const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  if (e.repeat) aimKey = dir;   // held -> continuous
  else aimNudge(dir);           // single tap -> one fixed nudge
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" && aimKey === 1) aimKey = 0;
  else if (e.key === "ArrowRight" && aimKey === -1) aimKey = 0;
});

function showMenu() {
  mode = "menu";
  elMenu.classList.remove("hidden");
  elRangeUI.classList.add("hidden");
  elStats.classList.add("hidden");
  elCourseMenuBtn.classList.add("hidden");
  elCourseControls.classList.add("hidden");
  elClubBar.classList.add("hidden");
  setMeasureMode(false);
  closeCourseMenu();
}

// Switch the world scale (yards/unit) and refresh derived power if it changed.
function setYardsPerUnit(ypu) {
  if (ypu && YARDS_PER_UNIT !== ypu) { YARDS_PER_UNIT = ypu; recalcPower(); }
}

function startCourse() {
  mode = "course";
  elMenu.classList.add("hidden");
  elRangeUI.classList.add("hidden");
  elScorecard.style.display = "";
  elCourseMenuBtn.classList.remove("hidden");
  elCourseControls.classList.remove("hidden");
  elClubBar.classList.remove("hidden");
  selectedClub = "driver";
  shot.carry = shot.total = null; shot.mph = 0;
  if (course) {
    setYardsPerUnit(course.yardsPerUnit);   // restore course scale (range may have changed it)
    holeIndex = 0;
    setHole(course.holes[0]);
  } else {
    loadCourse("pinehurst-no2").catch((e) => { console.warn(e); setHole(FALLBACK_HOLE); });
  }
}

let rangeRec = null; // baked real driving range (Pinehurst practice range)
async function startRange() {
  mode = "range";
  elMenu.classList.add("hidden");
  elScorecard.style.display = "none";
  elRangeUI.classList.remove("hidden");
  elCourseMenuBtn.classList.add("hidden");
  elCourseControls.classList.add("hidden");
  elClubBar.classList.remove("hidden");
  setMeasureMode(false);
  elHint.classList.add("hidden");
  rangeTarget = parseInt(rangeSlider.value, 10);
  if (!rangeRec) {
    try {
      const r = await fetch("courses/range.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      rangeRec = await r.json();
    } catch (e) {
      console.warn("Range load failed, using synthetic range:", e);
      rangeRec = buildRangeRec(rangeTarget); // offline fallback
    }
  }
  setYardsPerUnit(rangeRec.yardsPerUnit);
  setHole(rangeRec);
  HOLE.isRange = true;
  // target ring at the chosen yardage straight up the range from the tee
  HOLE.holePos = { x: HOLE.teePos.x, y: HOLE.teePos.y - rangeTarget / YARDS_PER_UNIT };
  HOLE.yards = rangeTarget;
  frameRange();
  snapCamera();
  shot.carry = shot.total = null; shot.mph = 0;
  rangeFeedback("Aim up the range");
}

document.getElementById("play-course").addEventListener("click", startCourse);
document.getElementById("play-range").addEventListener("click", startRange);
document.getElementById("range-menu-btn").addEventListener("click", showMenu);
rangeSlider.addEventListener("input", () => {
  rangeTarget = parseInt(rangeSlider.value, 10);
  elRangeYards.textContent = rangeTarget;
  if (mode === "range") {
    HOLE.holePos = { x: HOLE.teePos.x, y: HOLE.teePos.y - rangeTarget / YARDS_PER_UNIT };
    HOLE.yards = rangeTarget;
    frameRange();
    snapCamera();
  }
});

// =====================================================================
//  Main loop
// =====================================================================
function loop() {
  update();
  updateCamera();
  updateStats();
  draw();
  requestAnimationFrame(loop);
}

// Boot to the home menu over a course backdrop. Pinehurst loads in the
// background so "Play Course" starts instantly (keeps the fallback on error).
setHole(FALLBACK_HOLE);
loop();
showMenu();
loadCourse("pinehurst-no2").catch((e) => {
  console.warn("Course load failed, using fallback hole:", e);
});
