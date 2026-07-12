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
        let cam = MKMapCamera(
            lookingAtCenter: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            fromDistance: max(distM, 60),
            pitch: CGFloat(pitch),
            heading: heading)
        mv.camera = cam // direct assignment — no animation, game.js already pushes ~30fps
        let a = mv.camera
        // Ground truth for the JS overlay projection: where THIS view really
        // puts each probe coordinate on screen (UIKit pts == css px). game.js
        // fits a tiny screen-affine from its replica onto these, so overlay
        // and map agree exactly no matter what MapKit clamps or how the
        // flyover terrain anchors the camera. convert() answers with a STALE
        // camera if called in the same runloop turn as the camera assignment
        // (measured: probe points came back from the previous framing) — so
        // hop the runloop once before converting.
        DispatchQueue.main.async {
            var px: [Double] = [], py: [Double] = []
            for p in probes where p.count >= 2 {
                let pt = mv.convert(CLLocationCoordinate2D(latitude: p[0], longitude: p[1]), toPointTo: mv)
                px.append(Double(pt.x)); py.append(Double(pt.y))
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
}
