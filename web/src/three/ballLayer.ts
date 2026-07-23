import * as THREE from "three";
import type { CustomLayerInterface, Map as MBMap } from "mapbox-gl";
import { modelMatrix } from "./modelMatrix";
import { Ball } from "../game/ball";
import type { Hole } from "../game/types";

// Radius in metres. Spec §6 uses 1m as a placeholder; a real golf ball (~21mm)
// is invisible from broadcast distance, a 1m sphere is a beach ball (Gate B
// fails both). 0.45m reads as a ball at this camera range without looking absurd.
const BALL_RADIUS_M = 0.45; // reads as a ball at this camera range without looking absurd

export interface BallLayer extends CustomLayerInterface {
  ball: Ball;
}

// The ONE Three.js custom layer (spec §1, §6): the ball is the only thing that
// moves through 3D space with an arc and must be occluded by hills, so it's the
// only thing that justifies Three.js. renderingMode '3d' is required for terrain
// depth/occlusion.
export function makeBallLayer(hole: Hole): BallLayer {
  const ball = new Ball(hole.ballStart);
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.Camera;
  let map: MBMap;

  return {
    id: "ball",
    type: "custom",
    renderingMode: "3d",
    ball,

    onAdd(m, gl) {
      map = m;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(0, -1, 1).normalize();
      scene.add(sun);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_RADIUS_M, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
      );
      scene.add(mesh);

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGLRenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;
    },

    render(_gl, matrix) {
      // Advance ball; sample terrain so it sits on the ground. queryTerrainElevation
      // returns null until DEM tiles load — guard with ?? 0.
      ball.update();
      const groundM = map.queryTerrainElevation(ball.lngLat) ?? 0;
      const alt = groundM + ball.heightAboveGround;

      const l = modelMatrix(ball.lngLat, alt);
      // Mapbox GL v3: render(gl, matrix) passes the projection matrix POSITIONALLY
      // (a number[] / Float64Array of the camera projection). This differs from
      // MapLibre v5's args.defaultProjectionData.mainMatrix — the one behavioral
      // diff in the port. Everything else (shared context, renderingMode '3d',
      // queryTerrainElevation, modelMatrix) is identical across both libs.
      const m = new THREE.Matrix4().fromArray(matrix as number[]);
      camera.projectionMatrix = m.multiply(l);

      renderer.resetState();
      renderer.render(scene, camera);
      map.triggerRepaint(); // keep the animation loop alive
    },
  };
}
