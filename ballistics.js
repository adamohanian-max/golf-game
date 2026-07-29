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

  // Fitted aero coefficients. clK/clP set the Magnus lift curve, cd0/cdS the
  // drag; spinTau is the spin-decay time constant (≈19 s at 100 mph — over a
  // 6 s flight a driver keeps ~73% of its launch spin, which is why real
  // drives flatten late instead of ballooning).
  // These sit ON the published wind-tunnel values, not off in fudge-land: at a
  // driver's spin ratio (S ≈ 0.074) they give Cd ≈ 0.250 and Cl ≈ 0.170, which
  // is what a dimpled ball actually measures. Verified end-to-end — 171 mph /
  // 10.9° / 2545 rpm flies 270 yd with a 7.1 s hang and a 42° descent, against
  // a real tour driver's 275 yd / 6.3 s / 38°.
  const COEF = {
    clK: 0.48, clP: 0.40,     // Cl = clK · S^clP
    cd0: 0.237, cdS: 0.18,    // Cd = cd0 + cdS · S
    spinTau: 19.0,            // s  (≈19 s at 100 mph)
    clMax: 0.45,              // physical ceiling on the lift coefficient
  };

  const liftCoef = (S) => Math.min(COEF.clMax, COEF.clK * Math.pow(S, COEF.clP));
  const dragCoef = (S) => COEF.cd0 + COEF.cdS * S;

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
    const Cd = dragCoef(S), Cl = liftCoef(S);
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

  return {
    BALL, RHO_SEA, G, COEF,
    liftCoef, dragCoef, accel, step, launchState, flyToLanding,
    MPH_PER_MS: 2.23694, M_PER_YD: 0.9144,
  };
});
