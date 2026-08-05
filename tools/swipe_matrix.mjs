#!/usr/bin/env node
// SWIPE-SHAPE matrix + regression gate for the draw/fade channel.
//
//   node tools/swipe_matrix.mjs                       # print the matrix
//   node tools/swipe_matrix.mjs --json > before.json  # snapshot, edit, diff
//   node tools/swipe_matrix.mjs --gate                # exit 1 on a regression
//   node tools/swipe_matrix.mjs --seeds 2000          # more samples on the noise floor
//
// The other three gates are structurally BLIND to shot shape:
//   ball_calibrate.mjs  launches at axis tilt 0
//   shot_matrix.mjs     launches at { x:1, y:0 } with sideSpin 0
//   putt_matrix.js      putts discard the curve input entirely (game.js:3990)
// So the whole swipe -> curve -> spin-axis-tilt -> offline-yards chain has never
// had a gate. This is it.
//
// curveFromPath and swipeVelocity are SLICED OUT OF game.js and evaluated here,
// never copied — a copy is how a harness ends up testing a function the game no
// longer runs (the failure mode CLAUDE.md records for stepGroundRoll and for the
// release table's hardcoded stimp). The only deliberate copy in this file is
// `oracle3pt`, the retired 3-point formula, kept purely as a SIGN reference.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const B = createRequire(import.meta.url)(join(ROOT, 'ballistics.js'));
const YD = B.M_PER_YD;
const SRC = readFileSync(join(ROOT, 'game.js'), 'utf8');

// ---- pull TUNE straight out of game.js (single source of truth) ------------
// Same brace-matching trick shot_matrix.mjs:41 uses.
function readTune() {
  const start = SRC.indexOf('const TUNE = {');
  if (start < 0) throw new Error('TUNE not found in game.js');
  const i = SRC.indexOf('{', start);
  let depth = 0, end = -1;
  for (let k = i; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return new Function('return (' + SRC.slice(i, end) + ');')();
}

// Slice a top-level `function NAME(...) { ... }` out of game.js by brace match.
function readFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in game.js');
  const i = SRC.indexOf('{', start);
  let depth = 0, end = -1;
  for (let k = i; k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return SRC.slice(start + 1, end);
}

const TUNE = readTune();

// Bind the extracted functions to a TUNE we control, so the harness can probe
// the response WITHOUT the deadzone (to compare against the retired formula)
// and WITH it (what the player actually gets) in the same run.
function bind(over) {
  const T = { ...TUNE, ...(over || {}) };
  const body = readFn('curveFromPath') + '\n' + readFn('swipeVelocity') +
               '\nreturn { curveFromPath, swipeVelocity };';
  return new Function('TUNE', body)(T);
}
const G = bind();                                  // live constants
const GRAW = bind({ curveDeadzone: 0 });           // deadzone off — response only

// The retired 3-point measure (game.js:3455-3462 before the rework). SIGN ORACLE
// ONLY: if a rightward bow ever stops agreeing with this, every draw has silently
// become a fade and nothing throws.
function oracle3pt(pts) {
  if (!pts || pts.length < 3) return 0;
  const a = pts[0], m = pts[pts.length >> 1], b = pts[pts.length - 1];
  const v1x = m.x - a.x, v1y = m.y - a.y;
  const v2x = b.x - m.x, v2y = b.y - m.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) return 0;
  return (v1x * v2y - v1y * v2x) / (m1 * m2);
}

// ---- deterministic synthetic swipes ---------------------------------------
// mulberry32, the same PRNG game.js:11172 uses — so a failing seed here is a
// seed you can replay in the game.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd) {
  let u = 0; while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

// A swipe bowed sideways by `bow` x chord length at its midpoint — a parabola,
// so the sagitta at s=0.5 IS bow*L by construction and the generator can never
// disagree with the estimator's definition.
//
// Samples are uniform in TIME (pointermove fires on a clock, not on distance);
// `timing` maps time to arc position, which is what actually differs between a
// steady drag and a flick.
const TIMING = {
  uniform: (u) => u,
  accel: (u) => u * u,
  decel: (u) => 1 - (1 - u) * (1 - u),
};
function arc({ bow = 0, lengthPx = 200, n = 14, timing = 'uniform',
               jitterPx = 0, seed = 1, dirDeg = -90, durMs = 180 }) {
  const rnd = mulberry32(seed);
  const th = dirDeg * Math.PI / 180;
  const tx = Math.cos(th), ty = Math.sin(th);       // chord direction
  const nx = ty, ny = -tx;                          // +90deg -> "rightward" bow
  const map = TIMING[timing] || TIMING.uniform;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0 : k / (n - 1);
    const s = map(u);
    const off = bow * 4 * s * (1 - s) * lengthPx;   // parabola, sagitta = bow*L
    let x = tx * s * lengthPx + nx * off;
    let y = ty * s * lengthPx + ny * off;
    if (jitterPx) { x += gauss(rnd) * jitterPx; y += gauss(rnd) * jitterPx; }
    pts.push({ x, y, t: u * durMs });
  }
  return pts;
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// ---- swipe curve -> offline yards ------------------------------------------
// game.js:4103 -> attachAero game.js:2314 -> ballistics launchState.
const curveExp = () => (TUNE.curveExp != null ? TUNE.curveExp : 0.9);
const curveToTilt = (c) => Math.sign(c) * Math.pow(Math.abs(c), curveExp()) * TUNE.aeroSpinTilt;

// shot_matrix.mjs:84. Carry is monotonic in ball speed, so the bisection is
// well-posed; both bracket ends checked.
function aeroSpeedForCarry(Cm, launchDeg, spinRpm) {
  const carryAt = (mph) => B.flyToLanding(
    B.launchState(mph, launchDeg, spinRpm, { x: 1, y: 0 }, 0), {}, { dt: 1 / 120 }).carry;
  let lo = 4, hi = 240;
  if (carryAt(hi) < Cm) return hi;
  if (carryAt(lo) > Cm) return lo;
  for (let k = 0; k < 26; k++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < Cm) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const TABLE_CLUBS = ['driver', '5i', '7i', 'pw'];
const solvedMph = {};
for (const id of TABLE_CLUBS) {
  const c = TUNE.clubs[id];
  solvedMph[id] = aeroSpeedForCarry(c.carry * YD, c.launch, c.spin);
}
// Offline is measured at TOUCHDOWN, not at rest: the ground phase (bounce/skid/
// roll) is shot_matrix's job, and folding it in here would make this gate fail
// for turf reasons that have nothing to do with the swipe.
function shapeShot(clubId, curve) {
  const c = TUNE.clubs[clubId];
  const r = B.flyToLanding(
    B.launchState(solvedMph[clubId], c.launch, c.spin, { x: 1, y: 0 }, curveToTilt(curve)),
    {}, { dt: 1 / 120 });
  return { offlineYd: r.landing.p.y / YD, carryYd: r.carry / YD, tiltDeg: curveToTilt(curve) };
}

// ---- the matrix ------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const num = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : Number(argv[i + 1]); };
const SEEDS = num('--seeds', 800);

const out = { tune: {}, noise: [], response: [], reject: [], invariance: [], yards: [] };
for (const k of ['curveGain', 'curveMinSamples', 'curveMinPathPx', 'curveMinMs',
                 'curveDeadzone', 'curveExp', 'aeroSpinTilt'])
  out.tune[k] = TUNE[k] != null ? TUNE[k] : null;

// 1. NOISE FLOOR — a dead-straight swipe with realistic per-sample jitter.
//    This is the assertion the pre-rework code fails: at 40px/3 samples it
//    returns 0.264 at p95, which is ~10 yd of offline on a 7i for holding still.
const NOISE_CFG = [
  { lengthPx: 300, n: 20 }, { lengthPx: 200, n: 14 }, { lengthPx: 150, n: 10 },
  { lengthPx: 120, n: 6 }, { lengthPx: 80, n: 5 }, { lengthPx: 40, n: 3 },
];
for (const cfg of NOISE_CFG) {
  const cs = [];
  for (let s = 0; s < SEEDS; s++)
    cs.push(Math.abs(G.curveFromPath(arc({ ...cfg, bow: 0, jitterPx: 1.5, seed: s + 1 }))));
  const row = { ...cfg, p50: pct(cs, 0.5), p95: pct(cs, 0.95), p99: pct(cs, 0.99), max: Math.max(...cs) };
  row.yd99 = Math.abs(shapeShot('7i', row.p99).offlineYd);
  out.noise.push(row);
}

// 2. RESPONSE — clean arcs. Compared to the retired formula with the deadzone
//    DISABLED, because the deadzone is a deliberate change to small-arc feel and
//    would otherwise mask whether the estimator itself still agrees.
const BOWS = [0.01, 0.02, 0.05, 0.10, 0.20, 0.35];
for (const bow of BOWS) {
  const p = arc({ bow, lengthPx: 200, n: 14 });
  const raw = GRAW.curveFromPath(p), live = G.curveFromPath(p), orc = oracle3pt(p);
  out.response.push({
    bow, oracle: orc, raw, live,
    rawErrPct: orc === 0 ? 0 : (raw - orc) / Math.abs(orc) * 100,
  });
}

// 3. REJECTION — every gate that exists to kill a degenerate gesture.
const REJECT = [
  ['too few samples', arc({ bow: 0.2, n: 3 })],
  ['too short', arc({ bow: 0.2, lengthPx: 40, n: 12 })],
  ['too brief', arc({ bow: 0.2, n: 12, durMs: 20 })],
  // A drag-back then flick. Samples before the turn sit at s<0, where the fit
  // weight s(1-s) goes NEGATIVE and silently flips their sign. It is also the
  // right golf semantics: the backswing must not set your shot shape.
  //
  // The backswing is deliberately NOT colinear with the flick (a real thumb
  // pulls back off-axis). Colinear passes trivially under any estimator and
  // tests nothing; off-axis is the case that reads as a big phantom curve.
  ['backswing then straight flick', (() => {
    const back = arc({ bow: 0, lengthPx: 100, n: 6, dirDeg: 115, durMs: 90 });
    const last = back[back.length - 1];
    const fwd = arc({ bow: 0, lengthPx: 200, n: 14, dirDeg: -90, durMs: 150 });
    return back.concat(fwd.map((p) => ({ x: p.x + last.x, y: p.y + last.y, t: p.t + 90 })));
  })()],
];
for (const [label, p] of REJECT) out.reject.push({ label, curve: G.curveFromPath(p) });

// 4. INVARIANCE — the same shape must read the same at any size, sample rate or
//    tempo, or the shot depends on the phone rather than on the player.
{
  const ref = GRAW.curveFromPath(arc({ bow: 0.1, lengthPx: 200, n: 14 }));
  const rel = (v) => (ref === 0 ? 0 : (v - ref) / Math.abs(ref) * 100);
  for (const L of [120, 200, 240, 480])
    out.invariance.push({ kind: 'length', v: L, errPct: rel(GRAW.curveFromPath(arc({ bow: 0.1, lengthPx: L, n: 14 }))) });
  // Sample counts start AT curveMinSamples — below it a path is deliberately
  // rejected, and asking whether a rejected gesture reads "invariantly" is a
  // question about the floor, which the rejection block already gates.
  for (const n of [TUNE.curveMinSamples, 10, 20, 40])
    out.invariance.push({ kind: 'samples', v: n, errPct: rel(GRAW.curveFromPath(arc({ bow: 0.1, lengthPx: 200, n }))) });
  for (const tm of ['uniform', 'accel', 'decel'])
    out.invariance.push({ kind: 'timing', v: tm, errPct: rel(GRAW.curveFromPath(arc({ bow: 0.1, lengthPx: 200, n: 14, timing: tm }))) });
  // Negating every point must leave the curve UNCHANGED — finishWheelSwing
  // (game.js:4363) feeds an inverted path and its comment depends on this.
  const p = arc({ bow: 0.1, lengthPx: 200, n: 14 });
  const neg = p.map((q) => ({ x: -q.x, y: -q.y, t: q.t }));
  out.invariance.push({ kind: 'negate', v: '-p', errPct: rel(GRAW.curveFromPath(neg)) });
}

// 5. END TO END — the only table that says what the change is worth in yards.
for (const bow of [0.02, 0.05, 0.10, 0.20, 0.35]) {
  const curve = G.curveFromPath(arc({ bow, lengthPx: 200, n: 14 }));
  const row = { bow, curve, tiltDeg: curveToTilt(curve) };
  for (const id of TABLE_CLUBS) row[id] = shapeShot(id, curve).offlineYd;
  row.carry7iYd = shapeShot('7i', curve).carryYd;
  out.yards.push(row);
}

// ---- report ----------------------------------------------------------------
if (has('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const f = (v, d = 3) => (v == null ? '  -  ' : v.toFixed(d));
console.log('\nTUNE  ' + Object.entries(out.tune).map(([k, v]) => `${k}=${v}`).join('  '));

console.log('\n=== NOISE FLOOR (straight swipe, 1.5px jitter, ' + SEEDS + ' seeds) ===');
console.log('  chord   n     p50     p95     p99     max   7i yd @p99');
for (const r of out.noise)
  console.log(`  ${String(r.lengthPx).padStart(5)} ${String(r.n).padStart(3)}   ${f(r.p50)}   ${f(r.p95)}   ${f(r.p99)}   ${f(r.max)}      ${f(r.yd99, 1)}`);

console.log('\n=== RESPONSE (clean arc, 200px/14) ===');
console.log('    bow   oracle      raw     live   raw err%');
for (const r of out.response)
  console.log(`  ${f(r.bow, 3)}   ${f(r.oracle)}   ${f(r.raw)}   ${f(r.live)}   ${f(r.rawErrPct, 2)}%`);

console.log('\n=== REJECTION (all must be exactly 0) ===');
for (const r of out.reject) console.log(`  ${r.label.padEnd(32)} ${f(r.curve)}`);

console.log('\n=== INVARIANCE (deviation from 200px/14/uniform) ===');
for (const r of out.invariance)
  console.log(`  ${r.kind.padEnd(8)} ${String(r.v).padEnd(8)} ${f(r.errPct, 2)}%`);

console.log('\n=== OFFLINE YARDS AT TOUCHDOWN ===');
console.log('    bow    curve    tilt   driver      5i      7i      pw   7i carry');
for (const r of out.yards)
  console.log(`  ${f(r.bow, 3)}   ${f(r.curve)}  ${f(r.tiltDeg, 2)}   ${f(r.driver, 1).padStart(6)}  ${f(r['5i'], 1).padStart(6)}  ${f(r['7i'], 1).padStart(6)}  ${f(r.pw, 1).padStart(6)}     ${f(r.carry7iYd, 1)}`);

// ---- gate ------------------------------------------------------------------
if (has('--gate')) {
  const fails = [];
  const ck = (ok, msg) => { if (!ok) fails.push(msg); };

  // The one that matters. Jitter must not be able to SHAPE a shot — and the
  // honest unit for that is yards offline, not a raw curve number: the whole
  // point of the chain is what the ball does. 1.0 yd is comfortably beneath
  // every other error source in the game (the dispersion cone alone is 3.6 yd
  // at 1 sigma on a 7i), so anything under it cannot be felt or exploited.
  // Configs below curveMinPathPx/curveMinSamples are rejected outright and show
  // up as exactly 0, so this covers the floors as well as the confidence gate.
  for (const r of out.noise)
    ck(r.yd99 <= 1.0, `noise floor: ${r.lengthPx}px/${r.n} p99=${f(r.p99)} = ${f(r.yd99, 1)} yd offline on a 7i from jitter alone`);

  // Estimator agreement, deadzone/SNR excluded (see the note at the response
  // block). Banded on purpose: tanh and the retired formula are different
  // saturation SHAPES, so they cannot agree at extreme bow and there is no
  // single gain that makes them — but they agree to ~1% across the range a
  // player actually swipes, which is where "did feel change?" is answered.
  for (const r of out.response)
    ck(Math.abs(r.rawErrPct) <= (r.bow <= 0.1 ? 3.5 : 8),
       `response drift at bow ${r.bow}: ${f(r.rawErrPct, 2)}% vs the retired formula`);

  // Sign. A flip turns every draw into a fade and nothing throws.
  const rightBow = arc({ bow: 0.15, lengthPx: 200, n: 14 });
  ck(Math.sign(GRAW.curveFromPath(rightBow)) === Math.sign(oracle3pt(rightBow)),
     'SIGN FLIPPED vs the retired formula — every draw is now a fade');

  for (const r of out.reject) ck(r.curve === 0, `degenerate not rejected (${r.label}): ${f(r.curve)}`);

  for (const r of out.invariance) {
    const tol = r.kind === 'length' ? 2 : r.kind === 'samples' ? 5 : r.kind === 'timing' ? 8 : 0.001;
    ck(Math.abs(r.errPct) <= tol, `invariance ${r.kind} ${r.v}: ${f(r.errPct, 2)}% (tol ${tol}%)`);
  }

  // Bounded + monotone in bow: a bigger arc must never shape LESS.
  let prev = -1;
  for (const bow of [0, 0.05, 0.1, 0.2, 0.35, 0.6, 1.0]) {
    const c = Math.abs(GRAW.curveFromPath(arc({ bow, lengthPx: 240, n: 20 })));
    ck(c <= 1.0001, `curve out of range at bow ${bow}: ${f(c)}`);
    ck(c >= prev - 1e-9, `non-monotone in bow at ${bow}: ${f(c)} < ${f(prev)}`);
    prev = c;
  }

  if (fails.length) {
    console.log('\nFAIL (' + fails.length + ')');
    for (const m of fails) console.log('  x ' + m);
    process.exit(1);
  }
  console.log('\nPASS');
}
