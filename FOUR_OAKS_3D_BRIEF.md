# Build Brief / Prompt — Full 3D Engine for Four Oaks (three.js)

> Hand this whole file to a fresh Claude Code session (or read it yourself) to start
> the build. It is self-contained: a fresh agent has none of the conversation that
> produced it, so everything needed is below. Work with Adam iteratively — ask when a
> decision is load-bearing; don't guess on art/licensing/scope.

---

## 0. Mission

Build a **real 3D renderer** for ONE course — **Four Oaks Country Club** (`four-oaks-dracut`)
— *inside the existing mobile golf game*, using **three.js**. Not the current stylized 2D
top-down map, and NOT a 2D map tilted (that "2.5D drape" was tried and rejected for looking
flat/bad). The target is a real 3D scene like GSPro / TrackMan / GeoShot at a *feasible*
tier: true terrain relief, a photographic ground, standing trees, water, sand, sky, sun +
shadows, and a camera that flies the shot. Prove the model on this one course; every other
course stays 2D.

**Reuse, don't rebuild:** the tuned ball physics, the course data, the HUD, and the scoring
/ progression all already exist and stay. three.js replaces *only the course rendering* for
Four Oaks. The ball's world position drives a 3D mesh instead of a 2D sprite.

---

## 1. The existing game (context)

- Mobile-first golf game. **Vanilla JS + HTML5 Canvas 2D. No build step** — `index.html`
  loads `game.js` (a classic `<script>`, ~11k lines) and modular CSS directly. Served by
  `python3 -m http.server 8080` locally; shipped via **GitHub Pages** and wrapped for iOS
  via **Capacitor (WKWebView)**.
- Read `CLAUDE.md` (repo root) first — it documents the architecture, the course pipeline,
  the `TUNE` physics constants, the coordinate system, and the concurrent-agent / cache-bust
  rules. Key rules: **bump `?v=` on any changed `game.js`/CSS in `index.html`** or Pages
  serves stale files; **this run, do not commit or push** (overnight review) unless Adam says.
- Physics is already framerate-independent: `loop()` runs a fixed-timestep accumulator
  (`PHYS_DT = 1000/60`, `_physAccum`) and calls `draw()` once per frame. Keep that intact.

### Non-negotiable constraints
1. **No bundler / no build step.** three.js must load as ES modules via an **import map**
   (`<script type="importmap">`) pointing at **locally vendored** files (see §7) — NOT a CDN
   (Capacitor runs offline and a strict CSP blocks external hosts; GitHub Pages is fine but
   the iOS app is the hard case).
2. **Mobile GPU + WKWebView first.** Handle `webglcontextlost`/`webglcontextrestored`
   (re-create GPU resources). Watch iOS texture-memory limits and download size. Target a
   locked 60fps on a modern iPhone with the shot in motion.
3. **Four Oaks only.** Gate all 3D behind the course id `four-oaks-dracut` + a mode flag.
   The 2D path for every other course must be byte-for-byte unaffected.
4. **Reuse the physics + data.** Do not fork ball flight, putting, lie, or scoring.

---

## 2. Four Oaks data — already baked (use it, don't re-derive)

Everything is in `courses/four-oaks-dracut.json` (+ `courses/img/four-oaks-dracut/`). Verified
schema:

| Key | Value / meaning |
|---|---|
| `id` | `"four-oaks-dracut"` |
| `yardsPerUnit` | `3.0` → **1 world unit = 3 yd = 2.7432 m** (`M_PER_UNIT` in game.js) |
| `global` | `true` — one connected course in a single world (not per-hole frames) |
| `world` | `{ w: 573.73, h: 730.37 }` world units ≈ **1574 m × 2004 m** (~1.6×2.0 km) |
| `aerial` | `{ file:"img/four-oaks-dracut/course.jpg", w:2011, h:2560, src:"naip", toWorld:[0.296708,0,-11.4746, 0,0.296713,-14.605241] }` — **NAIP** (USGS, public-domain, commercial-OK). `toWorld` maps image px→world: `wx=a·px+b·py+c`, `wy=d·px+e·py+f`. This photo is the ground drape. |
| `dem` | `{ x0,y0,x1,y1, nx:288, ny:366, baseElevM:36.01, data:[105408 floats] }` — **real terrain heightmap**. Row-major `ny×nx` grid over world rect `[0..573.7]×[0..730.4]`, **2-unit (~5.5 m) cells**, values = metres above `baseElevM`. Relief range **0–54.8 m** (real hills). This is your terrain mesh source — no LiDAR fetch strictly required to start (optional enrichment in §8). |
| `surfaceMask` | `{ file:"...surfacemask.png", w:402, h:512, toWorld }` — per-pixel label PNG, palette **OB=0 / FAIRWAY=1 / ROUGH=2 / WOODS=3**. Use WOODS pixels to **place trees**; use it (with the polys) to tint the ground and mark OB. |
| `surfaces` | Polygon arrays in world units: `green`(18), `fairway`(24), `bunker`(47), `water`(11), `tee`(54), `cartpath`(17). `woods`/`grass`/`rough` are empty here — those come from the mask. |
| `holes` | 18 × `{ num, par, yards, tee:{x,y}, pin:{x,y}, pins:[...], geomYards }`. No stored centerline — route is tee→pin (fine for camera framing). Par 70 total. |
| `boundary` | OB polygon (course extent). |

The game loads this via `loadCourse("four-oaks-dracut")` → `setHole(rec)`; runtime helpers you
can lean on: `terrainZ(x,y)` (world-unit ground elevation from the DEM), `surfaceAt(x,y)`
(lie type), `HOLE._greens` (green topo w/ `h(x,y)` height field + `grad`), `HOLE.holePos`,
`state.ball`.

---

## 3. Coordinate system & unit bridge (get this exactly right first)

Game world: origin top-left, `+x` right, `+y` down, elevation via `terrainZ`. Units = "world
units" (1 unit = 3 yd = **2.7432 m**).

three.js scene (right-handed, Y up). Recommended mapping — **1 three.js unit = 1 metre**:

```
M = 2.7432                       // metres per world unit
scene.x =  worldX * M
scene.z =  worldY * M            // world +y (down/south on the map) -> scene +z
scene.y = (terrainZ(worldX,worldY)) * M      // ground height in metres (DEM)
ballScene.y = (terrainZ(bx,by) + ball.z) * M // ball.z is height above ground, world units
```

Write ONE tested pair of helpers `worldToScene(x,y,zUnits)` / `sceneToWorld(vec3)` and route
everything through them. Camera distances, tree heights, fog — all in metres, so real-world
sizes (a 12 m oak, a 9 m-wide green) are literal. Verify by dropping a 1.68-inch (0.0427 m)
sphere at the tee and a flag at the pin and checking they sit on the terrain at the right
separation (hole 1 tee `{177.07,505.22}` → pin `{96.91,419.14}` = 370 yd).

---

## 4. Target scene architecture

A separate ES module (e.g. `three3d/course3d.js`) owns a `THREE.Scene`, `WebGLRenderer`
(on its own `<canvas id="c3d">` behind/over `#game` per §6), a camera, and a `render(dt)`
called from the existing `loop()`. Build order = the phase plan in §9.

1. **Terrain mesh** — a `PlaneGeometry` (or custom grid) subdivided to ~the DEM resolution
   (288×366, decimate if needed), displaced per-vertex by the DEM (`terrainZ`). Compute
   smooth normals for lighting. This is the hills you can't fake.
2. **Ground material** — the **NAIP aerial** (`course.jpg`) as the base color texture, UV-mapped
   through the `aerial.toWorld` affine so the photo lands on the right terrain. Modulate with
   the surface mask + a slope-based tint so fairway/green read a touch greener and OB darkens.
   Consider a detail/normal map for close-up turf (the aerial is ~0.6 m/px; the putt camera
   magnifies far past that). Sun-lit with real shadows (§ lighting).
3. **Greens** — keep the existing synthetic green topo (`HOLE._greens[i].h(x,y)`) driving BOTH
   the mesh micro-relief AND putting break (already wired in 2D). Optionally overlay a subtle
   contour/grid decal when reading a putt. The mesh must roll where the ball breaks — same
   field, so "what you see is what breaks" holds in 3D too.
4. **Water** — a translucent animated plane at each `surfaces.water` polygon, at the local
   terrain height, with a normal-map ripple + reflection (screen-space or a cheap env map).
5. **Bunkers** — sand material (rough PBR, warm) clipped to `surfaces.bunker` polys, slightly
   depressed into the terrain; soft rim.
6. **Trees** — placed from **WOODS mask cells** (sample `surfacemask.png`, world-position each
   cell, thin by density). Start as cross-billboards or low-poly GLTF conifers/hardwoods
   (Four Oaks = New England woods), **instanced** (`InstancedMesh`) for hundreds/thousands at
   one draw call. Cast shadows. Cull + LOD by distance. This is what sells "real course."
7. **Sky + light** — a sky dome / gradient (or `Sky` shader), a directional **sun** with shadow
   map (PCFSoft), soft ambient/hemisphere fill. One tuned time-of-day to start.
8. **Atmosphere** — distance fog in metres so the far course fades naturally (also hides the
   world boundary + helps perf).
9. **Ball + flight** — a small sphere at `worldToScene(ball.x, ball.y, ball.z)` each frame,
   with a trail/tracer while airborne and a ground shadow. Cup + pin/flag (cloth optional) at
   `HOLE.holePos`. Divot/impact particles optional.
10. **Camera modes** — (a) address/aim behind the ball looking at the pin; (b) shot-follow /
    fly-cam tracking the ball's arc; (c) green-read orbit. Reuse the existing aim input; map
    swipe→`launch()` unchanged. Ease between modes.

---

## 5. Physics bridge (reuse everything)

- Keep `update()` / `flightStep` / `rollStep` / `launch(dxs,dys,dt)` / putting / lie / capture
  exactly as-is — they run in world units and are already tuned + framerate-independent.
- The 3D module is **render-only**: each frame read `state.ball` (`{x,y,z,vx,vy,vz,spin}`) and
  place the ball mesh; read `camera`/aim to place the three.js camera. No physics in three.js.
- Ground height for the ball while rolling already comes from `terrainZ` + green fields — the
  same values you displaced the mesh with, so the ball sits ON the visible ground for free.
- Input: the existing swipe/drag → `launch()` path stays. Just make sure the aim reference
  (pin direction, power) reads correctly from the 3D camera orientation.

---

## 6. Integration points in the codebase

- **Mode/gating:** add a `render3D` flag, true only when `mode==="course"` &&
  `course.id==="four-oaks-dracut"` && a user/setting opt-in. When on: show `#c3d`, and in
  `draw()` **skip the 2D course render** but **keep drawing the HUD/overlays** (scorecard,
  club, wind, stats) on the 2D canvas on top — or move them to DOM. When off: 2D path unchanged.
- **Canvas:** add `<canvas id="c3d">` in `index.html`, stacked with `#game` (CSS z-index).
  three.js renders the world to `#c3d`; the 2D `#game` canvas carries HUD/overlays (cleared
  transparent where the 3D shows). Bump CSS/`game.js` `?v=`.
- **Picker:** Four Oaks gets a "Play in 3D" affordance (badge/toggle). Everything else 2D.
- **Loader:** hook the 3D scene build into course load (`loadCourse`/`setHole`) — build the
  terrain/textures/trees **once** on entering Four Oaks, dispose on leaving (free GPU memory).
- **Bridge shape:** game.js is a classic script; the 3D code is an ES module. Expose a small
  API on `window` (e.g. `window.Course3D = { init, enter, leave, render, resize, dispose }`)
  that game.js calls, or drive it via events. Keep the seam narrow and documented.

---

## 7. Loading three.js with no build step (offline-safe)

- **Vendor** three.js locally: download `three.module.min.js` + needed addons
  (`GLTFLoader`, `OrbitControls`?, `Sky`, `RoomEnvironment`, etc.) into `vendor/three/`
  (pin a version, e.g. r160+). Commit them (they must ship in the Capacitor bundle).
- In `index.html`:
  ```html
  <script type="importmap">
  { "imports": {
      "three": "./vendor/three/three.module.min.js",
      "three/addons/": "./vendor/three/addons/"
  }}
  </script>
  <script type="module" src="./three3d/course3d.js"></script>
  ```
- All assets (textures, GLTF, HDR/env) load from same-origin repo paths — no external hosts
  (CSP + offline). Keep total added download modest; compress textures (KTX2/basis if worth
  it), reuse the existing NAIP `course.jpg`.

---

## 8. Asset pipeline & sourcing

- **Terrain:** DEM already baked (§2). Optional enrichment: re-bake higher-res / smoother
  terrain from **USGS 3DEP LiDAR** for Dracut, MA (the bake tools live in `tools/`; extend the
  pipeline to write a denser `dem`). Not required for a first strong result — 2-unit cells over
  54 m of relief is already real hills.
- **Ground texture:** NAIP `course.jpg` (public domain, commercial-OK) — already licensed clean.
- **Trees:** need low-poly GLTF models (a few New-England species: white pine, oak, maple) +
  a billboard fallback for distance. Source **commercial-OK / CC0** assets (Poly Haven, Quaternius,
  Kenney, or purchased) — **confirm licensing with Adam before committing any asset.**
- **PBR materials:** turf, sand, water normal maps — CC0 (Poly Haven / ambientCG). Confirm
  licensing.
- **Sky/env:** a CC0 HDRI or a procedural `Sky` shader (no asset, best for size).
- Keep an `ASSETS.md` listing every asset + source + license.

---

## 9. Phase plan (each phase independently verifiable; commit-worthy checkpoints)

1. **Scaffold + coord bridge.** `#c3d` canvas, three.js vendored + importmap, empty scene,
   the mode gate, context-loss handling, `worldToScene` helpers, a ground plane + a sphere at
   the tee. Verify alignment vs the 2D tee/pin. (No physics yet — just place a static ball.)
2. **Terrain from DEM.** Displaced terrain mesh + smooth normals + a directional light. Confirm
   the hills match `terrainZ` (drop markers at known elevations).
3. **Ground drape.** NAIP aerial mapped through `aerial.toWorld` onto the terrain; mask-based
   surface tint; fog + sky. This is the first "oh, that's the course" moment.
4. **Ball + camera + physics bridge.** Hook `state.ball` → ball mesh; aim/shot-follow camera;
   swipe→`launch()`; play a full hole in 3D end-to-end. Trail, ground shadow, cup + flag.
5. **Trees.** Instanced trees from WOODS mask cells, shadows, LOD/cull. The big visual win.
6. **Water, bunkers, greens polish.** Animated water, sand, green micro-relief + putt-read
   overlay/orbit. Break must match the mesh you see.
7. **Lighting/atmosphere polish + perf.** Shadow tuning, PBR turf detail near the ball, LOD,
   draw-call budget. Lock 60fps on a real iPhone.
8. **Integration polish.** HUD over 3D, picker "Play in 3D", enter/leave/dispose lifecycle,
   settings toggle, on-device sign-off.

---

## 10. Verification

- **Local:** `python3 -m http.server 8080`; drive with Playwright MCP (`.mcp.json`). Screenshot
  each phase; A/B against the 2D render for geometry alignment. Measure fps with the shot in
  motion (rAF timestamps) — note headless Chrome may throttle rAF and can use software GL, so
  trust **on-device** for real perf.
- **Alignment tests:** tee/pin/cup positions, a known-elevation marker on a hill, a ball rolling
  down a green breaks the way the visible contour slopes.
- **On-device (required before calling it done):** sideload via Capacitor to Adam's iPhone;
  verify 60fps, no black-screen after backgrounding (context loss), acceptable download size.
- Bump `?v=` on changed files; keep `ASSETS.md` current.

---

## 11. Open questions to confirm with Adam (ask, don't assume)

1. **Art budget / sourcing:** OK to add ~a few MB of vendored three.js + tree GLTF + PBR maps
   to the repo/app? Any preferred asset source or license bar? Any budget for paid models?
2. **Time of day / mood:** one fixed sunny look to start, or dawn/dusk options?
3. **Camera feel:** broadcast fly-cam (auto-follows the shot) vs. player-controlled orbit —
   which is primary?
4. **Scope of "done" for phase 1 review:** how polished before Adam eyeballs it (greybox
   terrain + ball is enough to validate direction, per the plan).
5. **2D coexistence:** should Four Oaks *default* to 3D, or be an opt-in toggle with 2D still
   available for it?
6. **Perf floor:** which iPhone model is the min target?

---

## 12. First concrete steps for the executing session

1. Read `CLAUDE.md` + skim `game.js` for: `loadCourse`/`setHole`, the `loop()`/`draw()` seam,
   `state.ball`, `terrainZ`, `surfaceAt`, `camera`, and the mode system.
2. Vendor three.js (§7); add `#c3d` + importmap + an empty `three3d/course3d.js` module wired
   to `loop()` behind the Four Oaks mode gate.
3. Implement + unit-check `worldToScene`/`sceneToWorld`; drop a tee sphere + pin flag and
   screenshot against the 2D view. Get sign-off on Phase 1 before terrain.
```
```
