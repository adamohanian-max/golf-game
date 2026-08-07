#!/usr/bin/env node
// Does Google actually have PHOTOGRAMMETRY at this course, or just a photo on
// flat ground?
//
//   node tools/gtiles_geom_probe.mjs [--course <id>] [--course <id> ...] [--hole 1]
//
// Run this BEFORE adding an id to GTILES_IDS in game.js. Google serves tiles
// nearly everywhere, so "tiles load" proves nothing — outside the areas it has
// actually flown you get aerial imagery draped on near-flat terrain, which looks
// like the baked NAIP aerial the course already ships for free, while costing a
// billed tile session per visit.
//
// WHAT NOT TO MEASURE: `geometricError` from the tileset. That is tile
// subdivision / texture resolution, and a flat textured quad scores *better*
// than real photogrammetry — Butter Brook reads 2.01 m against Pebble's 4.01 m
// and has no 3D at all. That metric is what put Butter Brook into GTILES_IDS on
// 2026-08-05; it came back out on 2026-08-06.
//
// WHAT TO MEASURE: verts per rendered mesh, off the live engine. Measured:
//     pebble-beach-golf-course     1519   real 3D
//     liberty-national-golf-club   1007   real 3D
//     torrey-pines-south-course     912   real 3D
//     butter-brook-golf-club         85   FLAT
// The two regimes are ~an order of magnitude apart, so the 600 threshold below
// is not delicate. A secondary tell needing no engine: the finest .glb is ~200 KB
// with geometry and ~15 KB without.
//
// Needs a Map Tiles key ($GOOGLE_TILES_TOKEN or the gitignored local-config.js)
// and the dev server on :8080 (python3 -m http.server 8080).
import { chromium } from "../web/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
const courses = argv.reduce((a, v, i) => (argv[i - 1] === "--course" ? [...a, v] : a), []);
const IDS = courses.length ? courses : [
  "pebble-beach-golf-course", "liberty-national-golf-club",
  "torrey-pines-south-course", "butter-brook-golf-club",
];
const HOLE = arg("--hole", "1");
const REAL_3D_VPM = 600;   // verts/mesh; regimes sit ~85 vs ~900-1500, so not delicate
const SETTLE_MS = 24000;   // tiles must actually stream in before counting

const TOKEN = process.env.GOOGLE_TILES_TOKEN || (() => {
  try {
    return /window\.GOOGLE_TILES_TOKEN\s*=\s*"([^"]+)"/
      .exec(readFileSync(new URL("../local-config.js", import.meta.url), "utf8"))[1];
  } catch (e) {
    console.error("No Map Tiles key: set $GOOGLE_TILES_TOKEN or run  python3 tools/local_config.py");
    process.exit(2);
  }
})();

const b = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
console.log("course".padEnd(30) + "meshes".padStart(7) + "verts".padStart(9) +
            "tris".padStart(9) + "v/mesh".padStart(8) + "  verdict");
let anyFlat = false;
for (const id of IDS) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(({ t, i }) => {
    try {
      localStorage.setItem("golf.googleTilesToken", t);
      localStorage.setItem("golf.entitlements", JSON.stringify({ v: 1, courses: { [i]: { via: "dev" } } }));
    } catch (e) {}
  }, { t: TOKEN, i: id });
  const p = await c.newPage();
  await p.goto(`http://localhost:8080/index.html?course=${id}&hole=${HOLE}`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2500);
  // The whole point is to judge a course BEFORE committing it to GTILES_IDS, so
  // force the engine on for whatever we were asked to measure. GTILES_IDS is a
  // top-level `const` in a classic script — not on `window`, but it is a global
  // lexical binding, so it resolves inside evaluate(). updateGtilesMode() then
  // flips the latch and calls enter().
  const forced = await p.evaluate((i) => {
    try {
      if (typeof GTILES_IDS === "undefined") return "no GTILES_IDS";
      if (!GTILES_IDS.has(i)) { GTILES_IDS.add(i); updateGtilesMode(); return "forced on";}
      return "already listed";
    } catch (e) { return "err: " + e.message; }
  }, id);
  // the intro/OB overlays sit over the canvas; dismiss whichever is present
  for (const sel of ["#howto-ok", "#ob-got", 'button:has-text("Got it")']) {
    try { const el = await p.$(sel); if (el && await el.isVisible()) { await el.click({ timeout: 1200 }); break; } } catch (e) {}
  }
  await p.waitForTimeout(SETTLE_MS);
  const d = await p.evaluate(() => (window.GTiles3D ? window.GTiles3D.debug() : null));
  if (!d || !d.ready) {
    console.log(id.padEnd(30) + `  (engine not ready [${forced}] — no token, tiles failed, or no coverage)`);
    await c.close();
    continue;
  }
  const vpm = d.verts / Math.max(d.meshes, 1);
  const real = vpm > REAL_3D_VPM;
  if (!real) anyFlat = true;
  console.log(id.padEnd(30) + String(d.meshes).padStart(7) + String(d.verts).padStart(9) +
              String(d.tris).padStart(9) + vpm.toFixed(0).padStart(8) +
              "  " + (real ? "real 3D mesh" : "FLAT (draped imagery) — do NOT add to GTILES_IDS"));
  await c.close();
}
await b.close();
process.exit(anyFlat ? 1 : 0);
