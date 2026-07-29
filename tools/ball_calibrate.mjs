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
//   global (4 params) : Cd/Cl curve shape — fit so apex + descent angle match
//                       the table across ALL clubs at once
//   per club (1 param): launch angle — solved so carry hits the table exactly
//
// Exits nonzero if any club's carry drifts past --tol, so this can gate a
// commit the same way engine_smoke gates course bakes.
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
function solveSpeed(club, coef) {
  Object.assign(B.COEF, coef);
  const deg = LAUNCH_DEG[club.id];
  const carryAt = (mph) => {
    const s = B.launchState(mph, deg, club.spin, { x: 1, y: 0 }, 0);
    return B.flyToLanding(s, {}, {}).carry / YD;
  };
  let lo = 30, hi = 230;
  if (carryAt(hi) < club.carryYd) return { mph: hi, reach: false };
  for (let k = 0; k < 34; k++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < club.carryYd) lo = mid; else hi = mid;
  }
  return { mph: (lo + hi) / 2, reach: true };
}

function evaluate(clubs, coef) {
  Object.assign(B.COEF, coef);
  const rows = [];
  for (const c of clubs) {
    const { mph, reach } = solveSpeed(c, coef);
    const deg = LAUNCH_DEG[c.id];
    const s = B.launchState(mph, deg, c.spin, { x: 1, y: 0 }, 0);
    const r = B.flyToLanding(s, {}, {});
    rows.push({ ...c, launchDeg: deg, solvedMph: mph, reach,
      carry: r.carry / YD, apex: r.apex / YD, hang: r.hang, desc: r.descentDeg });
  }
  return rows;
}

// global objective: apex + descent shape across every club (carry is already
// exact by construction), plus a nudge keeping launch angles physically sane
function cost(rows) {
  let e = 0;
  for (const r of rows) {
    if (!r.reach) { e += 1e4; continue; }
    e += Math.pow(r.apex - r.apexYd, 2) * 2.0;       // trajectory height
    e += Math.pow(r.desc - r.landDeg, 2) * 0.5;      // descent angle (holds greens)
    // solved ball speed should stay near the table's own launch-monitor value
    e += Math.pow(r.solvedMph - r.ball, 2) * 0.35;
  }
  return e;
}

function fit(clubs, seed) {
  let best = { ...seed }, bestCost = cost(evaluate(clubs, best));
  const keys = ['clK', 'clP', 'cd0', 'cdS', 'spinTau'];
  let stepSize = { clK: 0.12, clP: 0.12, cd0: 0.03, cdS: 0.06, spinTau: 5 };
  for (let pass = 0; pass < 60; pass++) {
    let improved = false;
    for (const k of keys) {
      for (const dir of [1, -1]) {
        const trial = { ...best, [k]: best[k] + dir * stepSize[k] };
        if (trial.clK <= 0.02 || trial.clP <= 0.05 || trial.cd0 <= 0.05 || trial.spinTau < 4) continue;
        const c = cost(evaluate(clubs, trial));
        if (c < bestCost - 1e-9) { best = trial; bestCost = c; improved = true; }
      }
    }
    if (!improved) for (const k of keys) stepSize[k] *= 0.55;
    if (Object.values(stepSize).every((v, i) => v < [0.002, 0.002, 0.0006, 0.001, 0.15][i])) break;
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
  console.log('  clK: ' + coef.clK.toFixed(3) + ', clP: ' + coef.clP.toFixed(3) +
              ', cd0: ' + coef.cd0.toFixed(4) + ', cdS: ' + coef.cdS.toFixed(3) +
              ', spinTau: ' + coef.spinTau.toFixed(1));
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
