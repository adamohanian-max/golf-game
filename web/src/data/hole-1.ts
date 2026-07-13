import type { Hole, Course, LngLat, HoleFeatureProps } from "../game/types";

// Banff Springs (Stanley Thompson course), hole 1 — real geometry pulled from
// OpenStreetMap (golf=green/tee/hole). ~376m tee->green on the Bow valley floor,
// ringed by Mt Rundle / Tunnel Mountain, so the coarse global DEM (no LiDAR yet)
// already shows dramatic relief. Tee/green rings are verbatim OSM; slope arrows
// are placeholders until tools/bake_lidar.py runs for this course (§4b).

const TEE: LngLat = [-115.537371, 51.1734626];
const PIN: LngLat = [-115.532223, 51.1744625];

const GREEN_RING: LngLat[] = [
  [-115.5321671, 51.1745872], [-115.5322062, 51.1745851], [-115.532243, 51.174576],
  [-115.5322721, 51.174555], [-115.5323067, 51.1745319], [-115.5323313, 51.1745158],
  [-115.5323625, 51.1744906], [-115.532386, 51.1744611], [-115.5324038, 51.1744324],
  [-115.5324161, 51.1744016], [-115.5324105, 51.174375], [-115.5323927, 51.1743526],
  [-115.5323659, 51.1743414], [-115.5323301, 51.174333], [-115.5322989, 51.1743281],
  [-115.5322709, 51.1743351], [-115.5322151, 51.1743631], [-115.5321671, 51.1743883],
  [-115.5321302, 51.1744051], [-115.5321023, 51.1744191], [-115.532071, 51.1744373],
  [-115.532052, 51.1744576], [-115.5320386, 51.174485], [-115.5320431, 51.1745151],
  [-115.5320442, 51.1745319], [-115.5320509, 51.1745487], [-115.5320666, 51.1745662],
  [-115.5320911, 51.1745802], [-115.5321347, 51.1745879], [-115.5321671, 51.1745872],
];

const TEE_RING: LngLat[] = [
  [-115.537299, 51.1735125], [-115.537462, 51.1734868], [-115.5374323, 51.1734188],
  [-115.5372709, 51.1734455], [-115.537299, 51.1735125],
];

const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function feat(
  props: HoleFeatureProps,
  geometry: GeoJSON.Geometry
): GeoJSON.Feature<GeoJSON.Geometry, HoleFeatureProps> {
  return { type: "Feature", properties: props, geometry };
}

// Placeholder slope arrows near the green centre (real ones come from §4b).
function slopeArrow(offEastM: number, offNorthM: number, bearing: number, magnitude: number) {
  const pt: LngLat = [
    PIN[0] + offEastM / mPerDegLon(PIN[1]),
    PIN[1] + offNorthM / M_PER_DEG_LAT,
  ];
  return feat({ kind: "slope", bearing, magnitude }, { type: "Point", coordinates: pt });
}

export const hole: Hole = {
  id: "banff-springs-1",
  ballStart: TEE,
  pin: PIN,
  featureCollection: {
    type: "FeatureCollection",
    features: [
      feat({ kind: "tee" }, { type: "Polygon", coordinates: [TEE_RING] }),
      feat({ kind: "green" }, { type: "Polygon", coordinates: [GREEN_RING] }),
      slopeArrow(-4, 2, 200, 2.2),
      slopeArrow(4, 1, 215, 1.6),
      slopeArrow(0, -5, 185, 2.8),
    ],
  },
};

export const course: Course = {
  id: "banff-springs",
  name: "Banff Springs — Hole 1",
  center: [(TEE[0] + PIN[0]) / 2, (TEE[1] + PIN[1]) / 2],
  // No LiDAR baked yet -> coarse global DEM. Mountains still read strongly here.
  // Once tools/bake_lidar.py runs: "/tiles/banff-springs/{z}/{x}/{y}.png".
  terrainTiles: null,
  lidarDate: null,
};
