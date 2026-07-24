// Bundle the gtiles facade (3d-tiles-renderer + three@0.179, three BAKED IN) into
// a single self-contained ESM the root bundler-free game loads via importmap.
//
// Output: ../../vendor/gtiles/gtiles.js  (importmap key "gtiles")
// Run:    cd web && node scripts/build-gtiles.mjs   (or: npm run build:gtiles)
//
// three is intentionally NOT external — see vendor-src/gtiles-facade.js for why
// (root app vendors three r160, renderer needs >=0.167; this bundle isolates
// its own three@0.179 so the shared root three stays untouched).
//
// esbuild is invoked via `npx` so no devdep is required in web/.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "../vendor-src/gtiles-facade.js");
const outdir = resolve(__dirname, "../../vendor/gtiles");
const outfile = resolve(outdir, "gtiles.js");

mkdirSync(outdir, { recursive: true });

const args = [
  "--yes",
  "esbuild@0.24.0",
  entry,
  "--bundle",
  "--format=esm",
  "--platform=browser",
  "--target=es2020",
  "--minify",
  "--legal-comments=none",
  `--outfile=${outfile}`,
];

const r = spawnSync("npx", args, { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("built", outfile);
