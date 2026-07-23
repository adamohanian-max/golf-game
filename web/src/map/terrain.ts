import type { Map as MBMap, RasterDEMSourceSpecification } from "mapbox-gl";
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

export function addTerrain(map: MBMap, course: Course): void {
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

// Relief shading toward the Apple-Maps look. The satellite raster alone carries
// no lighting — a flat, evenly-lit photo draped on terrain reads as flat even
// when the mesh is 3D. A hillshade layer off the SAME dem source paints warm
// sun/shadow onto the slopes (the cheap ~80% of "Apple lighting"; full PBR
// shadows would need the three.js terrain-mesh path, deferred). Call AFTER
// addTerrain (needs the 'dem' source) and BEFORE the hole overlays so tee/green
// tints sit on top of the shading.
export function addHillshade(map: MBMap): void {
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "dem",
    paint: {
      "hillshade-exaggeration": 0.45,
      "hillshade-illumination-direction": 315, // NW light, matches the relief convention
      "hillshade-illumination-anchor": "map", // rotate the sun with the terrain, not the screen
      "hillshade-shadow-color": "#37302b", // warm brown-grey, not flat black
      "hillshade-highlight-color": "#fff4e0", // warm cream sun side
      "hillshade-accent-color": "#4a3f38",
    },
  });
}
