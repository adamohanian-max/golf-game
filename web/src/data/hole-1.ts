import type { Hole, Course, LngLat, HoleFeatureProps } from "../game/types";

// Sample hole — real coordinates in the Colorado Springs foothills so the coarse
// global DEM shows genuine relief (proves terrain draping before any LiDAR bake
// exists). Polygons are hand-approximated; swap for your OSM-baked geometry.
// When tools/bake_lidar.py has run for this course, set course.terrainTiles and
// replace the placeholder slope points with the bake's slope GeoJSON (§4b).

const TEE: LngLat = [-104.85, 38.79];
const PIN: LngLat = [-104.84871, 38.7928]; // ~360yd, bearing ~NNE

const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Axis-aligned box (metres half-size) around a point, as a GeoJSON ring. */
function box(c: LngLat, halfM: number): GeoJSON.Position[] {
  const dLon = halfM / mPerDegLon(c[1]);
  const dLat = halfM / M_PER_DEG_LAT;
  return [
    [c[0] - dLon, c[1] - dLat],
    [c[0] + dLon, c[1] - dLat],
    [c[0] + dLon, c[1] + dLat],
    [c[0] - dLon, c[1] + dLat],
    [c[0] - dLon, c[1] - dLat],
  ];
}

function feat(
  props: HoleFeatureProps,
  geometry: GeoJSON.Geometry
): GeoJSON.Feature<GeoJSON.Geometry, HoleFeatureProps> {
  return { type: "Feature", properties: props, geometry };
}

// A few placeholder slope arrows around the green (real ones come from §4b).
function slopeArrow(offEastM: number, offNorthM: number, bearing: number, magnitude: number) {
  const pt: LngLat = [
    PIN[0] + offEastM / mPerDegLon(PIN[1]),
    PIN[1] + offNorthM / M_PER_DEG_LAT,
  ];
  return feat({ kind: "slope", bearing, magnitude }, { type: "Point", coordinates: pt });
}

export const hole: Hole = {
  id: "hole-1",
  ballStart: TEE,
  pin: PIN,
  featureCollection: {
    type: "FeatureCollection",
    features: [
      feat({ kind: "tee" }, { type: "Polygon", coordinates: [box(TEE, 6)] }),
      feat({ kind: "green" }, { type: "Polygon", coordinates: [box(PIN, 14)] }),
      slopeArrow(-6, 4, 205, 2.4),
      slopeArrow(5, 3, 220, 1.8),
      slopeArrow(0, -7, 190, 3.1),
    ],
  },
};

export const course: Course = {
  id: "demo-foothills",
  name: "Foothills Demo",
  center: [(TEE[0] + PIN[0]) / 2, (TEE[1] + PIN[1]) / 2],
  // No LiDAR baked yet -> coarse global DEM fallback. Once tools/bake_lidar.py
  // has produced tiles, set e.g. "/tiles/demo-foothills/{z}/{x}/{y}.png".
  terrainTiles: null,
  lidarDate: null,
};
