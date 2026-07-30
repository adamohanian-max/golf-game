#!/usr/bin/env node
// GROUND-PHASE shot matrix + regression gate for the aerodynamic model.
//
//   node tools/shot_matrix.mjs                       # print the matrix
//   node tools/shot_matrix.mjs --json > before.json  # snapshot, edit, diff
//   node tools/shot_matrix.mjs --gate                # exit 1 on a release/shape regression
//   node tools/shot_matrix.mjs --surface fairway     # land full shots on a different turf
//
// tools/ball_calibrate.mjs covers FLIGHT only — it never calls bounce() or
// skidRoll(), and it pins launch at the club-table value. So it is structurally
// blind to the two things that make a wedge feel like a wedge: how high it goes
// on a PARTIAL swing, and what happens when it hits the ground. This harness
// covers exactly that gap.
//
// Everything below mirrors the live chain in game.js. Where a line is a copy,
// the game.js line is cited — if one drifts, the other is wrong:
//
//   aeroSpeedForCarry   game.js:1843-1855
//   buildFlight landD   game.js:1809-1821   (the carry the aero solver is handed)
//   aeroFlightStep      game.js:1884-1902
//   aeroGroundContact   game.js:1917-1928
//   aeroToRoll          game.js:1930-1942
//   rollStepSI          game.js:2229-2265
//   solveChipEf         game.js:3272-3296
//   buildTrialShot      game.js:3297-3440   (ef -> C -> spin -> launch delta)
//
// TUNE is parsed straight out of game.js, so there is one source of truth for
// every constant. No browser, no game state.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const B = createRequire(import.meta.url)(join(ROOT, 'ballistics.js'));
const YD = B.M_PER_YD;

// ---- pull TUNE straight out of game.js (single source of truth) ------------
// Same brace-matching trick readClubs() uses in ball_calibrate.mjs, widened to
// the whole TUNE literal so turf/chip/loft constants come along too.
function readTune() {
  const src = readFileSync(join(ROOT, 'game.js'), 'utf8');
  const start = src.indexOf('const TUNE = {');
  if (start < 0) throw new Error('TUNE not found in game.js');
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const T = new Function('return (' + src.slice(i, end) + ');')();
  // derived in recalcPower() at game.js:560-562, not in the literal
  for (const c in T.clubs) {
    T.clubs[c].spinN = Math.max(0, Math.min(1, (T.clubs[c].spin - 2500) / 7500));
  }
  return T;
}

const TUNE = readTune();
const YARDS_PER_UNIT = 3.0;          // game.js:446 default
const M_PER_UNIT = 2.7432;           // game.js:450
const DEFAULT_STIMP = 11;            // game.js:471
const simDt = () => TUNE.timeScale / 60;                 // game.js:457
const rollDecelMs = (s) => (s === 'green' ? B.greenDecel(DEFAULT_STIMP)
                                          : (TUNE.turf[s] || TUNE.turf.fairway).roll);

// ---- flight ---------------------------------------------------------------

// game.js:1843-1855. Carry is monotonic in ball speed (unlike launch angle),
// so this bisection is well-posed.
function aeroSpeedForCarry(Cm, launchDeg, spinRpm) {
  const carryAt = (mph) => B.flyToLanding(
    B.launchState(mph, launchDeg, spinRpm, { x: 1, y: 0 }, 0), {}, { dt: 1 / 120 }).carry;
  let lo = 20, hi = 240;
  if (carryAt(hi) < Cm) return hi;
  for (let k = 0; k < 26; k++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < Cm) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// game.js:1809-1821. The live code hands attachAero the arc's frame-quantized
// landD, NOT C — matching C would fly a few yards short of every historical
// calibration (see the comment at game.js:3430-3432). Reproduced so the solved
// ball speed matches the game's to the yard.
function landDUnits(Cu, Hu) {
  const H0 = Math.max(Hu, 0.001);
  const vh0 = Cu / Math.max(2 * Math.sqrt(2 * H0 / TUNE.gravity), 1);
  return Math.ceil(Cu / vh0) * vh0;
}

// ---- one whole shot, flight through rest ----------------------------------
// Mirrors arcFlightStep's aero branch (game.js:1946-1970) then the rollStep
// loop, ticking at the live simDt() so hop DURATIONS are measured on the same
// clock the renderer samples.
function flyAndSettle(mph, launchDeg, spinRpm, surf) {
  const A = B.launchState(mph, launchDeg, spinRpm, { x: 1, y: 0 }, 0);
  const turf = TUNE.turf[surf] || TUNE.turf.fairway;
  const dt = simDt();

  let apex = 0, t = 0, carry = null, descentDeg = null, hops = 0;
  const hopList = [];
  let curHopMax = 0, curHopT = 0;

  // flight + bounces
  for (let guard = 0; guard < 4000; guard++) {
    const n = Math.max(2, Math.ceil(dt * 120));      // game.js:1891
    for (let i = 0; i < n; i++) B.step(A, dt / n, {});
    t += dt;
    if (A.p.z > apex) apex = A.p.z;
    if (hops > 0) { curHopMax = Math.max(curHopMax, A.p.z); curHopT += dt; }
    if (A.p.z > 0) continue;

    // touchdown (game.js:1949-1961)
    if (carry == null) {
      carry = Math.hypot(A.p.x, A.p.y);
      descentDeg = Math.atan2(Math.max(0, -A.v.z), Math.hypot(A.v.x, A.v.y)) * 180 / Math.PI;
    } else {
      hopList.push({ ft: curHopMax / 0.3048, s: curHopT });
    }
    if (surf === 'water' || surf === 'woods' || surf === 'ob') break;   // game.js:1919

    B.bounce(A, turf);                                                  // game.js:1920
    hops++;
    if (A.v.z < TUNE.aeroSettleVz || hops > 8) { A.v.z = 0; A.p.z = 0; break; }
    A.p.z = 1e-4;                                                       // game.js:1926
    curHopMax = 0; curHopT = 0;
  }

  // aeroToRoll (game.js:1930-1942): hand the ANGULAR velocity to the roll phase
  const landX = A.p.x, landY = A.p.y;
  const vm = Math.hypot(A.v.x, A.v.y) || 1;
  const dx = A.v.x / vm, dy = A.v.y / vm;
  let sv = A.v.x * dx + A.v.y * dy;
  let w = A.spin.y * dx - A.spin.x * dy;

  // rollStepSI (game.js:2229-2265), flat ground (no slope term)
  const prof = surf === 'green' ? { mu: turf.mu, roll: rollDecelMs('green') } : turf;
  let dist = 0, skid = 0;
  const r = B.BALL.r;
  for (let k = 0; k < 20000; k++) {
    const slipping = Math.abs(sv - w * r) > 0.02;      // ballistics.js:279
    const res = B.skidRoll(sv, w, prof, dt);
    const step = ((sv + res.sv) / 2) * dt;             // trapezoid over the tick
    dist += step;
    if (slipping) skid += step;
    sv = res.sv; w = res.w;
    t += dt;
    if (Math.abs(sv) <= TUNE.aeroStopMs) break;        // game.js:2255
  }

  const restM = Math.hypot(landX + dx * dist, landY + dy * dist);
  const h1 = hopList[0] || { ft: 0, s: 0 };
  return {
    carryYd: carry / YD, apexFt: apex / 0.3048, descentDeg, hangS: t,
    hop1Ft: h1.ft, hop1S: h1.s, hopCount: hopList.length,
    skidYd: skid / YD, rollYd: (dist - skid) / YD, releaseYd: dist / YD,
    restYd: restM / YD,
  };
}

// ---- buildTrialShot: ef -> launch conditions (game.js:3297-3437) -----------
function shotFor(club, ef, { chip, chipBias = 0, flightBias = 0, surf = 'green', pinYds = 0 }) {
  const c = TUNE.clubs[club];
  // carry, world units (game.js:3391) — fairway lie, so every lie multiplier is 1
  const Cu = (c.carry / YARDS_PER_UNIT) * ef;
  const Hu = (c.maxH / YARDS_PER_UNIT) * ef;              // game.js:3395

  // spin (game.js:3402-3412, 3434)
  const chipBoost = ef < 0.6 ? 1 + (1 - ef / 0.6) * 0.5 : 1;
  let spinScale;
  if (chip) {
    // chipSpinParams (game.js:3251-3259). chipSpinRef is the Phase-2 ramp; when
    // it is absent this reduces to the old flat chipSpin.
    const base = TUNE.chipSpinRef
      ? TUNE.chipSpin + (1 - TUNE.chipSpin) * Math.min(1, ef / TUNE.chipSpinRef)
      : TUNE.chipSpin;
    spinScale = base * Math.pow(TUNE.chipSpinRange, chipBias);
  } else {
    spinScale = chipBoost;
  }
  const effectiveSpinN = Math.min(1, c.spinN * spinScale);
  const rpm = Math.max(200, c.spin * (c.spinN > 0 ? effectiveSpinN / c.spinN : 1));

  // launch angle (game.js:3433-3437). partialLoftDeg/Ref are the Phase-1 knobs;
  // absent, loftAdd is 0 and this is the pre-fix behaviour exactly.
  const pitchLoft = TUNE.partialLoftDeg
    ? TUNE.partialLoftDeg * Math.max(0, Math.min(1, 1 - ef / TUNE.partialLoftRef))
    : 0;
  // Chips ramp loft UP with length instead of down — see the long note at
  // `loftAdd` in buildTrialShot. Guarded so a TUNE without the chipLoft keys
  // still reproduces the pitch-only behaviour exactly.
  let loftAdd = (chip && TUNE.chipLoftRef)
    ? pitchLoft + (TUNE.chipLoftDeg - pitchLoft) *
                  (1 - Math.min(1, Math.max(0, ef) / TUNE.chipLoftRef))
    : pitchLoft;
  // Whole-band chip lift, faded out by chipRangeYds (game.js `loftAdd`). Keyed on
  // pin distance, so the chip rows must pass their target through opts.
  if (chip && TUNE.chipLoftBoost) {
    const span = Math.max(1, TUNE.chipRangeYds - TUNE.chipLoftHoldYds);
    const k = 1 - Math.max(0, Math.min(1, (pinYds - TUNE.chipLoftHoldYds) / span));
    loftAdd += TUNE.chipLoftBoost * k;
  }
  const delta = loftAdd + (chip ? chipBias * TUNE.chipLaunchSpread
                                : flightBias * TUNE.flightLaunchSpread);
  const launchDeg = Math.max(4, Math.min(60, c.launch + delta));        // game.js:1873

  const targetM = landDUnits(Cu, Hu) * M_PER_UNIT;
  const mph = aeroSpeedForCarry(targetM, launchDeg, rpm);
  return { ef, launchDeg, rpm, mph, ...flyAndSettle(mph, launchDeg, rpm, surf) };
}

// solveChipEf (game.js:3272-3296): bisect ef so the ball COMES TO REST at target
function solveChipEf(club, targetYds, opts) {
  const c = TUNE.clubs[club];
  const landFrac = Math.max(0.5, Math.min(0.98,
    TUNE.chipLandFrac + (opts.chipBias || 0) * TUNE.chipLandSpread));
  const carryEf = Math.min(1, (targetYds * landFrac) / c.carry);
  let lo = 0.02, hi = Math.min(1, Math.max(carryEf * 2.2, 0.25));
  if (shotFor(club, hi, opts).restYd < targetYds) return hi;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (shotFor(club, mid, opts).restYd < targetYds) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- matrix ---------------------------------------------------------------
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const gate = argv.includes('--gate');
const SURF = argv.includes('--surface') ? argv[argv.indexOf('--surface') + 1] : 'green';
// --turf e,mu,dig[,roll] overrides the landing surface in memory, so a tuning
// sweep never has to edit game.js and risk leaving a stray value behind.
if (argv.includes('--turf')) {
  const [e, mu, dig, roll] = argv[argv.indexOf('--turf') + 1].split(',').map(Number);
  const t = TUNE.turf[SURF];
  t.e = e; t.mu = mu; t.dig = dig;
  if (Number.isFinite(roll)) t.roll = roll;
}
// --timescale N runs the whole matrix at a different wall-clock pace. Chips are
// played at TUNE.chipTimeScale rather than TUNE.timeScale so their launch and
// landing are legible, and that is only safe if the sim really is
// time-invariant — a chip is auto-solved to REST at the pin, so a dt that moved
// the rest point would quietly move every chip's aim. Run the matrix at both
// paces and diff the rest column to prove it does not.
if (argv.includes('--timescale')) {
  TUNE.timeScale = +argv[argv.indexOf('--timescale') + 1];
}
// --chipspin N / --chiploft N override the two knobs that set a chip's SHAPE,
// same in-memory trick as --turf: chipSpin is the backspin floor a short chip
// gets as a fraction of the club's full-swing value, chipLoftDeg the loft a
// chip presents on top of the club's own launch angle.
if (argv.includes('--chipspin')) TUNE.chipSpin = +argv[argv.indexOf('--chipspin') + 1];
if (argv.includes('--chiploft')) TUNE.chipLoftDeg = +argv[argv.indexOf('--chiploft') + 1];
if (argv.includes('--chiploftref')) TUNE.chipLoftRef = +argv[argv.indexOf('--chiploftref') + 1];
if (argv.includes('--chiploftboost')) TUNE.chipLoftBoost = +argv[argv.indexOf('--chiploftboost') + 1];
if (argv.includes('--chiplofthold')) TUNE.chipLoftHoldYds = +argv[argv.indexOf('--chiplofthold') + 1];

const CHIP_TARGETS = [15, 20, 30, 40, 50, 60, 74];
const FULL_CLUBS = ['driver', '5i', '7i', 'pw', 'lw'];

const rows = [];

// full swings (ef = 1) — the calibrated release table
for (const id of FULL_CLUBS) {
  const s = shotFor(id, 1, { chip: false, surf: SURF });
  rows.push({ club: id, mode: 'full', target: TUNE.clubs[id].carry, ...s });
}
// LW just under its full-swing floor — the other side of the chip boundary
rows.push({ club: 'lw', mode: 'full', target: null,
            ...shotFor('lw', TUNE.clubs.lw.minFrac, { chip: false, surf: SURF }) });

// FLIGHT selector on a full swing. A high shot lands steeper and must check
// MORE; a knockdown lands shallower and must run OUT. That ordering is the
// point of the selector, and it is the thing a turf re-tune can quietly
// destroy: slicken the green enough to restore an iron's release and high and
// low collapse onto each other. Gated below, not assumed.
for (const id of ['5i', '7i']) {
  for (const bias of [-1, 1]) {
    rows.push({ club: id, mode: 'full' + (bias > 0 ? '-hi' : '-lo'),
                target: TUNE.clubs[id].carry,
                ...shotFor(id, 1, { chip: false, flightBias: bias, surf: SURF }) });
  }
}

// the chip/pitch band
for (const id of ['lw', 'sw']) {
  for (const target of CHIP_TARGETS) {
    if (target > TUNE.chipRangeYds) continue;
    const opts = { chip: true, chipBias: 0, surf: SURF, pinYds: target };
    const ef = solveChipEf(id, target, opts);
    rows.push({ club: id, mode: 'chip', target, ...shotFor(id, ef, opts) });
  }
}
// slider ends at 40 yd: the runner and the checker must stay distinct
for (const bias of [-1, 1]) {
  const opts = { chip: true, chipBias: bias, surf: SURF, pinYds: 40 };
  const ef = solveChipEf('lw', 40, opts);
  rows.push({ club: 'lw', mode: 'chip' + (bias > 0 ? '+1' : '-1'), target: 40,
              ...shotFor('lw', ef, opts) });
}

if (asJson) {
  console.log(JSON.stringify({ surface: SURF, turf: TUNE.turf[SURF], rows }, null, 2));
  process.exit(0);
}

const H = ['club', 'mode', 'tgt', 'ef', 'lnch', 'rpm', 'mph', 'carry', 'apexFt',
           'desc', 'hangS', 'hopFt', 'hopS', 'n', 'skid', 'roll', 'rest'];
const W = [7, 7, 5, 6, 6, 7, 6, 7, 7, 6, 6, 6, 6, 3, 6, 6, 7];
const fmt = (v, i) => String(v).padStart(W[i]);
console.log('landing surface: ' + SURF + '  ' + JSON.stringify(TUNE.turf[SURF]));
console.log(H.map(fmt).join(''));
for (const r of rows) {
  console.log([r.club, r.mode, r.target ?? '-', r.ef.toFixed(3), r.launchDeg.toFixed(1),
    Math.round(r.rpm), r.mph.toFixed(1), r.carryYd.toFixed(1), r.apexFt.toFixed(1),
    r.descentDeg.toFixed(1), r.hangS.toFixed(2), r.hop1Ft.toFixed(2), r.hop1S.toFixed(2),
    r.hopCount, r.skidYd.toFixed(1), r.rollYd.toFixed(1), r.restYd.toFixed(1),
  ].map(fmt).join(''));
}

// ---- gate -----------------------------------------------------------------
if (gate) {
  const fails = [];
  const find = (club, mode, target) =>
    rows.find((r) => r.club === club && r.mode === mode && (target == null || r.target === target));
  const band = (label, v, lo, hi) => {
    if (!(v >= lo && v <= hi)) fails.push(`${label}: ${v.toFixed(2)} outside [${lo}, ${hi}]`);
  };

  if (SURF === 'green') {
    // Full-shot release. These bands were re-cut after the 2026-07-29 aero
    // re-fit; the previous ones (5i 8-15) were measured when the 5i came down
    // at 39° instead of 47° and so encoded the shallow-descent bug rather than
    // any property of the turf. Control test behind the new numbers: at MATCHED
    // descent the green still releases what it always did (5i 38.8° -> 9.9 yd
    // now vs 40.0° -> 9.2 yd before), so only the targets moved, not the model.
    band('driver release', find('driver', 'full').releaseYd, 1.5, 6.0);
    band('5i release', find('5i', 'full').releaseYd, 1.0, 5.0);
    band('7i release', find('7i', 'full').releaseYd, -1.0, 2.5);
    band('pw release', find('pw', 'full').releaseYd, -2.0, 1.5);
    band('lw release', find('lw', 'full').releaseYd, -2.5, 1.5);

    // FLIGHT selector: high checks, low runs out. Ordering AND a real gap —
    // the failure mode is not inversion, it is collapse, which is exactly what
    // a too-grabby green produces by pinning every shot to zero release.
    for (const id of ['5i', '7i']) {
      const lo = find(id, 'full-lo').releaseYd;
      const st = find(id, 'full').releaseYd;
      const hi = find(id, 'full-hi').releaseYd;
      if (!(lo > st && st > hi)) {
        fails.push(`${id} FLIGHT order broken: low ${lo.toFixed(1)} / stock ${st.toFixed(1)} / high ${hi.toFixed(1)} (want low > stock > high)`);
      }
      band(`${id} FLIGHT spread`, lo - hi, 2.0, 99);
    }
  }

  // the fix itself
  for (const id of ['lw', 'sw']) {
    for (const t of CHIP_TARGETS) {
      const r = find(id, 'chip', t);
      if (!r) continue;
      // +-2.2 yd, not tighter: buildFlight quantizes the carry the aero solver
      // is handed (landD = ceil(C/vh0)*vh0, game.js:1821), which is a ~2 yd
      // staircase for a wedge. solveChipEf bisects a step function, so it can
      // only ever land on a tread. Pre-existing; it used to be smeared out by
      // the rollout the chip no longer has.
      band(`${id} ${t}yd rest`, r.restYd, t - 2.2, t + 2.2);
      // Hop visibility applies to the PITCHES (>=30 yd), not the running chips.
      // 544ed1e added these because a 40 yd pitch arrived with no visible hop;
      // a 15-20 yd chip legitimately skips once low and then runs, so demanding
      // two 0.6 ft hops of it would just be demanding the wrong shot.
      if (t >= 30) {
        band(`${id} ${t}yd hop ft`, r.hop1Ft, 0.6, 99);
        band(`${id} ${t}yd hop s`, r.hop1S, 0.35, 99);
        band(`${id} ${t}yd hops`, r.hopCount, 2, 99);
      }
      // A chip must RELEASE. Nothing here checked the carry/roll split, which is
      // how "every chip in the band rolls backwards" shipped unnoticed: rest was
      // right at every target, because solveChipEf simply flew the ball the whole
      // way. Short chips are the running shot and must clearly run; by 40 yd it
      // is a pitch and is allowed to check, but never to reverse.
      // Greenside (<=20 yd) is the RUNNING shot and must clearly release.
      // From 30 yd up it is a pitch, allowed to check — but never to reverse,
      // which is the actual defect this whole pass exists to kill.
      const release = r.restYd - r.carryYd;
      if (t <= 20) {
        band(`${id} ${t}yd release`, release, 0.5, 99);
        // Floor cut 0.15 -> 0.08 when chipLoftBoost raised the trajectory: height and
        // release trade directly at fixed carry, so a chip that flies higher keeps a
        // smaller SHARE of roll even while still clearly running (20 yd LW: 2.0 yd of
        // release on a 19 yd carry). The absolute release band above is the real guard;
        // this one only has to catch a collapse back to zero.
        band(`${id} ${t}yd carry:roll`, release / r.carryYd, 0.08, 2.0);
      } else {
        band(`${id} ${t}yd release`, release, -0.5, 99);
      }
    }
  }
  const p40 = find('lw', 'chip', 40);
  band('lw 40yd apex ft', p40.apexFt, 30, 99);
  band('lw 40yd descent', p40.descentDeg, 45, 90);
  band('lw 40yd roll', p40.rollYd, -99, 2);

  // continuity: a 74yd chip and a full-swing LW must attach the same backspin
  const chip74 = find('lw', 'chip', 74), fullLo = rows.find((r) => r.mode === 'full' && r.club === 'lw' && r.target === null);
  if (Math.abs(chip74.rpm - fullLo.rpm) > 250) {
    fails.push(`spin cliff at the chip boundary: 74yd chip ${Math.round(chip74.rpm)} rpm vs full LW ${Math.round(fullLo.rpm)} rpm`);
  }

  // the runner must still run further than the checker
  const lo40 = find('lw', 'chip-1', 40), hi40 = find('lw', 'chip+1', 40);
  if (lo40.rollYd <= hi40.rollYd + 0.5) {
    fails.push(`chip spin slider collapsed: runner rolls ${lo40.rollYd.toFixed(1)} yd vs checker ${hi40.rollYd.toFixed(1)}`);
  }

  console.log('');
  if (fails.length) { for (const f of fails) console.error('FAIL  ' + f); process.exit(1); }
  console.log('gate: all checks pass');
}
