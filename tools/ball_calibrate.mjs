#!/usr/bin/env node
// Club calibration + regression gate for the aerodynamic ball model.
//
//   node tools/ball_calibrate.mjs            # check current coefficients (CI gate)
//   node tools/ball_calibrate.mjs --fit      # re-fit global aero coefficients
//   node tools/ball_calibrate.mjs --tol 1.5  # carry tolerance, yards
//
// The club table in game.js already carries real launch-monitor data per club
// (`ball` mph, `spin` rpm, `maxH` apex yd, `land` descent °). Under the aero
// model those are INPUTS and carry is an OUTPUT, so calibration is two-level:
//
//   global (7 params) : Cd/Cl curve shape — fit so apex + descent angle match
//                       the table across ALL clubs at once
//   per club (1 param): ball speed — solved so carry hits the table exactly
//
// Exits nonzero if any club's carry drifts past --tol, so this can gate a
// commit the same way engine_smoke gates course bakes.
//
// KNOWN RESIDUAL (2026-07-29 fit): the model's descent angle spans ~44-54°
// across the bag where the tour spans 39-55°, i.e. it is not quite sensitive
// enough to spin. Everything from the 6-iron down lands within ~1° of tour, the
// long irons come in 3-4° shallow, and the DRIVER lands ~6° too steep (45° vs
// 39°) — so drives run less than they should. This was chased hard: raising the
// spin term (cdS) over-steepens the wedges past 60° and demands a 137 mph
// 9-iron, and cdVRef shifts the whole bag together instead of spreading it.
// Fixing it properly needs a Cl that depends on Reynolds as well as spin ratio,
// not another knob on the current curve.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const B = createRequire(import.meta.url)(join(ROOT, 'ballistics.js'));
const YD = B.M_PER_YD;

// ---- pull the club table straight out of game.js (single source of truth) ----
function readClubs() {
  const src = readFileSync(join(ROOT, 'game.js'), 'utf8');
  const start = src.indexOf('clubs: {');
  if (start < 0) throw new Error('clubs table not found in game.js');
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const body = src.slice(i, end);
  // object literal with comments — Function-eval it in isolation (no game state)
  const obj = new Function('return (' + body + ');')();
  const out = [];
  for (const [id, c] of Object.entries(obj)) {
    if (id === 'putter' || !c.ball || !c.carry) continue;
    out.push({ id, name: c.name, ball: c.ball, spin: c.spin, carryYd: c.carry,
               apexYd: c.maxH, landDeg: c.land });
  }
  return out;
}

// PGA Tour average launch angles (TrackMan). These are REAL and stay fixed —
// a 7-iron leaves the face at ~16°, full stop. Solving launch angle instead was
// tried first and is a trap: carry is non-monotonic in launch, and the solver
// happily returns physically absurd 1-5° launches for irons because a
// lift-heavy model self-lofts.
const LAUNCH_DEG = {
  driver: 10.9, "3w": 9.2, "5w": 9.4, hybrid: 10.2, "3i": 10.4, "4i": 11.0,
  "5i": 12.1, "6i": 14.1, "7i": 16.3, "8i": 18.1, "9i": 20.4,
  pw: 24.2, sw: 28.0, lw: 31.5,
};

// Ball speed that makes this club carry exactly its rated distance. Carry IS
// monotonic in ball speed, so this bisection is well-posed (unlike launch
// angle). Ball speed is also the honest free parameter: it encodes how hard
// THIS player hits THIS club, while launch/spin are properties of the club.
// `fast` runs the search at a coarser integration step and a shorter bisection.
// The fit calls evaluate() thousands of times, and at full precision that took
// minutes; the reported table is always re-run at full precision.
const FINE = { dt: 1 / 120, iters: 34 };
const FAST = { dt: 1 / 100, iters: 18 };

function solveSpeed(club, coef, prec = FINE) {
  Object.assign(B.COEF, coef);
  const deg = LAUNCH_DEG[club.id];
  const carryAt = (mph) => {
    const s = B.launchState(mph, deg, club.spin, { x: 1, y: 0 }, 0);
    return B.flyToLanding(s, {}, { dt: prec.dt }).carry / YD;
  };
  let lo = 30, hi = 230;
  if (carryAt(hi) < club.carryYd) return { mph: hi, reach: false };
  for (let k = 0; k < prec.iters; k++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < club.carryYd) lo = mid; else hi = mid;
  }
  return { mph: (lo + hi) / 2, reach: true };
}

function evaluate(clubs, coef, prec = FINE) {
  Object.assign(B.COEF, coef);
  const rows = [];
  for (const c of clubs) {
    const { mph, reach } = solveSpeed(c, coef, prec);
    const deg = LAUNCH_DEG[c.id];
    const s = B.launchState(mph, deg, c.spin, { x: 1, y: 0 }, 0);
    const r = B.flyToLanding(s, {}, { dt: prec.dt });
    rows.push({ ...c, launchDeg: deg, solvedMph: mph, reach,
      carry: r.carry / YD, apex: r.apex / YD, hang: r.hang, desc: r.descentDeg });
  }
  return rows;
}

// Global objective: apex + descent shape across every club (carry is already
// exact by construction), plus the solved ball speed against the table's own
// launch-monitor value. That third term is not cosmetic — a fit that hits the
// shape by quietly hitting the ball 8 mph softer than a tour player is wrong
// about the flight, and it is what left the old coefficients landing mid-irons
// 10° too shallow.
function cost(rows) {
  let e = 0;
  for (const r of rows) {
    if (!r.reach) { e += 1e4; continue; }
    e += Math.pow(r.apex - r.apexYd, 2) * 1.5;       // trajectory height
    // descent carries the most weight: it is what decides whether a shot holds
    // a green, and it was the metric the old coefficients missed by 10 degrees
    e += Math.pow(r.desc - r.landDeg, 2) * 3.0;
    e += Math.pow(r.solvedMph - r.ball, 2) * 1.0;    // ball speed off the face
  }
  return e;
}

const KEYS = ['clK', 'clMax', 'cd0', 'cdS', 'cdRe', 'cdVRef', 'spinTau'];
const STEP0 = { clK: 1.2, clMax: 0.04, cd0: 0.03, cdS: 0.06, cdRe: 0.05, cdVRef: 8, spinTau: 5 };
const STEP_MIN = { clK: 0.01, clMax: 0.0015, cd0: 0.0006, cdS: 0.001, cdRe: 0.001, cdVRef: 0.3, spinTau: 0.15 };
// spinTau is bounded to the measured range for a golf ball (~15-40 s). Left free
// the search runs it to 130 s — i.e. no spin decay at all — because an
// ever-rising spin ratio is a cheap way to buy late lift.
const inBounds = (c) => c.clK > 0.5 && c.clK < 30 && c.clMax > 0.15 && c.clMax < 0.6 &&
                        c.cd0 > 0.10 && c.cd0 < 0.40 && c.cdS > 0 && c.cdS < 1.2 &&
                        c.cdRe >= 0 && c.cdRe < 0.5 &&
                        c.cdVRef >= 35 && c.cdVRef <= 95 &&
                        c.spinTau >= 15 && c.spinTau <= 40;

function descend(clubs, seed) {
  let best = { ...seed }, bestCost = cost(evaluate(clubs, best, FAST));
  let stepSize = { ...STEP0 };
  for (let pass = 0; pass < 60; pass++) {
    let improved = false;
    for (const k of KEYS) {
      for (const dir of [1, -1]) {
        const trial = { ...best, [k]: best[k] + dir * stepSize[k] };
        if (!inBounds(trial)) continue;
        const c = cost(evaluate(clubs, trial, FAST));
        if (c < bestCost - 1e-9) { best = trial; bestCost = c; improved = true; }
      }
    }
    if (!improved) for (const k of KEYS) stepSize[k] *= 0.55;
    if (KEYS.every((k) => stepSize[k] < STEP_MIN[k])) break;
  }
  return best;
}

// Coordinate descent is a local method and the old single-start version visibly
// parked in a local minimum, so run it from a spread of seeds and keep the best.
function fit(clubs, seed) {
  const seeds = [
    seed,
    { clK: 6.726, clMax: 0.330, cd0: 0.1694, cdS: 0.137, cdRe: 0.3254, cdVRef: 65, spinTau: 30.3 },
    { clK: 6.726, clMax: 0.330, cd0: 0.1694, cdS: 0.137, cdRe: 0.3254, cdVRef: 80, spinTau: 30.3 },
    { clK: 4.0, clMax: 0.40, cd0: 0.21, cdS: 0.30, cdRe: 0.05, cdVRef: 55, spinTau: 22 },
    { clK: 12.0, clMax: 0.24, cd0: 0.20, cdS: 0.12, cdRe: 0.22, cdVRef: 75, spinTau: 30 },
  ];
  let best = null, bestCost = Infinity;
  for (const s of seeds) {
    if (!inBounds(s)) continue;
    const c = descend(clubs, s);
    const score = cost(evaluate(clubs, c, FINE));   // rank at full precision
    if (score < bestCost) { best = c; bestCost = score; }
  }
  return { coef: best, cost: bestCost };
}

// ---- main ----
const argv = process.argv.slice(2);
const TOL = +(argv[argv.indexOf('--tol') + 1] || 1.5);
const clubs = readClubs();
let coef = { ...B.COEF };

if (argv.includes('--fit')) {
  const res = fit(clubs, coef);
  coef = res.coef;
  console.log('fitted coefficients (paste into ballistics.js COEF):');
  console.log('  clK: ' + coef.clK.toFixed(3) + ', clMax: ' + coef.clMax.toFixed(3) +
              ', cd0: ' + coef.cd0.toFixed(4) + ', cdS: ' + coef.cdS.toFixed(3) +
              ', cdRe: ' + coef.cdRe.toFixed(4) + ', spinTau: ' + coef.spinTau.toFixed(1));
  console.log('  shape cost: ' + res.cost.toFixed(1) + '\n');
}

const rows = evaluate(clubs, coef);
console.log('club     spin  launch  ballMph(tbl) |  carry (tgt) |  apex (tgt) | desc (tgt) | hang');
let worst = 0, fail = 0;
for (const r of rows) {
  const d = r.carry - r.carryYd;
  worst = Math.max(worst, Math.abs(d));
  if (Math.abs(d) > TOL) fail++;
  console.log(
    r.id.padEnd(7) + String(r.spin).padStart(6) +
    (r.launchDeg.toFixed(1) + '\u00b0').padStart(8) +
    r.solvedMph.toFixed(1).padStart(9) + ('(' + r.ball + ')').padStart(6) + ' |' +
    r.carry.toFixed(1).padStart(7) + String(r.carryYd).padStart(6) + ' |' +
    r.apex.toFixed(1).padStart(6) + String(r.apexYd).padStart(5) + ' |' +
    r.desc.toFixed(1).padStart(6) + String(r.landDeg).padStart(5) + ' |' +
    r.hang.toFixed(2).padStart(6) + 's');
}
console.log('\nball speeds for TUNE.clubs (launch angle fixed at the tour value):');
console.log('  ' + rows.map((r) => r.id + ': ball ' + r.solvedMph.toFixed(0) + ', launch ' + r.launchDeg.toFixed(1)).join('\n  '));
const hangs = rows.map((r) => r.hang);
console.log('hang time ' + Math.min(...hangs).toFixed(2) + '-' + Math.max(...hangs).toFixed(2) + 's (tour full-shot ~6-7s)');
console.log('worst carry drift ' + worst.toFixed(2) + ' yd (tolerance ' + TOL + ')');
if (fail) { console.error(fail + ' club(s) outside tolerance'); process.exit(1); }
