import Capacitor
import MapKit
import WebKit

/// Persistent native ground-layer (Butter Brook only). Owns one MKMapView,
/// inserted behind the Capacitor WKWebView and removed again on leave() — see
/// CourseMap3DPlugin.swift for why this lives in native UIKit rather than as
/// a web canvas layer (MapKit has no in-page renderer, native or JS).
///
/// Render-only and dumb on purpose: game.js already knows the course's `geo`
/// anchor (tools/geo_anchor_course.py) and its own camera state (view/camera
/// in game.js), so it does the world-units -> lat/lon math itself and just
/// hands this layer a finished MKCoordinateRegion each frame. This class never
/// fetches course data or knows about holes/tee/pin/ball — it is purely "show
/// this rectangle of Apple's map." Ball/flag/HUD/contours are drawn by the
/// existing 2D canvas on top, unchanged, exactly like every other course.
///
/// Stage 1 (current): flat, north-up, no heading/pitch — see the plan's
/// staged build order. Rotation/tilt land in later passes.
class CourseMap3DLayer: NSObject, MKMapViewDelegate {
    private var mapView: MKMapView?
    private weak var webView: WKWebView?
    // Invisible probe annotations: MapKit positions their views through its
    // REAL flyover render pipeline (terrain anchor state included), so their
    // view centers are ground-truth "where does this lat/lon render" answers.
    // MKMapView.convert(_:toPointTo:) can NOT provide this — it projects
    // through the flat mercator viewport and knows nothing about the pitch
    // anchor, which flyover re-samples nondeterministically from whatever
    // mesh LOD is loaded on every camera set (measured: same MKMapCamera,
    // renders 100-200 px apart across visits).
    private var probeAnns: [MKPointAnnotation] = []
    private var lastReq: (Double, Double, Double, Double, Double)?

    // Native green overlay (fill + break contours) — replaces the JS canvas's
    // equivalent draw for Apple ground. Confirmed via an on-device spike this
    // session that MKOverlay drapes correctly onto the flyover 3D terrain
    // under pitch (WWDC 2015: "overlays will be drawn on top of the terrain
    // so that they will follow the ground"), so this needs no probe
    // calibration — MapKit renders it through the same pipeline as the
    // imagery itself. Relief shading stays JS-canvas (baked raster, not a
    // good MKOverlay fit). Colors/alphas match drawGreen()'s current values
    // in game.js exactly (fill #7ecb86 @ 0.13, contour rgba(30,60,35,0.26)),
    // both further scaled by the live detailAlpha from syncCamera.
    private var greenOverlays: [MKOverlay] = []
    private var greenFillRenderers: [ObjectIdentifier: MKPolygonRenderer] = [:]
    private var greenContourRenderers: [ObjectIdentifier: MKMultiPolylineRenderer] = [:]

    func enter(into parent: UIView, behind webView: WKWebView) {
        self.webView = webView

        let mv: MKMapView
        if let existing = mapView {
            mv = existing
        } else {
            mv = MKMapView(frame: parent.bounds)
            mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            // NOT .satellite/MKStandardMapConfiguration: plain satellite silently
            // clamps MKMapCamera.pitch to 0 (verified in the simulator — the map
            // stayed top-down while the game's 3D toggle pitched the overlay).
            // Flyover/.realistic elevation honors pitch everywhere; where Apple
            // has coverage it also brings the photoreal 3D terrain/tree/building
            // meshes. `mapType = .satelliteFlyover` is soft-deprecated (WWDC22
            // "What's new in MapKit") in favor of `preferredConfiguration` —
            // same underlying flyover terrain-mesh subsystem (no behavioral
            // difference found for the mesh re-anchoring jitter this file's
            // probe/calibration machinery already works around — see below —
            // this is a hygiene swap for the deprecation, not a jitter fix).
            // App deployment target is iOS 15, `preferredConfiguration` needs
            // 16+, so fall back to the legacy enum on older OS.
            if #available(iOS 16.0, *) {
                mv.preferredConfiguration = MKImageryMapConfiguration(elevationStyle: .realistic)
            } else {
                mv.mapType = .satelliteFlyover
            }
            mv.showsCompass = false // game HUD owns the screen — no MapKit chrome
            mv.delegate = self
            // The game's own swipe-to-swing/pan/pinch input stays bound to
            // #game (the now-transparent WKWebView on top) — this layer is
            // driven entirely by syncCamera(), never touched directly.
            mv.isUserInteractionEnabled = false
            mapView = mv
        }
        parent.insertSubview(mv, belowSubview: webView)

        // #game canvas goes transparent where the ground would have been
        // painted (game.js's draw(), appleGroundActive() branch) so this
        // layer shows through; the WKWebView itself also needs to stop
        // painting its own opaque page background over it.
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isOpaque = false
    }

    func leave() {
        lastReq = nil
        if let mv = mapView { mv.removeOverlays(greenOverlays) }
        greenOverlays.removeAll()
        greenFillRenderers.removeAll()
        greenContourRenderers.removeAll()
        mapView?.removeFromSuperview()
        webView?.isOpaque = true
        webView?.backgroundColor = nil
        webView?.scrollView.backgroundColor = nil
    }

    /// Dumb on purpose: game.js owns the whole camera model (one pinhole shared
    /// by the map and the canvas overlay — buildAppleProj in game.js, including
    /// the FOV constant APPLE_CAM_K). This side just forwards the finished
    /// numbers into an MKMapCamera.
    /// Returns the camera MapKit ACTUALLY applied. MapKit silently clamps —
    /// flyover enforces a minimum distance and zoom-dependent max pitch — and
    /// the game's overlay projection must render what the map really shows,
    /// not what it asked for. game.js folds these actuals back into
    /// buildAppleProj (see _appleActualCam there).
    func syncCamera(lat: Double, lon: Double, heading: Double, distM: Double, pitch: Double,
                    probes: [[Double]], detailAlpha: Double, done: @escaping ([String: Any]) -> Void) {
        guard let mv = mapView else { done([:]); return }
        setGreenOverlayAlpha(detailAlpha)
        // Skip the camera assignment when the request hasn't changed: every
        // mv.camera set makes flyover RE-SAMPLE its pitch anchor from the
        // currently loaded mesh LOD, and at rest that re-roll alternates
        // between answers ~15 px apart — the whole scene (and the JS probe
        // calibration chasing it) visibly bounces. A parked camera must be
        // left alone; probes below still get read every call.
        let req = (lat, lon, heading, distM, pitch)
        let changed = lastReq == nil ||
            abs(lastReq!.0 - lat) > 1e-9 || abs(lastReq!.1 - lon) > 1e-9 ||
            abs(lastReq!.2 - heading) > 0.01 || abs(lastReq!.3 - distM) > 0.05 ||
            abs(lastReq!.4 - pitch) > 0.01
        if changed {
            lastReq = req
            mv.camera = MKMapCamera(
                lookingAtCenter: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                fromDistance: max(distM, 60),
                pitch: CGFloat(pitch),
                heading: heading) // direct assignment — no animation, game.js already pushes ~30fps
        }
        let a = mv.camera
        // Ground truth for the JS overlay projection: invisible probe
        // annotations at the requested coordinates. MapKit lays their views
        // out through the real flyover camera — terrain anchor state and all
        // — so view centers (UIKit pts == css px) are exactly where those
        // coordinates render. game.js fits a screen-affine from its replica
        // onto these (calA/calB in buildAppleProj), absorbing the flyover
        // pitch anchor's nondeterminism. Views need a runloop hop after the
        // camera assignment before their centers reflect the new framing.
        syncProbeAnnotations(mv, coords: probes)
        DispatchQueue.main.async {
            var px: [Double] = [], py: [Double] = []
            for ann in self.probeAnns {
                if let v = mv.view(for: ann) {
                    // MODEL value, not layer.presentation(): MapKit implicitly
                    // ANIMATES annotation view repositioning while the map
                    // tiles move instantly — presentation positions lag the
                    // real render by the animation curve, which fed a visible
                    // overlay wobble during the pitch ramp (flag reversed
                    // direction ±10 css px against a steady map). v.center is
                    // the final layout target for the current camera.
                    px.append(Double(v.center.x)); py.append(Double(v.center.y))
                } else {
                    px.append(.nan); py.append(.nan)
                }
            }
            done([
                "lat": a.centerCoordinate.latitude,
                "lon": a.centerCoordinate.longitude,
                "distM": a.centerCoordinateDistance,
                "pitch": Double(a.pitch),
                "heading": a.heading,
                "px": px, "py": py,
            ])
        }
    }

    /// Keep exactly one invisible annotation per probe coordinate (reused
    /// across frames — coordinate assignment is cheap, add/remove is not).
    private func syncProbeAnnotations(_ mv: MKMapView, coords: [[Double]]) {
        let want = coords.filter { $0.count >= 2 }
        while probeAnns.count > want.count {
            mv.removeAnnotation(probeAnns.removeLast())
        }
        while probeAnns.count < want.count {
            let ann = MKPointAnnotation()
            probeAnns.append(ann)
            mv.addAnnotation(ann)
        }
        // No implicit animation on coordinate moves — the views must sit at
        // their final layout position when read (see the v.center read above).
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, p) in want.enumerated() {
            let c = CLLocationCoordinate2D(latitude: p[0], longitude: p[1])
            if probeAnns[i].coordinate.latitude != c.latitude || probeAnns[i].coordinate.longitude != c.longitude {
                probeAnns[i].coordinate = c
            }
        }
        CATransaction.commit()
    }

    /// Probe annotations render as 1x1 transparent views — invisible, but
    /// still laid out by MapKit (isHidden could let MapKit skip positioning).
    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        guard let pt = annotation as? MKPointAnnotation, probeAnns.contains(pt) else { return nil }
        let id = "cm3d-probe"
        let v = mapView.dequeueReusableAnnotationView(withIdentifier: id)
            ?? MKAnnotationView(annotation: annotation, reuseIdentifier: id)
        v.annotation = annotation
        v.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        v.backgroundColor = .clear
        v.canShowCallout = false
        v.isEnabled = false
        v.alpha = 0.02
        return v
    }

    /// Replaces the current set of native green overlays wholesale — called
    /// only when game.js's greensInPlay() set actually changes (hole change,
    /// or the ball crossing into a new green's relevance), not every frame,
    /// so a full remove+add is cheap enough (at most 1-2 greens at a time).
    /// `greens`: [{ fill: [[lat,lon],...], contours: [{closed, pts:
    /// [[lat,lon],...]}] }] — already projected to corrected-WGS84 JS-side.
    func setGreenOverlay(_ greens: [JSObject]) {
        guard let mv = mapView else { return }
        mv.removeOverlays(greenOverlays)
        greenOverlays.removeAll()
        greenFillRenderers.removeAll()
        greenContourRenderers.removeAll()

        for green in greens {
            if let fill = green["fill"] as? [[Double]], fill.count >= 3 {
                let coords = fill.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) }
                let poly = MKPolygon(coordinates: coords, count: coords.count)
                greenOverlays.append(poly)
                mv.addOverlay(poly)
            }
            if let contours = green["contours"] as? [JSObject] {
                var lines: [MKPolyline] = []
                for c in contours {
                    guard let pts = c["pts"] as? [[Double]], pts.count >= 2 else { continue }
                    let coords = pts.map { CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1]) }
                    lines.append(MKPolyline(coordinates: coords, count: coords.count))
                }
                if !lines.isEmpty {
                    let multi = MKMultiPolyline(lines)
                    greenOverlays.append(multi)
                    mv.addOverlay(multi)
                }
            }
        }
    }

    /// Mirrors game.js's `_apDetailA` fade — 0.13/0.26 are drawGreen()'s
    /// current fill/contour baseline alphas (game.js ~3546/3560); detailAlpha
    /// multiplies on top exactly like `ctx.globalAlpha = _apDetailA` does
    /// there, so the fade-in/out feel matches the JS-canvas version unchanged.
    private func setGreenOverlayAlpha(_ alpha: Double) {
        let a = CGFloat(max(0, min(1, alpha)))
        for r in greenFillRenderers.values { r.alpha = a * 0.13 }
        for r in greenContourRenderers.values { r.alpha = a * 0.26 }
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let polygon = overlay as? MKPolygon {
            let r = MKPolygonRenderer(polygon: polygon)
            r.fillColor = UIColor(red: 0x7e / 255, green: 0xcb / 255, blue: 0x86 / 255, alpha: 1)
            r.alpha = 0 // set for real by the next syncCamera's detailAlpha
            greenFillRenderers[ObjectIdentifier(polygon)] = r
            return r
        }
        if let multi = overlay as? MKMultiPolyline {
            let r = MKMultiPolylineRenderer(multiPolyline: multi)
            r.strokeColor = UIColor(red: 30 / 255, green: 60 / 255, blue: 35 / 255, alpha: 1)
            r.lineWidth = 1.5
            r.alpha = 0
            greenContourRenderers[ObjectIdentifier(multi)] = r
            return r
        }
        return MKOverlayRenderer(overlay: overlay)
    }
}
