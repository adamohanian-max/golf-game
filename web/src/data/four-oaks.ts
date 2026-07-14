import type { Hole, Course, LngLat, HoleFeatureProps } from "../game/types";

// Four Oaks Country Club (Dracut, MA), hole 1 — a US course with USGS 3DEP LiDAR
// coverage, so it can demonstrate the LiDAR terrain bake (tools/bake_lidar.py)
// vs the coarse global DEM. Coordinates derived offline from the baked course's
// geo.toLonLat affine (courses/four-oaks-dracut.json), not re-queried from OSM.
// ~356 yd par 4.

const TEE: LngLat = [-71.2938461, 42.6844837];
const PIN: LngLat = [-71.2965236, 42.6866087];

const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function box(c: LngLat, halfM: number): GeoJSON.Position[] {
  const dLon = halfM / mPerDegLon(c[1]);
  const dLat = halfM / M_PER_DEG_LAT;
  return [
    [c[0] - dLon, c[1] - dLat], [c[0] + dLon, c[1] - dLat],
    [c[0] + dLon, c[1] + dLat], [c[0] - dLon, c[1] + dLat],
    [c[0] - dLon, c[1] - dLat],
  ];
}

function feat(
  props: HoleFeatureProps,
  geometry: GeoJSON.Geometry
): GeoJSON.Feature<GeoJSON.Geometry, HoleFeatureProps> {
  return { type: "Feature", properties: props, geometry };
}

export const hole: Hole = {
  id: "four-oaks-1",
  ballStart: TEE,
  pin: PIN,
  featureCollection: {
    type: "FeatureCollection",
    features: [
      feat({ kind: "tee" }, { type: "Polygon", coordinates: [box(TEE, 6)] }),
      feat({ kind: "green" }, { type: "Polygon", coordinates: [box(PIN, 13)] }),
    ],
  },
};

export const course: Course = {
  id: "four-oaks-dracut",
  name: "Four Oaks — Hole 1",
  center: [(TEE[0] + PIN[0]) / 2, (TEE[1] + PIN[1]) / 2],
  // LiDAR bake output (tools/bake_lidar.py --id four-oaks-dracut). Set to null to
  // A/B against the coarse AWS global DEM.
  // LiDAR bake output (tools/bake_lidar.py --id four-oaks-dracut --bbox=...,
  // 2021 MA QL2 3DEP). Tiles are gitignored (large); rebake to regenerate. Set
  // to null to A/B against the coarse AWS global DEM.
  terrainTiles: "/tiles/four-oaks-dracut/{z}/{x}/{y}.png",
  lidarDate: null,
};
