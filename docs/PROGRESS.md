# Progress notes

## 2026-08-05 — Apple MapKit ground removed; Google 3D Tiles is the only photoreal ground

The Apple Flyover ground and everything built around it were deleted. The three
courses it served (`butter-brook-golf-club`, `liberty-national-golf-club`,
`torrey-pines-south-course`) moved onto Google Photorealistic 3D Tiles alongside
Pebble Beach. See the CLAUDE.md entry above the gtiles framing section for the
full rationale and for the three symbols that survived the cut because the
Google path uses them (`geoAffine`, `CAM_K`, `BALL_DRAW_UNITS`).

**Deleted with it:** `ios/App/App/CourseMap3D{Plugin,ViewController}.swift`, the
`CourseMap3D` Capacitor plugin registration, `mac-tools/CourseTracer/` (the
macOS imagery tracer), `scripts/fit-correction.mjs`,
`scripts/apply-correction.mjs`, `scripts/test-apple-geo-affine.mjs`,
`scripts/fix-butter-brook-*.mjs`, `data/traced/`, `data/corrections/`,
`docs/TRACING.md`, and the four `.claude/skills/mapkit-*` skills.

### Retires the 2026-07-14 entry (Apple-imagery tracer + correction fitting)

That entry documented a macOS SwiftUI/MKMapView tracing app plus
`fit-correction.mjs` / `apply-correction.mjs`, built to measure Apple's
*satellite-imagery* georegistration offset per course (~1–5 m off true WGS84)
and fold it into every derived lat/lon — distinct from, and on top of, the
true-WGS84 anchoring `tools/geo_anchor_course.py` does.

The premise does not carry over. **Google's photoreal mesh is georeferenced to
true WGS84**, which is exactly what `courses/*.json` already stores, so there is
nothing to correct: `geoAffine()` now returns `course.geo.toLonLat` unmodified.
Applying an Apple-fitted offset to Google's mesh would actively *misregister* it,
which is why `data/corrections/butter-brook-golf-club.json` was deleted rather
than kept.

Nothing measured was lost. That entry recorded the pipeline as verified only
against synthetic fixtures, with the real work explicitly untested — no course
had ever been traced end-to-end, and whether a real trace was *accurate* was
called out as a manual judgment nobody had made yet.

**Still true, and still the anchoring tool:** `tools/geo_anchor_course.py` writes
`course.geo` — true WGS84, canonical, and required by gtiles. It is unrelated to
the deleted imagery-correction path and was not touched.
