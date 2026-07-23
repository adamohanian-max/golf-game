import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { STYLE_URL, assertToken } from "./map/style";
import { addTerrain, addHillshade } from "./map/terrain";
import { addHoleLayers } from "./map/holeLayers";
import { makeBallLayer } from "./three/ballLayer";
import * as fourOaks from "./data/four-oaks";
import * as pebble from "./data/pebble-1";
import type { LngLat } from "./game/types";

// Course switch via ?course= (default pebble for the Apple A/B). Both are
// geometry-only data modules exporting { hole, course }.
const COURSES: Record<string, { hole: typeof fourOaks.hole; course: typeof fourOaks.course }> = {
  "four-oaks-dracut": fourOaks,
  "pebble-beach-golf-course": pebble,
};
const wantId = new URLSearchParams(location.search).get("course") ?? "pebble-beach-golf-course";
const { hole, course } = COURSES[wantId] ?? pebble;

// Camera: frame down the hole (tee -> pin) so the green is up-screen (spec §9,
// Phase 6 centerline framing).
function bearingTo(a: LngLat, b: LngLat): number {
  const lat1 = (a[1] * Math.PI) / 180, lat2 = (b[1] * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

mapboxgl.accessToken = assertToken();

const map = new mapboxgl.Map({
  container: "map",
  style: STYLE_URL,
  center: course.center,
  zoom: 16.5,
  pitch: 72, // the Shot-Pattern-style tilted look (Mapbox v3 max pitch is 85°)
  bearing: bearingTo(hole.ballStart, hole.pin),
  // REQUIRED: Mapbox v3 defaults to the globe projection, which breaks the
  // custom-layer projection matrix in three/ballLayer.ts + three/modelMatrix.ts
  // (both assume mercator). Force it so the ball never renders mirrored/floating.
  projection: "mercator",
  // antialias: clean Three.js custom-layer edges. preserveDrawingBuffer lets the
  // screenshot harness read the canvas via toDataURL (the ball's continuous
  // triggerRepaint defeats Playwright's own screenshot stability wait). Minor
  // perf cost, acceptable for a viewer.
  antialias: true,
  preserveDrawingBuffer: true,
});
map.addControl(new mapboxgl.AttributionControl({ compact: false }));

map.on("style.load", () => {
  addTerrain(map, course);
  addHillshade(map);
  addHoleLayers(map, hole);
  const ballLayer = makeBallLayer(hole);
  map.addLayer(ballLayer);

  // Fire control (viewer dev tool): hit the ball down the hole.
  const btn = document.getElementById("hit");
  btn?.addEventListener("click", () => {
    ballLayer.ball.reset();
    // ~150 mph ball speed is ~67 m/s; scale down for a shorter demo hole.
    ballLayer.ball.hit(bearingTo(hole.ballStart, hole.pin), 42, 14);
  });

  // Expose for the screenshot harness / debugging.
  (window as unknown as { __golf: unknown }).__golf = { map, ballLayer };
});

// Surface load errors instead of failing silently (helps the shoot.mjs gate).
map.on("error", (e) => console.error("[mapbox]", e.error?.message ?? e));
