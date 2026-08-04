// Framing probe — what the apex anchor costs, and what it buys.
//
// The tiles camera used to frame the ground REACH span only. The ball climbs
// above that line, so on a leaned camera the apex projected off the top and the
// frame had to widen mid-flight to chase it — the widening that coarsened tile
// LOD and moved the ball's drawn ground height. Framing the apex at address
// removes the need, at the cost of camera ALTITUDE, which is what governs how
// much mesh Google has to stream before the tee looks real.
//
// This measures both sides for every hole x club x pitch: the solved distance D,
// and where the ball / reach / apex land in the play band (0 = just under the
// top bar, 1 = the bottom of the play area). Run it in a worktree at the old
// revision for the baseline and diff.
//
//   cd web && node scripts/framing_probe.mjs
//   cd web && node scripts/framing_probe.mjs --json > after.json
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8095;
const ROOT = new URL("../../", import.meta.url).pathname;
const BASE = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 390, height: 844 };

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const HOLES = arg("--holes", "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18").split(",").map(Number);
const CLUBS = arg("--clubs", "driver,7i,pw,putter").split(",");
const PITCHES = arg("--pitches", "0,55").split(",").map(Number);

// Read the framing for one club/pitch, once the camera has settled on it.
// frameAnchors() is the game's own bridge; project() is the tiles camera's own.
// Nothing here recomputes the solve — it reports what the live camera did.
function readFraming([club, pitch]) {   // playwright passes ONE arg — destructure it
  return new Promise((resolve) => {
    selectedClub = club;
    manualClubThisShot = true;
    if (typeof updateClubUI === "function") updateClubUI();
    window.GTiles3D.setPitch(pitch);
    // Wait for the camera to actually RE-SOLVE, not merely to report settled:
    // isSettled() is still true for the first frames after a club/pitch change,
    // so polling it alone reads the PREVIOUS framing (every club reported the
    // same D). Watch the placed camera position go quiet instead — the ease
    // snaps, so it goes exactly static — and only then read.
    const t0 = performance.now();
    let lastPos = null, quietSince = 0;
    const wait = () => {
      const d = window.GTiles3D.debug();
      const pos = d.camPos ? d.camPos.join(",") : null;
      if (pos !== lastPos) { lastPos = pos; quietSince = performance.now(); }
      const quiet = performance.now() - quietSince > 800 && d.errTarget <= 6.001 &&
                    performance.now() - t0 > 1200;
      if (!quiet && performance.now() - t0 < 25000) return setTimeout(wait, 100);
      const G = window.GTiles3D, A = GolfBridge.frameAnchors();
      const rsv = GolfBridge.hudReserve();
      const pTop = rsv.top, pH = Math.max(120, innerHeight - rsv.top - rsv.bot);
      const yf = (p) => p && p.inFront ? +((p.y - pTop) / pH).toFixed(3) : null;
      const tz = (x, y) => GolfBridge.terrainZRender(x, y);
      // Apex recomputed HERE, not read off frameAnchors, so the same physical
      // point is measured on a revision that predates the anchor. Mirrors
      // frameAnchors' own formula (club maxH scaled by how much of the club's
      // reach this shot uses, at frameApexFrac along the aim).
      const c = TUNE.clubs[club];
      const rd = Math.hypot(A.rx - A.bx, A.ry - A.by);
      const onGreen = GolfBridge.surfaceAt(A.bx, A.by) === "green";
      const reachYds = rd * YARDS_PER_UNIT, fullYds = c ? c.carry * TUNE.reachTotalK : 0;
      const azYds = (onGreen || !c) ? 0 : c.maxH * (fullYds > 0 ? Math.min(1, reachYds / fullYds) : 1);
      const az = azYds / YARDS_PER_UNIT;
      const f = 0.55;
      const ax = A.bx + (A.rx - A.bx) * f, ay = A.by + (A.ry - A.by) * f;
      resolve({
        club, pitch,
        D: window.GTiles3D.debug().easeD, fitN: window.GTiles3D.debug().apexFitN,
        ball:  yf(G.project(A.bx, A.by, tz(A.bx, A.by))),
        reach: yf(G.project(A.rx, A.ry, tz(A.rx, A.ry))),
        apex:  az > 0.01 ? yf(G.project(ax, ay, tz(ax, ay) + az)) : null,
        azYds: +azYds.toFixed(1),
      });
    };
    wait();
  });
}

async function run() {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
  });
  const rows = [];
  try {
    for (const hole of HOLES) {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await page.goto(`${BASE}?course=pebble-beach-golf-course&hole=${hole}`, { waitUntil: "domcontentloaded" });
      const ok = await page.waitForFunction(
        () => window.GTiles3D && window.GTiles3D.isReady() && window.GTiles3D.isSettled(),
        null, { timeout: 45000 }
      ).then(() => true).catch(() => false);
      if (!ok) { rows.push({ hole, skipped: true }); await page.close(); continue; }
      for (const pitch of PITCHES) {
        for (const club of CLUBS) {
          const r = await page.evaluate(readFraming, [club, pitch])
            .catch((e) => { console.error(`h${hole} ${club} p${pitch}: ${e.message.split("\n")[0]}`); return null; });
          if (r) rows.push({ hole, ...r });
        }
      }
      await page.close();
    }
  } finally { await browser.close(); server.kill(); }

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log("hole club    pitch      D    ball  reach   apex  apexYds");
  for (const r of rows) {
    if (r.skipped) { console.log(`h${r.hole} SKIPPED (no photoreal ground)`); continue; }
    console.log(
      `${String(r.hole).padStart(4)} ${r.club.padEnd(7)} ${String(r.pitch).padStart(4)}  ` +
      `${String(r.D).padStart(6)}  ${String(r.ball).padStart(5)}  ${String(r.reach).padStart(5)}  ` +
      `${String(r.apex).padStart(5)}  ${String(r.azYds).padStart(6)}  fit${r.fitN}`
    );
  }
  const live = rows.filter((r) => !r.skipped);
  const apexOut = live.filter((r) => r.apex != null && r.apex < 0);
  const ballOut = live.filter((r) => r.ball != null && (r.ball < 0 || r.ball > 1));
  console.log(`\n${live.length} framings; apex above the play band on ${apexOut.length}; ball outside it on ${ballOut.length}`);
  for (const r of apexOut) console.log(`  apex out: h${r.hole} ${r.club} pitch ${r.pitch} -> yf ${r.apex}`);
  for (const r of ballOut) console.log(`  ball out: h${r.hole} ${r.club} pitch ${r.pitch} -> yf ${r.ball}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
