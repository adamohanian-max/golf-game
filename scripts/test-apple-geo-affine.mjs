#!/usr/bin/env node
// Regression test for game.js's appleGeoAffine() sign convention.
//
// A sign flip here (subtract instead of add) doesn't throw or crash — it
// silently DOUBLES the Apple-imagery georegistration error in the same
// direction instead of canceling it. That exact bug shipped once already
// this session (caught only via live on-device visual testing + a slow
// multi-agent research detour), so this extracts and executes the REAL,
// current game.js function (not a hand-copied duplicate that could drift
// out of sync) and checks its sign against fit-correction.mjs's own
// ground-truth convention.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

function repoRoot() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

// Balanced-brace scan, not a regex with a fixed line count — survives the
// function being reformatted/moved without silently no-oping the test.
function extractFunctionSource(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`Could not find "${signature}" in game.js`);
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) throw new Error("Could not find opening brace");
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error("Unbalanced braces while scanning function body");
  return src.slice(start, i + 1);
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; }
  else console.log("ok - " + msg);
}

const root = repoRoot();
const gameJsSrc = fs.readFileSync(path.join(root, "game.js"), "utf8");
const fnSrc = extractFunctionSource(gameJsSrc, "function appleGeoAffine() {");

// Minimal harness: appleGeoAffine() reads two free variables, `course` and
// `appleCorrection` — supply them as locals and eval the real function body
// against them, so this exercises the exact source shipping in game.js.
function callAppleGeoAffine(course, appleCorrection) {
  const fn = new Function("course", "appleCorrection", `${fnSrc}\nreturn appleGeoAffine();`);
  return fn(course, appleCorrection);
}

// --- Test 1: synthetic, exact-arithmetic check -----------------------------
{
  const course = { id: "test-course", geo: { toLonLat: [1, 2, 100, 3, 4, 200] } };
  const appleCorrection = { courseId: "test-course", dLat: 0.001, dLng: -0.002 };
  const g = callAppleGeoAffine(course, appleCorrection);

  assert(g[2] === 100 + -0.002, "lon translation term (g[2]) equals g0[2] + dLng (add, not subtract)");
  assert(g[5] === 200 + 0.001, "lat translation term (g[5]) equals g0[5] + dLat (add, not subtract)");
  assert(g[2] !== 100 - -0.002, "lon translation term does NOT equal the subtract form (would double the error)");
  assert(g[5] !== 200 - 0.001, "lat translation term does NOT equal the subtract form (would double the error)");
  assert(g[0] === 1 && g[1] === 2 && g[3] === 3 && g[4] === 4, "linear (rotation/scale) terms untouched");
}

// --- Test 2: no-op when correction is absent or for a different course ----
{
  const course = { id: "test-course", geo: { toLonLat: [1, 2, 100, 3, 4, 200] } };
  const g1 = callAppleGeoAffine(course, null);
  assert(JSON.stringify(g1) === JSON.stringify(course.geo.toLonLat), "no correction loaded -> affine passes through unchanged");

  const g2 = callAppleGeoAffine(course, { courseId: "some-other-course", dLat: 5, dLng: 5 });
  assert(JSON.stringify(g2) === JSON.stringify(course.geo.toLonLat), "correction for a different course -> affine passes through unchanged");
}

// --- Test 3: end-to-end against real project data -------------------------
// fit-correction.mjs defines dLng = tracedLng - trueLng (its own separate
// source), i.e. by definition trueLng + dLng === tracedLng. Recompute a real
// hole's true lon/lat, run it through appleGeoAffine, and confirm the result
// lands within the fit's own reported residual of the real traced point —
// independent, project-data-grounded confirmation of the sign, not just
// synthetic arithmetic.
{
  const courseId = "butter-brook-golf-club";
  const coursePath = path.join(root, "courses", `${courseId}.json`);
  const correctionPath = path.join(root, "data", "corrections", `${courseId}.json`);
  const tracedPath = path.join(root, "data", "traced", `${courseId}-apple.geojson`);

  if (fs.existsSync(coursePath) && fs.existsSync(correctionPath) && fs.existsSync(tracedPath)) {
    const course = JSON.parse(fs.readFileSync(coursePath, "utf8"));
    const correctionRec = JSON.parse(fs.readFileSync(correctionPath, "utf8"));
    const ic = correctionRec.imageryCorrection;
    const traced = JSON.parse(fs.readFileSync(tracedPath, "utf8"));

    const greenFeature = traced.features.find((f) => f.properties.kind === "green" && f.properties.hole === 2);
    const hole2 = course.holes.find((h) => h.num === 2);

    if (greenFeature && hole2 && ic) {
      const appleCorrection = { courseId, dLat: ic.dLat, dLng: ic.dLng };
      const g = callAppleGeoAffine(course, appleCorrection);
      const correctedLon = g[0] * hole2.pin.x + g[1] * hole2.pin.y + g[2];
      const correctedLat = g[3] * hole2.pin.x + g[4] * hole2.pin.y + g[5];

      const ring = greenFeature.geometry.coordinates[0].slice(0, -1);
      const tracedLon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const tracedLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;

      const mLat = 111320.0;
      const mLon = 111320.0 * Math.cos((tracedLat * Math.PI) / 180);
      const meters = Math.hypot((correctedLat - tracedLat) * mLat, (correctedLon - tracedLon) * mLon);
      const tolerance = Math.max(ic.residualRMSE_m * 3, 5); // generous — this is a sign/sanity check, not a precision test
      assert(meters < tolerance, `corrected hole-2 pin lands within ${tolerance.toFixed(1)}m of the real traced green (got ${meters.toFixed(2)}m)`);
    } else {
      console.log("skip - real-data end-to-end check (missing hole-2 green trace or correction)");
    }
  } else {
    console.log("skip - real-data end-to-end check (butter-brook-golf-club project data not present)");
  }
}

if (process.exitCode) {
  console.error("\nappleGeoAffine sign regression test FAILED");
} else {
  console.log("\nappleGeoAffine sign regression test passed");
}
