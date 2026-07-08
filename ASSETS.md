# ASSETS.md — third-party assets vendored into the repo

## three.js (Four Oaks 3D renderer)

- **What:** `vendor/three/three.module.min.js` (core, r160/0.160.0) +
  `vendor/three/addons/controls/OrbitControls.js` +
  `vendor/three/addons/objects/Sky.js` +
  `vendor/three/addons/objects/Water.js` +
  `vendor/three/addons/loaders/GLTFLoader.js` +
  `vendor/three/addons/utils/BufferGeometryUtils.js` (examples/jsm addons, same version).
- **Source:** `npm pack three@0.160.0`, unpacked `build/three.module.min.js` and
  the addons above verbatim (all import only from `"three"` or each other —
  `GLTFLoader.js` needs `utils/BufferGeometryUtils.js`, no other deps).
- **License:** MIT (`vendor/three/LICENSE`).
- **Why vendored, not CDN:** no build step in this repo, and the iOS Capacitor
  (WKWebView) build runs offline behind a strict CSP that blocks external hosts —
  see `FOUR_OAKS_3D_BRIEF.md` §7. Loaded via an import map in `index.html`
  (`"three"` / `"three/addons/"`).
- **Used by:** `three3d/course3d.js` only. Gated to course id `four-oaks-dracut`;
  every other course renders on the original 2D canvas path, untouched.
- **Size:** ~950 KB combined, uncompressed.

## NAIP aerial imagery (Four Oaks ground texture)

Already covered by the existing course-data pipeline docs in `CLAUDE.md`
("Imagery source (Esri vs NAIP)") — public domain, commercial-OK, no separate
license entry needed here. Reused as-is for the 3D ground drape (phase 3).

## Turf detail texture (Four Oaks 3D ground close-up)

- **What:** `three3d/textures/turf_detail.jpg` — one small (1024px, tileable)
  grass/turf albedo photo, blended into the terrain material at close camera
  range via a distance-based shader patch (see `course3d.js`
  `ensureDetailTexture`/`patchGroundDetailShader`). Fixes the #1 visible flaw
  from the phase-4 review (aerial photo alone goes blurry under a chase-cam —
  it's ~0.6m/px source imagery, never meant to be viewed at ground level).
- **Source:** ambientCG, asset "Grass004" (`Grass004_1K-JPG_Color.jpg`,
  https://ambientcg.com/view?id=Grass004), re-encoded to JPEG q80 to shrink
  from ~2MB to ~300KB (mobile download size — this is a repeating detail tile,
  not something that needs full source fidelity).
- **License:** CC0 (ambientCG — all assets public-domain-equivalent).
- **Used by:** `three3d/course3d.js` only, Four Oaks 3D ground material.
- **Size:** ~300 KB.

## Tree models (Four Oaks 3D instanced forest)

- **What:** `three3d/models/trees/{tree_oak.glb, tree_detailed.glb,
  tree_pine_tall.glb, tree_pine_round.glb}` — 4 low-poly tree models (7-31KB
  each, single self-contained `.glb` files, no external textures), instanced
  from WOODS-mask cells (see `game.js` `buildTrees()` / `GolfBridge.getTrees`
  and `course3d.js` tree placement).
- **Source:** Kenney "Nature Kit" (https://kenney.nl/assets/nature-kit),
  `Models/GLTF format/{tree_oak.glb, tree_detailed.glb, tree_pineTallA.glb,
  tree_pineRoundC.glb}` (renamed on copy).
- **License:** CC0 (Kenney — credit appreciated, not required).
- **Used by:** `three3d/course3d.js` only, Four Oaks 3D tree instancing.
- **Size:** ~68 KB combined.

## Water ripple normal map (Four Oaks 3D water hazards)

- **What:** `three3d/textures/water_normal.jpg` — a small (512px, tileable)
  tangent-space normal map driving `Water.js`'s ripple distortion.
- **Source:** procedurally generated (layered tileable value noise ->
  gradient -> normal map, via a one-off Python/NumPy script — not run from
  the repo, output committed directly). Not a third-party asset: chosen over
  the stock three.js example's `waternormals.jpg` (ambiguous license) or an
  ambientCG substitute (ambientCG has no dedicated water/ripple normal map in
  its catalog as of this writing).
- **License:** N/A — original, generated content.
- **Used by:** `three3d/course3d.js` only, Four Oaks 3D water hazards.
- **Size:** ~34 KB.

## Sand detail texture (Four Oaks 3D bunkers)

- **What:** `three3d/textures/sand_detail.jpg` — one small (1024px, tileable)
  sand albedo photo, blended into bunker areas the same way the turf detail
  texture blends into fairway/rough (see `course3d.js` shader patch, bunker
  mask).
- **Source:** ambientCG, asset "Ground054" (`Ground054_1K-JPG_Color.jpg`,
  https://ambientcg.com/view?id=Ground054), re-encoded to JPEG q80.
- **License:** CC0 (ambientCG).
- **Used by:** `three3d/course3d.js` only, Four Oaks 3D bunker material.
- **Size:** ~200 KB.
