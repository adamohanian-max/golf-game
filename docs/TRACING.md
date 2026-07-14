# Tracing course geometry against Apple's imagery

## Why this exists

Apple's satellite imagery has its own georegistration error — typically a
few meters off true WGS84, and independent of any projection/calibration
work elsewhere in this repo (e.g. the tilted-3D flyover overlay math in
`.claude/skills/mapkit-flyover/`). Geometry traced *inside MapKit, against
Apple's own rendered imagery* is aligned to that imagery by construction —
there's no offset to correct, because none was introduced. Diffing a trace
against the course's existing true-WGS84 geometry (`courses/<id>.json`,
sourced from OSM) then measures Apple's per-course imagery offset. See
`scripts/fit-correction.mjs` / `scripts/apply-correction.mjs`.

True WGS84 stays canonical everywhere in this repo. A trace is an input to
fit a correction, not a replacement for the course's real geometry — see
those scripts' file comments for why.

## Running the tool

```sh
cd mac-tools/CourseTracer
./run.sh
```

Builds, ad-hoc signs, and launches `CourseTracer.app`. (A bare `swift run`
executable doesn't reliably get a window on macOS — always use `run.sh`.)

## Workflow

1. **Course ID** — type the course's id exactly as its `courses/<id>.json`
   filename (no extension), e.g. `butter-brook-golf-club`.
2. **Hole** — set the hole number for the feature you're about to trace.
3. **Feature Kind** — green / tee / bunker / fairway / water / cartpath.
4. **Pan, don't click-to-place.** The crosshair is fixed at the screen
   center. Pan the map under it (drag) until the crosshair sits exactly on
   the vertex you want, then **Add Point** (Space). This is the whole
   precision model — MapKit's `convert(_:toCoordinateFrom:)` at the crosshair
   is exact because camera pitch is locked to 0 for the entire session (no
   pitch-anchor nondeterminism to fight, unlike the pitched flyover overlay).
5. Repeat pan+Add Point around the feature's boundary. **Undo Last Point**
   (Cmd-Z) removes the most recent vertex if you misplace one.
6. **Close Polygon** (Enter) once you have at least 3 points. This commits
   the shape as a feature and clears the in-progress vertex list.
7. **Delete Last Feature** removes the most recently closed feature
   entirely, if you need to redo one.
8. Repeat for every green/tee (and any other kind you want) on the course.
9. **Export GeoJSON** (Cmd-E) writes everything traced so far to
   `data/traced/{courseId}-apple.geojson`.

Zoom to MapKit's maximum before tracing each feature — the tighter the zoom,
the smaller the pixel error in where the crosshair actually sits.

## The green-boundary convention

Trace the **collar** — the outer edge of the maintained putting surface, as
a visibly distinct grass texture/mowing pattern in the imagery — not the
fringe cut around it. Apply this identically on every green, every course,
every session. Consistency here matters more than which exact edge you pick,
because `fit-correction.mjs` is measuring a systematic offset across many
features; an inconsistent convention adds noise that looks like georegistration
error but isn't.

## Expected time

Roughly 20-40 minutes per course for greens + tees on all holes. Bunkers,
fairways, water, and cartpaths are supported by the tool but are not yet
consumed by `fit-correction.mjs` (see that script's comments — `courses/*.json`
doesn't tag `surfaces.*` polygons by hole today, so there's no per-hole true
geometry to match them against yet).

## Next step

Once a course is traced and exported:

```sh
node scripts/fit-correction.mjs --course <id> \
  --traced data/traced/<id>-apple.geojson
```

This writes `data/corrections/<id>.json`. Read its printed per-feature
residuals — a feature with an unusually large residual is either a bad trace
or, in Butter Brook's specific case, hole 3's tee (hand-placed from Apple
imagery earlier, not sourced from OSM — see that script's comments — so it's
not independent ground truth and will partially measure "how far off was the
eyeball" rather than pure imagery registration).

## Limitations (v1)

No vertex dragging, no snapping, no multi-select, no re-editing a closed
polygon — if you close a polygon wrong, delete it (Delete Last Feature) and
retrace it.
