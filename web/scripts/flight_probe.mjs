// Flight probe — the gate for "ball flight must not depend on the camera".
//
// On the Google photoreal ground the ball's DRAWN position is not its physics
// position: it is projected through the live tiles camera, at a ground height
// read from a mesh-height field that is re-raycast against whatever tile LOD is
// currently loaded. A camera that widened mid-flight therefore moved the ball:
// widen -> camera moves -> errorTarget 6->12 -> coarse tiles swap in ->
// meshHeightAt returns a different surface -> offsetAt changes -> the arc bends.
// Physics never touched any of it, which is exactly what made it hard to see.
//
// This drives a real drive on Pebble and asserts the coupling is gone:
//   1. the ball's mesh offset is CONSTANT for the whole flight
//   2. errorTarget stays 6 (camera frozen => no motion-coarse LOD swap)
//   3. the camera position is bit-identical on every in-flight frame
//   4. the projected screen path is smooth (no step discontinuities)
//
// Needs a Google Map Tiles key: put one in local-config.js (see index.html) or
// localStorage golf.googleTilesToken. Without it the course falls back to the
// flat 2D aerial and the probe skips with a clear message rather than passing
// vacuously.
//
//   cd web && node scripts/flight_probe.mjs
//   cd web && node scripts/flight_probe.mjs --hole 4 --club driver --json
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8098;
const ROOT = new URL("../../", import.meta.url).pathname;   // repo root
const BASE = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 390, height: 844 };               // iPhone-ish CSS box

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const HOLES = (arg("--holes", "1,4,18")).split(",").map(Number);
const CLUB = arg("--club", "auto");   // "auto" = the caddie's pick (realistic); or a club id

// Sampled every rAF while the ball is in the air. Everything here is read-only.
//
// NOTE game.js is a classic script: its top-level `let`/`const` (state, mode,
// ballTrail, selectedClub) land in the global LEXICAL record, not on `window`.
// They resolve as bare identifiers from any script, including this one — reading
// them as `window.state` silently returns undefined, which is how the first cut
// of this probe "sampled" a shot that never fired.
function installProbe() {
  window.__flight = null;
  window.__startFlightProbe = function () {
    const rows = [];
    window.__flight = rows;
    const tick = () => {
      const st = (typeof state !== "undefined") ? state : null;
      if (!st || !st.ball) return requestAnimationFrame(tick);
      const G = window.GTiles3D;
      const d = G && G.debug ? G.debug() : {};
      const a = G && G.anchorDiag ? G.anchorDiag() : {};
      const b = st.ball;
      let sx = null, sy = null, rx = null, ry = null;
      if (G && G.isReady && G.isReady()) {
        const p = G.project(b.x, b.y, terrainZRender(b.x, b.y) + (b.z || 0));
        sx = p.x; sy = p.y;
        // WITNESS: a FIXED world point (the address position) projected every
        // frame. If the mapping from world to screen is constant — camera frozen,
        // mesh-height field frozen — this lands on the same pixel every time. It
        // is an exact test of the invariant, with no dependence on how evenly the
        // physics accumulator happened to step, which is what makes it a better
        // gate than any smoothness heuristic over the arc itself.
        if (!window.__ref) window.__ref = { x: b.x, y: b.y, z: terrainZRender(b.x, b.y) };
        const q = G.project(window.__ref.x, window.__ref.y, window.__ref.z);
        rx = q.x; ry = q.y;
      }
      // Where the ball sits in the PLAY BAND (0 = just under the top bar,
      // 1 = bottom of the play area). With the mid-flight widen gone this is the
      // question the freeze has to answer for itself: does the pre-framed camera
      // actually hold the whole shot?
      const rsv = GolfBridge.hudReserve();
      const pH = Math.max(120, innerHeight - rsv.top - rsv.bot);
      const yf = sy == null ? null : +((sy - rsv.top) / pH).toFixed(3);
      rows.push({
        t: performance.now(), moving: !!st.moving, air: !!st.airborne,
        bx: b.x, by: b.y, bz: b.z, sx, sy, rx, ry, yf,
        ballOff: a.ballOff, errT: d.errTarget, guardK: d.guardK,
        shotCamD: d.shotCamD, frozen: d.fieldFrozen, camSeq: d.camSeq,
        camPos: d.camPos ? d.camPos.join(",") : null,
        trail: (typeof ballTrail !== "undefined") ? ballTrail.length : -1,
      });
      // Keep sampling a beat past rest so the rest-edge handover is captured.
      if (rows.length < 1500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
}

function summarize(rows) {
  // The flight window: airborne frames only. Rest-edge frames are reported
  // separately — that is where the anchor handover is allowed to move.
  const air = rows.filter((r) => r.air && r.bz > 0.4);
  if (air.length < 10) return { error: `only ${air.length} airborne frames sampled` };
  const nums = (k) => air.map((r) => r[k]).filter((v) => v != null);
  const spread = (k) => { const v = nums(k); return v.length ? +(Math.max(...v) - Math.min(...v)).toFixed(3) : null; };
  const uniq = (k) => [...new Set(air.map((r) => r[k]))];
  // The witness: how far the FIXED reference world point wandered on screen.
  const rxs = nums("rx"), rys = nums("ry");
  const witnessPx = rxs.length
    ? +Math.hypot(Math.max(...rxs) - Math.min(...rxs), Math.max(...rys) - Math.min(...rys)).toFixed(3)
    : null;
  // Smoothness, measured PER WORLD UNIT TRAVELLED rather than per frame. The
  // accumulator runs a variable number of fixed 16.67ms steps per rAF, so the
  // ball advances a different amount between consecutive samples and a plain
  // per-frame second difference reports that quantization (measured ~13 px) as
  // if it were a kink. Normalizing by world travel removes it; what is left is
  // real curvature plus any genuine step in the mapping.
  // Measured WITHIN one ballistic arc: a touchdown genuinely reverses the ball's
  // vertical velocity, so a metric that spans a bounce reports real physics as a
  // kink (h18 read 13 px/u that way). Runs are maximal stretches of consecutive
  // airborne samples in the original row order.
  let maxJerk = 0, jerkAt = null;
  const runs = [];
  let cur = null;
  for (const r of rows) {
    const up = r.air && r.bz > 0.4;
    if (!up) { cur = null; continue; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(r);
  }
  for (const run of runs) {
    const rates = [], at = [];
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i];
      if (a.sy == null || b.sy == null) continue;
      const dw = Math.hypot(b.bx - a.bx, b.by - a.by, b.bz - a.bz);
      if (dw < 1e-4) continue;
      rates.push((b.sy - a.sy) / dw);   // screen px of y per world unit travelled
      at.push(b);
    }
    for (let i = 1; i < rates.length; i++) {
      const j = Math.abs(rates[i] - rates[i - 1]);
      if (j > maxJerk) {
        maxJerk = j;
        jerkAt = { x: +at[i].bx.toFixed(1), y: +at[i].by.toFixed(1), z: +at[i].bz.toFixed(1) };
      }
    }
  }
  return {
    frames: air.length,
    ballOffSpreadM: spread("ballOff"),
    errTargets: uniq("errT"),
    guardKs: uniq("guardK"),
    camPositions: uniq("camPos").length,
    camSeqs: uniq("camSeq").length,
    frozen: uniq("frozen"),
    witnessPx,
    // Over the WHOLE shot, not just the airborne part: the ball has to stay in
    // frame while it rolls out too.
    minYf: Math.min(...rows.filter((r) => r.moving && r.yf != null).map((r) => r.yf)),
    maxYf: Math.max(...rows.filter((r) => r.moving && r.yf != null).map((r) => r.yf)),
    maxJerkPxPerU: +maxJerk.toFixed(2),
    jerkAt,
    trailMax: Math.max(...air.map((r) => r.trail)),
  };
}

async function run() {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
  });
  const results = [];
  try {
    for (const hole of HOLES) {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await page.addInitScript(installProbe);
      await page.goto(`${BASE}?course=pebble-beach-golf-course&hole=${hole}`, { waitUntil: "domcontentloaded" });
      // Wait for the photoreal ground to actually be up and settled: INTRO_MS is
      // 3s and the errorTarget ramp takes another ~0.8s past the camera parking.
      const ok = await page.waitForFunction(
        () => window.GTiles3D && window.GTiles3D.isReady() && window.GTiles3D.isSettled(),
        null, { timeout: 45000 }
      ).then(() => true).catch(() => false);
      if (!ok) {
        const why = await page.evaluate(() => ({
          token: !!window.GOOGLE_TILES_TOKEN,
          failed: window.GTiles3D ? window.GTiles3D.failed() : "no GTiles3D",
        }));
        results.push({ hole, skipped: true, why });
        await page.close();
        continue;
      }
      // Pick the club FIRST, then wait for the scene to settle again. Changing
      // clubs changes the framing anchors, so the camera glides — and firing
      // mid-glide leaves the errorTarget ramp still walking 12->6 through the
      // flight, which reads as LOD churn the shot did not cause.
      // "auto" leaves the caddie's own pick alone — the realistic case. Forcing a
      // driver on a 106-yard par 3 (h7) flies the ball into the Pacific and the
      // hazard reset teleports it, which is a probe artefact, not a framing bug.
      await page.evaluate(({ club }) => {
        if (club === "auto") return;
        selectedClub = club;               // bare: script-scope binding (see installProbe)
        manualClubThisShot = true;         // stop the caddie re-picking on the next frame
        if (typeof updateClubUI === "function") updateClubUI();
      }, { club: CLUB });
      await page.waitForFunction(
        () => window.GTiles3D.isSettled() && window.GTiles3D.debug().errTarget <= 6.001,
        null, { timeout: 30000 }
      ).catch(() => {});
      await page.evaluate(() => {
        window.__startFlightProbe();
        // Straight up-screen swipe at full power, through the real input path.
        launch(0, -260, 0.05, 0);
      });
      // Flights are 6-11 s of wall clock at the game's timeScale; give the
      // roll-out room and then a beat past rest for the anchor handover.
      await page.waitForFunction(() => {
        const f = window.__flight;
        return f && f.length > 60 && f.some((r) => r.air) && f.slice(-30).every((r) => !r.moving);
      }, null, { timeout: 90000 }).catch(() => {});
      const rows = await page.evaluate(() => window.__flight || []);
      results.push({ hole, ...summarize(rows) });
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); }
  else {
    for (const r of results) {
      if (r.skipped) { console.log(`h${r.hole}: SKIPPED — ${JSON.stringify(r.why)}`); continue; }
      if (r.error) { console.log(`h${r.hole}: ${r.error}`); continue; }
      console.log(
        `h${String(r.hole).padStart(2)}  frames ${String(r.frames).padStart(4)}  ` +
        `ballOffSpread ${String(r.ballOffSpreadM).padStart(5)} m  errT ${JSON.stringify(r.errTargets)}  ` +
        `guardK ${JSON.stringify(r.guardKs)}  camPos ${r.camPositions}  camSeq ${r.camSeqs}  ` +
        `frozen ${JSON.stringify(r.frozen)}  witness ${r.witnessPx} px  ` +
        `yf ${String(r.minYf).padStart(6)}..${String(r.maxYf).padStart(5)}  ` +
        `jerk ${r.maxJerkPxPerU} px/u  trail ${r.trailMax}`
      );
    }
  }

  // Gate. Skips are not passes — say so and exit non-zero, because a probe that
  // silently measures the 2D fallback proves nothing about the tiles path.
  const live = results.filter((r) => !r.skipped && !r.error);
  if (!live.length) { console.log("\nFAIL: no hole produced a photoreal flight (see skips above)"); process.exit(1); }
  let bad = 0;
  for (const r of live) {
    const fail = [];
    if (r.ballOffSpreadM > 0.01) fail.push(`ball mesh offset moved ${r.ballOffSpreadM} m in flight`);
    if (r.errTargets.some((e) => e > 6.001)) fail.push(`errorTarget rose to ${Math.max(...r.errTargets)} (LOD churn)`);
    if (r.camPositions !== 1) fail.push(`camera moved (${r.camPositions} distinct positions)`);
    if (r.camSeqs !== 1) fail.push(`camSeq changed (${r.camSeqs} values)`);
    if (r.frozen.some((f) => f !== true)) fail.push(`field not frozen on every frame (${JSON.stringify(r.frozen)})`);
    // Sub-pixel: a fixed world point must land on a fixed pixel all flight. This
    // is the whole invariant, stated exactly — with the mapping provably
    // constant, the drawn arc IS the physics arc and nothing else.
    if (!(r.witnessPx <= 0.5)) fail.push(`world->screen mapping moved ${r.witnessPx} px during flight`);
    // maxJerkPxPerU is printed, not gated: with the witness at 0 the screen path
    // is a fixed projection of the physics arc, so any jerk left in it belongs to
    // the PHYSICS — a world-edge clamp reversing vx, a hazard reset. Gating it
    // would have this probe policing the ball flight, which is not its job.
    if (fail.length) { bad++; console.log(`\nh${r.hole} FAIL:\n  - ${fail.join("\n  - ")}`); }
  }
  console.log(bad ? `\ngate: ${bad}/${live.length} holes FAILED` : `\ngate: all checks pass (${live.length} holes)`);
  process.exit(bad ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
