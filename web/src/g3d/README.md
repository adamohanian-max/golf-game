# Google Photorealistic 3D Tiles viewer (`g3d.html`)

A browser 3D backdrop renderer that streams Google's real-world Photorealistic
3D Tiles (terrain + buildings + trees) for an arbitrary lat/lon. Built to be a
reusable pipeline for a golf game — everything is parameterized by a
`CourseConfig`, so pointing it at a real course is a one-line change.

Lives inside the existing `web/` Vite app as a **second entry** (`g3d.html`);
the Mapbox+LiDAR viewer (`index.html`) is untouched.

## Setup

1. **Get a key + enable the API.** In the Google Cloud console, create a Maps
   Platform API key and **enable the "Map Tiles API"** on it. Restrict the key
   by **HTTP referrer** to your dev/prod origin (e.g. `http://localhost:5173/*`).

2. **Add the key locally** (never committed — `.env.local` is gitignored):
   ```sh
   # web/.env.local
   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key_here
   ```
   (See `.env.local.example`.)

3. **Run:**
   ```sh
   cd web
   npm install
   npm run dev
   # open http://localhost:5173/g3d.html
   ```
   Without a key the page shows a "Missing VITE_GOOGLE_MAPS_API_KEY" banner.

## Swapping courses

Edit the boot config in `src/g3d/config.ts`:

```ts
export const COURSE_CONFIG: CourseConfig = {
  name: "My Course",
  lat: 36.5687,
  lon: -121.95,
  height: 0,        // ellipsoidal ground height (m); 0 is fine
  headingDeg: 0,    // initial camera look heading (0 = north)
  radiusMeters: 400 // how far back the camera frames the site
};
```

Or switch at runtime from the browser console (exposed by `main-g3d.ts`):

```js
loadCourse(URBAN_FALLBACK);   // re-centers + resets camera in one call
getGroundHeightAt(0, 0);      // ground Y at scene (x,z), or null if unloaded
viewer;                       // the ViewerHandle (scene, camera, tiles, controls…)
```

## Files
- `config.ts` — `CourseConfig` + `COURSE_CONFIG`, `PEBBLE`, `URBAN_FALLBACK`.
- `viewer.ts` — three.js scene, `TilesRenderer` + plugins, `GlobeControls`,
  attribution overlay, coverage/error handling, render loop, `loadCourse`.
- `golfHooks.ts` — `getGroundHeightAt` (mesh raycast) + `loadCourse` passthrough.
- `main-g3d.ts` — entry: reads env key, boots viewer, exposes console API.
- `RESEARCH.md` — verified endpoints, package version, exact API calls, ToS.
- `NOTES.md` — gameplay limitations of the photogrammetry mesh + how to layer
  real collidable gameplay on top.

## Coverage note
Google photoreal coverage is dense in cities, sparse/absent on rural courses.
Pebble Beach may render terrain-only. If a course is sparse, the viewer shows a
coverage banner — use `loadCourse(URBAN_FALLBACK)` (Manhattan) to confirm the
pipeline works, then investigate that course's coverage.

## Perf
Defaults live in `DEFAULT_PERF` (`viewer.ts`): `errorTarget` (tile SSE),
LRU cache size, and pause-render-when-idle. Raise `errorTarget` for more speed /
less detail; lower it for sharper tiles at GPU cost.

## Attribution (required)
The Google logo + data-attribution strings from `tiles.getAttributions()` are
rendered every frame into the `#attribution` overlay. This is mandatory under
the Map Tiles API Terms of Service — do not remove it.
