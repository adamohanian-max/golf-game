import MapKit
import SwiftUI

/// Overlay subclasses carrying which FeatureKind they render — lets one
/// delegate method color-code by kind without a side table.
final class KindPolygon: MKPolygon {
    var kind: FeatureKind = .green
}
final class KindPolyline: MKPolyline {
    var kind: FeatureKind = .green
}

/// Thin NSViewRepresentable around MKMapView. Deliberately has none of the
/// probe-annotation / calibration-affine machinery that CourseMap3D (the
/// game's tilted-overlay iOS layer) needs — all of that exists there purely
/// to fight MapKit's pitch-anchor nondeterminism, which only shows up when
/// pitch > 0. This tool locks pitch to 0 permanently, so `mapView.convert`
/// is exact by construction (proven the hard way debugging that overlay —
/// see .claude/skills/mapkit-flyover/). No probes needed here.
struct MapView: NSViewRepresentable {
    @ObservedObject var viewModel: TracerViewModel

    // Butter Brook clubhouse — just a reasonable default so there's imagery
    // on first launch; pan anywhere from there.
    private static let startCoordinate = CLLocationCoordinate2D(latitude: 42.5365, longitude: -71.4017)

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> MKMapView {
        context.coordinator.viewModel = viewModel
        // A .zero-frame MKMapView's internal Metal-backed tile layer can latch
        // a 0x0 drawable at construction and never recover even once SwiftUI
        // resizes it — chrome (scale bar, attribution) and camera/delegate
        // state are unaffected (separate from the tile layer), but no tile
        // pixels ever draw, for either map type. A real starting frame avoids it.
        let mv = MKMapView(frame: NSRect(x: 0, y: 0, width: 900, height: 700))
        mv.delegate = context.coordinator
        mv.mapType = viewModel.mapType
        mv.showsCompass = false
        mv.showsScale = true
        mv.showsZoomControls = false
        mv.pointOfInterestFilter = .excludingAll

        mv.setCenter(Self.startCoordinate, animated: false)
        let camera = mv.camera
        camera.pitch = 0
        camera.altitude = 400
        mv.camera = camera

        viewModel.mapView = mv
        return mv
    }

    func updateNSView(_ mv: MKMapView, context: Context) {
        if mv.mapType != viewModel.mapType {
            mv.mapType = viewModel.mapType
        }
        // Defensive re-lock every update — cheap no-op once already 0.
        // .satellite (non-flyover) already refuses pitch, so this is
        // belt-and-suspenders, not load-bearing.
        if mv.camera.pitch != 0 {
            let c = mv.camera
            c.pitch = 0
            mv.camera = c
        }
        context.coordinator.refreshOverlays(mv, viewModel: viewModel)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        private var lastInProgressCount = -1
        private var lastFeatureCount = -1
        private var lastKind: FeatureKind?
        weak var viewModel: TracerViewModel?

        // Altitude is read here — reacting to MapKit's own "the camera
        // actually moved" signal — instead of writing a @Published property
        // from inside updateNSView. Writing there on every call created a
        // render feedback loop (view updates -> updateNSView -> published
        // write -> view update -> ...), which pegged a CPU core and, worse,
        // appeared to starve the run loop before it ever presented a window.
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            viewModel?.currentAltitude = mapView.camera.altitude
        }

        func refreshOverlays(_ mapView: MKMapView, viewModel: TracerViewModel) {
            let sameShape = viewModel.inProgress.count == lastInProgressCount
                && viewModel.features.count == lastFeatureCount
                && viewModel.selectedKind == lastKind
            guard !sameShape else { return }
            lastInProgressCount = viewModel.inProgress.count
            lastFeatureCount = viewModel.features.count
            lastKind = viewModel.selectedKind

            mapView.removeOverlays(mapView.overlays)

            for feature in viewModel.features {
                var coords = feature.vertices
                let polygon = KindPolygon(coordinates: &coords, count: coords.count)
                polygon.kind = feature.kind
                mapView.addOverlay(polygon)
            }
            if viewModel.inProgress.count >= 2 {
                var coords = viewModel.inProgress
                let line = KindPolyline(coordinates: &coords, count: coords.count)
                line.kind = viewModel.selectedKind
                mapView.addOverlay(line)
            }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let polygon = overlay as? KindPolygon {
                let r = MKPolygonRenderer(polygon: polygon)
                r.strokeColor = polygon.kind.color
                r.fillColor = polygon.kind.color.withAlphaComponent(0.25)
                r.lineWidth = 2
                return r
            }
            if let line = overlay as? KindPolyline {
                let r = MKPolylineRenderer(polyline: line)
                r.strokeColor = line.kind.color
                r.lineWidth = 2
                r.lineDashPattern = [6, 4]
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }
    }
}
