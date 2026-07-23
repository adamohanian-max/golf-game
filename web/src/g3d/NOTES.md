# NOTES — gameplay limitations of the Google 3D Tiles mesh

The Google Photorealistic mesh is **photogrammetry**, not a hand-authored game
world. Consequences for golf gameplay:

- **Blobby trees / soft geometry.** Trees, hedges, and thin structures are
  reconstructed as fused blobs — no crisp trunks, no per-tree separation. Fine
  as a backdrop, wrong as collision geometry.
- **No per-object colliders.** The scene is one big textured mesh. There are no
  labeled surfaces (green/fairway/bunker), no per-tree colliders, no cup.
- **Baked lighting.** Shadows and shading are baked into the texture. Dynamic
  lights won't relight the mesh; added (non-baked) game objects will look lit
  differently — keep scene lights gentle (as `viewer.ts` does).
- **LOD popping.** Detail streams in by distance; expect tiles to sharpen/fade
  as the camera moves (`TilesFadePlugin` softens this).
- **Coverage gaps.** Rural courses may return terrain-only or nothing. This is
  expected — the viewer surfaces a coverage banner, it is not a crash.

## Gameplay hooks provided (stubs)
- `getGroundHeightAt(viewer, x, z)` — raycasts straight down onto the tile mesh,
  returns visual-surface height (world Y) or `null` if tiles aren't loaded. This
  is the **visual** surface, not a physics surface.
- `loadCourse(viewer, config)` — one call re-centers to a new lat/lon + resets
  the camera.

## How to layer real gameplay on top later
1. **Physics surface**: keep the game's existing baked per-course geometry
   (`courses/<id>.json` surfaces + the `dem` grid) as the source of truth for
   lie/friction/slope. Use the tile mesh purely as the visual backdrop; align it
   to the course world via the same lat/lon anchor the game already stores.
2. **Placed + collidable trees**: scatter game-owned tree instances from the
   course's WOODS mask (the game already has `buildTrees`/canopy data) on top of
   the photoreal ground, so trees have real colliders and read crisply.
3. **Ball occlusion**: because the ball is a separate three.js object over the
   mesh, depth-testing against the tile mesh gives free occlusion behind terrain
   /buildings — no extra work.
4. **Ground height for the ball**: prefer the course `dem` for physics; use
   `getGroundHeightAt` only to visually seat props on the photoreal surface.
