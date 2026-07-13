import type { Map as MLMap, RasterDEMSourceSpecification } from "maplibre-gl";
import type { Course } from "../game/types";

// TERRAIN IS THE WHOLE BALLGAME (spec §4). A coarse global DEM (~10-30m effective
// resolution) renders a golf course as a nearly flat plane. We bake our own
// terrain tiles from LiDAR per course (see spec §4b / tools/bake_lidar.py) and
// fall back to the global DEM only where we have no LiDAR.
//
// MapLibre's setTerrain accepts exactly ONE source. We do NOT stack two DEM
// sources — the bake step composites LiDAR over global fill and emits a single
// per-course tileset with a buffer ring. Switching courses = switching source.

const GLOBAL_DEM: RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "Elevation: Terrain Tiles / AWS Open Data",
};

export function addTerrain(map: MLMap, course: Course): void {
  if (course.terrainTiles) {
    // LiDAR-baked, Terrarium-encoded, per-course. maxzoom is high because the
    // whole point is detail — z18 is roughly sub-metre per pixel.
    map.addSource("dem", {
      type: "raster-dem",
      tiles: [course.terrainTiles],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 18,
      attribution: "Elevation: USGS 3DEP LiDAR",
    });
  } else {
    map.addSource("dem", GLOBAL_DEM); // fallback: coarse, will look flat
  }

  // Start at 1.0. Real LiDAR terrain does NOT need exaggeration to read well —
  // if you find yourself pushing this above ~1.3 to see relief, your DEM is
  // wrong, not your exaggeration.
  map.setTerrain({ source: "dem", exaggeration: 1.0 });
}
