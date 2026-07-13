/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Single-page viewer. `public/tiles/<courseId>/…` (LiDAR Terrarium output from
// tools/bake_lidar.py) is served statically by Vite from public/.
export default defineConfig({
  build: { target: "es2020" },
  test: {
    // vitest — ball.ts is pure TS, node env is enough (no DOM).
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
