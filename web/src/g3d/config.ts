// Course backdrop config for the Google Photorealistic 3D Tiles viewer.
// Everything downstream (viewer, golf hooks) is parameterized by CourseConfig so
// a real course is just a new literal — nothing else changes.

export interface CourseConfig {
  /** Human label (shown in UI/console). */
  name: string;
  /** Latitude in degrees (WGS84). */
  lat: number;
  /** Longitude in degrees (WGS84). */
  lon: number;
  /** Ground height at the site in meters (ellipsoidal). 0 is fine for most. */
  height?: number;
  /** Compass heading the camera initially looks toward, degrees (0 = north). */
  headingDeg: number;
  /** Framing radius: how far back the camera sits to see the site, meters. */
  radiusMeters: number;
}

// Sample test coordinate from the brief — Pebble Beach area, CA.
// NOTE: Google Photorealistic coverage is dense in cities, sparse on rural
// courses. Pebble may render terrain-only / low detail — expected, not a bug.
export const PEBBLE: CourseConfig = {
  name: "Pebble Beach (CA)",
  lat: 36.5687,
  lon: -121.95,
  height: 0,
  headingDeg: 0,
  radiusMeters: 400,
};

// Dense-coverage urban fallback to prove the pipeline if a course is sparse.
// Lower Manhattan — guaranteed high-detail photoreal mesh.
export const URBAN_FALLBACK: CourseConfig = {
  name: "Manhattan (coverage check)",
  lat: 40.7128,
  lon: -74.006,
  height: 0,
  headingDeg: 0,
  radiusMeters: 600,
};

// The config the viewer boots with. Swap this (or call loadCourse) to move.
export const COURSE_CONFIG: CourseConfig = PEBBLE;
