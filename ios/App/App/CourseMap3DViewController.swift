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
    // good MKOverlay fit).
    //
    // STATIC BY CONTRACT — this is what made the spike flawless and what the
    // first production version broke: these overlays are added when the
    // greens-in-play set changes (rare) and then NEVER touched. No per-frame
    // renderer.alpha writes, no fade driven over the bridge — the first
    // version wrote renderer alphas on every syncCamera (30-60Hz, even with
    // the camera parked), which invalidated MapKit's overlay layer every
    // frame and destabilized the probe annotations' layout the same way
    // per-frame camera re-assignment does (see the lastReq guard below) —
    // the JS calibration ingested those shaky probe answers and every
    // JS-drawn element visibly bounced against a steady photo. Colors and
    // alphas are baked into the renderer's paint (fill #7ecb86 @ 0.13,
    // contour rgba(30,60,35,0.26) — drawGreen()'s exact values in game.js).
    private var greenOverlays: [MKOverlay] = []
    // Flag annotation — MapKit positions it through the same pipeline as the
    // probes (which are this system's calibration ground truth), so it is
    // pixel-glued to the pin coordinate by construction, upright, with zero
    // JS-side projection. State (visible/scale) changes are event-driven
    // from JS (setFlagState, deduped there) — never per-frame; the pennant
    // wave runs as a self-contained repeating Core Animation on the view's
    // own sublayer, which touches neither the map camera nor other
    // annotations' layout (static contract preserved).
    private var flagAnn: FlagAnnotation?

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
        if let mv = mapView {
            mv.removeOverlays(greenOverlays)
            if let f = flagAnn { mv.removeAnnotation(f) }
        }
        greenOverlays.removeAll()
        flagAnn = nil
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
    // DEBUG (misregistration experiment): counts syncs for throttled logging.
    private var dbgSyncN = 0

    func syncCamera(lat: Double, lon: Double, heading: Double, distM: Double, pitch: Double,
                    probes: [[Double]], dbgPinX: Double = .nan, dbgPinY: Double = .nan,
                    done: @escaping ([String: Any]) -> Void) {
        guard let mv = mapView else { done([:]); return }
        // DEBUG (misregistration experiment): compare the native flag view's
        // rendered center (model value, same read the probes use) against the
        // JS-projected pin. Read-only; ~1 line/sec; remove after.
        dbgSyncN += 1
        if dbgSyncN % 30 == 1, dbgPinX.isFinite,
           let f = flagAnn, let v = mv.view(for: f) {
            // view.center includes centerOffset (pole-base anchoring) — undo
            // it to get where MapKit renders the raw pin COORDINATE.
            let nx = Double(v.center.x - v.centerOffset.x), ny = Double(v.center.y - v.centerOffset.y)
            let dx = nx - dbgPinX, dy = ny - dbgPinY
            NSLog("CM3D-DBG pin flag=(%.1f,%.1f) js=(%.1f,%.1f) d=(%.1f,%.1f) |d|=%.1f pitch=%.1f distM=%.0f",
                  nx, ny, dbgPinX, dbgPinY,
                  dx, dy, (dx * dx + dy * dy).squareRoot(), pitch, distM)
        }
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
            // Disable implicit actions for the assignment: MapKit implicitly
            // ANIMATES annotation view repositioning while the tiles move
            // instantly (same behavior the probe reads dodge by using the
            // model .center) — so a visible annotation (the flag) lags the
            // ground by the animation curve during camera motion and slides
            // into place after it stops. The game pushes tiny camera steps at
            // 30-60Hz, so unanimated steps track exactly.
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            mv.camera = MKMapCamera(
                lookingAtCenter: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                fromDistance: max(distM, 60),
                pitch: CGFloat(pitch),
                heading: heading) // direct assignment — no animation, game.js already pushes ~30fps
            CATransaction.commit()
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
    /// The flag annotation gets its real view (checked first — it's also an
    /// MKPointAnnotation subclass, so it must not fall into the probe guard).
    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if let flag = annotation as? FlagAnnotation {
            let id = "cm3d-flag"
            let v = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? FlagAnnotationView)
                ?? FlagAnnotationView(annotation: flag, reuseIdentifier: id)
            v.annotation = flag
            v.apply(flag)
            return v
        }
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
    /// Once added, the overlays are never mutated (see the STATIC BY CONTRACT
    /// note on greenOverlays above).
    /// `greens`: [{ fill: [[lat,lon],...], contours: [{closed, pts:
    /// [[lat,lon],...]}] }] — already projected to corrected-WGS84 JS-side.
    func setGreenOverlay(_ greens: [JSObject]) {
        guard let mv = mapView else { return }
        mv.removeOverlays(greenOverlays)
        greenOverlays.removeAll()

        for green in greens {
            guard let fill = green["fill"] as? [[Double]], fill.count >= 3 else { continue }
            var contours: [GreenOverlay.Contour] = []
            for c in (green["contours"] as? [JSObject]) ?? [] {
                guard let pts = c["pts"] as? [[Double]], pts.count >= 2 else { continue }
                contours.append(GreenOverlay.Contour(
                    closed: (c["closed"] as? Bool) ?? false,
                    pts: pts.map { MKMapPoint(CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1])) }))
            }
            // Cup: present only on the green holding the pin. Radius arrives
            // in meters; convert to map points at the cup's latitude.
            var cup: MKMapPoint? = nil
            var cupRadius = 0.0
            if let cc = green["cup"] as? [Double], cc.count >= 2 {
                let coord = CLLocationCoordinate2D(latitude: cc[0], longitude: cc[1])
                cup = MKMapPoint(coord)
                let rM = (green["cupRadiusM"] as? Double) ?? 0
                cupRadius = rM * MKMapPointsPerMeterAtLatitude(coord.latitude)
            }
            let ov = GreenOverlay(
                fill: fill.map { MKMapPoint(CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1])) },
                contours: contours, cup: cup, cupRadius: cupRadius)
            greenOverlays.append(ov)
            mv.addOverlay(ov)
        }
    }

    /// Flag visibility/position/scale — called by JS ONLY on a state change
    /// (deduped there: pin move on hole change, ball-near-cup shrink in 0.05
    /// buckets, pulled-on-green visibility). Desired state also lives on the
    /// annotation itself so a view created later (MapKit lays views out a
    /// runloop after addAnnotation) picks it up in viewFor.
    func setFlagState(visible: Bool, scale: Double, lat: Double, lon: Double) {
        guard let mv = mapView else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let ann: FlagAnnotation
        if let existing = flagAnn {
            ann = existing
            if abs(ann.coordinate.latitude - lat) > 1e-9 || abs(ann.coordinate.longitude - lon) > 1e-9 {
                ann.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
        } else {
            ann = FlagAnnotation()
            ann.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            flagAnn = ann
            mv.addAnnotation(ann)
        }
        ann.flagVisible = visible
        ann.stickScale = CGFloat(scale)
        if let v = mv.view(for: ann) as? FlagAnnotationView {
            v.apply(ann)
        }
        CATransaction.commit()
    }

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let green = overlay as? GreenOverlay {
            return GreenOverlayRenderer(overlay: green)
        }
        return MKOverlayRenderer(overlay: overlay)
    }
}

/// One green = one overlay: the fill ring AND its break-contour paths,
/// rendered together in a single draw pass (GreenOverlayRenderer below).
/// One object through one rasterization pipeline — the exact path the
/// magenta-MKPolygon spike proved drapes correctly onto the flyover 3D
/// terrain — so the fill and its contours drape as a unit and can never
/// separate (the first version's separate MKMultiPolyline had unproven
/// drape behavior, and contours floating off the fill read as "the green
/// is off the photo"). Geometry is converted to MKMapPoint space once,
/// at construction; everything here is immutable after init, which also
/// makes it safe for MapKit's concurrent per-tile draw calls.
final class GreenOverlay: NSObject, MKOverlay {
    struct Contour {
        let closed: Bool
        let pts: [MKMapPoint]
    }
    let fill: [MKMapPoint]
    let contours: [Contour]
    // Cup (present only on the pin's green): center + radius in MAP POINTS
    // (converted from meters at construction). Flat ground paint — exactly
    // the kind of thing overlays are for; the upright flagstick is the
    // FlagAnnotation instead.
    let cup: MKMapPoint?
    let cupRadius: Double
    let boundingMapRect: MKMapRect
    let coordinate: CLLocationCoordinate2D

    init(fill: [MKMapPoint], contours: [Contour], cup: MKMapPoint? = nil, cupRadius: Double = 0) {
        self.fill = fill
        self.contours = contours
        self.cup = cup
        self.cupRadius = cupRadius
        var rect = MKMapRect.null
        for p in fill {
            rect = rect.union(MKMapRect(x: p.x, y: p.y, width: 0, height: 0))
        }
        // Small pad so contour strokes right at the fill edge don't clip at
        // the overlay's tile boundary.
        self.boundingMapRect = rect.insetBy(dx: -rect.size.width * 0.05 - 1, dy: -rect.size.height * 0.05 - 1)
        self.coordinate = MKMapPoint(x: rect.midX, y: rect.midY).coordinate
    }
}

final class GreenOverlayRenderer: MKOverlayRenderer {
    // drawGreen()'s exact photo-mode paint (game.js ~3546/3560): translucent
    // tint that lets the real turf show through, thin dark contour strokes.
    private static let fillColor = UIColor(red: 0x7e / 255, green: 0xcb / 255, blue: 0x86 / 255, alpha: 0.13).cgColor
    private static let contourColor = UIColor(red: 30 / 255, green: 60 / 255, blue: 35 / 255, alpha: 0.26).cgColor
    private static let cupFill = UIColor(red: 0x0a / 255, green: 0x1f / 255, blue: 0x0f / 255, alpha: 1).cgColor
    private static let cupRim = UIColor(red: 245 / 255, green: 245 / 255, blue: 235 / 255, alpha: 0.85).cgColor

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        guard let green = overlay as? GreenOverlay, green.fill.count >= 3 else { return }

        let ring = CGMutablePath()
        ring.move(to: point(for: green.fill[0]))
        for p in green.fill.dropFirst() { ring.addLine(to: point(for: p)) }
        ring.closeSubpath()

        context.addPath(ring)
        context.setFillColor(Self.fillColor)
        context.fillPath()

        if !green.contours.isEmpty {
            context.saveGState()
            // Clip contours to the green — the marching-squares paths are built
            // over the green's bounding box and rely on the draw-time clip (same
            // as drawGreen's withClip), otherwise they'd spill past the collar.
            context.addPath(ring)
            context.clip()
            let lines = CGMutablePath()
            for c in green.contours {
                lines.move(to: point(for: c.pts[0]))
                for p in c.pts.dropFirst() { lines.addLine(to: point(for: p)) }
                if c.closed { lines.closeSubpath() }
            }
            context.addPath(lines)
            context.setStrokeColor(Self.contourColor)
            context.setLineWidth(1.2 / zoomScale) // ~constant screen px at any zoom
            context.setLineJoin(.round)
            context.setLineCap(.round)
            context.strokePath()
            context.restoreGState()
        }

        // Cup — dark hole + bright rim (drawGreen's exact colors). Drawn last
        // so it sits over the contours. The REAL cup is 0.15 m radius —
        // sub-pixel at every normal zoom — so like the JS version
        // (max(ws(holeRadius), 3)) the drawn size is floored at ~3.5 screen
        // px via zoomScale, the same per-tile-rasterization idiom as the
        // contour line width (no per-frame mutation; MapKit re-rasterizes
        // tiles on zoom changes anyway).
        if let cup = green.cup, green.cupRadius > 0 {
            let rr = max(green.cupRadius, Double(3.5 / zoomScale))
            let mr = MKMapRect(x: cup.x - rr, y: cup.y - rr, width: rr * 2, height: rr * 2)
            let r = rect(for: mr)
            context.setFillColor(Self.cupFill)
            context.fillEllipse(in: r)
            context.setStrokeColor(Self.cupRim)
            context.setLineWidth(max(r.width * 0.18, 0.8 / zoomScale))
            context.strokeEllipse(in: r)
        }
    }
}

/// Pin flag as a real MKAnnotationView — MapKit positions it through the
/// same pipeline as the calibration probes (this system's ground truth), so
/// it's glued to the pin coordinate with zero JS-side projection: the last
/// green-side element that wiggled during camera moves. Carries its desired
/// visible/scale state so a view laid out a runloop after addAnnotation
/// still picks it up (see CourseMap3DLayer.setFlagState).
final class FlagAnnotation: MKPointAnnotation {
    var flagVisible = true
    var stickScale: CGFloat = 1
}

final class FlagAnnotationView: MKAnnotationView {
    // Fixed intrinsic size — the JS flag already sat at its 22px floor at
    // most zooms, and it's pulled (hidden) on the green, so putt-zoom sizes
    // never show. Pole base at (4, 44); pennant flies right from the top.
    private static let W: CGFloat = 30, H: CGFloat = 46
    private static let base = CGPoint(x: 4, y: 44)
    private static let top = CGPoint(x: 4, y: 10)

    private let contentLayer = CALayer()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: Self.W, height: Self.H)
        // Anchor the annotation at the pole BASE, not the view center: the
        // coordinate lands at view point (center - offset), so offset =
        // center - base = (W/2 - 4, H/2 - 44) = (+11, -21).
        centerOffset = CGPoint(x: Self.W / 2 - Self.base.x, y: Self.H / 2 - Self.base.y)
        canShowCallout = false
        isEnabled = false
        backgroundColor = .clear

        // Container scaled about the pole base for the ball-near-cup shrink
        // (fs) — one transform, set only when JS's deduped state changes.
        contentLayer.frame = bounds
        contentLayer.anchorPoint = CGPoint(x: Self.base.x / Self.W, y: Self.base.y / Self.H)
        contentLayer.position = Self.base
        layer.addSublayer(contentLayer)

        // Short ground shadow of the stick (drawGreen's exact look).
        let shadow = CAShapeLayer()
        let sp = CGMutablePath()
        sp.move(to: Self.base)
        sp.addLine(to: CGPoint(x: Self.base.x + 7, y: Self.base.y + 2))
        shadow.path = sp
        shadow.strokeColor = UIColor(white: 0, alpha: 0.28).cgColor
        shadow.lineWidth = 2.5
        shadow.fillColor = nil
        contentLayer.addSublayer(shadow)

        let pole = CAShapeLayer()
        let pp = CGMutablePath()
        pp.move(to: Self.base)
        pp.addLine(to: Self.top)
        pole.path = pp
        pole.strokeColor = UIColor(red: 0xf4 / 255, green: 0xf4 / 255, blue: 0xf0 / 255, alpha: 1).cgColor
        pole.lineWidth = 2
        pole.fillColor = nil
        contentLayer.addSublayer(pole)

        // Red pennant (JS's static wave shape), rotated gently around the
        // pole top by a self-contained repeating animation — no bridge
        // traffic, no MapKit re-layout, just a composited sublayer wobble.
        let pennant = CAShapeLayer()
        let fp = CGMutablePath()
        let L: CGFloat = 15, FH: CGFloat = 10
        fp.move(to: Self.top)
        fp.addQuadCurve(to: CGPoint(x: Self.top.x + L, y: Self.top.y + FH * 0.5),
                        control: CGPoint(x: Self.top.x + L * 0.5, y: Self.top.y))
        fp.addQuadCurve(to: CGPoint(x: Self.top.x, y: Self.top.y + FH),
                        control: CGPoint(x: Self.top.x + L * 0.5, y: Self.top.y + FH * 0.5))
        fp.closeSubpath()
        pennant.path = fp
        pennant.fillColor = UIColor(red: 0xe0 / 255, green: 0x2a / 255, blue: 0x25 / 255, alpha: 1).cgColor
        pennant.strokeColor = UIColor(red: 120 / 255, green: 15 / 255, blue: 12 / 255, alpha: 0.6).cgColor
        pennant.lineWidth = 1
        pennant.frame = bounds
        pennant.anchorPoint = CGPoint(x: Self.top.x / Self.W, y: Self.top.y / Self.H)
        pennant.position = Self.top
        contentLayer.addSublayer(pennant)
        pennantLayer = pennant
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private weak var pennantLayer: CAShapeLayer?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // (Re)start the wave — CA removes animations when the view leaves a
        // window, so re-add whenever we come back.
        guard window != nil, let p = pennantLayer, p.animation(forKey: "wave") == nil else { return }
        let a = CABasicAnimation(keyPath: "transform.rotation.z")
        a.fromValue = -0.06
        a.toValue = 0.06
        a.duration = 1.15
        a.autoreverses = true
        a.repeatCount = .infinity
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        p.add(a, forKey: "wave")
    }

    func apply(_ ann: FlagAnnotation) {
        isHidden = !ann.flagVisible
        contentLayer.transform = CATransform3DMakeScale(ann.stickScale, ann.stickScale, 1)
    }
}
