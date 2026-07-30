// Engine smoke test — run via:
//   osascript -l JavaScript tools/engine_smoke.js <id> <repoRoot> [--holes 1,4,7]
//
// Loads game.js into a headless JavaScriptCore environment with stubbed
// DOM/canvas/Image/fetch (tools/headless_stubs.js), points the game at
// courses/<id>.json, then for EVERY hole runs draw() in BOTH render modes
// (vector + photoreal) plus a full swing and a putt. No exception across all
// holes = pass (exit 0). Any throw => non-zero exit with the failing holes, so
// verify_course.py can gate on it.
//
// The full 18 is ~2 min (two draw() passes per hole) — use --holes to subset.
//
// processAerial() uses only drawImage/fillRect (no getImageData), so the real
// aerial pipeline runs against a stub Image that fires onload synchronously —
// the photoreal path is exercised for real, not faked.
//
// The DOM/canvas stubs live in tools/headless_stubs.js so tools/putt_matrix.js
// can share them.

ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, 4 /* NSUTF8 */, null);
  if (!s) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}

// ballistics.js's UMD picks `self` then `globalThis`. Under osascript BOTH `self`
// and `module` are undefined, so it lands on globalThis — while game.js reads
// `window.Ballistics` off the STUB window. Wire them together or the whole
// aeroPhysics branch silently never runs (buildTrialShot -> attachAero derefs
// window.Ballistics and throws, and before this the harness had only ever
// exercised the retired legacy physics).
var BAL_PRELUDE = '\nwindow.Ballistics = (typeof Ballistics !== "undefined") ? Ballistics : globalThis.Ballistics;\n';

var POSTLUDE = `
;(function(){
  var errors = [];
  try {
    mode = "course";
    course = __COURSE__;                 // game.js's top-level 'let course'
    course._dem = undefined; course._greens = null; course._img = undefined; course._imgReady = false;
    var hs = course.holes, only = __ONLY__;
    for (var i = 0; i < hs.length; i++) {
      var rec = hs[i];
      if (only && only.indexOf(rec.num) < 0) continue;
      try {
        setHole(rec);                    // frames camera + resets state + loads aerial (onload sync)
        draw();                          // photoreal (image ready after hole 0)
        var ready = HOLE._imgReady; HOLE._imgReady = false; draw(); HOLE._imgReady = ready;  // vector
        // full swing toward the pin
        resetState();
        launchShot(Math.atan2(HOLE.holePos.y - HOLE.teePos.y, HOLE.holePos.x - HOLE.teePos.x), 1, 0, false);
        settle(3000);
        // putt: place the ball just off the cup on the green and roll it in
        state.ball.x = HOLE.holePos.x + 0.7; state.ball.y = HOLE.holePos.y + 0.7;
        state.ball.vx = state.ball.vy = state.ball.z = state.ball.vz = state.ball.spin = 0;
        state.moving = false; state.airborne = false;
        launchShot(Math.atan2(HOLE.holePos.y - state.ball.y, HOLE.holePos.x - state.ball.x), 0.15, 0, true);
        settle(3000);
        __N__++;
      } catch (e) { errors.push("hole " + rec.num + ": " + ((e && e.stack) || e)); }
    }
  } catch (e) { errors.push("setup: " + ((e && e.stack) || e)); }
  __RESULT__ = { ok: errors.length === 0, errors: errors, holes: __N__,
                 aero: !!(TUNE.aeroPhysics && window.Ballistics) };
})();
JSON.stringify(__RESULT__);
`;

function run(argv) {
  var id = argv[0];
  var base = argv[1];
  if (!id || !base) throw new Error("usage: engine_smoke.js <id> <repoRoot> [--holes 1,4,7]");
  var only = "null";
  for (var i = 2; i < argv.length; i++) {
    if (argv[i] === "--holes" && argv[i + 1]) only = "[" + argv[i + 1] + "]";
  }
  var courseJson = readFile(base + "/courses/" + id + ".json");
  var big = readFile(base + "/tools/headless_stubs.js")
          + "\nvar __N__ = 0;\nvar __ONLY__ = " + only + ";\n"
          + readFile(base + "/ballistics.js") + BAL_PRELUDE
          + "\nvar __COURSE__ = " + courseJson + ";\n"
          + readFile(base + "/game.js") + "\n" + POSTLUDE;
  var out = eval(big);
  var res = JSON.parse(out);
  if (!res.ok) {
    throw new Error("ENGINE SMOKE FAIL (" + res.errors.length + " hole(s)):\n  " +
                    res.errors.slice(0, 8).join("\n  "));
  }
  if (!res.aero) throw new Error("ENGINE SMOKE FAIL: aeroPhysics branch not live (window.Ballistics unbound)");
  return "engine smoke PASS: " + res.holes + " holes, aero physics live (draw vector+photoreal, swing, putt)";
}
