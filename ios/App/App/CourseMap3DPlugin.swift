import Capacitor
import UIKit

// Bridges game.js -> the persistent native ground layer (CourseMap3DLayer),
// inserted BEHIND the Capacitor WKWebView. This is the native analogue of the
// existing #c3d-behind-#game canvas-stacking trick three3d/course3d.js uses
// for Four Oaks: MapKit has no in-page renderer (native or MapKit JS) to
// stack as a web canvas, so the "layer behind #game" has to live in the
// native UIKit view hierarchy instead. Dumb/render-only — game.js does all
// the world-units -> lat/lon math (course.geo.toLonLat) and just pushes a
// finished region each frame via syncCamera.
@objc(CourseMap3DPlugin)
public class CourseMap3DPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CourseMap3DPlugin"
    public let jsName = "CourseMap3D"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "enter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "leave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGreenOverlay", returnType: CAPPluginReturnPromise)
    ]

    private let layer = CourseMap3DLayer()

    @objc func enter(_ call: CAPPluginCall) {
        NSLog("CourseMap3D: enter() called")
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                NSLog("CourseMap3D: enter() FAILED — no bridge.webView")
                call.reject("no bridge view"); return
            }
            // CAPBridgeViewController sets `view = webView` (confirmed in
            // CAPBridgeViewController.swift) — the controller's view IS the
            // webview, not a container holding it. So the only valid parent
            // to insert a real sibling "behind" the webview is webView's own
            // superview (its containing UIWindow), not viewController.view.
            guard let parent = webView.superview else {
                NSLog("CourseMap3D: enter() FAILED — webView.superview is nil")
                call.reject("webview has no superview yet"); return
            }
            NSLog("CourseMap3D: enter() inserting mapView into \(type(of: parent)), webView frame=\(webView.frame)")
            self.layer.enter(into: parent, behind: webView)
            call.resolve()
        }
    }

    @objc func leave(_ call: CAPPluginCall) {
        NSLog("CourseMap3D: leave() called")
        DispatchQueue.main.async {
            self.layer.leave()
            call.resolve()
        }
    }

    private var syncCount = 0
    @objc func syncCamera(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon"),
              let heading = call.getDouble("heading"), let distM = call.getDouble("distM") else {
            NSLog("CourseMap3D: syncCamera() FAILED — missing params: \(call.options ?? [:])")
            call.reject("lat/lon/heading/distM required"); return
        }
        let pitch = call.getDouble("pitch") ?? 0
        // Live fade for the native green overlay (mirrors game.js's _apDetailA)
        // — piggybacked on this existing per-frame call rather than a second
        // bridge round-trip, since this value already changes every frame.
        let detailAlpha = call.getDouble("detailAlpha") ?? 0
        syncCount += 1
        if syncCount % 30 == 1 { // log roughly once/sec at the ~30fps throttle, not every frame
            NSLog("CourseMap3D: syncCamera #\(syncCount) lat=\(lat) lon=\(lon) heading=\(heading) distM=\(distM) pitch=\(pitch)")
        }
        // probes: [[lat,lon],...] — coordinates the JS overlay wants ground-truth
        // screen positions for (see CourseMap3DLayer.syncCamera).
        let probes = (call.getArray("probes") as? [[Double]]) ?? []
        DispatchQueue.main.async {
            self.layer.syncCamera(lat: lat, lon: lon, heading: heading, distM: distM, pitch: pitch,
                                   probes: probes, detailAlpha: detailAlpha) { actual in
                var out = JSObject()
                for (k, v) in actual {
                    if let d = v as? Double { out[k] = d }
                    else if let arr = v as? [Double] { out[k] = arr.map { $0 as JSValue } }
                }
                call.resolve(out)
            }
        }
    }

    // greens: [{ fill: [[lat,lon],...], contours: [{closed: Bool, pts: [[lat,lon],...]}] }].
    // Called only when game.js's greensInPlay() set changes (hole change /
    // ball crossing into a new green's relevance) — not every frame. World
    // units -> corrected-WGS84 projection already happened JS-side (reuses
    // appleGeoAffine(), the same math the camera/probes use).
    @objc func setGreenOverlay(_ call: CAPPluginCall) {
        let greens = call.getArray("greens", JSObject.self) ?? []
        DispatchQueue.main.async {
            self.layer.setGreenOverlay(greens)
            call.resolve()
        }
    }
}
