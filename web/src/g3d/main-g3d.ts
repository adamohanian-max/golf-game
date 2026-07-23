// Entry for the Google Photorealistic 3D Tiles viewer (g3d.html).
// Reads the key from env, boots the viewer on COURSE_CONFIG, and exposes
// loadCourse on window for manual course-switch testing from the console.

import { createViewer } from "./viewer.js";
import { getGroundHeightAt, loadCourse } from "./golfHooks.js";
import { COURSE_CONFIG, PEBBLE, URBAN_FALLBACK } from "./config.js";
import type { CourseConfig } from "./config.js";

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const mount = document.getElementById("app")!;
const attribution = document.getElementById("attribution")!;
const status = document.getElementById("status")!;

function setStatus(msg: string) {
  status.textContent = msg;
  status.style.display = msg ? "block" : "none";
}

if (!KEY) {
  setStatus(
    "Missing VITE_GOOGLE_MAPS_API_KEY. Add it to web/.env.local (enable the Map Tiles API on the key), then restart the dev server.",
  );
} else {
  const viewer = createViewer(
    mount,
    KEY,
    COURSE_CONFIG,
    attribution,
    setStatus,
  );

  // Console API for manual verification / demoing course switching.
  const w = window as unknown as Record<string, unknown>;
  w.viewer = viewer;
  w.loadCourse = (c: CourseConfig) => loadCourse(viewer, c);
  w.PEBBLE = PEBBLE;
  w.URBAN_FALLBACK = URBAN_FALLBACK;
  w.getGroundHeightAt = (x: number, z: number) =>
    getGroundHeightAt(viewer, x, z);

  // eslint-disable-next-line no-console
  console.log(
    "[g3d] ready. Try: loadCourse(URBAN_FALLBACK) — or getGroundHeightAt(0,0)",
  );
}
