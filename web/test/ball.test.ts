import { describe, it, expect } from "vitest";
import { Ball } from "../src/game/ball";
import type { LngLat } from "../src/game/types";

const START: LngLat = [-104.85, 38.79];
const M_PER_DEG_LAT = 110540;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function metresBetween(a: LngLat, b: LngLat): number {
  const dE = (b[0] - a[0]) * mPerDegLon(a[1]);
  const dN = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(dE, dN);
}

/** Run the ball to rest, capped so a bug can't hang the suite. */
function runToRest(ball: Ball, maxFrames = 6000): number {
  let f = 0;
  while (ball.state !== "rest" && ball.state !== "holed" && f < maxFrames) {
    ball.update();
    f++;
  }
  return f;
}

describe("Ball", () => {
  it("lands roughly where a known launch should carry", () => {
    const ball = new Ball(START);
    // due north, 42 m/s, 14deg — a mid-iron-ish carry. Expect ~130-190m total.
    ball.hit(0, 42, 14);
    runToRest(ball);
    const d = metresBetween(START, ball.lngLat);
    expect(d).toBeGreaterThan(120);
    expect(d).toBeLessThan(220);
    // launched due north => stays essentially on the meridian
    expect(Math.abs(ball.lngLat[0] - START[0])).toBeLessThan(1e-4);
    expect(ball.lngLat[1]).toBeGreaterThan(START[1]);
  });

  it("comes to rest (no infinite roll)", () => {
    const ball = new Ball(START);
    ball.hit(45, 50, 12);
    const frames = runToRest(ball);
    expect(ball.state).toBe("rest");
    expect(frames).toBeLessThan(6000);
    expect(ball.groundSpeed).toBe(0);
  });

  it("transitions teed -> flying -> rolling -> rest", () => {
    const ball = new Ball(START);
    expect(ball.state).toBe("teed");
    ball.hit(0, 40, 15);
    expect(ball.state).toBe("flying");

    const seen = new Set<string>([ball.state]);
    for (let i = 0; i < 6000 && ball.state !== "rest"; i++) {
      ball.update();
      seen.add(ball.state);
    }
    expect(seen.has("flying")).toBe(true);
    expect(seen.has("rolling")).toBe(true);
    expect(ball.state).toBe("rest");
  });

  it("never lets heightAboveGround go negative", () => {
    const ball = new Ball(START);
    ball.hit(30, 55, 20);
    for (let i = 0; i < 6000 && ball.state !== "rest"; i++) {
      ball.update();
      expect(ball.heightAboveGround).toBeGreaterThanOrEqual(0);
    }
  });

  it("reset returns the ball to the tee", () => {
    const ball = new Ball(START);
    ball.hit(0, 45, 14);
    runToRest(ball);
    ball.reset();
    expect(ball.state).toBe("teed");
    expect(ball.lngLat).toEqual(START);
    expect(ball.heightAboveGround).toBe(0);
  });
});
