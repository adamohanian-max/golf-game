#!/usr/bin/env node
// Fixes specific holes' tee data in courses/butter-brook-golf-club.json using
// real Apple-imagery traces, mirroring fix-butter-brook-hole1.mjs's approach
// but generalized to a list of holes and tee-only (their greens are fine).
//
// Discovered via fit-correction.mjs: after fitting the course-wide imagery
// correction from GREENS only (clean, ~1-6m residuals across 13 holes), several
// holes' TEE traces showed huge (45-180m) residuals against their canonical
// hole.tee — the same class of bug hole 1 had (tees are known-less-reliable;
// courses/butter-brook-golf-club.json's own geo.toLonLat note says tees were
// excluded from the original affine fit "may be scorecard-stretched by the
// baker"). This is a real per-hole data bug, not the few-meter imagery offset
// this whole correction mechanism is meant to measure.
//
// Usage: node scripts/fix-butter-brook-tees.mjs 6,9,13 [--dry-run]

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

function repoRoot() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

const dryRun = process.argv.includes("--dry-run");
const holeArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!holeArg) {
  console.error("Usage: node scripts/fix-butter-brook-tees.mjs <holeNums,comma-separated> [--dry-run]");
  process.exit(1);
}
const holeNums = holeArg.split(",").map((s) => parseInt(s, 10));

const root = repoRoot();
const courseId = "butter-brook-golf-club";
const coursePath = path.join(root, "courses", `${courseId}.json`);
const correctionPath = path.join(root, "data", "corrections", `${courseId}.json`);
const tracedPath = path.join(root, "data", "traced", `${courseId}-apple.geojson`);

const course = JSON.parse(fs.readFileSync(coursePath, "utf8"));
const correctionRec = JSON.parse(fs.readFileSync(correctionPath, "utf8"));
const ic = correctionRec.imageryCorrection;
const traced = JSON.parse(fs.readFileSync(tracedPath, "utf8"));

const g = course.geo.toLonLat;
const gdet = g[0] * g[4] - g[1] * g[3];

function tracedToWorld([lon, lat]) {
  const trueLon = lon - ic.dLng;
  const trueLat = lat - ic.dLat;
  const wx = (g[4] * (trueLon - g[2]) - g[1] * (trueLat - g[5])) / gdet;
  const wy = (g[0] * (trueLat - g[5]) - g[3] * (trueLon - g[2])) / gdet;
  return { x: wx, y: wy };
}
function centroid(pts) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function nearestPolyIndex(polys, target) {
  let bestI = -1, bestD = Infinity;
  polys.forEach((poly, i) => {
    const d = dist(centroid(poly), target);
    if (d < bestD) { bestD = d; bestI = i; }
  });
  return { index: bestI, dist: bestD };
}

for (const hn of holeNums) {
  const hole = course.holes.find((h) => h.num === hn);
  if (!hole) { console.error(`hole ${hn} not found, skipping`); continue; }
  const teeFeature = traced.features.find((f) => f.properties.kind === "tee" && f.properties.hole === hn);
  if (!teeFeature) { console.error(`no traced tee for hole ${hn}, skipping`); continue; }

  const newTeeRing = teeFeature.geometry.coordinates[0].slice(0, -1).map(tracedToWorld);
  const newTeeCentroid = centroid(newTeeRing);

  const teeMatch = nearestPolyIndex(course.surfaces.tee, hole.tee);
  const oldDist = dist(hole.tee, hole.pin) * course.yardsPerUnit;
  const newDist = dist(newTeeCentroid, hole.pin) * course.yardsPerUnit;
  const moveYds = dist(hole.tee, newTeeCentroid) * course.yardsPerUnit;

  console.log(`\nhole ${hn}: nearest surfaces.tee[${teeMatch.index}] (centroid dist ${teeMatch.dist.toFixed(3)} units)`);
  console.log(`  old tee-pin: ${oldDist.toFixed(1)}yd, new tee-pin: ${newDist.toFixed(1)}yd (scorecard ${hole.yards}yd)`);
  console.log(`  tee moved by: ${moveYds.toFixed(1)}yd`);

  if (newDist < hole.yards * 0.5 || newDist > hole.yards * 1.1) {
    console.error(`  ABORT: new tee-pin distance implausible for a ${hole.yards}yd hole — skipping hole ${hn}`);
    continue;
  }

  if (!dryRun) {
    hole.tee = { x: newTeeCentroid.x, y: newTeeCentroid.y };
    course.surfaces.tee[teeMatch.index] = newTeeRing;
    console.log(`  updated hole${hn}.tee + surfaces.tee[${teeMatch.index}]`);
  } else {
    console.log(`  [dry run] would update hole${hn}.tee + surfaces.tee[${teeMatch.index}]`);
  }
}

if (!dryRun) {
  fs.writeFileSync(coursePath, JSON.stringify(course) + "\n");
  console.log(`\nWrote ${path.relative(root, coursePath)}`);
} else {
  console.log("\n(dry run — no file written)");
}
