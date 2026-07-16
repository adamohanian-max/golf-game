---
name: mapkit-js-web
description: MapKit JS (web) API reference distilled for this game — map/overlay/annotation/camera APIs, auth + quota model, and a grounded verdict on whether the web build can get an Apple ground like the iOS native one. Use when considering Apple maps on the web build.
---

# MapKit JS for the web build

Distilled from Apple's MapKit JS docs (crawled 2026-07 via the JSON backend:
`developer.apple.com/tutorials/data/documentation/mapkitjs/<path>.json`). Every claim cites a doc
path under `developer.apple.com/documentation/mapkitjs/`. Latest major version: **MapKit JS 6**
(`mapkitjs/mapkit-js-6`). Search/Geocoding/Directions/Places deliberately omitted.

## 1. Loading + auth (`creating-a-maps-token`, `loading-the-latest-version-of-mapkit-js`, `mapkit/init`)

- Script: `https://cdn.apple-mapkit.com/mk/x/mapkit.core.js` (`x` = version selector: `x` latest,
  `6`, `6.0.x`, or pinned `5.81.60`; semver). `crossorigin async` +
  `data-callback` (required), `data-libraries` (required), `data-token`, optional `data-language`, `nonce`.
- Libraries (loaded on demand): `services`, `full-map`, `map` (no overlays/annotations),
  `overlays`, `annotations`, `geojson`, `user-location`, `look-around`. Post-init:
  `await mapkit.load([...])` → `Promise<MapKit>` (v6). npm loader: `@apple/mapkit-loader`.
- Auth = **JWT Maps token**, created in the Apple Developer account (Certificates, Identifiers &
  Profiles → Services → Maps → Tokens). Token types: Embed API / **MapKit JS** / Server API / Web
  Snapshots. Restriction: Domain (comma-list of websites, validation duration No-Expiration/30/90/180d/custom)
  or None. Revocable instantly. Dynamic server-side signing: JWT `scope: "mapkit_js"` + `origin` claim.
  **Apple Developer Program membership required.**
- Alternative to `data-token`: `mapkit.init({ authorizationCallback: done => fetch("/gettoken").then(r=>r.text()).then(done), language, libraries })`
  (`mapkit/init`, `MapKitInitializationOptions`). Success → `configuration-change` event on `mapkit`;
  failure → `error` event (`handling-initialization-events`).
- **Quotas** (developer.apple.com/maps/mapkitjs marketing page, not the API docs): free with
  Apple Developer Program membership, per membership: **250,000 map views/day + 25,000 service
  calls/day** (snapshots separately 25,000/day). "For additional capacity needs, contact us" — no
  published overage pricing. No documented commercial-use restriction (unlike Esri terms).
  Our overlay/annotation usage consumes only map views, not service calls.

## 2. Map display (`mapkitjs/map`, `MapConstructorOptions`)

- `new mapkit.Map(parent, options)` — embeds in a DOM element; `map.element` exposes it;
  `map.destroy()` frees it (`map/destroy()`).
- **mapType** (`mapkitjs/maptype`): `Standard`, `MutedStandard`, `Satellite` ("A satellite image
  of the area"), `Hybrid` (satellite + road layer). **Satellite imagery: yes.** No flyover/3D
  member exists.
- Visible-portion API (`map/...`, all with instant property set + `set…Animated(value, animated)`
  variants): `center`/`setCenterAnimated`, `region`/`setRegionAnimated` (CoordinateRegion),
  `visibleMapRect`/`setVisibleMapRectAnimated`, `rotation` (degrees)/`setRotationAnimated`,
  `cameraDistance`/`setCameraDistanceAnimated` (camera altitude in **meters** above map-center
  elevation, ≥0; direct property set is instant, per `map/cameradistance`),
  `cameraZoomRange`/`setCameraZoomRangeAnimated` (`CameraZoomRange(min, max)` meters —
  `mapkitjs/camerazoomrange`), `cameraBoundary`/`setCameraBoundaryAnimated` (constrains center;
  `CameraBoundaryDescription`).
- **There is NO pitch/tilt/heading-elevation camera axis anywhere in the API.** Camera =
  {center, rotation (yaw), distance (altitude)} only — top-down. Confirmed absent from
  `MapConstructorOptions`, `mapkitjs/map`, `mapkitjs/maptype`, and the v5→v6 release notes
  (`mapkit-js-6`, `mapkit-js-release-notes` — zero hits for 3D/pitch/tilt/flyover/terrain).
  Look Around (`mapkitjs/lookaround`) is street-level panoramas, not a camera mode.
- Interaction toggles: `isRotationAvailable/isRotationEnabled/isScrollEnabled/isZoomEnabled`;
  chrome: `showsCompass/showsMapTypeControl/showsScale/showsZoomControl/showsUserLocationControl`,
  `colorScheme` (`mapkitjs/colorscheme`), `tintColor`, `padding` (`mapkitjs/padding`),
  `pointOfInterestFilter`/`showsPointsOfInterest`, `loadPriority` (`mapkitjs/maploadpriority`),
  `showItems(items, options)`.
- **Events** (`handling-map-events`): `region-change-start/end`, `rotation-start/end`,
  `scroll-start/end`, `zoom-start/end`, `map-type-change`, `single-tap`, `double-tap`,
  `long-press`, `select`/`deselect`, annotation `drag-start/dragging/drag-end`,
  `user-location-change/-error`. **Start/end pairs only — no per-frame camera event during
  animations or gestures.** (v6: classes extend native `EventTarget`.)
- v6 changes of note (`mapkit-js-6`): wheel zoom/pan without Shift; all images (tiles,
  annotations) now require CORS.

## 3. Overlays (`mapkitjs/overlays`, `adding-interactivity-to-overlays`)

- Geographic-space shapes that re-render automatically as the map pans/zooms/rotates and when
  geometry or style mutates (observable properties). Layered above map tiles, below annotations;
  z-order = insertion order.
- `mapkit.PolygonOverlay(points, options)` — `points: Coordinate[][]`; multiple rings supported,
  inner rings subtract (holes — e.g. green with a bunker cut out); `style.fillRule`
  `nonzero|evenodd`; longitudes must span <360°. `PolylineOverlay` (open path),
  `CircleOverlay(center, radius)`. Base class `Overlay` (`mapkitjs/overlay`); `OverlayOptions` =
  `{data, visible, enabled, selected, style}`.
- `mapkit.Style` (`mapkitjs/style`): `fillColor/fillOpacity/fillRule`,
  `strokeColor/strokeOpacity/strokeStart/strokeEnd`, `lineWidth` (CSS px),
  `lineCap/lineJoin/lineDash/lineDashOffset`, `lineGradient` (`mapkitjs/linegradient`).
  All observable — mutate and the overlay redraws.
- Interactivity: overlays fire `select`/`deselect` (listen on the map; `event.overlay`). Hit
  region needs `enabled:true`, `visible:true`, and non-null fill (area) or stroke+lineWidth>0
  (outline); use `fillOpacity:0` for invisible-but-tappable. Map helpers:
  `overlaysAtPoint(point)`, `topOverlayAtPoint(point)`, `add/removeOverlay(s)`, `selectedOverlay`.
- `mapkit.TileOverlay(imageForTile, options)` (`mapkitjs/tileoverlay`): `imageForTile` = URL
  template (`{x}/{y}/{z}/{scale}` + custom `data` substitutions) **or a callback returning
  ImageSource / Promise<ImageSource> / null** (v6 — client-side tile rendering, e.g. canvas-drawn
  tiles). `minimumZ/maximumZ/opacity/data`, `reload()`. Docs: tiles "can supplement the underlying
  map content **or replace it completely**" — i.e. our baked NAIP tiles could be served *on top of*
  an Apple map, or Apple satellite could sit under our canvas. v6: no longer disables rotation or
  integer-snaps zoom.

## 4. Annotations (`mapkitjs/annotations`)

- MapKit JS has no view-delegate split: the annotation IS the view. Base
  `mapkit.Annotation(location, factory, options)` — **factory is a callback returning any DOM
  element** (`mapkitjs/annotation`), so fully custom HTML/canvas pins are supported.
- `AnnotationConstructorOptions`: `title/subtitle`, `anchorOffset` (DOMPoint — move anchor off
  bottom-center), `calloutOffset`, `callout` (`AnnotationCalloutDelegate` — fully custom callout
  DOM), `calloutEnabled`, `size` (CSS px), `appearanceAnimation` (CSS animation string),
  `draggable`, `enabled`, `selected`, `visible`, `animates`, `collisionMode`
  (`mapkitjs/annotationcollisionmode`), `displayPriority` (`mapkitjs/annotationdisplaypriority`),
  `clusteringIdentifier` (+ `map.annotationForCluster`, `clustering-annotations`), `data`,
  `padding`. Runtime: `annotation.element`, `annotation.map`.
- `MarkerAnnotation(location, opts)` (`mapkitjs/markerannotation`): balloon pin — `color`,
  `glyphText`, `glyphColor`, `glyphImage`/`selectedGlyphImage` as `{1:url, 2:url@2x, 3:url@3x}`,
  `titleVisibility`/`subtitleVisibility` (`mapkitjs/featurevisibility`).
- `ImageAnnotation(location, opts)` (`mapkitjs/imageannotation`): `image` accepts URL string,
  retina dict, `ImageSource` (**HTMLCanvasElement / ImageBitmap**), or `Promise<ImageSource>`
  (v6); `url` dict deprecated. `ImageDelegate` (`mapkitjs/imagedelegate`) for dynamic scale
  selection.
- Map API: `annotations`, `add/removeAnnotation(s)`, `selectedAnnotation`,
  `annotationsInMapRect(mapRect)`. Drag events include continuous `dragging`.

## 5. Coordinates + conversions

- `mapkit.Coordinate(lat, lng)` (`mapkitjs/coordinate`): `equals`, `copy`, `toMapPoint()`,
  `toUnwrappedMapPoint()`. `CoordinateRegion(center, span)` / `CoordinateSpan(latDelta, lngDelta)`
  / `BoundingRegion` (`mapkitjs/coordinateregion` etc.).
- Projected space: `MapPoint`/`MapRect`/`MapSize` (`mapkitjs/maprect`) — normalized 0..1 Web
  Mercator units; `MapRect(x,y,w,h)`, `minX/midX/maxX…`, `scale()`, `toCoordinateRegion()`;
  `MapPoint.toCoordinate()`.
- **Screen↔geo per frame:** `map.convertCoordinateToPointOnPage(coordinate)` and
  `map.convertPointOnPageToCoordinate(point)` (`mapkitjs/map`, "Converting map coordinates"
  section). These are synchronous calls — usable in a rAF loop to pin canvas-drawn game elements
  to the live map, the same trick the iOS build does with the probe-calibrated projection.
- `mapkit.importGeoJSON` + `GeoJSONDelegate` (`mapkitjs/mapkit/importgeojson`) can turn course
  GeoJSON straight into overlays/annotations.

## 6. Gaps (could not fetch)

- Individual method leaf pages with parenthesized names (e.g.
  `map/setcameradistanceanimated(distance,animated)`, `map/convertcoordinatetopointonpage(coordinate)`)
  404 on the JSON data endpoint in every encoding tried; their signatures above come from the
  parent `mapkitjs/map` class page, which is authoritative for existence + signature but not full
  discussion text (return types of the page-point converters are inferred to be DOMPoint-like).
- Exact overage pricing beyond the free quota: not published anywhere; Apple says contact them.

## Verdict — can the web build get the iOS-style Apple ground?

**Documented fact:**
- **Satellite imagery: YES.** `mapType: Satellite`/`Hybrid` is first-class (`mapkitjs/maptype`).
- **3D / pitch / flyover: NO.** The web camera has center + yaw rotation + altitude only; no
  pitch/tilt axis exists in `MapConstructorOptions` or any `Map` API, no flyover map type, no
  terrain/elevation API, and nothing in the v6 release notes. The iOS `.satelliteFlyover`
  perspective ground **cannot be reproduced** — web Apple ground would be flat top-down satellite,
  functionally comparable to our baked NAIP aerials (but live, global incl. non-US, and
  license-clean for a monetized app as far as the docs state — quota page shows limits, not a
  non-commercial clause; confirm in the Apple Maps agreement before shipping ads).
- **Overlays/annotations: YES, full parity with the iOS overlay stack.** Geo-anchored polygons
  with holes, observable restyling, select events (`mapkitjs/polygonoverlay`, `mapkitjs/style`);
  annotations as arbitrary DOM/canvas content with anchor offsets (`mapkitjs/annotation`,
  `mapkitjs/imageannotation`). Green paint + pin flag port directly.
- **Auth/quota:** Apple Developer Program membership + JWT Maps token (domain-restrictable);
  free 250k map views/day + 25k service calls/day per membership — far above our needs; our usage
  is map-view-only.

**Inference (not documented):**
- **Per-frame camera drive: workable but not native.** Property setters (`center`, `rotation`,
  `cameraDistance`) apply instantly, so a rAF loop can drive the camera each frame, and
  `convertCoordinateToPointOnPage` supports per-frame canvas registration. But there is no
  camera transaction/interpolation API and no render-frame event — smoothness of tile
  loading/reprojection under continuous programmatic control is unverified; expect it to be
  serviceable for follow-cams, not guaranteed 60fps buttery.
- **Net:** MapKit JS could replace baked NAIP with live Apple satellite + native-style
  overlay/annotation stack on the web build, but it is a **flat-ground** solution. It cannot give
  the web build the Butter Brook flyover look; for 3D on web, the existing three.js/course3d or
  photogrammetry paths remain the only options.
