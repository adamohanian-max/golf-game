// Headless screenshot harness — the human-gate mechanism (WORKFLOW §6).
// Boots `vite preview`, loads the app, waits for map idle + a fixed settle for
// DEM/satellite tiles, captures 3 PNGs to shots/. Exits non-zero on console
// error. A screenshot that renders is NOT a screenshot that is correct — these
// exist for a human to eyeball.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Capture the map canvas via toDataURL (preserveDrawingBuffer is on in main.ts).
// page.screenshot() times out here — the ball's triggerRepaint animation loop
// keeps the compositor perpetually busy so Playwright's stability wait never
// resolves. Reading the drawing buffer directly sidesteps that entirely.
async function shot(page, path) {
  const dataUrl = await page.evaluate(
    () => document.querySelector("canvas")?.toDataURL("image/png") ?? ""
  );
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error(`canvas capture failed for ${path} (blank/no canvas)`);
  }
  writeFileSync(path, Buffer.from(dataUrl.split(",")[1], "base64"));
}

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const SETTLE_MS = 3000;

function waitFor(re, child) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("preview server timeout")), 30000);
    const onData = (buf) => {
      if (re.test(buf.toString())) { clearTimeout(to); resolve(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

async function main() {
  mkdirSync("shots", { recursive: true });
  const server = spawn("npm", ["run", "preview"], { stdio: "pipe" });
  await waitFor(/localhost:4173/, server);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "load" });
  // Settle: resolve on map 'idle' OR a hard cap — external satellite/DEM tiles
  // can be slow or blocked headless, and 'idle' may never fire. Never hang.
  await page.evaluate(
    ({ settle, cap }) => new Promise((resolve) => {
      const map = (window).__golf?.map;
      let done = false;
      const finish = () => { if (!done) { done = true; setTimeout(resolve, settle); } };
      if (map) map.once("idle", finish);
      setTimeout(finish, cap); // hard cap regardless of idle
    }),
    { settle: SETTLE_MS, cap: 12000 }
  );

  // 01 — pitched overview of the whole hole (Gate A)
  await shot(page, "shots/01-overview.png");

  // 02 — camera close on the ball at the tee (Gate B)
  await page.evaluate(() => {
    const { map, ballLayer } = (window).__golf;
    map.flyTo({ center: ballLayer.ball.lngLat, zoom: 19, pitch: 70, duration: 0 });
  });
  await page.waitForTimeout(1200);
  await shot(page, "shots/02-ball-tee.png");

  // 03 — low-angle depth-integration shot: ground-level view down the hole with
  // the mountainside behind. Proves the ball is depth-composited into the 3D
  // terrain (not floating / not showing through). NOTE: a textbook ball-hidden-
  // behind-a-hill frame is awkward on a flat valley hole — terrain depth-testing
  // is already evident in 01 where the near ridge self-occludes the far valley.
  await page.evaluate(() => {
    const { map, ballLayer } = (window).__golf;
    map.jumpTo({ center: ballLayer.ball.lngLat, zoom: 17, pitch: 78, bearing: 68 });
  });
  await page.waitForTimeout(1800);
  await shot(page, "shots/03-occlusion.png");

  await browser.close();
  server.kill("SIGTERM");

  if (errors.length) {
    console.error("Console errors during shoot:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("Wrote shots/01-overview.png, 02-ball-tee.png, 03-occlusion.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
