#!/usr/bin/env node
// Applies a fitted Apple-imagery correction (see fit-correction.mjs) to a
// true-WGS84 GeoJSON FeatureCollection, producing an Apple-frame copy.
//
// True WGS84 stays canonical everywhere in this repo — this script never
// mutates it in place. The correction is Apple-imagery-specific (wrong on
// any other basemap) and Apple periodically re-registers its imagery (baking
// this into canonical data would silently go stale), so it's applied fresh
// at render/consumption time instead. This is also the mechanism that will
// eventually snap future WGS84 LiDAR slope arrows into alignment with
// Apple's imagery wherever that's rendered.
//
// Usage:
//   node scripts/apply-correction.mjs --correction data/corrections/<id>.json \
//     --in <wgs84-features.geojson> --out <apple-frame-features.geojson>

import fs from "node:fs";
import path from "node:path";

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

// Recursively walks a GeoJSON `coordinates` array (works for Point,
// LineString, Polygon, and their Multi* variants alike) and shifts every
// [lng, lat, ...] leaf tuple by the fitted delta.
function shiftCoordinates(coords, dLng, dLat) {
  if (typeof coords[0] === "number") {
    const shifted = coords.slice();
    shifted[0] += dLng;
    shifted[1] += dLat;
    return shifted;
  }
  return coords.map((c) => shiftCoordinates(c, dLng, dLat));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.correction || !args.in || !args.out) {
    console.error(
      "Usage: node scripts/apply-correction.mjs --correction <path.json> --in <in.geojson> --out <out.geojson>"
    );
    process.exit(1);
  }

  const correction = JSON.parse(fs.readFileSync(path.resolve(args.correction), "utf8"));
  const ic = correction.imageryCorrection;
  if (!ic || typeof ic.dLat !== "number" || typeof ic.dLng !== "number") {
    console.error(`${args.correction} has no valid imageryCorrection.{dLat,dLng}.`);
    process.exit(1);
  }

  const input = JSON.parse(fs.readFileSync(path.resolve(args.in), "utf8"));
  if (input.type !== "FeatureCollection" || !Array.isArray(input.features)) {
    console.error("Input is not a valid GeoJSON FeatureCollection.");
    process.exit(1);
  }

  const outFeatures = input.features.map((f) => {
    const frame = f.properties?.frame;
    if (frame !== undefined && frame !== "wgs84") {
      throw new Error(
        `Feature has properties.frame="${frame}" — apply-correction only accepts frame "wgs84" or absent (true-WGS84 input). ` +
          `Refusing to guess: assert on the frame you expect rather than assume it.`
      );
    }
    return {
      ...f,
      properties: { ...f.properties, frame: "apple" },
      geometry: {
        ...f.geometry,
        coordinates: shiftCoordinates(f.geometry.coordinates, ic.dLng, ic.dLat),
      },
    };
  });

  const output = { type: "FeatureCollection", features: outFeatures };
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2) + "\n");
  console.log(
    `Applied ${correction.courseId ?? "?"} correction (dLat=${ic.dLat.toExponential(4)}, dLng=${ic.dLng.toExponential(4)}) ` +
      `to ${outFeatures.length} feature(s) -> ${args.out}`
  );
}

main();
