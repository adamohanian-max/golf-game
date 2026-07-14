#!/usr/bin/env node
// One-off fix: hole 1's canonical tee/green in courses/butter-brook-golf-club.json
// is ~500m off true position (a bad OSM match that was excluded as an outlier
// during the original geo.toLonLat affine fit — see that field's own `.note`/
// `residualMaxM` — but never corrected afterward). The user has since manually
// traced hole 1's REAL tee+green against Apple's imagery (data/traced/). This
// script converts that trace back into the course's world-unit coordinate
// system and writes it in, replacing both the point markers (hole.tee/hole.pin)
// AND the surfaces.tee/surfaces.green polygons themselves (confirmed both are
// wrong together, not just the markers — see docs/PROGRESS.md).
//
// Usage: node scripts/fix-butter-brook-hole1.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

function repoRoot() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

const dryRun = process.argv.includes("--dry-run");
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

// Apple-frame traced coordinate -> true WGS84 -> world units, using the exact
// 2x2 solve game.js's own probe-calibration code uses (buildAppleProj), so
// this fix uses the identical math the runtime does, not a reimplementation.
function tracedToWorld([lon, lat]) {
  const trueLon = lon - ic.dLng;
  const trueLat = lat - ic.dLat;
  const wx = (g[4] * (trueLon - g[2]) - g[1] * (trueLat - g[5])) / gdet;
  const wy = (g[0] * (trueLat - g[5]) - g[3] * (trueLon - g[2])) / gdet;
  return { x: wx, y: wy };
}

function centroid(poly) {
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const hole1 = course.holes.find((h) => h.num === 1);
if (!hole1) throw new Error("hole 1 not found");

const teeFeature = traced.features.find((f) => f.properties.kind === "tee" && f.properties.hole === 1);
const greenFeature = traced.features.find((f) => f.properties.kind === "green" && f.properties.hole === 1);
if (!teeFeature || !greenFeature) throw new Error("hole 1 tee/green trace not found in " + tracedPath);

// Convert traced rings (drop the closing duplicate vertex) to world units.
function ringToWorld(feature) {
  const ring = feature.geometry.coordinates[0];
  const pts = ring.slice(0, -1);
  return pts.map(tracedToWorld);
}
const newTeeRing = ringToWorld(teeFeature);
const newGreenRing = ringToWorld(greenFeature);
const newTeeCentroid = centroid(newTeeRing);
const newGreenCentroid = centroid(newGreenRing);

// Find which surfaces.tee/surfaces.green polygon is nearest the CURRENT
// (wrong) hole.tee/hole.pin — recomputed at run time, not hardcoded indices.
function nearestPolyIndex(polys, target) {
  let bestI = -1, bestD = Infinity;
  polys.forEach((poly, i) => {
    const d = dist(centroid(poly), target);
    if (d < bestD) { bestD = d; bestI = i; }
  });
  return { index: bestI, dist: bestD };
}
const teeMatch = nearestPolyIndex(course.surfaces.tee, hole1.tee);
const greenMatch = nearestPolyIndex(course.surfaces.green, hole1.pin);
console.log(`hole1.tee nearest surfaces.tee[${teeMatch.index}] (centroid dist ${teeMatch.dist.toFixed(3)} units)`);
console.log(`hole1.pin nearest surfaces.green[${greenMatch.index}] (centroid dist ${greenMatch.dist.toFixed(3)} units)`);

const oldTeePinDist = dist(hole1.tee, hole1.pin) * course.yardsPerUnit;
const newTeePinDist = dist(newTeeCentroid, newGreenCentroid) * course.yardsPerUnit;
const moveDistYds = dist(hole1.pin, newGreenCentroid) * course.yardsPerUnit;
console.log(`old tee-pin distance: ${oldTeePinDist.toFixed(1)} yds (scorecard: ${hole1.yards} yds)`);
console.log(`new tee-pin distance: ${newTeePinDist.toFixed(1)} yds`);
console.log(`pin moved by: ${moveDistYds.toFixed(1)} yds`);

// Sanity checks before writing anything.
if (newTeePinDist < hole1.yards * 0.5 || newTeePinDist > hole1.yards * 1.05) {
  throw new Error(`new tee-pin distance (${newTeePinDist.toFixed(1)}yd) implausible for a ${hole1.yards}yd hole — aborting`);
}
if (moveDistYds * 0.9144 < 100) {
  throw new Error(`pin only moved ${moveDistYds.toFixed(1)}yd — expected ~500m; this doesn't look like the known bug, aborting`);
}

const pinDelta = { x: newGreenCentroid.x - hole1.pin.x, y: newGreenCentroid.y - hole1.pin.y };
const newPins = hole1.pins.map((p) => ({ ...p, x: p.x + pinDelta.x, y: p.y + pinDelta.y }));
for (const p of newPins) {
  if (!pointInPoly(p, newGreenRing)) {
    console.warn(`WARNING: pin "${p.name}" does not fall inside the new green polygon after the shift`);
  }
}

console.log(`\n${dryRun ? "[dry run] would update" : "Updating"}: hole1.tee, hole1.pin, hole1.pins[], ` +
  `surfaces.tee[${teeMatch.index}], surfaces.green[${greenMatch.index}]`);

if (!dryRun) {
  hole1.tee = { x: newTeeCentroid.x, y: newTeeCentroid.y };
  hole1.pin = { x: newGreenCentroid.x, y: newGreenCentroid.y };
  hole1.pins = newPins;
  course.surfaces.tee[teeMatch.index] = newTeeRing;
  course.surfaces.green[greenMatch.index] = newGreenRing;
  fs.writeFileSync(coursePath, JSON.stringify(course) + "\n");
  console.log(`\nWrote ${path.relative(root, coursePath)}`);
} else {
  console.log("\n(dry run — no file written)");
}
