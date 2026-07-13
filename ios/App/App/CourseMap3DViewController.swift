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

    func enter(into parent: UIView, behind webView: WKWebView) {
        self.webView = webView

        let mv: MKMapView
        if let existing = mapView {
            mv = existing
        } else {
            mv = MKMapView(frame: parent.bounds)
            mv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            // .satelliteFlyover, NOT .satellite: plain satellite silently clamps
            // MKMapCamera.pitch to 0 (verified in the simulator — the map stayed
            // top-down while the game's 3D toggle pitched the overlay). Flyover
            // honors pitch everywhere; where Apple has flyover coverage it also
            // brings the photoreal 3D terrain/tree/building meshes.
            mv.mapType = .satelliteFlyover
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
                    probes: [[Double]], done: @escaping ([String: Any]) -> Void) {
        guard let mv = mapView else { done([:]); return }
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
}
