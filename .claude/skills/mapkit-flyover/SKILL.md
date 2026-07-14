---
name: mapkit-flyover
description: Put Apple's native 3D (MKMapView .satelliteFlyover) behind the game canvas as the ground — iOS-only. Covers the probe-calibrated overlay projection, MapKit clamp traps, and adding a course geo anchor. Use when extending the Apple 3D ground to a new course or debugging the Butter Brook flyover.
---

# Apple MapKit Flyover ground (native iOS 3D)

This is the **highest-fidelity 3D in the project** — Apple's own photogrammetry mesh + imagery, free, on-device. It renders as the *ground* behind the transparent game canvas; the canvas paints only ball/flag/HUD/contours on top. **iOS-only (Capacitor); web/desktop silently falls back to the baked NAIP aerial.** Live today for `butter-brook-golf-club`.

## Architecture

A native `MKMapView` sits **behind** the transparent `WKWebView`. MapKit is dumb/render-only — it never knows about holes. Each frame the web layer computes the camera Apple *should* show and pushes it over a Capacitor bridge; MapKit applies it (with its own clamps), and the web layer reads back what MapKit *actually* did to keep the overlay glued on.

**Files:**
- `ios/App/App/CourseMap3DViewController.swift` — the `MKMapView` owner (class `CourseMap3DLayer`).
  - `enter(into:behind:)` (~L33-66): one `MKMapView`, `mapType = .satelliteFlyover` (~L47), `isUserInteractionEnabled = false`, `insertSubview(mv, belowSubview: webView)`, WKWebView made transparent (`isOpaque=false`, clear backgrounds ~L62-65).
  - `syncCamera(...)` (~L85-142): builds `MKMapCamera(lookingAtCenter:fromDistance:pitch:heading:)`, returns the camera MapKit **actually** applied + probe screen positions.
  - **Probe annotations** (~L146-183): invisible 1×1 `MKAnnotationView`s at requested lat/lons; their laid-out centers are read as ground-truth "where does this coord render." Needed because `MKMapView.convert(_:toPointTo:)` can't see the Flyover pitch anchor.
- `ios/App/App/CourseMap3DPlugin.swift` — Capacitor bridge `@objc(CourseMap3DPlugin)`, jsName **`CourseMap3D`**, methods `enter`/`leave`/`syncCamera`. Inserts the map into `webView.superview` (the window), since `CAPBridgeViewController` sets `view = webView`.
- `capacitor.config.json` (~L24-29): registers `CourseMap3DPlugin` in `packageClassList`. (No `@capacitor` maps/geolocation plugin — MapKit is reached only through this custom plugin.)

## The overlay projection (game.js ~L521-942)

MapKit **silently clamps** the camera (min distance, pitch) and its pitch anchor is **nondeterministic** — the same `MKMapCamera` can render 100-200 px apart across visits. So the overlay is NOT projected from what we requested; it's fit to what MapKit actually did, measured live:

- `buildAppleProj(cssW,cssH)` (~L599-775): replicates the MKMapCamera pinhole in JS (ENU basis, focal `(cssH/2)/tan15°`), folds MapKit's actual clamps back in via `_appleActualCam`, then fits a **least-squares screen affine** onto the native probe answers with outlier rejection + median-of-3 + eased smoothing.
- `appleProjPt` (~L778-792) world→screen; `appleUnproject` (~L797-818) screen→terrain.
- `syncAppleGround()` (~L819-911): throttled ~30fps, sends requested camera + 4 sticky ground probes over the bridge, stores actuals + probe answers for the next fit.
- Constants: `APPLE_CAM_K = 1.866` (=1/(2·tan15°), MapKit's ~30° vFOV), `APPLE_MIN_DIST_M = 165` (Flyover min distance clamp), `APPLE_ANCHOR_DROP_M = 2` (pitch-pivot height above terrain), `TUNE.applePitchDeg = 55`.

## Enable gate

`appleGroundActive()` (game.js ~L529-534) requires ALL of: `course.id === "butter-brook-golf-club"` **AND** `course.geo` present **AND** `mode === "course"` **AND** not a range **AND** `window.Capacitor.isNativePlatform()` **AND** the `CourseMap3D` plugin exists. Pitch is driven by the shared HUD `#tilt-view-btn` (`golf.tiltView`), zoom-adaptive.

## Add a new course

1. **Anchor it**: `python3 tools/geo_anchor_course.py --id <course-id> --near <lat,lon> --write` — solves the world→lon/lat affine from hole PINs and writes `course.geo`.
2. **Generalize the gate**: replace the hardcoded `course.id === "butter-brook-golf-club"` in `appleGroundActive()` with `course.geo && <flyover-coverage>`. Coverage check: Apple Flyover exists for most metro/suburban US + many international areas but NOT everywhere rural — verify in the Apple Maps app first.
3. Test on-device (native only). Watch the overlay glue through a tilt + zoom sweep.

## Gotchas (all learned the hard way)
- `.satellite`/`.hybrid` clamp pitch to **0** — you MUST use `.satelliteFlyover`/`.hybridFlyover` to get 3D.
- Never trust the requested camera for projection — MapKit clamps distance/pitch AND drifts center unreported. Fit to probes.
- Cap zoom so you never request closer than ~165 m, or MapKit clamps and drifts.
- Requires Apple Flyover **coverage** at the location. No coverage = no 3D mesh, just flat satellite.
- All of this only runs in the Capacitor iOS build. See [[3d-tiles]] and [[lidar-terrain]] for the cross-platform / web 3D paths.
