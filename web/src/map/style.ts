// Base map style — Mapbox GL v3.
//
// `standard-satellite` = real satellite imagery + the Standard 3D engine
// (dynamic lighting, atmosphere, vertical fog, sky). This is the closest thing
// to the Apple-Flyover look out of the box: photoreal ground + a lit 3D scene,
// with none of Apple's sealed-renderer constraints. Our per-course LiDAR
// raster-dem + setTerrain is layered on at runtime (map/terrain.ts) to sharpen
// the coarse global DEM into real green micro-contour.
//
// Mercator is Mapbox's default and REQUIRED here — the globe projection breaks
// the custom-layer projection matrix used by three/ballLayer.ts.
//
// Alternatives to A/B in the prototype:
//   mapbox://styles/mapbox/standard            — vector 3D, illustrated ground (NOT photoreal)
//   mapbox://styles/mapbox/satellite-streets-v12 — flat photo, no Standard lighting
export const STYLE_URL = "mapbox://styles/mapbox/standard-satellite";

// Mapbox GL is proprietary: tiles will not load without an access token.
// Supply it as VITE_MAPBOX_TOKEN (see web/.env.local, gitignored). We read it
// here so a missing token fails loud and early instead of a blank map.
export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? "";

export function assertToken(): string {
  if (!MAPBOX_TOKEN) {
    const msg =
      "Missing VITE_MAPBOX_TOKEN. Create web/.env.local with " +
      "VITE_MAPBOX_TOKEN=pk.your_token (get one at account.mapbox.com/access-tokens).";
    // Surface it in the page too, not just the console — the map is otherwise blank.
    const el = document.getElementById("map");
    if (el) el.textContent = msg;
    throw new Error(msg);
  }
  return MAPBOX_TOKEN;
}
