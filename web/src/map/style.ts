import type { StyleSpecification } from "maplibre-gl";

// Base map style. Mercator LOCKED (spec §1) — globe breaks the custom-layer
// matrix math. Satellite is a raster source; DEM/terrain is added at runtime by
// map/terrain.ts once we know which course (and thus which terrain source) loads.
export const style: StyleSpecification = {
  version: 8,
  projection: { type: "mercator" }, // do not use globe
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        // DEV ONLY — Esri World Imagery. Check terms before production; swap for
        // MapTiler Satellite (keyed) or your own tiles. Keep attribution visible.
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Imagery © Esri",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  // Sky so pitched views show a horizon, not a white void (Phase 6 polish).
  sky: {
    "sky-color": "#8fbcff",
    "sky-horizon-blend": 0.5,
    "horizon-color": "#e8f0fb",
    "horizon-fog-blend": 0.6,
    "fog-color": "#dfe8f2",
    "fog-ground-blend": 0.2,
  },
};
