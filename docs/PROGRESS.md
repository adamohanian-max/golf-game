# Progress notes

## 2026-07-14 — Apple-imagery tracer + correction-fitting tool

Built a standalone dev tool for measuring and correcting Apple Maps'
satellite-imagery georegistration offset per course, distinct from and in
addition to the true-WGS84 anchoring `tools/geo_anchor_course.py` already
does. See `docs/TRACING.md` for the concept and operator workflow.

**Built:**
- `mac-tools/CourseTracer/` — SwiftUI + MKMapView macOS app. Pan-under-fixed-
  crosshair tracing (not click-to-place), pitch locked to 0, 6 feature kinds,
  hole tagging, GeoJSON export to `data/traced/{courseId}-apple.geojson`
  matching `docs/web_course_viewer_spec.md` §8's schema exactly (`frame:
  "apple"` on every feature).
- `docs/TRACING.md` — operator guide, states the green-collar-not-fringe
  convention explicitly.
- `scripts/fit-correction.mjs` — matches traced green/tee features against
  each hole's true-WGS84 `pin`/`tee` (projected through `courses/<id>.json`'s
  `geo.toLonLat`), fits a Model B constant offset, reports RMSE + per-feature
  residuals + a spatial-trend correlation, writes
  `data/corrections/<courseId>.json`.
- `scripts/apply-correction.mjs` — shifts a true-WGS84 FeatureCollection by a
  fitted correction, asserts on `properties.frame` rather than assuming it,
  retags output `frame: "apple"`.

**What was verified mechanically:**
- The app builds (`swift build`) and runs (`./run.sh`) as a real, focusable,
  window-presenting macOS app — this needed a manual `.app` bundle wrapper
  (a bare SPM executable never gets a window on this machine) and an
  explicit non-zero initial `MKMapView` frame (a zero-frame map view's
  internal Metal tile layer silently never paints, independent of chrome —
  the map otherwise looked "alive": camera, scale bar, and Apple attribution
  all rendered while the imagery itself stayed flat black).
- Panning the map with a real OS-level drag actually moves the imagery under
  the fixed crosshair (confirmed via screenshot diff).
- A full trace → close polygon → export cycle was driven end-to-end through
  the live UI (via the app's own Trace menu, not synthetic taps on
  `mapView.convert` directly) and produced a `data/traced/*.geojson` file
  that passed a structural schema check (`type: "FeatureCollection"`, each
  feature has `properties.kind`/`properties.hole`/`properties.frame ===
  "apple"`, `geometry.type === "Polygon"`, closed ring, coordinates in
  range). That dummy trace was deleted afterward — it has 3 duplicate
  vertices at the crosshair's start position, not real geometry.
- `fit-correction.mjs` was run against a hand-built synthetic fixture with a
  known, injected `(dLat, dLng)` and zero noise: it recovered the injected
  offset exactly and reported RMSE ≈ 0. Also run against a variant with an
  injected per-feature offset trend to sanity-check the RMSE/residual math
  under non-degenerate input.
- `apply-correction.mjs` was run against a small synthetic WGS84
  `FeatureCollection`: output coordinates matched the fitted delta to better
  than 1e-12°, `frame` was retagged `"apple"` on every feature (including one
  that started with no `frame` field at all), and it was confirmed to throw
  (refusing to write output) when given a feature already tagged
  `frame: "apple"`.
- All synthetic fixtures and test output were deleted after verification —
  `data/traced/` and `data/corrections/` are empty (`.gitkeep` only) as of
  this entry.

**What is explicitly untested — this requires a human at the keyboard:**
No course has actually been traced yet. Whether a real trace is *accurate* —
does a traced green polygon actually sit on the real green in Apple's
imagery — is a visual, manual judgment call that can't be verified by
running a script. Nobody has yet: traced a real course end-to-end, run
`fit-correction.mjs` against real trace output, or inspected whether a real
course's fitted `dLat`/`dLng`/RMSE numbers are sane (small offset, low
residual). The tool runs and exports correctly-shaped data; whether the
geometry it produces is a *good trace* is unverified.
