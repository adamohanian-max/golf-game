import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { style } from "./map/style";
import { addTerrain, addHillshade } from "./map/terrain";
import { addHoleLayers } from "./map/holeLayers";
import { makeBallLayer } from "./three/ballLayer";
import { hole, course } from "./data/four-oaks";
import type { LngLat } from "./game/types";

// Camera: frame down the hole (tee -> pin) so the green is up-screen (spec §9,
// Phase 6 centerline framing).
function bearingTo(a: LngLat, b: LngLat): number {
  const lat1 = (a[1] * Math.PI) / 180, lat2 = (b[1] * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const map = new maplibregl.Map({
  container: "map",
  style,
  center: course.center,
  zoom: 16.5,
  pitch: 72, // the Shot-Pattern-style tilted look
  bearing: bearingTo(hole.ballStart, hole.pin),
  // v5 moved antialias under canvasContextAttributes; required for clean Three.js
  // edges. preserveDrawingBuffer lets the screenshot harness read the canvas via
  // toDataURL (the ball's continuous triggerRepaint defeats Playwright's own
  // screenshot stability wait). Minor perf cost, acceptable for a viewer.
  canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
});
map.addControl(new maplibregl.AttributionControl({ compact: false }));

map.on("style.load", () => {
  addTerrain(map, course);
  addHillshade(map);
  addHoleLayers(map, hole);
  const ballLayer = makeBallLayer(hole);
  map.addLayer(ballLayer);

  // Temporary hit control (Phase 5): fire the ball down the hole.
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
map.on("error", (e) => console.error("[maplibre]", e.error?.message ?? e));
