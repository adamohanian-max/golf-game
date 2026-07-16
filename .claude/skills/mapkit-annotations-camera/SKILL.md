---
name: mapkit-annotations-camera
description: Native MapKit annotation-view, camera, and map-configuration API reference distilled from a full crawl of Apple's docs — every MKAnnotationView/MKMapCamera member, conversion-method caveats, and where docs confirm or stay silent on this game's empirical findings (implicit annotation animation, flyover anchor nondeterminism). Use when working on the flag annotation, probe calibration, or camera bridge.
---

# Native MapKit: annotations, camera, display control

Distilled 2026-07 from a full crawl of Apple's doc JSON backend
(`developer.apple.com/tutorials/data/documentation/mapkit/<path>.json`). Doc paths below are
relative to `developer.apple.com/documentation/mapkit/`. Companion skills: `mapkit-flyover`
(our empirical rig), `mapkit-overlays` (renderer side).

## MKAnnotationView (`mkannotationview`) — iOS 3+

Class overview facts that matter to us:
- Views are **loosely coupled** to their `MKAnnotation`; may be recycled through a reuse queue.
- Easiest content path: set `image` — the view auto-sizes its frame to the image (frame origin
  unchanged). If you override `draw(_:)` without an image, frame defaults to **0×0** — you must
  set a nonzero frame yourself (our `FlagAnnotationView` draws custom → must size frame).
- "Annotation views anchor to the map at the point their annotation specifies. Although they
  **scroll with the map contents, annotation views reside in a separate display layer** and don't
  scale when the visible region changes." (`mkannotationview` Overview) — this separate-layer fact
  is the closest the docs come to explaining tile-vs-annotation motion decoupling.

Members (each at `mkannotationview/<member>`):
- `centerOffset: CGPoint` — map places the **view's center** at the annotation coordinate; offset
  in points, +x right / +y **down**. This is the documented anchor mechanism (our flag pole-base
  anchoring is the intended use).
- `calloutOffset: CGPoint` — moves the callout anchor from top-center of the frame. Ignored on
  macOS (use `leftCalloutOffset`/`rightCalloutOffset` there).
- `zPriority: MKAnnotationViewZPriority` (iOS 14+) — z-axis ordering while **unselected**; default
  `.defaultUnselected`. `selectedZPriority` (iOS 14+) — same for selected state, default
  `.defaultSelected`. `MKAnnotationViewZPriority` constants: `.min`, `.defaultUnselected`,
  `.defaultSelected`, `.max`; float rawValue, `init(_:)`/`init(rawValue:)` for in-between values.
- `displayPriority: MKFeatureDisplayPriority` (iOS 11+) — **default is `.required`** for base
  MKAnnotationView ("always visible"); lower priorities can be **hidden entirely** on collision
  (loser = lower priority, tie → view farther from view center hides). `.required` views also
  **do not participate in clustering** (`mkfeaturedisplaypriority/required`). NOTE:
  `MKMarkerAnnotationView`'s default is `.defaultLow` (its class page says so) — markers can vanish.
- `collisionMode` (iOS 11+): `.rectangle` (full collision frame), `.circle` (inscribed circle),
  `.none` (iOS 14+, collisions can't occur). Property page has no default stated; enum at
  `mkannotationview/collisionmode-swift.enum`.
- `clusteringIdentifier: String?` (iOS 11+) — default nil = never clusters; non-nil views with the
  same id that collide are replaced by a cluster annotation view. `cluster: MKAnnotationView?` —
  the replacing cluster view; nil while this view itself is displayed.
- Dragging: `isDraggable` (default false; annotation must implement `setCoordinate:`; once a drag
  starts it must run to completion — you can't cancel from `starting`), `dragState` property +
  `setDragState(_:animated:)` (override the setter on iOS ≥4.2; you are responsible for advancing
  `starting → dragging` and `ending/canceling → none` after your animations). `DragState` cases:
  `none, starting, dragging, canceling, ending`. Delegate: `mapView(_:annotationView:didChange:fromOldState:)`.
- Reuse/lifecycle: `init(annotation:reuseIdentifier:)`; `prepareForReuse()` (called when the view
  comes OFF the reuse queue; default does nothing); `prepareForDisplay()` (iOS 11+, "map view is
  about to display it" — the sample code sets displayPriority/tint here); `reuseIdentifier`;
  `annotation` (don't set directly; **non-nil only while visible on the map** — nil when queued.
  Direct implication for our probes: `view(for:)` readbacks only work for on-screen annotations).
- Selection: `isSelected`, `setSelected(_:animated:)`, delegate `mapView(_:didSelect:)` — two
  variants: view-based (iOS 4+) and annotation-based (iOS 16+), same for `didDeselect`.
- Callouts: `canShowCallout` (needs non-empty title or view acts disabled), `left/rightCalloutAccessoryView`,
  `detailCalloutAccessoryView` (iOS 9+), `accessoryOffset`, delegate
  `mapView(_:annotationView:calloutAccessoryControlTapped:)`.
- `isEnabled`, `isHighlighted`, `image`.
- **There is NO `anchorPoint` member.** `mkannotationview/anchorpoint` 404s in the doc backend.
  (SwiftUI `Annotation(_:coordinate:anchor:)` has an anchor; UIKit MKAnnotationView only has
  `centerOffset`.) Don't go looking for it.

## MKAnnotation / concrete annotations

- `MKAnnotation` protocol (`mkannotation`): only `coordinate` required; **must be KVO-compliant**
  (`@objc dynamic` in Swift) — that KVO is how the map view tracks coordinate changes. `title`/
  `subtitle` optional.
- `MKPointAnnotation`: trivial concrete class; `init(coordinate:)`, `init(coordinate:title:subtitle:)`.
- `MKMarkerAnnotationView` (iOS 11+): Maps-app balloon marker. `markerTintColor`, `glyphText`,
  `glyphImage`, `selectedGlyphImage`, `glyphTintColor`, `titleVisibility`/`subtitleVisibility`
  (`MKFeatureVisibility: .adaptive/.hidden/.visible`), `animatesWhenAdded` (default false).
  Default `displayPriority = .defaultLow` — see above.
- `MKPinAnnotationView`: **deprecated iOS 16 / macOS 13** — "use an MKAnnotationView to create a
  custom map annotation". (`pinTintColor`, `animatesDrop` legacy only.)
- `MKUserLocation`: annotation object for the user dot (`location`, `isUpdating`, `heading`,
  `title`/`subtitle`); appears in `mapView(_:viewFor:)` — return nil for the system view.

## Annotation plumbing on MKMapView

- `mapView(_:viewFor:)` — dequeue rather than create; return nil → standard pin (or system user-dot).
- `register(_:forAnnotationViewWithReuseIdentifier:)` (iOS 11+) — register class **before adding
  annotations**; then `dequeueReusableAnnotationView(withIdentifier:for:)` creates/reuses and
  auto-assigns the annotation (throws if identifier unregistered). Legacy
  `dequeueReusableAnnotationView(withIdentifier:)` returns nil if queue empty.
  Constants `MKMapViewDefaultAnnotationViewReuseIdentifier` / `...ClusterAnnotationViewReuseIdentifier`.
- `mapView(_:didAdd: [MKAnnotationView])` — views already added by call time.
- `view(for annotation:) -> MKAnnotationView?` — **nil if not yet created OR annotation outside the
  visible region** (documented). Our probe readback relies on this; keep probes inside the viewport.
- `annotations`, `addAnnotation(s)`, `removeAnnotation(s)`, `annotations(in: MKMapRect)`,
  `selectedAnnotations`, `selectAnnotation(_:animated:)`, `deselectAnnotation(_:animated:)`,
  `annotationVisibleRect: CGRect` (the rect where annotation views are being displayed),
  `showAnnotations(_:animated:)` (sets region to fit).
- Clustering article (`decluttering-a-map-with-mapkit-annotation-clustering`, sample "TANDm"):
  set `clusteringIdentifier` in the view's init; tune `displayPriority` in `prepareForDisplay()`;
  customize the cluster via `mapView(_:clusterAnnotationForMemberAnnotations:) -> MKClusterAnnotation`.
- `annotating-a-map-with-custom-data` article: `@objc dynamic var coordinate` for KVO; title
  required if `canShowCallout`.

## MKMapCamera (`mkmapcamera`) — iOS 7+

Assigning a camera re-centers the map at `centerCoordinate` and folds pitch+altitude into the
computed visible region.
- `centerCoordinate` — coordinate at the **view center**. "When pitch is 0 this also corresponds to
  the geographic position of the camera. Changing pitch to nonzero **moves the camera** but doesn't
  affect this property." I.e. it is a look-at point, not an eye point.
- `centerCoordinateDistance` (iOS 13+) — **line-of-sight distance** center→camera, meters.
- `altitude` — **deprecated iOS 27**, "use centerCoordinateDistance". Its page: can't be < 0;
  "changing this property may also change the **maximum pitch**; if current pitch exceeds the new
  max, the class clamps `pitch` to the new maximum."
- `pitch` — degrees; 0 = straight down. Two documented clamps: (1) "**If the map type is satellite
  or hybrid, the object clamps the pitch value to 0**." (2) "The class may clamp the value to a
  maximum to maintain readability. There's **no fixed maximum** — the actual maximum depends on the
  altitude of the camera." Docs still speak in `mapType` terms; there is NO per-configuration pitch
  statement (nothing saying flyover/`.realistic` honors pitch — that's empirical).
- `heading` — degrees from true north (90 = top of view faces east).
- Inits: `init(lookingAtCenter:fromDistance:pitch:heading:)` (iOS 9+; doc gives the relation
  **altitude = distance × cos(pitch)**), `init(lookingAtCenter:fromEyeCoordinate:eyeAltitude:)`
  (computes pitch+heading from eye→center geometry; eye == center → straight down),
  `init(lookingAt:forViewSize:allowPitch:)` (iOS 16+, from MKMapItem).
- `MKMapView.camera` (`@NSCopying`!): "Assigning a new camera **updates the map immediately and
  without animating the change**." Never nil; restore flat with pitch 0. `setCamera(_:animated:)`
  to animate. NSCopying means each `mv.camera = c` copies `c` — mutating `c` afterward does nothing
  until reassigned.
- `isPitchEnabled` / `isRotateEnabled` — when false the map **ignores** the camera's pitch/heading
  entirely (not just gestures — "the map ignores the camera's pitch angle and displays as if
  looking straight down"). "In an app, be sure to check `isPitchEnabled` to determine whether a map
  can support 3D." `isZoomEnabled`/`isScrollEnabled` by contrast gate **user gestures only** —
  programmatic changes still work.

## Camera constraints (iOS 13+)

- `MKMapView.CameraZoomRange` — `init(minCenterCoordinateDistance:maxCenterCoordinateDistance:)`
  (either alone also available); constrains user zoom in **centerCoordinateDistance meters**;
  reusable across map views. `MKMapCameraZoomDefault` = "no limit in this direction".
- `MKMapView.CameraBoundary` — `init(coordinateRegion:)` or `init(mapRect:)`; "constrains the
  **center point** of the map" (edges may still show outside).
- Apply via `cameraZoomRange` / `cameraBoundary` properties (both `@NSCopying`; zoomRange is
  implicitly-unwrapped, boundary optional) or `setCameraZoomRange(_:animated:)` /
  `setCameraBoundary(_:animated:)` (nil resets). Could hard-fence our hole camera; note constraints
  are documented against user camera positions — we drive per-frame programmatically anyway.

## Map configurations & display control

- `preferredConfiguration: MKMapConfiguration` (`@NSCopying`, iOS 16+) replaces `mapType`
  (**deprecated iOS 27**, as are `pointOfInterestFilter`, `showsBuildings`, `altitude` etc. — the
  dep@27 wave pushes everything to configurations).
- `MKMapConfiguration` (abstract): `elevationStyle` — `.flat` | `.realistic` ("realistic ground
  contours"). That two-line enum is ALL the docs say; no behavior contract for what realistic
  changes (terrain mesh, pitch behavior, anchor sampling — all undocumented).
- Subclasses: `MKStandardMapConfiguration` (also `emphasisStyle` `.default/.muted`,
  `pointOfInterestFilter`, `showsTraffic`), `MKImageryMapConfiguration` (**only** `init()` /
  `init(elevationStyle:)` — no POI filter, no traffic; what we use),
  `MKHybridMapConfiguration` (elevationStyle + POI filter + traffic).
- Legacy `MKMapType`: `.standard/.satellite/.hybrid/.satelliteFlyover/.hybridFlyover/.mutedStandard`.
  Flyover cases (iOS 9+): "satellite image of the area **with flyover data where available**" —
  the only doc acknowledgment that flyover coverage is partial. Config equivalents: imagery+realistic
  ≈ satelliteFlyover, imagery+flat ≈ satellite (per WWDC22; the docs themselves never state the mapping).
- `showsBuildings` (dep@27): extruded buildings only on standard/mutedStandard when pitch > 0.
  Interesting note: **iOS 16+ with overlay content present, buildings and trees render transparent**
  (may matter if we combine overlays with the flyover ground).
- Chrome toggles: `showsCompass`, `showsScale`, `showsTraffic`, `pitchButtonVisibility` (iOS 17,
  `MKFeatureVisibility`), `showsPitchControl` (macOS/Catalyst), `showsZoomControls`,
  `showsUserTrackingButton`, `pointOfInterestFilter` (`MKPointOfInterestFilter`,
  including/excluding POI categories).

## Coordinate conversion (all iOS 3+, on MKMapView)

- `convert(_ coordinate:toPointTo:)` → CGPoint; `convert(_ point:toCoordinateFrom:)` → coordinate;
  `convert(_ region:toRectTo:)` → CGRect; `convert(_ rect:toRegionFrom:)` → region.
- The discussions are **one-liners**: "The point (in the appropriate view or window coordinate
  system) corresponding to the specified latitude and longitude value." Passing nil view = window
  coordinates. **No accuracy caveats, no pitch/3D discussion, no promise about terrain** — the docs
  neither guarantee correctness under pitched/flyover cameras nor warn it breaks.

## Region / visible area

- `region: MKCoordinateRegion` — set updates immediately; **the map adjusts your value to fit the
  view precisely, so read-after-write may differ**; `regionThatFits(_:)` predicts the adjustment.
  Changing only the center can still change the span (span-per-degree varies with latitude) — use
  `centerCoordinate`/`setCenter(_:animated:)` to keep zoom.
- `visibleMapRect` — same info as MKMapRect; `setVisibleMapRect(_:animated:)` and
  `(_:edgePadding:animated:)` (padding in screen points); `mapRectThatFits(_:)`/`(_:edgePadding:)`.
- Delegate order per change: `mapView(_:regionWillChangeAnimated:)` → N×
  `mapViewDidChangeVisibleRegion(_:)` (iOS 11+, "each time the value of its visible region changes",
  must be lightweight) → `mapView(_:regionDidChangeAnimated:)`. That per-change callback is the
  finest camera-motion notification MapKit offers — there is no per-rendered-frame callback.
- Load/render lifecycle: `mapViewWillStartLoadingMap`/`DidFinishLoadingMap`/`DidFailLoadingMap`,
  `mapViewWillStartRenderingMap`, `mapViewDidFinishRenderingMap(_:fullyRendered:)` (fires when all
  visible tiles rendered "to the best of its ability" — useful as a flyover-ready signal).
- Delegate protocol page: all delegate methods called on the **main thread**; nil the delegate
  before releasing the map view.

## Docs vs our empirical findings

1. **Implicit annotation-view animation during camera sets** (views lag ground unless wrapped in
   `CATransaction.setDisableActions(true)`): **SILENT / weakly contradicted.** `camera` setter says
   assignment "updates the map immediately and without animating the change" — true for tiles, but
   nothing documents that annotation repositioning goes through Core Animation implicit actions in
   their "separate display layer" (the Overview's only hint). No doc mentions CATransaction anywhere
   in the MapKit annotation/camera tree. Our disable-actions wrapper remains empirically justified.
2. **Flyover pitch-anchor nondeterminism** (same MKMapCamera renders 100–200px apart across visits):
   **SILENT — confirmed.** Nothing in `mkmapcamera`, the flyover MKMapType cases, or
   `elevationStyle` describes anchor sampling, terrain-height sampling for the look-at point, or
   any determinism guarantee. `.realistic`'s entire doc is "realistic ground contours".
3. **`convert(_:toPointTo:)` wrong under pitched flyover:** the docs promise only a point
   "corresponding to" the coordinate, with zero discussion of pitch, elevation, or projection model.
   They don't document the flat-mercator behavior we observe, but they also promise nothing more —
   **silent; no contract violated, none offered.** Probe-based calibration stays the ground truth.
4. **Pitch clamps:** **DOCUMENTED, in mapType terms.** `mkmapcamera/pitch`: satellite/hybrid clamp
   pitch to 0; max pitch is altitude-dependent with "no fixed maximum" (and `altitude` doc: lowering
   altitude can re-clamp an existing pitch). Matches our empirics exactly, including the
   altitude-dependent max. Docs never restate this per-configuration; flyover/realistic honoring
   pitch is empirical only.
5. **APIs we're not using that could help:**
   - `zPriority`/`selectedZPriority` (iOS 14+) — deterministic z-order; set flag `.max` so probe
     views or future annotations never overlap-hide it visually.
   - `displayPriority` — base default is already `.required` (never auto-hidden, never clustered),
     so probes are safe by default; but if we ever use MKMarkerAnnotationView remember its
     `.defaultLow` default. `collisionMode = .none` (iOS 14+) additionally opts out of collisions.
   - `prepareForDisplay()` — right hook for configuring FlagAnnotationView before display.
   - `mapViewDidChangeVisibleRegion(_:)` — per-change (finer than regionDidChange) camera callback;
     could re-trigger probe resample without polling. No finer/per-frame API exists.
   - `mapViewDidFinishRenderingMap(_:fullyRendered:)` — "flyover tiles ready" signal for gating
     calibration after teleports.
   - `annotationVisibleRect`; `annotations(in:)`; `CameraZoomRange`/`CameraBoundary` hard fences.
   - **No `MKAnnotationView.anchorPoint` exists** (404) — `centerOffset` is the only anchor knob.

## Crawl gaps

- `mkannotationview/anchorpoint` — 404 (member does not exist; that's the finding, not a gap).
- Article `optimizing-map-views-with-filtering-and-camera-constraints` — 404 under mapkit
  (removed or renamed; not listed in the current MapKit root topic tree, which only carries
  deprecated-symbols + default-navigation-app articles plus the two annotation samples above).
- Everything else in the requested tree fetched OK (≈175 pages, incl. two-pass retry).
