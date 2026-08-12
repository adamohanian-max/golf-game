// =====================================================================
//  ballistics.js — real golf-ball aerodynamics (SI units, pure functions)
// =====================================================================
// Loaded as a plain script before game.js (sets window.Ballistics) AND
// require()-able from node (calibration + regression tools) — no DOM, no
// game state, no side effects. Everything here is pure so the live loop and
// the launch-time predictor (simShotRest) can share ONE stepper: the old
// engine kept a hand-copied mirror of every motion line, and keeping the two
// in step was a permanent source of drift.
//
// Model (all SI: metres, seconds, radians/s):
//   drag  F = ½·ρ·v_rel²·Cd·A   opposing the RELATIVE airflow (v_ball − v_wind)
//   Magnus F = ½·ρ·v_rel²·Cl·A  along  ω̂ × v̂_rel
//   spin decay  ω(t) = ω₀·e^(−t/τ)
// Cd and Cl are functions of the spin ratio S = ω·r / v — the standard
// non-dimensional grouping for a spinning sphere. Coefficients are FITTED
// (see tools/ball_calibrate.mjs) so the club table's real launch-monitor
// numbers reproduce its carry/apex/descent targets; the published wind-tunnel
// values are the starting point, not the answer, because a dimpled ball's
// Cd/Cl also depend on Reynolds number, which we fold into the fit.
//
// Wind is part of the airflow, NOT a side force: a headwind increases v_rel,
// which raises BOTH drag and lift — that is why into the wind a ball climbs,
// stalls and drops short, while downwind it flattens and runs. The old
// per-frame lateral acceleration could not produce either behaviour.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ballistics = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // --- invariants of a conforming golf ball (USGA) ---
  const BALL = {
    m: 0.04593,          // kg  (1.620 oz max)
    r: 0.021335,         // m   (42.67 mm dia min)
    get A() { return Math.PI * this.r * this.r; },  // m² frontal area
  };
  const RHO_SEA = 1.225; // kg/m³ at 15 °C, sea level
  const G = 9.81;        // m/s²

  // Fitted aero coefficients. clK/clMax set the Magnus lift curve, cd0/cdS the
  // drag; spinTau is the spin-decay time constant (≈19 s at 100 mph — over a
  // 6 s flight a driver keeps ~73% of its launch spin, which is why real
  // drives flatten late instead of ballooning).
  //
  // The lift law SATURATES: Cl rises ~linearly with spin ratio at low S and
  // flattens toward clMax near S ≈ 0.3, which is what a dimpled sphere actually
  // measures (Bearman & Harvey). The earlier power law `clK · S^clP` was the
  // single biggest source of error in this model — at a driver's S ≈ 0.07 it
  // returned Cl ≈ 0.17 against a measured ≈ 0.11, so low-spin clubs floated,
  // and the curve's slope was wrong across the rest of the bag: fed the real
  // TrackMan launch numbers it flew every iron ~16 yd long and flat (7i 188 yd
  // vs a tour 172), which forced the carry solver to hold ball speed DOWN and
  // land the ball 5-10° too shallow.
  // Drag carries a Reynolds term as well as a spin term. Without it the model
  // cannot be right about both ends of the bag at once: a driver leaves at
  // ~76 m/s (Re ≈ 2.2e5, past the dimple-induced drag crisis, Cd ≈ 0.23) while
  // a wedge leaves at ~36 m/s and every club finishes its descent near 25 m/s,
  // where Cd is materially higher. One spin-only Cd forced a compromise that
  // under-carried the driver AND landed the long irons 6-10° too shallow.
  // `cdRe` is that rise, ramped in linearly below `cdVRef`.
  // Fitted by `node tools/ball_calibrate.mjs --fit` against all 14 club rows at
  // once. Residuals: mean |descent| error 2.1°, mean |apex| error 1.6 yd, and
  // the solved ball speed lands a mean 2.2 mph from the club table's own
  // launch-monitor value. The one club that does not fit is the driver, which
  // lands ~6° steeper than a tour drive — see the note in ball_calibrate.mjs.
  const COEF = {
    clK: 6.726, clMax: 0.330,   // Cl = clMax · (1 − e^(−clK·S))
    cd0: 0.1694, cdS: 0.137,    // Cd = cd0 + cdS·S + cdRe·max(0, 1 − v/cdVRef)
    cdRe: 0.3254, cdVRef: 65,   // m/s
    spinTau: 30.3,              // s
  };

  const liftCoef = (S) => COEF.clMax * (1 - Math.exp(-COEF.clK * S));
  const dragCoef = (S, v) =>
    COEF.cd0 + COEF.cdS * S + COEF.cdRe * Math.max(0, 1 - v / COEF.cdVRef);

  // Acceleration (m/s²) on a ball moving at v with spin ω through air moving
  // at `wind`. `rho` lets courses at altitude play longer (thinner air = less
  // drag AND less lift).
  function accel(v, spin, wind, rho) {
    const wx = wind ? wind.x : 0, wy = wind ? wind.y : 0, wz = wind ? wind.z : 0;
    const rx = v.x - wx, ry = v.y - wy, rz = v.z - wz;      // relative airflow
    const sp = Math.hypot(rx, ry, rz);
    if (sp < 1e-6) return { x: 0, y: 0, z: -G };
    const w = Math.hypot(spin.x, spin.y, spin.z);
    const S = (w * BALL.r) / sp;                             // spin ratio
    const q = 0.5 * (rho || RHO_SEA) * sp * sp * BALL.A / BALL.m;  // accel scale
    const Cd = dragCoef(S, sp), Cl = liftCoef(S);
    // drag: opposes relative airflow
    let ax = -q * Cd * (rx / sp), ay = -q * Cd * (ry / sp), az = -q * Cd * (rz / sp);
    if (w > 1e-6) {
      // Magnus: ω̂ × v̂ (unit cross product — the magnitude lives in Cl)
      const ux = spin.x / w, uy = spin.y / w, uz = spin.z / w;
      const dx = rx / sp, dy = ry / sp, dz = rz / sp;
      let cx = uy * dz - uz * dy, cy = uz * dx - ux * dz, cz = ux * dy - uy * dx;
      const cm = Math.hypot(cx, cy, cz);
      if (cm > 1e-9) {
        ax += q * Cl * (cx / cm); ay += q * Cl * (cy / cm); az += q * Cl * (cz / cm);
      }
    }
    return { x: ax, y: ay, z: az - G };
  }

  // One RK4 step of dt seconds. RK4 (not Euler) because at 75 m/s launch the
  // acceleration changes fast enough that Euler at 1/60 s visibly shortens
  // carry; RK4 at 1/120 s is exact to well under a yard.
  function step(s, dt, env) {
    const wind = env && env.wind, rho = env && env.rho;
    const k = (st) => accel(st.v, st.spin, wind, rho);
    const at = (f) => ({
      p: { x: s.p.x + f.v.x, y: s.p.y + f.v.y, z: s.p.z + f.v.z },
      v: { x: s.v.x + f.a.x, y: s.v.y + f.a.y, z: s.v.z + f.a.z },
      spin: s.spin,
    });
    const a1 = k(s);
    const s2 = at({ v: mul(s.v, dt / 2), a: mul(a1, dt / 2) });
    const a2 = k(s2);
    const s3 = at({ v: mul(s2.v, dt / 2), a: mul(a2, dt / 2) });
    const a3 = k(s3);
    const s4 = at({ v: mul(s3.v, dt), a: mul(a3, dt) });
    const a4 = k(s4);
    const vx = (s.v.x + 2 * s2.v.x + 2 * s3.v.x + s4.v.x) / 6;
    const vy = (s.v.y + 2 * s2.v.y + 2 * s3.v.y + s4.v.y) / 6;
    const vz = (s.v.z + 2 * s2.v.z + 2 * s3.v.z + s4.v.z) / 6;
    const ax = (a1.x + 2 * a2.x + 2 * a3.x + a4.x) / 6;
    const ay = (a1.y + 2 * a2.y + 2 * a3.y + a4.y) / 6;
    const az = (a1.z + 2 * a2.z + 2 * a3.z + a4.z) / 6;
    s.p.x += vx * dt; s.p.y += vy * dt; s.p.z += vz * dt;
    s.v.x += ax * dt; s.v.y += ay * dt; s.v.z += az * dt;
    const decay = Math.exp(-dt / COEF.spinTau);
    s.spin.x *= decay; s.spin.y *= decay; s.spin.z *= decay;
    return s;
  }
  const mul = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });

  // Build a launch state from real launch-monitor numbers.
  //   ballMph   ball speed off the face
  //   launchDeg vertical launch angle
  //   spinRpm   BACKspin rate
  //   dir       {x,y} horizontal unit aim vector
  //   axisTiltDeg  spin-axis tilt (+ = right/fade for a right-hander) — this
  //                is how real curvature works: the ball curves because the
  //                lift vector tilts, not because a side force is bolted on.
  function launchState(ballMph, launchDeg, spinRpm, dir, axisTiltDeg) {
    const v0 = ballMph * 0.44704;                       // mph → m/s
    const th = launchDeg * Math.PI / 180;
    const dx = dir ? dir.x : 1, dy = dir ? dir.y : 0;
    const dm = Math.hypot(dx, dy) || 1;
    const ux = dx / dm, uy = dy / dm;
    const v = { x: ux * v0 * Math.cos(th), y: uy * v0 * Math.cos(th), z: v0 * Math.sin(th) };
    // backspin axis = d̂ × ẑ (gives Magnus straight up for pure backspin)
    let sx = uy * 1, sy = -ux * 1, sz = 0;
    const tilt = (axisTiltDeg || 0) * Math.PI / 180;
    if (tilt) {
      // rotate the spin axis about the aim direction: tilts lift sideways
      const c = Math.cos(tilt), si = Math.sin(tilt);
      const kx = ux, ky = uy, kz = 0;                    // rotation axis = aim
      const dot = sx * kx + sy * ky + sz * kz;
      const cxx = ky * sz - kz * sy, cyy = kz * sx - kx * sz, czz = kx * sy - ky * sx;
      sx = sx * c + cxx * si + kx * dot * (1 - c);
      sy = sy * c + cyy * si + ky * dot * (1 - c);
      sz = sz * c + czz * si + kz * dot * (1 - c);
    }
    const w = spinRpm * 2 * Math.PI / 60;                // rpm → rad/s
    return { p: { x: 0, y: 0, z: 0 }, v, spin: { x: sx * w, y: sy * w, z: sz * w } };
  }

  // Fly until the ball returns to z = 0 (or `groundZ(x,y)` when supplied).
  // Returns the trajectory summary the calibrator and the game both need.
  function flyToLanding(s0, env, opts) {
    const dt = (opts && opts.dt) || 1 / 120;
    const maxT = (opts && opts.maxT) || 25;
    const groundZ = opts && opts.groundZ;
    const s = { p: { ...s0.p }, v: { ...s0.v }, spin: { ...s0.spin } };
    let t = 0, apex = s.p.z, prev = null;
    while (t < maxT) {
      prev = { p: { ...s.p }, v: { ...s.v }, t };
      step(s, dt, env);
      t += dt;
      if (s.p.z > apex) apex = s.p.z;
      const gz = groundZ ? groundZ(s.p.x, s.p.y) : 0;
      if (s.p.z <= gz && t > dt) {
        // linear-interpolate the crossing so carry doesn't quantize to a step
        const z0 = prev.p.z - (groundZ ? groundZ(prev.p.x, prev.p.y) : 0);
        const z1 = s.p.z - gz;
        const f = z0 === z1 ? 0 : z0 / (z0 - z1);
        s.p.x = prev.p.x + (s.p.x - prev.p.x) * f;
        s.p.y = prev.p.y + (s.p.y - prev.p.y) * f;
        s.p.z = gz;
        t = prev.t + dt * f;
        break;
      }
    }
    const vh = Math.hypot(s.v.x, s.v.y);
    return {
      carry: Math.hypot(s.p.x - s0.p.x, s.p.y - s0.p.y),   // m
      apex,                                                 // m
      hang: t,                                              // s
      descentDeg: Math.atan2(-s.v.z, vh) * 180 / Math.PI,
      landing: { p: s.p, v: s.v, spin: s.spin },
    };
  }

  // --- oblique impact with spin -------------------------------------------
  // A real golf ball landing is not a scripted "spend N yards of rollout": the
  // turf applies a normal impulse (restitution) AND a tangential friction
  // impulse that fights the CONTACT-POINT slip. With backspin the contact point
  // is racing forward, so friction acts backward — that single term is what
  // makes a wedge check and a spun ball hop back, with no special-casing.
  //   Jn = −(1+e)·m·v_n              (normal, upward)
  //   Jt = −min(μ·Jn, m·|u_t|)·û_t   (Coulomb-capped, opposes contact slip)
  //   ω' = ω + ((−r·n) × Jt)/I,  I = (2/5)m r²
  // `e` falls with impact speed (turf absorbs more from a harder strike), which
  // is why a steeply-dropping wedge sits and a shallow drive skips on.
  function bounce(s, surf) {
    const p = surf || { e: 0.4, mu: 0.45 };
    const m = BALL.m, r = BALL.r, I = 0.4 * m * r * r;
    const vn = s.v.z;                                  // ground normal = +z
    if (vn >= 0) return s;
    const speed = Math.abs(vn);
    const e = Math.max(0.05, (p.e || 0.4) * (1 - Math.min(0.55, speed / 45)));
    const mu = p.mu == null ? 0.45 : p.mu;
    const Jn = -(1 + e) * m * vn;                      // > 0, upward
    // contact-point velocity: v_t − r·(ω × n)
    const wxn = { x: s.spin.y * 1 - s.spin.z * 0, y: s.spin.z * 0 - s.spin.x * 1, z: 0 };
    const ux = s.v.x - r * wxn.x, uy = s.v.y - r * wxn.y;
    const um = Math.hypot(ux, uy);
    let jx = 0, jy = 0;
    if (um > 1e-6) {
      const jt = Math.min(mu * Jn, m * um);            // Coulomb cap / stick
      jx = -jt * (ux / um); jy = -jt * (uy / um);
    }
    s.v.x += jx / m; s.v.y += jy / m; s.v.z = -vn * e;
    // Soft-turf absorption ("the pitch mark"). Coulomb friction assumes a rigid
    // plane, but a receptive green deforms: the ball digs a crater and the far
    // wall of it kills horizontal momentum well beyond what μ·Jn allows. Scaled
    // by impact speed, this is what separates a green that grabs a wedge from a
    // baked fairway that lets a drive skip on.
    const dig = (p.dig || 0) * Math.min(1, speed / 25);
    // The crater takes translation: the ball buries and hits the far wall of
    // its own pitch mark. That is a horizontal reaction through the centre, so
    // it does NOT remove angular momentum.
    if (dig > 0) { s.v.x *= 1 - dig; s.v.y *= 1 - dig; }
    // ...but soft turf cannot leave the ball spinning FORWARD faster than it is
    // travelling: that would be a wheel driving itself along, and without the
    // cap a ball landing at 1.9 m/s with 671 rad/s of topspin accelerated to
    // 3.1 m/s over two hops.
    //
    // DIRECTIONAL, and that matters: only the forward-rolling component is
    // capped. A ball may legitimately spin BACKWARD far faster than it travels
    // — that is exactly a checking wedge, and it is the mechanism that stops a
    // chip. Clamping the magnitude (as this first did) threw away two thirds of
    // a greenside wedge's backspin and chips ran out like putts.
    const vt = Math.hypot(s.v.x, s.v.y);
    if (vt > 1e-6) {
      const dx = s.v.x / vt, dy = s.v.y / vt;
      const fx = -dy, fy = dx;                     // ẑ × d̂: the forward-roll axis
      const fwd = s.spin.x * fx + s.spin.y * fy;   // signed forward-roll rate
      const wMax = vt / r;
      if (fwd > wMax) {                            // topspin only
        const excess = fwd - wMax;
        s.spin.x -= excess * fx; s.spin.y -= excess * fy;
      }
    }
    // torque from the tangential impulse at the contact point (−r·n)
    s.spin.x += (-r * jy) / I * -1;
    s.spin.y += (-r * jx) / I;
    // Mild spin loss to the impact itself. Deliberately NOT aggressive: the
    // tangential impulse above already changes spin physically, and an extra
    // blanket scrub here wiped out the retained backspin that checks a wedge.
    s.spin.x *= 0.90; s.spin.y *= 0.90; s.spin.z *= 0.90;
    return s;
  }

  // --- skid → roll ---------------------------------------------------------
  // THE reason greens hold. A ball that has just landed is SLIDING, not
  // rolling: its contact point is slipping, so the turf applies full kinetic
  // friction (μ·g, metres per second squared) — an order of magnitude more
  // deceleration than the rolling resistance that governs a putt. Friction
  // simultaneously spins the ball up until the rolling condition v = ω·r is
  // met, and only then does it settle into the low-resistance roll.
  //
  // With backspin the slip is enormous (the contact point races forward at
  // v + ωr), so the grip lasts and the ball checks. If the backspin is strong
  // enough, v reaches zero while ω is still negative and the ball rolls BACK —
  // spin-back falls out of the same equations, with nothing special-cased.
  //
  // `sv` is speed along the travel direction (signed, so it can reverse), `w`
  // is angular velocity (positive = rolling forward). Returns the new pair.
  function skidRoll(sv, w, surf, dt) {
    const p = surf || { mu: 0.45, roll: 3 };
    const mu = p.mu == null ? 0.45 : p.mu;
    const r = BALL.r;
    const u = sv - w * r;                      // contact-point slip
    if (Math.abs(u) > 0.02) {
      const sgn = Math.sign(u);
      const a = mu * G;                        // kinetic friction
      // SUB-STEP TO THE ROLLING TRANSITION. Slip closes at 3.5·a (a acting on
      // translation, 2.5a on spin), so when rolling would begin inside this
      // tick, integrate only up to that instant and switch. Stepping the whole
      // tick blindly overshoots: at a 3.75x time scale one tick is 62 ms and
      // moves speed ~0.5 m/s, so a slow ball flip-flopped across zero forever
      // and NEVER came to rest — which then blocked every later swing on
      // state.moving. This is the integration error the speed-up exposed.
      const tRoll = Math.abs(u) / (3.5 * a);
      const h = Math.min(dt, tRoll);
      sv -= sgn * a * h;
      w += sgn * (2.5 * a / r) * h;
      if (h < dt) {                            // rolling began mid-tick
        w = sv / r;                            // exact rolling condition
        const ar = p.roll || 0, dv = ar * (dt - h);   // spend the remainder rolling
        sv = Math.abs(sv) <= dv ? 0 : sv - Math.sign(sv) * dv;
        w = sv / r;
      }
    } else {
      const a = p.roll || 0;                   // true rolling resistance
      const dv = a * dt;
      sv = Math.abs(sv) <= dv ? 0 : sv - Math.sign(sv) * dv;
      w = sv / r;
    }
    return { sv, w };
  }

  // Rolling deceleration (m/s²) once the ball is on the ground. Green speed
  // comes straight from the stimpmeter definition — the device releases a ball
  // at 1.83 m/s and the stimp reading IS how far it rolls, so a = v²/(2d).
  // A 13.5 green gives 0.41 m/s²; the old engine ran 5.4, which is why putts
  // died in under two seconds.
  // The conversion itself, with no floor: ANY turf can be described by the
  // stimpmeter, and off-green surfaces are simply much slower ones (game.js
  // TUNE.turfStimp: fairway 5, rough 2, bunker 1). Split out of greenDecel
  // because that function's floor of 3 ft is a GREEN sanity guard, and reusing
  // it for turf silently collapsed rough, bunker and woods onto one value.
  function rollDecelFromStimp(stimpFt) {
    return (1.83 * 1.83) / (2 * Math.max(0.5, stimpFt || 1) * 0.3048);
  }
  // Greens only. Floors the reading at 3 ft: anything slower is not a putting
  // surface, and a bad greenSpeed in a course JSON must not hand the putter a
  // different game.
  function greenDecel(stimpFt) {
    return rollDecelFromStimp(Math.max(3, stimpFt || 11));
  }
  // A rolling (not sliding) ball on a slope accelerates at (5/7)·g·sinθ — the
  // 5/7 is the rolling-inertia factor for a solid sphere. Replaces the old
  // arbitrary slope constant and its ad-hoc cap.
  const SLOPE_ROLL_K = 5 / 7;

  return {
    BALL, RHO_SEA, G, COEF,
    liftCoef, dragCoef, accel, step, launchState, flyToLanding,
    bounce, skidRoll, greenDecel, rollDecelFromStimp, SLOPE_ROLL_K,
    MPH_PER_MS: 2.23694, M_PER_YD: 0.9144,
  };
});
