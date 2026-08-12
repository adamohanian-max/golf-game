// Approach matrix — the OFF-GREEN ROLLOUT gate. Run via:
//
//   osascript -l JavaScript tools/approach_matrix.js <courseId> <repoRoot> [flags]
//     --json           raw rows
//     --gate           exit 1 on a regression
//     --holes 1,4,7    subset (default: all)
//     --club 7i        approach club (default 7i)
//     --from 175       ball distance from the pin, YARDS (default: the club's carry)
//     --stimp N        override every hole's greenSpeed in memory
//
// WHY THIS EXISTS, given tools/shot_matrix.mjs already reports skid/roll/rest:
// shot_matrix MIRRORS the ground phase. It requires the real ballistics.js
// kernels but hand-copies rollStepSI/turfFor/rollDecelMs, and in doing so it
//   (1) models NO slope        — the game applies slopeGradAt() off-green, worth
//                                up to 2.45 m/s2 against fairway's rolling decel,
//   (2) pins ONE surface for the whole roll — the game re-reads surfaceAt() every
//                                tick, and mask cells are ~3.5 yds, so a real
//                                rollout crosses fairway/rough/green repeatedly,
//   (3) integrates a trapezoid — the game is explicit Euler (b.x += b.vx BEFORE
//                                stepGroundRoll), which runs systematically longer.
// The bug this tool was written for lives entirely in (1)+(2): a ball that lands
// short and still has speed when it reaches the collar inherits the GREEN's
// rolling decel, which is an order of magnitude below turf's. shot_matrix cannot
// see that seam at all, and shot_matrix --gate never even ran its release table
// off the green (it was wrapped in `if (SURF === 'green')`).
//
// So this drives the REAL game the way putt_matrix.js does — headless_stubs.js +
// ballistics.js + game.js, then setHole()/launchShot()/update() — and steps the
// roll a tick at a time, recording which surface the ball is on for every inch of
// it. Unlike putt_matrix it KEEPS the surface mask: mask classification (is the
// apron short of this green fairway or rough?) is half of what is measured here.
//
// Method: park the ball a fixed distance from the pin on the tee->pin line, then
// sweep swing power. Each swing lands somewhere short of (or past) the pin, so
// one sweep traces the whole curve of "landed N short -> finished M past" without
// bisecting for a target carry. Rows are then bucketed by how short they landed.

ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, 4 /* NSUTF8 */, null);
  if (!s) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}

// See engine_smoke.js — JSC has no `self`/`module`, so ballistics.js's UMD lands
// on globalThis while game.js reads window.Ballistics off the stub. Without this
// the harness silently exercises the retired legacy physics.
var BAL_PRELUDE = '\nwindow.Ballistics = (typeof Ballistics !== "undefined") ? Ballistics : globalThis.Ballistics;\n';

var POSTLUDE = `
;(function(){
  var CFG = __CFG__, out = { rows: [], errors: [], holes: 0 };

  // One shot, stepped by hand so the roll can be attributed to surfaces.
  // settle() from headless_stubs just spins update() and would lose all of that.
  function fire(sx, sy, ang, frac) {
    resetState();
    var b = state.ball;
    b.x = sx; b.y = sy;
    b.z = b.vz = b.vx = b.vy = b.spin = 0; b.spinW = 0; b._chipK = 0;
    state.moving = false; state.airborne = false; state.inHole = false;
    state.lastSafe = { x: sx, y: sy };
    // Explicit ZERO dispersion. rollDispersion() is seeded rather than random, so
    // it would be reproducible — but it is seeded on ball position, which this
    // sweep varies deliberately, so leaving it on would deal a different card to
    // every row and scatter a measurement that is supposed to isolate the turf.
    launchShot(ang, frac, 0, false, { ang: 0, carry: 0 });
    if (!state.moving) return null;              // buildTrialShot refused the swing

    var carryU = null, landSurf = null, landX = 0, landY = 0;
    var segs = [], px = b.x, py = b.y, wasAir = true;
    for (var i = 0; i < 40000 && (state.moving || state.airborne); i++) {
      update();
      var nx = b.x, ny = b.y;
      if (wasAir && !state.airborne) {           // first touchdown = carry
        if (carryU == null) {
          carryU = Math.hypot(nx - sx, ny - sy);
          landSurf = surfaceAt(nx, ny); landX = nx; landY = ny;
        }
      }
      if (!state.airborne) {                     // on the deck: attribute the inch
        var s = surfaceAt(nx, ny);
        var d = Math.hypot(nx - px, ny - py);
        if (!segs.length || segs[segs.length - 1].surf !== s) segs.push({ surf: s, u: 0 });
        segs[segs.length - 1].u += d;
      }
      px = nx; py = ny; wasAir = state.airborne;
    }
    if (carryU == null) return null;             // never landed (holed out of the air, or bailed)
    return { carryU: carryU, landSurf: landSurf, landX: landX, landY: landY,
             segs: segs, restX: b.x, restY: b.y, holed: !!state.inHole,
             restSurf: surfaceAt(b.x, b.y) };
  }

  function matrix() {
    var rows = [], hs = course.holes;
    for (var i = 0; i < hs.length; i++) {
      var rec = hs[i];
      if (CFG.holes && CFG.holes.indexOf(rec.num) < 0) continue;
      try {
        setHole(rec);
        if (CFG.stimp) HOLE.greenSpeed = CFG.stimp;
        out.holes++;
        var pin = HOLE.holePos, tee = HOLE.teePos || pin;
        var dx = tee.x - pin.x, dy = tee.y - pin.y, dm = Math.hypot(dx, dy) || 1;
        var ux = dx / dm, uy = dy / dm;          // unit vector pin -> tee
        // Fixed club, manual: an auto-club would change under us as power varies,
        // and the point is to isolate the GROUND phase, not the club table.
        autoClubEnabled = false; manualClubThisShot = true; selectedClub = CFG.club;
        chipEnabled = false;                     // 175 yd out it can't be a chip anyway
        previewFrac = 1; previewFracTouched = false;
        // Turf, not weather: wind would move every landing point and the whole
        // sweep with it, and this gate is about what happens AFTER the ball lands.
        windEnabled = false; wind.speed = 0;

        // CALIBRATE the start distance per hole. Placing the ball at the club's
        // table carry is not enough — elevation (elevAdjustCarry) means a full
        // swing can finish 20 yd short of the pin, and then the sweep never
        // reaches the green and the seam this tool exists to measure is never
        // sampled. So: fire one full swing, see where it actually pitches, then
        // re-place the ball at that distance so full power carries TO the pin and
        // every softer swing lands progressively shorter.
        var fromU = (CFG.from || TUNE.clubs[CFG.club].carry) / YARDS_PER_UNIT;
        var sx = pin.x + ux * fromU, sy = pin.y + uy * fromU;
        var ang = Math.atan2(pin.y - sy, pin.x - sx);
        if (CFG.from == null) {
          var cal = fire(sx, sy, ang, 1.0);
          if (cal) {
            fromU = cal.carryU;
            sx = pin.x + ux * fromU; sy = pin.y + uy * fromU;
            ang = Math.atan2(pin.y - sy, pin.x - sx);
          }
        }
        for (var k = 0; k < CFG.fracs.length; k++) {
          try {
            var r = fire(sx, sy, ang, CFG.fracs[k]);
            if (!r) continue;
            var landPin = Math.hypot(r.landX - pin.x, r.landY - pin.y) * YARDS_PER_UNIT;
            // signed: + = landed short of the pin (still to travel), - = past it
            var landAlong = ((pin.x - r.landX) * (pin.x - sx) + (pin.y - r.landY) * (pin.y - sy));
            var shortYd = (landAlong >= 0 ? 1 : -1) * landPin;
            var restPin = Math.hypot(r.restX - pin.x, r.restY - pin.y) * YARDS_PER_UNIT;
            var restAlong = ((pin.x - r.restX) * (pin.x - sx) + (pin.y - r.restY) * (pin.y - sy));
            var pastYd = (restAlong >= 0 ? -1 : 1) * restPin;   // + = finished PAST the pin
            var roll = 0, segOut = [], crossedGreen = false;
            for (var q = 0; q < r.segs.length; q++) {
              var yd = r.segs[q].u * YARDS_PER_UNIT;
              roll += yd;
              segOut.push(r.segs[q].surf + ":" + (Math.round(yd * 10) / 10));
              if (r.segs[q].surf === "green") crossedGreen = true;
            }
            rows.push({ hole: rec.num, frac: CFG.fracs[k],
                        carry: r.carryU * YARDS_PER_UNIT,
                        landSurf: r.landSurf, shortYd: shortYd,
                        roll: roll, segs: segOut, nSeg: r.segs.length,
                        greenRun: crossedGreen && r.landSurf !== "green",
                        rest: restPin, pastYd: pastYd,
                        restSurf: r.restSurf, holed: r.holed });
          } catch (e) {
            out.errors.push("hole " + rec.num + " f" + CFG.fracs[k] + ": " + ((e && e.stack) || e));
          }
        }
      } catch (e) { out.errors.push("hole " + rec.num + ": " + ((e && e.stack) || e)); }
    }
    return rows;
  }

  try {
    mode = "course";
    course = __COURSE__;
    // Drop the AERIAL only. putt_matrix drops the mask too (a putt never leaves
    // the green, where OSM polygons are ground truth ahead of the mask) — here
    // the mask IS the measurement, because it decides whether the apron short of
    // the green plays as fairway (roll 5.60) or rough (9.00).
    for (var h = 0; h < (course.holes || []).length; h++) delete course.holes[h].aerial;
    delete course.aerial;
    course._img = undefined; course._imgReady = false;
    var rows = matrix();
    out.rows = rows;
    out.club = CFG.club; out.from = CFG.from;
    out.timeScale = TUNE.timeScale;
    out.aero = !!(TUNE.aeroPhysics && window.Ballistics);
    out.stimp = DEFAULT_STIMP;
    out.turf = {};
    var keys = ["fairway", "rough", "green", "bunker"];
    for (var t = 0; t < keys.length; t++) {
      out.turf[keys[t]] = { mu: TUNE.turf[keys[t]].mu,
                            roll: rollDecelMs(keys[t]),
                            dig: TUNE.turf[keys[t]].dig,
                            muG: TUNE.turf[keys[t]].mu * window.Ballistics.G };
    }
  } catch (e) { out.errors.push("setup: " + ((e && e.stack) || e)); }
  __RESULT__ = out;
})();
JSON.stringify(__RESULT__);
`;

function pctl(a, p) {
  if (!a.length) return null;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function f1(v) { return v == null ? "   -  " : (Math.round(v * 10) / 10).toFixed(1); }
function pad(v, w) { return String(v).padStart(w); }

// Rows whose LANDING was in the band we care about: short of the pin, on grass.
function band(rows, lo, hi) {
  return rows.filter(function (r) {
    return r.shortYd >= lo && r.shortYd < hi &&
           (r.landSurf === "fairway" || r.landSurf === "rough");
  });
}

function report(res, cfg) {
  var L = [];
  L.push("approach matrix — " + cfg.id + "  club " + res.club +
         "  from " + (res.from == null ? "auto (calibrated per hole)" : res.from + " yd") +
         "  stimp " + res.stimp + "  aero " + (res.aero ? "on" : "OFF") +
         "  holes " + res.holes);
  var tk = Object.keys(res.turf || {});
  for (var i = 0; i < tk.length; i++) {
    var t = res.turf[tk[i]];
    L.push("  turf " + pad(tk[i], 8) + "  roll " + f1(t.roll) + " m/s2   mu*g " + f1(t.muG) +
           "   " + (t.roll > t.muG ? "<-- INVERTED (rolls harder than it skids)" : "ok"));
  }
  var rows = res.rows || [];
  L.push("");
  L.push("landed short of pin, on grass — how far it then ran, and where it finished");
  L.push(pad("shortYd", 9) + pad("n", 5) + pad("roll p50", 10) + pad("roll p90", 10) +
         pad("past p50", 10) + pad("past p90", 10) + pad("ranOn", 7) + pad("fw%", 6));
  var bands = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 30], [30, 45]];
  for (var b = 0; b < bands.length; b++) {
    var sel = band(rows, bands[b][0], bands[b][1]);
    if (!sel.length) continue;
    var roll = sel.map(function (r) { return r.roll; });
    var past = sel.map(function (r) { return r.pastYd; });
    var ran = sel.filter(function (r) { return r.greenRun; }).length;
    var fw = sel.filter(function (r) { return r.landSurf === "fairway"; }).length;
    L.push(pad(bands[b][0] + "-" + bands[b][1], 9) + pad(sel.length, 5) +
           pad(f1(pctl(roll, 0.5)), 10) + pad(f1(pctl(roll, 0.9)), 10) +
           pad(f1(pctl(past, 0.5)), 10) + pad(f1(pctl(past, 0.9)), 10) +
           pad(Math.round(100 * ran / sel.length) + "%", 7) +
           pad(Math.round(100 * fw / sel.length) + "%", 6));
  }
  // The seam itself: shots that landed off the green and ran ONTO it.
  var onto = rows.filter(function (r) { return r.greenRun; });
  L.push("");
  L.push("crossed onto the green while rolling: " + onto.length + " / " + rows.length +
         " shots" + (onto.length ? "" : "  (none — widen --from or the frac sweep)"));
  if (onto.length) {
    var oRoll = onto.map(function (r) { return r.roll; });
    var oPast = onto.map(function (r) { return r.pastYd; });
    L.push("  roll p50 " + f1(pctl(oRoll, 0.5)) + "  p90 " + f1(pctl(oRoll, 0.9)) +
           "  max " + f1(Math.max.apply(null, oRoll)));
    L.push("  finished past the pin p50 " + f1(pctl(oPast, 0.5)) +
           "  p90 " + f1(pctl(oPast, 0.9)) + "  max " + f1(Math.max.apply(null, oPast)));
    var worst = onto.slice().sort(function (a, c) { return c.roll - a.roll; }).slice(0, 6);
    L.push("  worst rollouts:");
    for (var w = 0; w < worst.length; w++) {
      L.push("    h" + pad(worst[w].hole, 2) + " landed " + f1(worst[w].shortYd) +
             " short on " + pad(worst[w].landSurf, 7) + " ran " + f1(worst[w].roll) +
             " finished " + f1(worst[w].pastYd) + " past   [" + worst[w].segs.join(" ") + "]");
    }
  }
  if (res.errors && res.errors.length) {
    L.push("");
    L.push("errors (" + res.errors.length + "):");
    for (var e = 0; e < Math.min(res.errors.length, 8); e++) L.push("  " + res.errors[e]);
  }
  return L.join("\n");
}

function gate(res) {
  var fails = [], warns = [], rows = res.rows || [];
  // 1. The model must not be inverted: a rolling ball cannot decelerate harder
  //    than a skidding one. This is the actual bug class, asserted directly.
  var tk = Object.keys(res.turf || {});
  for (var i = 0; i < tk.length; i++) {
    var t = res.turf[tk[i]];
    if (t.roll > t.muG)
      fails.push(tk[i] + " roll " + f1(t.roll) + " m/s2 exceeds skid decel mu*g " +
                 f1(t.muG) + " — rolling resistance above kinetic friction is unphysical");
  }
  // 2. Rolling resistance must be ordered green < fairway < rough.
  var T = res.turf || {};
  if (T.green && T.fairway && T.green.roll >= T.fairway.roll)
    fails.push("green roll " + f1(T.green.roll) + " >= fairway " + f1(T.fairway.roll));
  if (T.fairway && T.rough && T.fairway.roll >= T.rough.roll)
    fails.push("fairway roll " + f1(T.fairway.roll) + " >= rough " + f1(T.rough.roll));
  // 3. The reported symptom: landing short and running onto the green must not
  //    turn into a putt. Bounded against the green, not an absolute yardage, so
  //    it holds on a 13.5-stimp course as well as an 11.
  var onto = rows.filter(function (r) { return r.greenRun; });
  if (onto.length >= 8) {
    var p90 = pctl(onto.map(function (r) { return r.roll; }), 0.9);
    if (p90 > 45) fails.push("green-crossing rollout p90 " + f1(p90) + " yd > 45");
    var past90 = pctl(onto.map(function (r) { return r.pastYd; }), 0.9);
    if (past90 > 30) fails.push("green-crossing finish p90 " + f1(past90) + " yd past the pin > 30");
  } else if (rows.length) {
    warns.push("only " + onto.length + " green-crossing shots — seam barely sampled");
  }
  // 4. A shot landing on grass short of the pin has to actually roll SOMEWHERE.
  //    Zero rollout would mean the ball is plugging, which is the opposite bug.
  var grass = band(rows, 0, 45);
  if (grass.length >= 10) {
    var med = pctl(grass.map(function (r) { return r.roll; }), 0.5);
    if (med < 1) fails.push("median rollout off the green " + f1(med) + " yd < 1 — ball is plugging");
  }
  if (res.errors && res.errors.length) warns.push(res.errors.length + " sim errors");
  return { fails: fails, warns: warns };
}

function run(argv) {
  var cfg = { id: argv[0], base: argv[1], holes: null, json: false, gate: false,
              club: "7i", from: null, stimp: null,
              fracs: [0.62, 0.66, 0.70, 0.74, 0.78, 0.82, 0.86, 0.90, 0.94, 0.97, 1.0] };
  if (!cfg.id || !cfg.base)
    throw new Error("usage: approach_matrix.js <courseId> <repoRoot> [--json|--gate|--holes 1,4|--club 7i|--from 175|--stimp N]");
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--json") cfg.json = true;
    else if (a === "--gate") cfg.gate = true;
    else if (a === "--holes") cfg.holes = argv[++i].split(",").map(Number);
    else if (a === "--club") cfg.club = argv[++i];
    else if (a === "--from") cfg.from = Number(argv[++i]);
    else if (a === "--stimp") cfg.stimp = Number(argv[++i]);
  }
  var courseJson = readFile(cfg.base + "/courses/" + cfg.id + ".json");
  // cfg.from stays null unless the caller pins it: the sim self-calibrates per
  // hole (see the CALIBRATE block) so the sweep straddles the pin on every hole,
  // whatever the elevation does to that club's carry there.
  var post = POSTLUDE.replace("__CFG__", JSON.stringify(cfg));
  var big = readFile(cfg.base + "/tools/headless_stubs.js")
          + readFile(cfg.base + "/ballistics.js") + BAL_PRELUDE
          + "\nvar __COURSE__ = " + courseJson + ";\n"
          + readFile(cfg.base + "/game.js")
          + post;
  var res = JSON.parse(eval(big));
  if (cfg.json) return JSON.stringify(res);
  var txt = report(res, cfg);
  if (cfg.gate) {
    var g = gate(res);
    for (var w = 0; w < g.warns.length; w++) txt += "\nWARN: " + g.warns[w];
    if (g.fails.length)
      throw new Error(txt + "\n\nAPPROACH GATE FAIL (" + g.fails.length + "):\n  " + g.fails.join("\n  "));
    txt += "\n\ngate: all checks pass";
  }
  return txt;
}
