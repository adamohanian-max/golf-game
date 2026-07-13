// Shared data model. No renderer imports — this file is safe to reuse anywhere.

export type LngLat = [number, number];

/** A course record. `terrainTiles` is the LiDAR Terrarium pyramid URL from
 *  tools/bake_lidar.py; null/undefined => viewer falls back to the coarse global
 *  DEM (spec §4). Nullable is what makes LiDAR opt-in per course. */
export interface Course {
  id: string;
  name: string;
  center: LngLat;
  /** e.g. "/tiles/pinehurst-no2/{z}/{x}/{y}.png" — or null for global fallback. */
  terrainTiles?: string | null;
  /** LiDAR acquisition date (ISO). Surface staleness — greens get rebuilt. */
  lidarDate?: string | null;
}

export type FeatureKind = "tee" | "green" | "fairway" | "bunker" | "water" | "slope";

export interface HoleFeatureProps {
  kind: FeatureKind;
  /** slope only: downhill direction, degrees from north. */
  bearing?: number;
  /** slope only: slope percent. */
  magnitude?: number;
}

export interface Hole {
  id: string;
  ballStart: LngLat;
  pin: LngLat;
  featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry, HoleFeatureProps>;
}

export type BallState = "teed" | "flying" | "rolling" | "rest" | "holed";
