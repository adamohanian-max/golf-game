// Facade bundled (with three baked IN, not external) into
// ../../vendor/gtiles/gtiles.js by scripts/build-gtiles.mjs, for the root
// bundler-free game to consume via importmap ("gtiles").
//
// WHY three is bundled here rather than shared: the root app vendors three r160
// (vendor/three/three.module.min.js), but 3d-tiles-renderer@0.5.0 needs
// three >=0.167. Bumping the shared root three would force re-vendoring three +
// all addons and risk regressing course3d.js / mbox3d.js. Instead this bundle
// carries its OWN isolated three@0.179; three3d/gtiles3d.js imports THREE from
// here, never from the importmap. Safe because the gtiles engine only outputs
// screen-pixel numbers across the bridge — no three objects cross into game.js.

export * as THREE from "three";

export { TilesRenderer, GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
export {
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  UnloadTilesPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
