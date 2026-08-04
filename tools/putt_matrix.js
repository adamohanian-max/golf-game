// Putt matrix — the GREEN-READING gate. Run via:
//
//   osascript -l JavaScript tools/putt_matrix.js <courseId> <repoRoot> [flags]
//     --json           raw rows (before/after diffs)
//     --gate           exit 1 on a regression
//     --holes 1,4,7    subset (default: all)
//     --dists 6,20,30  distances in FEET (default 3,5,6,10,20,30,45)
//     --offgreen       ALSO sweep the off-green putter (bump-and-run) branch
//     --offdists 8,20  off-green distances in YARDS (default 5,8,12,20,30)
//     --timescale N    re-run the sim at another pace
//     --stimp N        override every hole's greenSpeed in memory
//     --dtcheck        run the matrix at this timeScale AND 0.25, compare
//
// WHY JXA and not node: this drives the REAL game — headless_stubs.js +
// ballistics.js + game.js, then setHole() / launchShot() / update(). A node
// harness would have to mirror buildGreenTopo, demPlaneTilt, greenSlopeAt,
// slopeGradAt, rollStepSI, invertPuttPaceCurved, buildTrialShot's putter branch
// and resolveCup — all of which run through HOLE, polygon hit tests, per-hole
// greenSpeed and the cup. That is exactly where drift hides. Cost: ~2 s of load,
// no draw() (this is physics only, ~20x faster than engine_smoke).
//
// Each putt is DEAD PACE: launchShot(ang, 0.5, 0, true) puts f at the middle of
// the puttBandLo..puttBandHi band, so the target is exactly the cup and the pace
// comes from the real invertPuttPaceCurved. Break is then the rest point's
// offset from the aim line — the number a player has to read.

ObjC.import('Foundation');

function readFile(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(p, 4 /* NSUTF8 */, null);
  if (!s) throw new Error("cannot read " + p);
  return ObjC.unwrap(s);
}

// See engine_smoke.js — JSC has no `self`/`module`, so ballistics.js's UMD lands
// on globalThis while game.js reads window.Ballistics off the stub.
var BAL_PRELUDE = '\nwindow.Ballistics = (typeof Ballistics !== "undefined") ? Ballistics : globalThis.Ballistics;\n';

var POSTLUDE = `
;(function(){
  var CFG = __CFG__, out = { rows: [], census: [], errors: [] };
  var FT = 1 / FT_PER_UNIT_OR_9;                 // feet -> world units
  function pct(a, p){ if (!a.length) return null;
    var s = a.slice().sort(function(x, y){ return x - y; });
    return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

  function runOne(rec, greenIdx, g, D_ft, ang, upDir) {
    var pin = HOLE.holePos, D = D_ft * FT;
    resetState();
    var b = state.ball;
    b.x = pin.x - Math.cos(ang) * D; b.y = pin.y - Math.sin(ang) * D;
    if (surfaceAt(b.x, b.y) !== "green") return null;
    b.z = b.vz = b.vx = b.vy = b.spin = 0; b.spinW = 0;
    state.moving = false; state.airborne = false;
    var sx = b.x, sy = b.y;
    var gr = slopeGradAt(sx, sy, "green");        // grad points UPHILL
    var gm = gr ? Math.hypot(gr.x, gr.y) : 0;
    launchShot(ang, 0.5, 0, true);
    var mph = (typeof shot !== "undefined" && shot) ? shot.mph : null;
    var ticks = settle(1200);
    var ex = state.ball.x - sx, ey = state.ball.y - sy;
    // signed lateral offset off the aim line; perpendicular of (cos,sin) is (-sin,cos)
    var lat = (-Math.sin(ang) * ex + Math.cos(ang) * ey) * FT_PER_UNIT_OR_9;
    var cls = "cross";
    if (upDir) { var c = Math.cos(ang) * upDir.x + Math.sin(ang) * upDir.y;
                 cls = c > 0.65 ? "up" : (c < -0.65 ? "down" : "cross"); }
    return { hole: rec.num, greenIdx: greenIdx, D_ft: D_ft, aim: ang, cls: cls,
             stimp: HOLE.greenSpeed, mph: mph, grade: gm,
             disp_ft: Math.hypot(ex, ey) * FT_PER_UNIT_OR_9, lat_ft: lat,
             ticks: ticks, holed: !!state.inHole, restSurf: surfaceAt(state.ball.x, state.ball.y) };
  }

  // One OFF-GREEN putter stroke (bump-and-run). Deliberately a separate function
  // from runOne: that one places the ball on the aim line and rejects any lie
  // that is not green, and always passes onGreen=true, so the entire off-green
  // branch of buildTrialShot went untested. This one sweeps the compass at
  // radius D looking for the first rough/fairway spot, aims back at the pin and
  // fires with the putter, which is the shot a player actually plays from just
  // off the collar. Distances are YARDS here, not feet — a bump-and-run is a
  // yardage shot, and the interesting range (5-30 yd) is silly in feet.
  function runOff(rec, D_yd) {
    var pin = HOLE.holePos, U = D_yd / YARDS_PER_UNIT, sp = null;
    for (var k = 0; k < 144 && !sp; k++) {
      var a = k * Math.PI * 2 / 144;
      var x = pin.x + Math.cos(a) * U, y = pin.y + Math.sin(a) * U, s = surfaceAt(x, y);
      if (s === "rough" || s === "fairway") sp = { x: x, y: y, surf: s, ang: Math.atan2(pin.y - y, pin.x - x) };
    }
    if (!sp) return null;
    resetState();
    var b = state.ball;
    b.x = sp.x; b.y = sp.y;
    b.z = b.vz = b.vx = b.vy = b.spin = 0; b.spinW = 0; b._chipK = 0;
    state.moving = false; state.airborne = false; state.inHole = false;
    chipEnabled = true; autoClubEnabled = false; manualClubThisShot = true; selectedClub = "putter";
    previewFrac = 0.5; previewFracTouched = false;
    var sx = b.x, sy = b.y;
    launchShot(sp.ang, 0.5, 0, false);          // dead pace: f=0.5 -> target IS the pin
    var mph = (typeof shot !== "undefined" && shot) ? shot.mph : null;
    var ticks = settle(6000), e = state.ball;
    return { hole: rec.num, D_yd: D_yd, lie: sp.surf, mph: mph,
             rest_yd: Math.hypot(e.x - sx, e.y - sy) * YARDS_PER_UNIT,
             toPin_yd: Math.hypot(e.x - pin.x, e.y - pin.y) * YARDS_PER_UNIT,
             ticks: ticks, holed: !!state.inHole,
             restSurf: surfaceAt(e.x, e.y) };
  }

  function offMatrix() {
    var rows = [], hs = course.holes;
    for (var i = 0; i < hs.length; i++) {
      var rec = hs[i];
      if (CFG.holes && CFG.holes.indexOf(rec.num) < 0) continue;
      try {
        setHole(rec);
        if (CFG.stimp) HOLE.greenSpeed = CFG.stimp;
        for (var d = 0; d < CFG.offDists.length; d++) {
          try { var r = runOff(rec, CFG.offDists[d]); if (r) rows.push(r); }
          catch (e) { out.errors.push("offgreen hole " + rec.num + " D" + CFG.offDists[d] + ": " + ((e && e.stack) || e)); }
        }
      } catch (e) { out.errors.push("offgreen hole " + rec.num + ": " + ((e && e.stack) || e)); }
    }
    return rows;
  }

  function matrix() {
    var rows = [], census = [];
    var hs = course.holes;
    for (var i = 0; i < hs.length; i++) {
      var rec = hs[i];
      if (CFG.holes && CFG.holes.indexOf(rec.num) < 0) continue;
      try {
        setHole(rec);
        if (CFG.stimp) HOLE.greenSpeed = CFG.stimp;
        var pin = HOLE.holePos, greens = HOLE._greens || [], g = null, gi = -1;
        for (var k = 0; k < greens.length; k++)
          if (greens[k].grad && pointInPoly(pin.x, pin.y, greens[k].poly)) { g = greens[k]; gi = k; break; }
        if (!g) { out.errors.push("hole " + rec.num + ": no green under the pin"); continue; }
        // --- grade census over this green (in-poly grid), plus the macro fall line
        var bb = polyBBox(g.poly), gs = [], mx = 0, my = 0, mn = 0;
        for (var jj = 0; jj <= 12; jj++) for (var ii = 0; ii <= 12; ii++) {
          var x = bb.minx + (bb.maxx - bb.minx) * ii / 12, y = bb.miny + (bb.maxy - bb.miny) * jj / 12;
          if (!pointInPoly(x, y, g.poly)) continue;
          var gv = slopeGradAt(x, y, "green"); if (!gv) continue;
          gs.push(Math.hypot(gv.x, gv.y)); mx += gv.x; my += gv.y; mn++;
        }
        var mm = Math.hypot(mx, my) || 1;
        var upDir = mn ? { x: mx / mm, y: my / mm } : null;   // uphill unit vector
        // Expected cross-slope break of a 20 ft dying putt, closed form, for THIS
        // green's median grade and THIS hole's stimp: deflection ~= 0.5·(a_lat/a_roll)·D
        // with a_lat = (5/7)·g·s. Verified against the stepper within a few % at
        // 2-4% (2.81 predicted vs 2.77 measured, 4.21 vs 4.39). The gate compares
        // the simulated break to this instead of to a fixed band, so it holds on a
        // 13.5-stimp fictional course as well as an 11-stimp real one.
        var aRoll = window.Ballistics.greenDecel(HOLE.greenSpeed || DEFAULT_STIMP);
        var aLat = window.Ballistics.SLOPE_ROLL_K * window.Ballistics.G * (pct(gs, 0.5) || 0);
        census.push({ hole: rec.num, greenIdx: gi, stimp: HOLE.greenSpeed,
          exp20: 0.5 * (aLat / aRoll) * 20,
          n: gs.length, p50: pct(gs, 0.5), p90: pct(gs, 0.9), max: gs.length ? Math.max.apply(null, gs) : null,
          spanFt: (g.hmax != null && g.hmin != null) ? (g.hmax - g.hmin) : null,
          contours: (g.contours || []).length, gmax: g.gmax,
          cap: (typeof greenGradCap === "function") ? greenGradCap() : null });
        // --- the putts: 8 compass headings + straight up and straight down the fall line
        var aims = [];
        for (var a = 0; a < 8; a++) aims.push(a * Math.PI / 4);
        if (upDir) { var au = Math.atan2(upDir.y, upDir.x); aims.push(au); aims.push(au + Math.PI); }
        for (var d = 0; d < CFG.dists.length; d++) for (var q = 0; q < aims.length; q++) {
          try {
            var r = runOne(rec, gi, g, CFG.dists[d], aims[q], upDir);
            if (r) rows.push(r);
          } catch (e) { out.errors.push("hole " + rec.num + " D" + CFG.dists[d] + ": " + ((e && e.stack) || e)); }
        }
      } catch (e) { out.errors.push("hole " + rec.num + ": " + ((e && e.stack) || e)); }
    }
    return { rows: rows, census: census };
  }

  try {
    mode = "course";
    course = __COURSE__;
    // Drop the imagery + label raster before setHole touches them. Measured:
    // setHole costs 12-100 s per hole in JSC with them (the aerial grade/bake
    // runs every canvas op through the stub's Proxy) versus ~0.15 s without,
    // and buildGreenTopo itself is 121 ms. Neither one can change a putt: the
    // green field comes from the polygons + the DEM, and greens are OSM
    // ground truth in surfaceAt, ahead of the mask. Only the off-green surface
    // label of a ball that runs off is affected, which is reported, not gated.
    for (var h = 0; h < (course.holes || []).length; h++) {
      delete course.holes[h].aerial; delete course.holes[h].surfaceMask;
    }
    delete course.aerial; delete course.surfaceMask;
    course._dem = undefined; course._greens = null; course._img = undefined; course._imgReady = false;
    if (CFG.timescale) { TUNE.timeScale = CFG.timescale; recalcPower(); }
    if (CFG.offgreen) out.off = offMatrix();
    var m = matrix();
    out.rows = m.rows; out.census = m.census;
    out.timeScale = TUNE.timeScale;
    out.aero = !!(TUNE.aeroPhysics && window.Ballistics);
    if (CFG.dtcheck) {
      var slow = 0.25;
      TUNE.timeScale = slow; recalcPower(); course._greens = null;
      var m2 = matrix();
      out.dt = { timeScale: slow, rows: m2.rows };
    }
    // flat-green launch-speed reference: what the stimpmeter says a 20 ft putt needs
    out.mphRef20 = greenRollSpeedSI(20 / FT_PER_UNIT_OR_9) * msPerUF() * window.Ballistics.MPH_PER_MS;
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
function f2(v) { return v == null ? "  -  " : (Math.round(v * 100) / 100).toFixed(2); }

function report(res, cfg) {
  var lines = [];
  var rows = res.rows, dists = cfg.dists;
  lines.push("putt matrix — " + cfg.id + "  (timeScale " + res.timeScale +
             ", aero " + (res.aero ? "LIVE" : "OFF") + ", " + rows.length + " putts)");
  lines.push("");
  lines.push("BREAK (ft off the aim line, dead pace)          rest offset");
  lines.push("  D ft |  n  | cross p25  p50  p75  p90 |  up p90 | down p90 | holed%");
  var byD = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; (byD[r.D_ft] = byD[r.D_ft] || []).push(r);
  }
  for (var d = 0; d < dists.length; d++) {
    var g = byD[dists[d]] || [], cross = [], up = [], down = [], holed = 0;
    for (var j = 0; j < g.length; j++) {
      var a = Math.abs(g[j].lat_ft);
      if (g[j].cls === "cross") cross.push(a); else if (g[j].cls === "up") up.push(a); else down.push(a);
      if (g[j].holed) holed++;
    }
    lines.push("  " + String(dists[d]).padStart(5) + " | " + String(g.length).padStart(3) + " |      " +
      f2(pctl(cross, 0.25)) + " " + f2(pctl(cross, 0.5)) + " " + f2(pctl(cross, 0.75)) + " " + f2(pctl(cross, 0.9)) +
      " |   " + f2(pctl(up, 0.9)) + " |    " + f2(pctl(down, 0.9)) +
      " |  " + (g.length ? Math.round(holed / g.length * 100) : 0) + "%");
  }
  // pace error, rest, launch speed
  var stuck = 0, offGreen = 0, mph20 = [];
  for (var k = 0; k < rows.length; k++) {
    var r2 = rows[k];
    if (r2.ticks >= 1200) stuck++;
    if (r2.restSurf !== "green") offGreen++;
    if (r2.D_ft === 20 && r2.mph != null) mph20.push(r2.mph);
  }
  var errsLong = [], errsShort = [];
  for (var p2 = 0; p2 < rows.length; p2++) {
    if (rows[p2].holed) continue;
    var ae = Math.abs(rows[p2].disp_ft - rows[p2].D_ft);
    (rows[p2].D_ft > 6 ? errsLong : errsShort).push(ae);
  }
  lines.push("");
  lines.push("PACE  |disp - D| ft over 6 ft: median " + f2(pctl(errsLong, 0.5)) + "  p90 " + f2(pctl(errsLong, 0.9)) +
             "  max " + f2(errsLong.length ? Math.max.apply(null, errsLong) : null) +
             "   (<=6 ft, floored so it is never short: max " +
             f2(errsShort.length ? Math.max.apply(null, errsShort) : null) + ")");
  lines.push("REST  never-rested (>=1200 ticks): " + stuck + "   rest off green: " + offGreen +
             " (" + (rows.length ? Math.round(offGreen / rows.length * 100) : 0) + "%)");
  lines.push("LAUNCH 20 ft median: " + (mph20.length ? f2(pctl(mph20, 0.5)) : " n/a ") +
             " mph   flat stimp reference " + f2(res.mphRef20) + " mph");
  // tap-ins
  var tap = {};
  for (var t = 0; t < rows.length; t++) {
    var r3 = rows[t];
    if (r3.D_ft !== 3 && r3.D_ft !== 5) continue;
    var e = tap[r3.D_ft] = tap[r3.D_ft] || { n: 0, in: 0 };
    e.n++; if (r3.holed) e.in++;
  }
  var tapTxt = [];
  for (var key in tap) tapTxt.push(key + " ft " + Math.round(tap[key].in / tap[key].n * 100) + "% (" + tap[key].n + ")");
  if (tapTxt.length) lines.push("TAP-IN made at dead pace, aimed STRAIGHT (no read): " + tapTxt.join("   "));
  // grade census
  var cp50 = [], cmax = [], spans = [], cont = [];
  for (var c = 0; c < res.census.length; c++) {
    var q = res.census[c];
    if (q.p50 != null) cp50.push(q.p50);
    if (q.max != null) cmax.push(q.max);
    if (q.spanFt != null) spans.push(q.spanFt);
    cont.push(q.contours);
  }
  lines.push("");
  lines.push("GREENS " + res.census.length + ": grade p50 " + f2(pctl(cp50, 0.5) * 100) + "%  p90 " +
             f2(pctl(cp50, 0.9) * 100) + "%  steepest " + f2(cmax.length ? Math.max.apply(null, cmax) * 100 : null) +
             "%  cap " + f2((res.census[0] && res.census[0].cap) != null ? res.census[0].cap * 100 : null) + "%");
  lines.push("       relief span ft p50 " + f2(pctl(spans, 0.5)) + "  p90 " + f2(pctl(spans, 0.9)) +
             "   contours p50 " + pctl(cont, 0.5) + " max " + (cont.length ? Math.max.apply(null, cont) : 0));
  if (res.off) {
    lines.push("");
    lines.push("OFF-GREEN PUTTER (bump-and-run, dead pace, " + res.off.length + " strokes)");
    lines.push("  D yd |  n  |  med rest |  med err% |  worst err% | mph p90");
    var byY = {};
    for (var o1 = 0; o1 < res.off.length; o1++) {
      var ro = res.off[o1]; (byY[ro.D_yd] = byY[ro.D_yd] || []).push(ro);
    }
    for (var o2 = 0; o2 < cfg.offDists.length; o2++) {
      var gy = byY[cfg.offDists[o2]] || [], rests = [], errs = [], mphs = [];
      for (var o3 = 0; o3 < gy.length; o3++) {
        if (gy[o3].holed) continue;
        rests.push(gy[o3].rest_yd);
        errs.push(Math.abs(gy[o3].rest_yd - gy[o3].D_yd) / gy[o3].D_yd * 100);
        if (gy[o3].mph != null) mphs.push(gy[o3].mph);
      }
      lines.push("  " + String(cfg.offDists[o2]).padStart(5) + " | " + String(gy.length).padStart(3) +
                 " |   " + f2(pctl(rests, 0.5)) + "   |   " + f2(pctl(errs, 0.5)) +
                 "   |    " + f2(errs.length ? Math.max.apply(null, errs) : null) +
                 "    | " + f2(pctl(mphs, 0.9)));
    }
  }
  if (res.dt) {
    // pair rows by (hole, D, aim) and compare
    var key2 = function (r) { return r.hole + "|" + r.D_ft + "|" + Math.round(r.aim * 1000); };
    var m = {}, worstL = 0, worstD = 0, n = 0;
    for (var a2 = 0; a2 < res.dt.rows.length; a2++) m[key2(res.dt.rows[a2])] = res.dt.rows[a2];
    for (var b2 = 0; b2 < rows.length; b2++) {
      var o = m[key2(rows[b2])]; if (!o) continue;
      n++;
      worstL = Math.max(worstL, Math.abs(o.lat_ft - rows[b2].lat_ft));
      worstD = Math.max(worstD, Math.abs(o.disp_ft - rows[b2].disp_ft));
    }
    lines.push("");
    lines.push("dt-INVARIANCE vs timeScale " + res.dt.timeScale + " (" + n + " pairs): worst break delta " +
               f2(worstL) + " ft, worst distance delta " + f2(worstD) + " ft");
    res._dtWorst = { lat: worstL, disp: worstD, n: n };
  }
  if (res.errors.length) {
    lines.push("");
    lines.push("ERRORS (" + res.errors.length + "):");
    for (var e2 = 0; e2 < Math.min(6, res.errors.length); e2++) lines.push("  " + res.errors[e2]);
  }
  return lines.join("\n");
}

// Gate thresholds. Break bands come from the real physics of a dying putt:
// deflection ~= 0.5*(a_lat/a_roll)*D, so a tour-real 1.5-3.5% green must put a
// 20 ft cross-slope putt in the 2.2-4.6 ft band at stimp 11. The rest are
// invariants, not taste: a putt must always come to rest, dead pace must finish
// at the cup, a fall-line putt must not bend, and the whole matrix must not
// change when the integration step does.
function gate(res, cfg) {
  var fails = [], warns = [], rows = res.rows;
  var cross20 = [], stuck = 0, offGreen = 0, mph20 = [], tap = {}, crossByD = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], a = Math.abs(r.lat_ft);
    // Break stats skip HOLED putts: their rest point is the cup, so their
    // "break" is the cup's offset, not the ball's — mixing them in made the
    // per-distance medians jump around with the make rate.
    if (r.cls === "cross" && !r.holed) { (crossByD[r.D_ft] = crossByD[r.D_ft] || []).push(a); if (r.D_ft === 20) cross20.push(a); }
    if (r.ticks >= 1200) stuck++;
    if (r.restSurf !== "green") offGreen++;
    if (r.D_ft === 20 && r.mph != null) mph20.push(r.mph);
    if (r.D_ft === 3 || r.D_ft === 5) {
      var e = tap[r.D_ft] = tap[r.D_ft] || { n: 0, in: 0, flat: 0, flatIn: 0, wild: 0 };
      e.n++; if (r.holed) e.in++;
      if (r.grade < 0.015) { e.flat++; if (r.holed) e.flatIn++; }
      // how far past/short of the CUP it finished (cup is at D along the aim line)
      if (!r.holed && Math.hypot(r.disp_ft - r.D_ft, r.lat_ft) > 1.5 * r.D_ft) e.wild++;
    }
  }
  // Break must match the PHYSICS of the field it is rolling on (see census.exp20),
  // not a fixed band: the same code has to hold on an 11-stimp real course and a
  // 13.5-stimp fictional one. This is the check that would have caught the 12x
  // gradient crush that made putts roll straight, and it equally catches runaway.
  var exps = [];
  for (var e3 = 0; e3 < res.census.length; e3++)
    if (res.census[e3].exp20) exps.push(res.census[e3].exp20);
  if (cross20.length && exps.length) {
    var p50 = pctl(cross20, 0.5), exp20 = pctl(exps, 0.5), ratio = p50 / exp20;
    if (ratio < 0.5 || ratio > 1.8)
      fails.push("cross-slope break at 20 ft: " + f2(p50) + " ft vs " + f2(exp20) +
                 " predicted by the field (ratio " + f2(ratio) + ", want 0.5-1.8)");
  } else warns.push("no 20 ft cross-slope putts sampled");
  // Break must GROW with distance (it is ~linear in D at dying pace). Tolerance
  // matters: adjacent rungs like 5 and 6 ft differ by ~1 in of real break, well
  // inside the sampling noise of ~25 putts per rung, so a strict comparison
  // reports a 0.6 in dip as a physics failure. Allow max(0.15 ft, 20%) of
  // backslide between rungs, and require the ladder to at least double overall.
  var ds = Object.keys(crossByD).map(Number).sort(function (x, y) { return x - y; }), prev = -1, pd = null;
  for (var k = 0; k < ds.length; k++) {
    var v = pctl(crossByD[ds[k]], 0.5);
    if (prev >= 0 && v < prev - Math.max(0.15, 0.2 * prev))
      fails.push("break falls off with distance: " + pd + " ft -> " + f2(prev) + ", " + ds[k] + " ft -> " + f2(v));
    prev = v; pd = ds[k];
  }
  if (ds.length >= 3) {
    var first = pctl(crossByD[ds[0]], 0.5), last = pctl(crossByD[ds[ds.length - 1]], 0.5);
    if (last < 2 * first)
      fails.push("break barely grows with distance: " + ds[0] + " ft -> " + f2(first) + ", " +
                 ds[ds.length - 1] + " ft -> " + f2(last) + " (want at least 2x)");
  }
  // A putt struck along the fall line must bend LESS than one struck across it.
  // Not "must not bend at all": the heading class comes from the green's MACRO
  // fall line, and the micro undulation genuinely tilts sideways under a putt
  // aimed straight up the macro slope — real greens do that too. What would be a
  // bug is break that ignores the slope direction (a constant bias), which shows
  // up as fall-line break matching or exceeding cross-slope break, and as a
  // non-zero MEAN signed cross-slope offset (break that always goes one way).
  var fall20 = [], cross20s = [];
  for (var j = 0; j < rows.length; j++) {
    if (rows[j].D_ft !== 20 || rows[j].holed) continue;
    if (rows[j].cls === "cross") cross20s.push(rows[j].lat_ft);
    else fall20.push(Math.abs(rows[j].lat_ft));
  }
  if (fall20.length && cross20.length) {
    var fp = pctl(fall20, 0.5), cp2 = pctl(cross20, 0.5);
    if (fp > cp2 * 0.8)
      fails.push("fall-line putts bend as much as cross-slope ones at 20 ft: " + f2(fp) +
                 " vs " + f2(cp2) + " ft (want <= 80% of cross)");
  }
  if (cross20s.length >= 8) {
    var sum = 0;
    for (var s2 = 0; s2 < cross20s.length; s2++) sum += cross20s[s2];
    var mean = sum / cross20s.length, mag = pctl(cross20, 0.5) || 1;
    if (Math.abs(mean) > 0.5 * mag)
      fails.push("cross-slope break is biased one way: mean signed " + f2(mean) +
                 " ft vs magnitude " + f2(mag) + " (break must follow the slope, not a constant)");
  }
  // Pace: the short-putt floor (buildTrialShot's puttFloorFt) DELIBERATELY never
  // leaves a putt short inside 6 ft, using the flat closed form, so a downhill
  // tap-in is meant to run past the cup. Those are reported, not gated.
  // ...and a putt that curled OFF the green: past the collar the turf and the
  // slope field both change, so dead pace for a green roll cannot land it at D.
  var errsLong = [];
  for (var p2 = 0; p2 < rows.length; p2++)
    if (!rows[p2].holed && rows[p2].D_ft > 6 && rows[p2].restSurf === "green")
      errsLong.push(Math.abs(rows[p2].disp_ft - rows[p2].D_ft));
  if (errsLong.length) {
    var med = pctl(errsLong, 0.5), mx = Math.max.apply(null, errsLong);
    if (med > 0.15) fails.push("pace error median " + f2(med) + " ft, want <= 0.15");
    if (mx > 0.60) fails.push("pace error max " + f2(mx) + " ft, want <= 0.60");
  }
  // Off-green putter (bump-and-run). Gated LOOSER than the on-green pace check
  // and on purpose: this roll crosses a surface seam, and which TICK the ball
  // steps over the collar is discrete against turf that decelerates 18x faster
  // than the green, so predicted and live displacement can differ by a tick's
  // worth of rough. What is NOT allowed is the failure this gate was written for
  // — the stroke saturating against a ceiling and ignoring the target entirely,
  // which measured as a 20 yd bump-and-run stopping at 4.8 yd (-76%).
  if (res.off && res.off.length) {
    var offErr = [], sat = 0;
    for (var f1 = 0; f1 < res.off.length; f1++) {
      var ro2 = res.off[f1];
      if (ro2.holed) continue;
      var pe = (ro2.rest_yd - ro2.D_yd) / ro2.D_yd;
      offErr.push(Math.abs(pe));
      if (pe < -0.35) sat++;                    // finished a third short: a ceiling, not a miss
    }
    if (offErr.length) {
      var omed = pctl(offErr, 0.5), omax = Math.max.apply(null, offErr);
      if (omed > 0.10) fails.push("off-green putter pace error median " + f2(omed * 100) + "%, want <= 10%");
      if (omax > 0.30) fails.push("off-green putter pace error max " + f2(omax * 100) + "%, want <= 30%");
    }
    if (sat) fails.push(sat + " off-green putter stroke(s) finished >35% short — the pace is being clamped, not solved");
  }
  if (stuck) fails.push(stuck + " putt(s) never came to rest (>=1200 ticks)");
  if (rows.length && offGreen / rows.length > 0.05)
    warns.push(Math.round(offGreen / rows.length * 100) + "% of putts rest off the green");
  // Launch speed. The MEDIAN over all 20 ft putts is the right statistic: uphill
  // needs more pace and downhill less, symmetrically, so the median sits near the
  // flat stimpmeter answer. This is the tripwire for a putt that skids off the
  // face instead of rolling — that regression reads 35% hot, far outside 15%.
  if (mph20.length) {
    var got = pctl(mph20, 0.5), want = res.mphRef20;
    if (Math.abs(got - want) / want > 0.15)
      fails.push("20 ft launch speed " + f2(got) + " mph vs flat stimp reference " + f2(want) + " (>15% off)");
  }
  // Makeability. These are dead-pace putts aimed DEAD STRAIGHT at the cup with no
  // read at all, so on a real green they are supposed to miss: at stimp 11 a 3%
  // grade breaks a 5-footer ~12 in (AimPoint's ~0.75 in per %·ft agrees) against a
  // 5.9 in cup radius — aiming straight into that CANNOT hole, and the real make
  // rate comes from the player reading it. So gate the two things that would be
  // BUGS instead of the raw rate: a flat-ish tap-in must hole (that is capture
  // working), and no short putt may finish wildly away from the cup (that is the
  // lip-out/rocket failure mode). Raw rates are reported for feel-tuning.
  if (tap[3] && tap[3].flat >= 4 && tap[3].flatIn / tap[3].flat < 0.95)
    fails.push("3 ft tap-ins on <1.5% grade made " + Math.round(tap[3].flatIn / tap[3].flat * 100) + "%, want >= 95%");
  if (tap[5] && tap[5].flat >= 4 && tap[5].flatIn / tap[5].flat < 0.85)
    fails.push("5 ft putts on <1.5% grade made " + Math.round(tap[5].flatIn / tap[5].flat * 100) + "%, want >= 85%");
  for (var tk in tap) if (tap[tk].wild)
    fails.push(tap[tk].wild + " of " + tap[tk].n + " " + tk + " ft putts finished more than " +
               f2(1.5 * Number(tk)) + " ft from the cup");
  for (var c = 0; c < res.census.length; c++) {
    var q = res.census[c];
    if (q.cap != null && q.max != null && q.max > q.cap + 1e-6)
      fails.push("hole " + q.hole + ": grade " + f2(q.max * 100) + "% exceeds the physical cap " + f2(q.cap * 100) + "%");
  }
  var allP50 = [];
  for (var c2 = 0; c2 < res.census.length; c2++) if (res.census[c2].p50 != null) allP50.push(res.census[c2].p50);
  if (allP50.length) {
    var cp = pctl(allP50, 0.5);
    if (cp < 0.008 || cp > 0.040) fails.push("course median green grade " + f2(cp * 100) + "%, want 0.8-4.0%");
  }
  // dt-invariance. BREAK is held tight (0.15 ft): break that changes with the
  // integration step means the slope math is dt-dependent, which is the bug class
  // 6dc9fc7 fixed. DISTANCE gets a looser 0.5 ft because ~0.3 ft of it is honest
  // first-order Euler error in the roll phase, not a slope bug: the ball advances
  // position then decelerates, so its stopping point carries an O(v·dt) error —
  // 2.4 m/s × 62 ms / 2 = 0.25 ft, which is what the 0.37 ft measured at
  // timeScale 3.75 vs 0.25 is made of. The player never sees it (the pace
  // inversion runs at the live timeScale, so distances are self-consistent);
  // closing it would mean a midpoint/RK step for the roll and a re-calibration.
  if (res._dtWorst) {
    if (res._dtWorst.lat > 0.15) fails.push("dt-invariance: break moves " + f2(res._dtWorst.lat) + " ft at timeScale 0.25");
    if (res._dtWorst.disp > 0.50) fails.push("dt-invariance: distance moves " + f2(res._dtWorst.disp) + " ft at timeScale 0.25");
  }
  if (res.errors.length) fails.push(res.errors.length + " harness error(s): " + res.errors[0]);
  if (!res.aero) fails.push("aeroPhysics branch not live (window.Ballistics unbound)");
  return { fails: fails, warns: warns };
}

function run(argv) {
  var cfg = { id: argv[0], base: argv[1], holes: null, dists: [3, 5, 6, 10, 20, 30, 45],
              json: false, gate: false, timescale: null, stimp: null, dtcheck: false,
              offgreen: false, offDists: [5, 8, 12, 20, 30] };
  if (!cfg.id || !cfg.base) throw new Error("usage: putt_matrix.js <courseId> <repoRoot> [--json|--gate|--holes 1,4|--dists 6,20|--offgreen|--offdists 8,20|--timescale N|--stimp N|--dtcheck]");
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--json") cfg.json = true;
    else if (a === "--gate") cfg.gate = true;
    else if (a === "--dtcheck") cfg.dtcheck = true;
    else if (a === "--offgreen") cfg.offgreen = true;
    else if (a === "--offdists") { cfg.offgreen = true; cfg.offDists = argv[++i].split(",").map(Number); }
    else if (a === "--holes") cfg.holes = argv[++i].split(",").map(Number);
    else if (a === "--dists") cfg.dists = argv[++i].split(",").map(Number);
    else if (a === "--timescale") cfg.timescale = Number(argv[++i]);
    else if (a === "--stimp") cfg.stimp = Number(argv[++i]);
  }
  var courseJson = readFile(cfg.base + "/courses/" + cfg.id + ".json");
  var post = POSTLUDE.replace("__CFG__", JSON.stringify(cfg));
  var big = readFile(cfg.base + "/tools/headless_stubs.js")
          + readFile(cfg.base + "/ballistics.js") + BAL_PRELUDE
          + "\nvar __COURSE__ = " + courseJson + ";\n"
          + readFile(cfg.base + "/game.js")
          // FT_PER_UNIT arrives with the real-units green field; before that, derive
          // it from the course scale so this gate runs on either side of the change.
          + "\nvar FT_PER_UNIT_OR_9 = (typeof FT_PER_UNIT !== 'undefined') ? FT_PER_UNIT : YARDS_PER_UNIT * 3;\n"
          + post;
  var res = JSON.parse(eval(big));
  if (cfg.json) return JSON.stringify(res);
  var txt = report(res, cfg);
  if (cfg.gate) {
    var g = gate(res, cfg);
    for (var w = 0; w < g.warns.length; w++) txt += "\nWARN: " + g.warns[w];
    if (g.fails.length) throw new Error(txt + "\n\nPUTT GATE FAIL (" + g.fails.length + "):\n  " + g.fails.join("\n  "));
    txt += "\n\ngate: all checks pass";
  }
  return txt;
}
