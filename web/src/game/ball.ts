// Framework-agnostic ball state + physics. Imports NOTHING from maplibre or
// three — this is the reusable engine (iOS can lift it verbatim). It knows
// geography (lng/lat, metres, bearings) and physics, nothing about rendering.
//
// Model is "close enough to look right", not a real aero solution (spec §7):
//   flying  -> ballistic arc with light linear drag + gravity
//   rolling -> ground friction until below a stop threshold
//   rest    -> settled
// heightAboveGround is metres above the terrain surface; the renderer adds it to
// the sampled ground elevation. It is never negative.

import type { LngLat, BallState } from "./types";

const G = 9.81;                 // m/s^2
const DRAG = 0.06;              // linear air drag coefficient (per second)
const BOUNCE_RESTITUTION = 0.35; // vertical energy kept on first ground contact
const ROLL_FRICTION = 3.2;      // m/s^2 deceleration while rolling
const STOP_SPEED = 0.4;         // m/s below which a roll settles to rest
const DT = 1 / 60;              // fixed internal integration step (seconds)

const M_PER_DEG_LAT = 110540;
function mPerDegLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export class Ball {
  lngLat: LngLat;
  heightAboveGround = 0;
  state: BallState = "teed";

  // velocity in a local ENU frame, m/s
  private vE = 0;
  private vN = 0;
  private vUp = 0;

  private readonly start: LngLat;

  constructor(start: LngLat) {
    this.start = [start[0], start[1]];
    this.lngLat = [start[0], start[1]];
  }

  /** Reset to the tee. */
  reset(): void {
    this.lngLat = [this.start[0], this.start[1]];
    this.heightAboveGround = 0;
    this.vE = this.vN = this.vUp = 0;
    this.state = "teed";
  }

  /** Launch. bearing = degrees from north (cw), speed = m/s, launch = degrees
   *  above horizontal. */
  hit(bearingDeg: number, speed: number, launchDeg: number): void {
    if (this.state === "flying" || this.state === "rolling") return;
    const b = (bearingDeg * Math.PI) / 180;
    const l = (launchDeg * Math.PI) / 180;
    const horiz = speed * Math.cos(l);
    this.vUp = speed * Math.sin(l);
    this.vE = horiz * Math.sin(b);
    this.vN = horiz * Math.cos(b);
    this.heightAboveGround = 0.01; // just off the deck so the first step flies
    this.state = "flying";
  }

  /** Advance one animation frame. Call once per rendered frame. */
  update(): void {
    if (this.state === "flying") this.stepFlight();
    else if (this.state === "rolling") this.stepRoll();
    // teed / rest / holed: nothing to integrate
  }

  private stepFlight(): void {
    // integrate the arc
    this.vUp -= G * DT;
    this.vE *= 1 - DRAG * DT;
    this.vN *= 1 - DRAG * DT;
    this.heightAboveGround += this.vUp * DT;
    this.advanceGround(this.vE * DT, this.vN * DT);

    if (this.heightAboveGround <= 0) {
      this.heightAboveGround = 0;
      if (this.vUp < 0 && -this.vUp > 1.5) {
        // bounce: keep some vertical, shed horizontal
        this.vUp = -this.vUp * BOUNCE_RESTITUTION;
        this.vE *= 0.6;
        this.vN *= 0.6;
      } else {
        this.vUp = 0;
        this.state = "rolling";
      }
    }
  }

  private stepRoll(): void {
    const speed = Math.hypot(this.vE, this.vN);
    if (speed < STOP_SPEED) {
      this.vE = this.vN = 0;
      this.state = "rest";
      return;
    }
    const decel = ROLL_FRICTION * DT;
    const k = Math.max(0, (speed - decel) / speed);
    this.vE *= k;
    this.vN *= k;
    this.advanceGround(this.vE * DT, this.vN * DT);
  }

  private advanceGround(dEastM: number, dNorthM: number): void {
    const lat = this.lngLat[1];
    this.lngLat = [
      this.lngLat[0] + dEastM / mPerDegLon(lat),
      this.lngLat[1] + dNorthM / M_PER_DEG_LAT,
    ];
  }

  /** Horizontal ground speed, m/s (test/debug helper). */
  get groundSpeed(): number {
    return Math.hypot(this.vE, this.vN);
  }
}
