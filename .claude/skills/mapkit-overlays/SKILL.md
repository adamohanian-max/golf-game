---
name: mapkit-overlays
description: Native MapKit overlay/renderer API reference distilled from a full crawl of Apple's docs — every renderer class, geometry type, tile overlays, threading/redraw semantics, and where the docs confirm or stay silent on this game's empirical findings (static contract, terrain drape). Use when writing or debugging the Apple-ground native overlays.
---

# MapKit overlays & renderers — distilled from Apple's full doc tree

Crawled 2026-07 from `developer.apple.com/tutorials/data/documentation/mapkit/<path>.json`
(~200 pages: every member page of the overlay/renderer/geometry classes + both overlay sample
articles). Doc paths below are relative to `documentation/mapkit/`. See **Docs vs our empirical
findings** at the bottom for what matters most to the Butter Brook flyover ground.

## Architecture (mapkit-overlays topic group, displaying-overlays-on-a-map)

Two-object split: an **overlay** (data: geometry + `boundingMapRect`, conforms to `MKOverlay`) and a
**renderer** (`MKOverlayRenderer` subclass that draws it). Map view monitors each overlay's
`boundingMapRect`; when it intersects the visible map it calls the delegate's
`mapView(_:rendererFor:)` **once** to obtain the renderer (`mkmapview/addoverlay(_:)`). The
renderer is then reused; `mkmapview/renderer(for:)` returns that same object, or nil if the overlay
isn't onscreen. `MKOverlay: MKAnnotation`, so an overlay added via `addAnnotation` displays as an
annotation at its `coordinate`, not as a draped area (`mkoverlay` overview).

## MKOverlay (protocol, `mkoverlay/*`)

- `boundingMapRect: MKMapRect` — smallest rect encompassing the overlay, in projected map points.
  "Implementers … need to set this area when implementing their overlay class, and after setting
  it, **not change it**." For live-growing overlays the Travel History sample returns `.world` here
  and keeps a separate mutable `pathBounds` (see threading below).
- `coordinate` — approximate center; anchor for callouts if used as annotation.
- `intersects(_ mapRect:) -> Bool` (optional) — more precise bounds check; default uses
  `boundingMapRect` only. Worth implementing for sparse shapes to skip tile draws.
- `canReplaceMapContent() -> Bool` (optional) — return true only if you cover the region with fully
  opaque content; hint that lets the map skip loading/drawing its own tiles underneath.

## MKOverlayRenderer (`mkoverlayrenderer/*`)

Base drawing infrastructure. Subclass and override only `draw(_:zoomScale:in:)`; also override
`canDraw(_:zoomScale:)` if content may not be ready.

- `draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext)` — default does
  nothing. **Documented threading contract:** "the map view may divide your overlay into multiple
  tiles and render each one on a separate thread. Therefore, your implementation … needs to be
  capable of safely running multiple threads simultaneously." Compute in map points, convert with
  the renderer's conversion methods, draw with Core Graphics; UIKit drawing requires
  `UIGraphicsPushContext`/`Pop`, and "don't manipulate UIKit views" (background threads). Don't
  draw outside `mapRect`; if your algorithm must, `context.clip(to:)` first
  (displaying-overlays-on-a-map). Don't reference the map view's `bounds`/`frame` while drawing.
- `canDraw(_:zoomScale:) -> Bool` — default true. Return false when not ready **or when you have
  nothing in that rect**; you are then responsible for later calling
  `setNeedsDisplay(_:zoomScale:)` when ready.
- `setNeedsDisplay()` / `setNeedsDisplay(_ mapRect:)` / `setNeedsDisplay(_:zoomScale:)` —
  invalidate all / a rect at all zooms / a rect at one zoom; redraw happens "during the next
  update cycle". Sample guidance (displaying-an-updating-path…): **avoid the no-arg version** — it
  "may cause a render pass for the entire visible map"; pass the changed rect (outset by line
  width). Also: prefer `setNeedsDisplay(_:)` over remove+re-add of the overlay — re-adding is not
  instantaneous and causes visible flicker, especially with several overlays or frequent updates.
- Conversions, all **documented safe to call from `draw`**: `point(for: MKMapPoint) -> CGPoint`,
  `mapPoint(for:)`, `rect(for: MKMapRect) -> CGRect`, `mapRect(for:)`.
- `alpha: CGFloat` — 0…1, default 1.0. Nothing documented about animation, per-frame cost, or
  thread affinity (see findings §1).
- `blendMode: CGBlendMode` — **iOS/iPadOS/tvOS 16+, visionOS 1+ only; macOS and Catalyst absent
  from its availability list.** Relates overlay pixels to map pixels behind it; the sample pairs a
  world-covering polygon with an interior cutout (`.screen` to desaturate outside a park) and an
  inner polygon (`.colorBurn` to saturate inside).
- `contentScaleFactor: CGFloat` (get) — logical-points→device-pixels factor, "typically 1.0 or 2.0".
- `overlay` (strong ref, set by `init(overlay:)`).
- `MKRoadWidthAtZoomScale(_ zoomScale) -> CGFloat` (`mkroadwidthatzoomscale(_:)`) — width **in
  screen points** of roads at that zoom; the documented way to get a sane, zoom-appropriate line
  width in custom `draw` (the breadcrumb sample uses exactly this and outsets its clip rect by it).

## MKOverlayPathRenderer (`mkoverlaypathrenderer/*`)

For overlays whose shape is a `CGPath`. Fills then strokes. Subclass point: override `createPath()`
and assign to `path`; on data change call `invalidatePath()` (nils `path`, triggers redisplay —
lazy `path` getter recreates via `createPath()`).

- Style: `fillColor` (nil → no fill), `strokeColor` (nil → no stroke), `lineWidth` (**default 0**),
  `lineCap`/`lineJoin` (default round), `lineDashPattern` (in points), `lineDashPhase`,
  `miterLimit` (10).
- `applyStrokeProperties(to:atZoomScale:)` — applies stroke color/width/join/cap/miter/dash to the
  context **and applies the zoomScale to line width and dash pattern automatically "so that lines
  scale appropriately"** — i.e. path-renderer `lineWidth` is authored in screen points and MapKit
  does the ÷zoomScale for you. `applyFillProperties(to:atZoomScale:)` sets fill color.
  `strokePath(_:in:)` / `fillPath(_:in:)` no-op if the respective color is nil. None save/restore
  graphics state.
- `shouldRasterize` (iOS 13+, default false) — "whenever possible, MapKit **vectorizes** overlay
  shapes by default so that they scale along with the map and remain sharp"; set true to force
  bitmap rendering. Per displaying-overlays-on-a-map, subclassing a provided renderer with a
  custom `draw(_:zoomScale:in:)` **automatically enables rasterized rendering** — vector path vs
  rasterized custom-draw is a real, documented split in the pipeline.

### Concrete path renderers

- `MKPolygonRenderer` — fills then strokes one `MKPolygon`. `strokeStart`/`strokeEnd` (iOS 14+):
  unit-distance window of the outline stroke; get unit distances from
  `MKMultiPoint.location(atPointIndex:)`.
- `MKPolylineRenderer` — "strokes the line only; it doesn't fill it." Same
  `strokeStart`/`strokeEnd`. Use as-is, don't subclass.
- `MKMultiPolygonRenderer` / `MKMultiPolylineRenderer` — one renderer styles every member of an
  `MKMultiPolygon`/`MKMultiPolyline` identically. Docs: grouping identically-styled overlays this
  way is "more efficient than creating a renderer for each overlay" and Apple says to do it
  "whenever the visual style is the same", especially at scale.
- `MKCircleRenderer` — fills+strokes an `MKCircle`; `strokeStart`/`strokeEnd` where 0 = top of
  circle, stroke runs clockwise.
- `MKGradientPolylineRenderer` (iOS 14+/macOS 11+) — stroke-only gradient along the line.
  `setColors(_:locations:)` with unit distances 0…1 (separate UIColor/NSColor overloads);
  read-only `colors`/`locations`. "Don't subclass." Pair per-vertex colors using
  `location(atPointIndex:)`.

## Overlay data classes

- `MKShape` (abstract; `title`/`subtitle` for callouts) → `MKMultiPoint` (abstract) →
  `MKPolyline`/`MKPolygon`.
- `MKMultiPoint`: `pointCount`, `points()` (unsafe pointer into `MKMapPoint` storage),
  `getCoordinates(_:range:)`, `location(atPointIndex:) -> CGFloat` and `locations(at: IndexSet)`
  (iOS 14+, unit distance along the shape — feeds gradient/strokeStart APIs).
- `MKPolygon`: closed (first↔last auto-connect). **`interiorPolygons: [MKPolygon]?`** via
  `init(coordinates:count:interiorPolygons:)` / `init(points:count:interiorPolygons:)` — cutout
  regions masked out with the **even-odd fill rule**; renderer excludes those areas. This is the
  documented way to build ring/donut tints (e.g. green tint with a cup cutout, or a world-covering
  dim with a course-shaped hole) in ONE overlay instead of two stacked alpha fills.
- `MKPolyline`: open, ≥2 points. `MKGeodesicPolyline`: segments follow Earth curvature (appear
  curved when projected); irrelevant at golf-hole scale.
- `MKMultiPolygon`/`MKMultiPolyline` (iOS 13+): thin collections (`polygons`/`polylines`) for
  same-style groups; also what `MKGeoJSONDecoder` emits for MultiPolygon features.
- `MKCircle`: `init(center:radius:)` (meters) or `init(mapRect:)`; `boundingMapRect` grows toward
  the poles (map points shrink with latitude).

## MKTileOverlay + MKTileOverlayRenderer (`mktileoverlay/*`)

Bitmap tile pyramid, EPSG:3857 indexing. `init(urlTemplate:)` with `{x}`,`{y}`,`{z}`,`{scale}`
placeholders — HTTP or file URLs (bundle tiles work: `file://…/{z}/{x}/{y}.jpg`); nil template
requires overriding the loaders. Override `url(forTilePath:)` for a custom URL scheme, or
`loadTile(at: MKTileOverlayPath, result:)` (completion may run on any queue; default impl loads
`url(forTilePath:)` via URLSession) for fully custom loading. `MKTileOverlayPath` = `x`,`y`,`z`,
`contentScaleFactor`. Knobs: `minimumZ` (default 0) / `maximumZ` (default 21 — setting higher
doesn't force extra levels), `tileSize` (default 256×256 **pixels**; on Retina a 256px tile renders
as 128pt — pixel-for-pixel, never scaled), `isGeometryFlipped` (true = tile origin bottom-left,
TMS-style), `canReplaceMapContent` (property here, vs the protocol *method*; true = fully opaque
tiles, map skips base tiles). Renderer is dumb: `init(tileOverlay:)` + `reloadData()` (drops cached
tile images, reloads from source, redraws as loaded).

## MKMapView overlay methods (`mkmapview/*`)

- `addOverlay(_:)` / `addOverlays(_:)` — adds at **`.aboveLabels`** (the default level).
- `addOverlay(_:level:)` / `addOverlays(_:level:)` — appends to that level's list.
  `MKOverlayLevel.aboveRoads` = above roadways, below labels/shields/POI icons;
  `.aboveLabels` = above labels, **below annotations and 3D building projections**.
- `insertOverlay(_:at:)` / `insertOverlay(_:at:level:)` — index > count appends;
  `insertOverlay(_:above:)` / `(_:below:)` — relative to a sibling (must already be added); if the
  sibling is in a different level the overlay just appends to that level.
- `exchangeOverlay(at:withOverlayAt:)` (indices, aboveLabels only) and
  `exchangeOverlay(_:with:)` (cross-level: swaps levels too).
- `removeOverlay(_:)` / `removeOverlays(_:)` — level-agnostic; "removing an overlay also removes
  its corresponding renderer".
- `overlays` — union across levels; **array order ≠ visual order**. `overlays(in: level)` — order
  IS visual order within that level (earlier = behind). `renderer(for:)` — the delegate-provided
  renderer, nil if offscreen.

## Delegate callbacks (`mkmapviewdelegate/*`)

Protocol is `@MainActor`; "MapKit calls all of your delegate methods on the app's main thread."
- `mapView(_:rendererFor:) -> MKOverlayRenderer` — create/return the renderer; called when the
  overlay's bounding rect first intersects the visible map.
- `mapView(_:didAdd: [MKOverlayRenderer])` — renderer is active; "might be prior to those contents
  appearing onscreen".
- `mapViewWillStartRenderingMap(_:)` / `mapViewDidFinishRenderingMap(_:fullyRendered:)` — tile
  render pass begin/end; `fullyRendered=false` when tile errors prevented completion. (These fire
  for map tiles generally — useful as a "ground settled" signal.)
- `mapViewDidFailLoadingMap(_:withError:)` — network/tile-load failure.

## Geometry (`mkmappoint`, `mkmaprect`, `mkmapsize`, functions)

Map points = Mercator-projected world; `MKMapRect.world` / `MKMapSize.world` span it. Save
lat/lon to disk, not map points. `MKMapPoint(CLLocationCoordinate2D)` ↔ `.coordinate`;
`distance(to:)` returns true meters (accounts for curvature). Scale helpers:
`MKMapPointsPerMeterAtLatitude(_:)` (grows toward poles) and `MKMetersPerMapPointAtLatitude(_:)`.
`MKCoordinateRegion(mapRect)` converts rect→region (`mkcoordinateregion/init(_:)`);
`MKCoordinateRegion(center:latitudinalMeters:longitudinalMeters:)` for meter-sized regions.
`MKMapRect`: full CGRect-style kit — `init(x:y:width:height:)`, min/mid/max X/Y, `insetBy`,
`offsetBy`, `union`, `intersection`, `intersects` (edge-touching ≠ intersecting), `contains`
(point on min edges counts), `spans180thMeridian` + `remainder`, `.null` vs empty.
`zoomScale` relation used by the sample: `zoomScale = view.bounds.width / visibleMapRect.width`.

## Docs vs our empirical findings

1. **Static contract / per-frame `alpha` writes destabilizing the scene — docs SILENT on cost,
   supportive in spirit.** `alpha` is documented only as a 0–1 value, default 1.0 — nothing on
   animation, frequency, or threading. But the static framing is real: `MKOverlay.boundingMapRect`
   must be set once "and after setting it, not change it"; the Travel History article states
   "MapKit treats overlay data as static when using the system-provided overlay classes", warns
   that rect-less `setNeedsDisplay()` "may cause a render pass for the entire visible map", and
   that remove+re-add causes flicker. Nothing documents `alpha` as a cheap animatable property —
   our bake-colors-at-construction rule doesn't contradict anything and matches the docs' grain.
2. **`draw()` per-tile, concurrent, background — DOCUMENTED, verbatim.** `mkoverlayrenderer`
   overview + `draw(_:zoomScale:in:)`: the map "may tile large overlays and distribute the
   rendering of each tile to separate threads"; implementation "needs to be capable of safely
   running multiple threads simultaneously"; sample says "concurrently on multiple background
   queues" and guards shared mutable state with `OSAllocatedUnfairLock`. The four point/rect
   conversion methods are each explicitly documented as safe from `draw`. Delegate methods, by
   contrast, are all main-thread.
3. **Overlays draping onto flyover/realistic terrain — docs SILENT.** No page in the crawl
   mentions overlays interacting with `elevationStyle`, pitch, or 3D terrain.
   `MKMapConfiguration.ElevationStyle.realistic` is documented only as "realistic ground
   contours". Closest statement is `MKOverlayLevel.aboveLabels`: "below annotations and 3D
   projections of buildings". The WWDC-2015 "overlays follow the ground" behavior we rely on
   remains empirical, unpromised by current docs.
4. **`x / zoomScale` line width — CONFIRMED as the mechanism, with two documented flavors.**
   `MKRoadWidthAtZoomScale(zoomScale)` returns a screen-point road width and is the sample's
   choice inside custom `draw` (it also outsets the redraw/clip rects by it). For path renderers
   you never divide yourself: `applyStrokeProperties(to:atZoomScale:)` "applies the scale factor
   … to the line width and line dash pattern automatically so that lines scale appropriately" —
   `lineWidth` is authored in screen points.
5. **`MKMultiPolyline` drape / per-class rendering differences — drape undocumented, but one real
   documented split exists.** Multi-renderers are documented purely as a perf/styling grouping
   (one renderer, identical style, "more efficient"). Nothing on drape differences per class.
   However `shouldRasterize` docs + sample reveal a genuine pipeline fork: standard shape
   renderers are **vectorized** (scale sharp with the map), while a custom `draw` override is
   **automatically rasterized**. Our `GreenOverlayRenderer` is therefore on the rasterized path —
   a plausible root for behavioral differences vs `MKMultiPolylineRenderer`, though the docs never
   connect it to terrain draping.

## Fetch gaps

- `MKGradientPolylineRenderer`'s own `strokeStart`/`strokeEnd`/`locations` disambiguated pages
  404'd (`…/locations-1b2ny`, `…/strokestart`); inherited semantics from `MKPolylineRenderer`
  assumed identical (same iOS 14 API family).
- `mkmaprect/init(_:)` and the legacy C-style `MKCoordinateRegionForMapRect` pages don't exist in
  the Swift tree (covered via `MKCoordinateRegion.init(_:)`).
- `MKPlacemark` (listed under "Shared behavior" in mapkit-overlays) skipped — not overlay-relevant.
- watchOS `WKInterfaceMap` overlay surface not crawled (game is iOS-only).
