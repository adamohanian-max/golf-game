// STRIKE DISPERSION probe — run via:
//   osascript -l JavaScript tools/disp_probe.js <id> <repoRoot> [--hole 1] [--n 60] [--gate]
//
// Drives the REAL game headless (same JavaScriptCore rig as engine_smoke.js /
// putt_matrix.js — tools/headless_stubs.js + ballistics.js + game.js itself), so
// there is no mirrored copy of the physics to drift.
//
// This exists because every other gate is structurally blind to dispersion:
//   shot_matrix.mjs   calls its own mirror of buildTrialShot and passes no disp
//   ball_calibrate    is flight-only
//   putt_matrix.js    fires launchShot(ang, 0.5, 0, true) — putts never reach
//                     the dispersion branch at all (the putter path returns
//                     before it)
//   engine_smoke.js   only asserts nothing THROWS — a disp that silently came
//                     back null every time would sail straight through it
//
// Four things are checked, and the first is the one that actually matters:
//   1. determinism — the same ball, hole, stroke and round seed must deal the
//      same card. If this fails the daily challenge is not fair and no bug is
//      reproducible.
//   2. it fires at all — spread must be non-zero (the null-disp trap above)
//   3. magnitude — 1 sigma offline within a sane band of the TUNE intent
//   4. lie scaling — rough must spread wider than fairway
ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, 4, null);
  if (!s) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}

var POSTLUDE = `
;(function(){
  var out = { rows: [], err: null };
  try {
    mode = "course";
    course = __COURSE__;
    course._dem = undefined; course._greens = null; course._img = undefined; course._imgReady = false;
    var hs = course.holes, want = __HOLE__;
    var rec = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].num === want) rec = hs[i];
    if (!rec) throw new Error("hole " + want + " not in course");
    setHole(rec);

    var tee = { x: HOLE.teePos.x, y: HOLE.teePos.y };
    var ang = Math.atan2(HOLE.holePos.y - tee.y, HOLE.holePos.x - tee.x);
    // Aim-line basis: offline is the component across the aim, carry along it.
    var ax = Math.cos(ang), ay = Math.sin(ang);
    var px = -ay, py = ax;

    // The lie is forced rather than found: surfaceAt() depends on this hole's
    // polygons, and hunting for a real rough pixel would make the probe's answer
    // depend on which hole it landed on. lieEffectEnabled is the same switch the
    // game uses, so the multiplier path under test is the real one.
    function fire(strokes, forceLie) {
      resetState();
      state.ball.x = tee.x; state.ball.y = tee.y;
      state.ball.z = 0; state.ball.vx = state.ball.vy = state.ball.vz = 0;
      state.moving = false; state.airborne = false;
      state.strokes = strokes;
      selectedClub = "driver";
      autoClubEnabled = false;
      var realSurf = surfaceAt;
      if (forceLie) surfaceAt = function () { return forceLie; };
      try { launchShot(ang, 1, 0, false); settle(4000); }
      finally { surfaceAt = realSurf; }
      var dx = state.ball.x - tee.x, dy = state.ball.y - tee.y;
      return { off: (dx * px + dy * py) * YARDS_PER_UNIT,
               along: (dx * ax + dy * ay) * YARDS_PER_UNIT };
    }

    var N = __N__;
    for (var lie of ["fairway", "rough"]) {
      var offs = [], alongs = [];
      for (var k = 0; k < N; k++) {
        var r = fire(k, lie);
        offs.push(r.off); alongs.push(r.along);
      }
      var mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      var sd = (a) => { var m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };
      out.rows.push({ lie: lie, n: N, offMean: mean(offs), offSd: sd(offs),
                      alongMean: mean(alongs), alongSd: sd(alongs),
                      offMax: Math.max.apply(null, offs.map(Math.abs)) });
    }

    // Determinism: identical inputs, twice.
    var a1 = fire(7, "fairway"), a2 = fire(7, "fairway");
    out.determ = Math.hypot(a1.off - a2.off, a1.along - a2.along);
    // And a different stroke number must deal a different card, or the "seeded"
    // part is real but the "varies" part is not.
    var a3 = fire(8, "fairway");
    out.varies = Math.hypot(a1.off - a3.off, a1.along - a3.along);
  } catch (e) { out.err = (e && e.stack) || String(e); }
  __RESULT__ = out;
})();
JSON.stringify(__RESULT__);
`;

function run(argv) {
  var id = argv[0], base = argv[1];
  if (!id || !base) throw new Error("usage: disp_probe.js <id> <repoRoot> [--hole N] [--n N] [--gate]");
  var hole = 1, n = 60, gate = false;
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === "--hole") hole = parseInt(argv[i + 1], 10);
    else if (argv[i] === "--n") n = parseInt(argv[i + 1], 10);
    else if (argv[i] === "--gate") gate = true;
  }
  var courseJson = readFile(base + "/courses/" + id + ".json");
  // The aerial and mask cost 12-100s per hole in JSC and cannot change a
  // trajectory — same reason putt_matrix drops them.
  var cj = JSON.parse(courseJson);
  for (var h of cj.holes) { delete h.aerial; delete h.surfaceMask; }
  var big = readFile(base + "/tools/headless_stubs.js")
          + "\nvar __HOLE__ = " + hole + ";\nvar __N__ = " + n + ";\n"
          + readFile(base + "/ballistics.js")
          + '\nwindow.Ballistics = (typeof Ballistics !== "undefined") ? Ballistics : globalThis.Ballistics;\n'
          + "\nvar __COURSE__ = " + JSON.stringify(cj) + ";\n"
          + readFile(base + "/game.js") + "\n" + POSTLUDE;
  var res = JSON.parse(eval(big));
  if (res.err) throw new Error("DISP PROBE ERROR:\n" + res.err);

  var f = (v, d) => v.toFixed(d == null ? 2 : d);
  var lines = ["", "=== STRIKE DISPERSION (driver, hole " + hole + ", n=" + n + ") ==="];
  lines.push("  lie        off mean   off sd   off max   carry mean   carry sd");
  for (var r of res.rows)
    lines.push("  " + r.lie.padEnd(10) + f(r.offMean).padStart(8) + f(r.offSd).padStart(9) +
               f(r.offMax).padStart(10) + f(r.alongMean, 1).padStart(13) + f(r.alongSd).padStart(11));
  lines.push("  determinism: same inputs differ by " + f(res.determ, 4) + " yd");
  lines.push("  variation:   next stroke differs by " + f(res.varies, 2) + " yd");

  if (gate) {
    var fails = [];
    var fw = res.rows.find(r => r.lie === "fairway");
    var rg = res.rows.find(r => r.lie === "rough");
    if (res.determ > 1e-9)
      fails.push("NOT DETERMINISTIC: identical inputs differ by " + f(res.determ, 4) + " yd — the daily is unfair and no bug replays");
    if (res.varies < 0.5)
      fails.push("dispersion does not vary between strokes (" + f(res.varies) + " yd) — seeded but frozen");
    if (fw.offSd < 2)
      fails.push("fairway offline sd " + f(fw.offSd) + " yd — dispersion is not firing (disp null?)");
    if (fw.offSd > 15)
      fails.push("fairway offline sd " + f(fw.offSd) + " yd — dispersion is wild");
    if (rg.offSd <= fw.offSd * 1.3)
      fails.push("rough (" + f(rg.offSd) + ") does not spread meaningfully wider than fairway (" + f(fw.offSd) + ") — lieAccuracy is inert");
    // A cone must be centred: a biased draw is an aim error every player would
    // learn to counter-aim, which is worse than no dispersion at all.
    if (Math.abs(fw.offMean) > fw.offSd)
      fails.push("fairway dispersion is BIASED: mean " + f(fw.offMean) + " vs sd " + f(fw.offSd));
    lines.push("");
    if (fails.length) { lines.push("FAIL (" + fails.length + ")"); for (var m of fails) lines.push("  x " + m); }
    else lines.push("PASS");
    if (fails.length) { console.log(lines.join("\n")); $.NSApplication; throw new Error("disp gate failed"); }
  }
  return lines.join("\n");
}
