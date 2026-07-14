#!/usr/bin/env node
// Fits Apple-imagery georegistration correction for one course.
//
// Matches hand-traced Apple-frame features (green/tee polygons, traced
// directly against MapKit's own satellite imagery — see docs/TRACING.md)
// against this repo's existing true-WGS84 geometry (each hole's `pin`/`tee`
// world-unit point, projected through the course's `geo.toLonLat` affine).
// The mean delta between matched pairs (Model B: constant offset — NOT a
// full affine, so rotation/scale error never gets silently absorbed into
// what's supposed to be a pure imagery-registration measurement) becomes the
// course's imageryCorrection, written to data/corrections/<courseId>.json.
//
// Usage:
//   node scripts/fit-correction.mjs --course butter-brook-golf-club \
//     --traced data/traced/butter-brook-golf-club-apple.geojson

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const METERS_PER_DEG_LAT = 111320.0;

function metersPerDegLon(lat) {
  return 111320.0 * Math.cos((lat * Math.PI) / 180);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function repoRoot() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

function projectAffine(toLonLat, wx, wy) {
  const [a, b, c, d, e, f] = toLonLat;
  return { lng: a * wx + b * wy + c, lat: d * wx + e * wy + f };
}

function ringCentroid(ring) {
  // Simple arithmetic-mean centroid — fine for the small, roughly-convex
  // green/tee polygons this fits; drop the closing duplicate vertex.
  const pts = ring[0] !== undefined && ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of pts) { sumLng += lng; sumLat += lat; }
  return { lng: sumLng / pts.length, lat: sumLat / pts.length };
}

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.course || !args.traced) {
    console.error("Usage: node scripts/fit-correction.mjs --course <id> --traced <path.geojson>");
    process.exit(1);
  }

  const root = repoRoot();
  const coursePath = path.join(root, "courses", `${args.course}.json`);
  if (!fs.existsSync(coursePath)) {
    console.error(`Course file not found: ${coursePath}`);
    process.exit(1);
  }
  const course = JSON.parse(fs.readFileSync(coursePath, "utf8"));
  if (!course.geo || !Array.isArray(course.geo.toLonLat)) {
    console.error(
      `${args.course} has no geo.toLonLat affine — run tools/geo_anchor_course.py first.`
    );
    process.exit(1);
  }

  const tracedPath = path.resolve(args.traced);
  if (!fs.existsSync(tracedPath)) {
    console.error(`Traced GeoJSON not found: ${tracedPath}`);
    process.exit(1);
  }
  const traced = JSON.parse(fs.readFileSync(tracedPath, "utf8"));
  if (traced.type !== "FeatureCollection" || !Array.isArray(traced.features)) {
    console.error("Traced file is not a valid GeoJSON FeatureCollection.");
    process.exit(1);
  }

  // True-WGS84 side of the match: only `pin`/`tee` exist as per-hole ground
  // truth in courses/*.json today (surfaces.* polygons aren't hole-tagged) —
  // see plan's "Scoping decision" for why this is v1's deliberate limit.
  const trueByHoleKind = new Map(); // "3:green" -> {lon,lat}
  for (const h of course.holes) {
    const pin = projectAffine(course.geo.toLonLat, h.pin.x, h.pin.y);
    const tee = projectAffine(course.geo.toLonLat, h.tee.x, h.tee.y);
    trueByHoleKind.set(`${h.num}:green`, pin);
    trueByHoleKind.set(`${h.num}:tee`, tee);
  }

  const pairs = []; // {hole, kind, dLat, dLng, tracedLat}
  const skipped = [];
  for (const feat of traced.features) {
    const kind = feat.properties?.kind;
    const hole = feat.properties?.hole;
    if (kind !== "green" && kind !== "tee") {
      skipped.push(`${kind ?? "?"} (hole ${hole ?? "?"}) — not matched in v1 (no per-hole true geometry for this kind)`);
      continue;
    }
    const truth = trueByHoleKind.get(`${hole}:${kind}`);
    if (!truth) {
      skipped.push(`${kind} hole ${hole} — no matching hole in ${args.course}`);
      continue;
    }
    if (feat.geometry?.type !== "Polygon") {
      skipped.push(`${kind} hole ${hole} — geometry type ${feat.geometry?.type}, expected Polygon`);
      continue;
    }
    const c = ringCentroid(feat.geometry.coordinates[0]);
    pairs.push({
      hole,
      kind,
      dLat: c.lat - truth.lat,
      dLng: c.lng - truth.lng,
      lat: c.lat,
    });
  }

  if (pairs.length === 0) {
    console.error("No traced green/tee features matched any hole — nothing to fit.");
    if (skipped.length) console.error("Skipped:\n  " + skipped.join("\n  "));
    process.exit(1);
  }

  // Model B: constant offset = mean delta across all matched pairs.
  const meanLat = pairs.reduce((s, p) => s + p.lat, 0) / pairs.length;
  const dLat = pairs.reduce((s, p) => s + p.dLat, 0) / pairs.length;
  const dLng = pairs.reduce((s, p) => s + p.dLng, 0) / pairs.length;
  const mLat = METERS_PER_DEG_LAT;
  const mLon = metersPerDegLon(meanLat);

  const residuals = pairs.map((p) => {
    const rLat = p.dLat - dLat;
    const rLng = p.dLng - dLng;
    const north = rLat * mLat;
    const east = rLng * mLon;
    const meters = Math.sqrt(north * north + east * east);
    return { ...p, north, east, meters };
  });
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r.meters * r.meters, 0) / residuals.length);
  const spatialTrendR = pearsonR(residuals.map((r) => r.hole), residuals.map((r) => r.meters));

  console.log(`Fitted Model B correction for ${args.course} from ${pairs.length} feature(s):`);
  console.log(`  dLat=${dLat.toExponential(4)}  dLng=${dLng.toExponential(4)}`);
  console.log(`  meters: north=${(dLat * mLat).toFixed(2)}  east=${(dLng * mLon).toFixed(2)}`);
  console.log(`  residual RMSE: ${rmse.toFixed(2)} m`);
  console.log(
    spatialTrendR === null
      ? "  spatial trend: n/a (too few pairs or insufficient variance to compute)"
      : `  spatial trend (residual magnitude vs hole number): r=${spatialTrendR.toFixed(3)}` +
        (Math.abs(spatialTrendR) > 0.5
          ? "  -- non-trivial correlation; Model B (constant offset) may not fully capture the error. Reporting as-is, not auto-escalating to a fancier model."
          : "")
  );
  console.log("  per-feature residuals:");
  for (const r of residuals) {
    console.log(
      `    hole ${r.hole} ${r.kind}: north=${r.north.toFixed(2)}m east=${r.east.toFixed(2)}m |${r.meters.toFixed(2)}m|`
    );
  }
  if (skipped.length) {
    console.log(`  skipped ${skipped.length} feature(s):`);
    for (const s of skipped) console.log(`    ${s}`);
  }

  const out = {
    courseId: args.course,
    imageryCorrection: {
      model: "B",
      dLat,
      dLng,
      meters: { north: dLat * mLat, east: dLng * mLon },
      residualRMSE_m: rmse,
      spatialTrendR,
      fittedFrom: "traced-vs-osm",
      featureCount: pairs.length,
      fittedOn: new Date().toISOString().slice(0, 10),
    },
  };

  const outDir = path.join(root, "data", "corrections");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${args.course}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(root, outPath)}`);
}

main();
