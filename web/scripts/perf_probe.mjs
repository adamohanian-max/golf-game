// Battery/CPU probe — the gate for the render-pace work.
//
// The game used to paint every frame forever: physics early-outs when the ball
// is at rest but draw() had no gate at all, so a player standing over the ball
// burned a full frame budget, and so did the opaque home menu. This measures
// that directly. The headline number is `cpuMsPerSec` — milliseconds of
// draw() + GTiles3D.render() per wall-clock second. It is a proxy for battery,
// but an exact and repeatable one; run it before and after a change.
//
// Lives under web/ because that is where playwright is a devDependency (see
// web/package.json); it serves the GAME from the repo root, not the viewer.
// Mirrors web/scripts/shoot.mjs for the spawn/wait pattern.
//
//   cd web && node scripts/perf_probe.mjs
//   cd web && node scripts/perf_probe.mjs --json          # machine-readable
//   cd web && node scripts/perf_probe.mjs --only pebble-rest
//
// NOTE headless Chrome runs at devicePixelRatio 1; a phone is 3, i.e. 9x the
// pixels. Measured separately, that drops painted fps 60 -> 40 on the same
// frame, so these numbers UNDERSTATE the device. Treat them as a relative gate,
// not an absolute battery figure.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8099;
const ROOT = new URL("../../", import.meta.url).pathname;   // repo root
const BASE = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 390, height: 844 };               // iPhone-ish CSS box

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

// settle = how long to let the scene stop moving before measuring. Pebble needs
// the most: the opening pull-back is 3s (INTRO_MS) and the tile errorTarget ramp
// walks 12->6 over another ~0.8s after the camera parks.
const SCENARIOS = [
  { id: "menu",         url: "",                                  settle: 6000,  measure: 8000 },
  { id: "flat-rest",    url: "?course=pinehurst-no2",             settle: 8000,  measure: 10000 },
  { id: "pebble-rest",  url: "?course=pebble-beach-golf-course",  settle: 14000, measure: 10000 },
  { id: "pebble-active", url: "?course=pebble-beach-golf-course", settle: 14000, measure: 8000, active: true },
];

// Wrap draw() and GTiles3D.render() in place and count rAF frames independently,
// so `paintedFps` (frames actually drawn) can differ from `rafFps` (frames the
// browser offered) — that gap IS the saving.
function installProbe() {
  const P = { raf: 0, paints: 0, draw: 0, gt: 0, drawMax: 0, gtMax: 0 };
  window.__probe = P;
  const od = window.draw;
  if (typeof od === "function") {
    window.draw = function (...a) {
      P.paints++;
      const t = performance.now();
      const r = od.apply(this, a);
      const dt = performance.now() - t;
      P.draw += dt; if (dt > P.drawMax) P.drawMax = dt;
      return r;
    };
  }
  const G = window.GTiles3D;
  if (G && typeof G.render === "function") {
    const og = G.render;
    G.render = function (...a) {
      const t = performance.now();
      const r = og.apply(this, a);
      const dt = performance.now() - t;
      P.gt += dt; if (dt > P.gtMax) P.gtMax = dt;
      return r;
    };
  }
  const tick = () => { P.raf++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

// Drag the 2D<->3D slider back and forth. Forces the camera to keep moving, so
// this scenario measures the ACTIVE path — it must NOT get cheaper, that would
// mean the pace governor is throttling frames the player can see.
function driveActive(ms) {
  return new Promise((resolve) => {
    const r = document.getElementById("tilt-range");
    if (!r) return resolve(false);
    const t0 = performance.now();
    let v = 0, dir = 1;
    const step = () => {
      v += dir * 4;
      if (v >= 100) { v = 100; dir = -1; }
      if (v <= 0) { v = 0; dir = 1; }
      r.value = String(v);
      r.dispatchEvent(new Event("input", { bubbles: true }));
      if (performance.now() - t0 < ms) requestAnimationFrame(step);
      else resolve(true);
    };
    requestAnimationFrame(step);
  });
}

function readProbe(ms) {
  return new Promise((resolve) => {
    const P = window.__probe;
    const a = { raf: P.raf, paints: P.paints, draw: P.draw, gt: P.gt };
    const t0 = performance.now();
    setTimeout(() => {
      const el = performance.now() - t0;
      const paints = P.paints - a.paints;
      const cpu = (P.draw - a.draw) + (P.gt - a.gt);
      resolve({
        seconds: +(el / 1000).toFixed(1),
        rafFps: +((P.raf - a.raf) / el * 1000).toFixed(1),
        paintedFps: +(paints / el * 1000).toFixed(1),
        cpuMsPerSec: +(cpu / el * 1000).toFixed(0),
        msPerPaint_draw: paints ? +((P.draw - a.draw) / paints).toFixed(2) : 0,
        msPerPaint_gtiles: paints ? +((P.gt - a.gt) / paints).toFixed(2) : 0,
        peakDrawMs: +P.drawMax.toFixed(1),
        peakGtilesMs: +P.gtMax.toFixed(1),
      });
    }, ms);
  });
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("http.server timeout")), 15000);
    const onData = (b) => { if (/Serving HTTP/.test(b.toString())) { clearTimeout(to); resolve(); } };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    // python may buffer its banner; poll as a backstop
    setTimeout(() => { clearTimeout(to); resolve(); }, 1500);
  });
}

// Headless Chrome defaults to SwiftShader (software raster), which inflates every
// canvas op several-fold and caps the frame rate well under 60 — it changes the
// ABSOLUTE numbers a lot. Ask for the real GPU so a run resembles a device, and
// give each scenario its own browser so a heavy one (Pebble's tiles) cannot leave
// the next one contending for the same compositor.
const LAUNCH = {
  args: ["--enable-gpu", "--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"],
};

async function main() {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "pipe" });
  await waitForPort(server);

  const out = [];
  for (const s of SCENARIOS) {
    if (ONLY && s.id !== ONLY) continue;
    const browser = await chromium.launch(LAUNCH);
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE + s.url, { waitUntil: "load" });
      await page.waitForTimeout(s.settle);
      await page.evaluate(installProbe);
      // The probe wraps GTiles3D.render, which only exists once the module has
      // entered — settle first, then wrap, or the wrap misses it entirely.
      const ctx = await page.evaluate(() => ({
        mode: typeof mode !== "undefined" ? mode : "?",
        course: (typeof course !== "undefined" && course) ? course.id : null,
        gtiles: typeof gtilesGround !== "undefined" ? gtilesGround : false,
        moving: (typeof state !== "undefined" && state) ? !!state.moving : null,
        dpr: window.devicePixelRatio,
      }));
      // Drive and measure CONCURRENTLY. Awaiting the driver first measured the
      // quiet period after it stopped, which reported the active scenario as
      // idle — exactly backwards, and it looked like a real regression.
      const driving = s.active ? page.evaluate(driveActive, s.measure + 800) : null;
      const r = await page.evaluate(readProbe, s.measure);
      if (driving) await driving;
      out.push({ scenario: s.id, ...ctx, ...r, pageErrors: errors.slice(0, 3) });
      await page.close();
    } finally {
      await browser.close();
    }
  }
  server.kill("SIGTERM");

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }
  const pad = (v, n) => String(v).padStart(n);
  console.log("\nscenario        gtiles  rafFps  paintFps  cpuMs/s   draw/paint  gtiles/paint");
  console.log("-".repeat(78));
  for (const r of out) {
    console.log(
      r.scenario.padEnd(15) +
      pad(r.gtiles ? "yes" : "no", 6) +
      pad(r.rafFps, 8) + pad(r.paintedFps, 10) + pad(r.cpuMsPerSec, 9) +
      pad(r.msPerPaint_draw, 13) + pad(r.msPerPaint_gtiles, 14)
    );
  }
  console.log("\ncpuMs/s = ms of draw()+GTiles3D.render() per wall second. Lower is better.");
  console.log("pebble-active must NOT drop — it is the visible, moving case.\n");
  const errs = out.flatMap((r) => r.pageErrors);
  if (errs.length) { console.error("page errors:", errs); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
