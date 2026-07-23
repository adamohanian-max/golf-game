/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

// Single-page viewer. `public/tiles/<courseId>/…` (LiDAR Terrarium output from
// tools/bake_lidar.py) is served statically by Vite from public/.
export default defineConfig({
  build: {
    target: "es2020",
    // Multi-page: the Mapbox viewer (index.html) + the Google 3D Tiles viewer
    // (g3d.html) are independent entries. Dev serves both; `npm run build`
    // emits both.
    rollupOptions: {
      input: {
        main: "index.html",
        g3d: "g3d.html",
      },
    },
  },
  test: {
    // vitest — ball.ts is pure TS, node env is enough (no DOM).
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
