import * as THREE from "three";
import { MercatorCoordinate } from "mapbox-gl";
import type { LngLat } from "../game/types";

// Build a model matrix that places a Three.js object (Y-up, metres) at a
// geographic location on the mercator map. Axis conventions are the #1 source of
// bugs here — this matches the official Mapbox "Add a 3D model with three.js"
// example (identical to MapLibre's — MercatorCoordinate has the same shape in
// both libs). If the ball appears mirrored / sunk / floating, suspect THIS file
// before anything else.
export function modelMatrix(lngLat: LngLat, altitudeM: number): THREE.Matrix4 {
  const mc = MercatorCoordinate.fromLngLat(lngLat, altitudeM);
  const s = mc.meterInMercatorCoordinateUnits();

  const translate = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z);
  // MapLibre mercator is Z-up-ish with Y flipped vs three.js Y-up; rotate +90°
  // about X so the sphere sits on the ground plane, not standing on the horizon.
  const rotateX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const scale = new THREE.Matrix4().makeScale(s, s, s);

  return translate.multiply(rotateX).multiply(scale);
}
