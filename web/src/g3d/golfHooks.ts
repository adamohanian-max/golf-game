// Golf-oriented hooks over the photoreal tile mesh. Deliberately thin stubs —
// enough for later ball/terrain interaction and one-call course switching,
// nothing over-built. See NOTES.md for the gameplay limitations of this mesh.

import { Raycaster, Vector3 } from "three";
import type { ViewerHandle } from "./viewer.js";
import type { CourseConfig } from "./config.js";

const _ray = new Raycaster();
const _down = new Vector3(0, -1, 0);
const _origin = new Vector3();

/**
 * Ground height (world Y) under scene-space (x, z) by raycasting straight down
 * onto the loaded tile mesh. Returns null if tiles aren't loaded / no hit yet.
 *
 * Casts from high above so we always start above terrain; the mesh is
 * photogrammetry, so this is visual-surface height, not a physics collider.
 */
export function getGroundHeightAt(
  viewer: ViewerHandle,
  x: number,
  z: number,
  fromHeight = 10000,
): number | null {
  _origin.set(x, fromHeight, z);
  _ray.set(_origin, _down);
  const hits = _ray.intersectObject(viewer.tiles.group, true);
  return hits.length > 0 ? hits[0].point.y : null;
}

/**
 * Switch the backdrop to another course in one call. Thin pass-through to the
 * viewer's reorientation-based re-center + camera reset.
 */
export function loadCourse(viewer: ViewerHandle, config: CourseConfig): void {
  viewer.loadCourse(config);
}
