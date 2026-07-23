import type { Map as MBMap } from "mapbox-gl";
import type { Hole } from "../game/types";

// Course furniture = GeoJSON layers draped on terrain (spec §5). Tee/green fills
// + slope-arrow symbols. Zero custom WebGL — MapLibre drapes fill/line/symbol
// onto 3D terrain for free. Slope arrows come from the LiDAR bake (§4b), not
// OSM and not the coarse global DEM.

/** A small triangular arrow pointing "up" (north). icon-rotate turns it to the
 *  downhill bearing; icon-rotation-alignment 'map' keeps it flat on the ground. */
function arrowImage(size = 32): { width: number; height: number; data: Uint8Array } {
  const w = size, h = size;
  const data = new Uint8Array(w * h * 4);
  const cx = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // triangle: apex at top-centre, base at ~75% height
      const ty = y / h;
      const halfW = (ty * w) / 2.4; // widens toward the base
      const inTri = ty > 0.12 && ty < 0.78 && Math.abs(x - cx) < halfW;
      const i = (y * w + x) * 4;
      if (inTri) {
        data[i] = 255; data[i + 1] = 240; data[i + 2] = 40; data[i + 3] = 235; // amber
      }
    }
  }
  return { width: w, height: h, data };
}

export function addHoleLayers(map: MBMap, hole: Hole): void {
  if (!map.hasImage("slope-arrow")) {
    map.addImage("slope-arrow", arrowImage(), { pixelRatio: 2 });
  }
  map.addSource("hole", { type: "geojson", data: hole.featureCollection });

  // Real course surfaces draped on the satellite. Tints kept translucent so the
  // photo reads through — the aerial already SHOWS grass/sand/water; these are
  // play-surface hints, not opaque paint (mirrors the game's photoreal overlay).
  map.addLayer({
    id: "fairway-fill",
    type: "fill",
    source: "hole",
    filter: ["==", ["get", "kind"], "fairway"],
    paint: { "fill-color": "#8ad98f", "fill-opacity": 0.14 },
  });
  map.addLayer({
    id: "water-fill",
    type: "fill",
    source: "hole",
    filter: ["==", ["get", "kind"], "water"],
    paint: { "fill-color": "#1f6f8b", "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: "bunker-fill",
    type: "fill",
    source: "hole",
    filter: ["==", ["get", "kind"], "bunker"],
    paint: { "fill-color": "#e8d9a0", "fill-opacity": 0.28 },
  });
  map.addLayer({
    id: "green-fill",
    type: "fill",
    source: "hole",
    filter: ["==", ["get", "kind"], "green"],
    paint: { "fill-color": "#4ea24e", "fill-opacity": 0.4 },
  });
  map.addLayer({
    id: "green-outline",
    type: "line",
    source: "hole",
    filter: ["==", ["get", "kind"], "green"],
    paint: { "line-color": "#eafff0", "line-width": 1.5, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: "tee-fill",
    type: "fill",
    source: "hole",
    filter: ["==", ["get", "kind"], "tee"],
    paint: { "fill-color": "#2b6cb0", "fill-opacity": 0.6 },
  });

  map.addLayer({
    id: "slope-arrows",
    type: "symbol",
    source: "hole",
    filter: ["==", ["get", "kind"], "slope"],
    layout: {
      "icon-image": "slope-arrow",
      "icon-rotate": ["get", "bearing"], // degrees, downhill direction
      "icon-size": ["*", 0.4, ["coalesce", ["get", "magnitude"], 1]],
      "icon-allow-overlap": true,
      "icon-rotation-alignment": "map", // rotate with the map, not the screen
    },
  });
}
