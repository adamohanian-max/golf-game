import Combine
import CoreLocation
import MapKit

/// All tracer state. The map view reads/writes this directly (via a weak
/// back-reference set once in MapView.makeNSView) rather than round-tripping
/// through SwiftUI bindings for every crosshair capture — there's only ever
/// one map view, and this keeps addVertex() a single, obvious call.
@MainActor
final class TracerViewModel: ObservableObject {
    @Published var courseId: String = "butter-brook-golf-club"
    @Published var selectedKind: FeatureKind = .green
    @Published var selectedHole: Int = 1
    @Published var mapType: MKMapType = .satellite

    @Published private(set) var inProgress: [CLLocationCoordinate2D] = []
    @Published private(set) var features: [TracedFeature] = []
    @Published var statusMessage: String = "Ready. Pan under the crosshair, then Add Point."
    @Published var currentAltitude: CLLocationDistance = 0

    weak var mapView: MKMapView?

    var vertexCount: Int { inProgress.count }
    var featureCount: Int { features.count }

    /// Captures whatever coordinate currently sits under the fixed crosshair —
    /// NOT a click position. Precision is bounded by zoom level, not by
    /// pointing accuracy (the whole reason this tool pans-under-crosshair
    /// instead of click-to-place; see docs/TRACING.md).
    func addVertex() {
        guard let mapView else {
            statusMessage = "Map not ready yet."
            return
        }
        let center = CGPoint(x: mapView.bounds.midX, y: mapView.bounds.midY)
        let coord = mapView.convert(center, toCoordinateFrom: mapView)
        inProgress.append(coord)
        statusMessage = "Point \(inProgress.count) added (\(selectedKind.displayName), hole \(selectedHole))."
    }

    func undoLastPoint() {
        guard !inProgress.isEmpty else {
            statusMessage = "Nothing to undo."
            return
        }
        inProgress.removeLast()
        statusMessage = "Undid last point — \(inProgress.count) left in this shape."
    }

    func closePolygon() {
        guard inProgress.count >= 3 else {
            statusMessage = "Need at least 3 points to close a polygon (have \(inProgress.count))."
            return
        }
        let feature = TracedFeature(kind: selectedKind, hole: selectedHole, vertices: inProgress)
        features.append(feature)
        inProgress.removeAll()
        statusMessage = "Closed \(feature.kind.displayName), hole \(feature.hole), " +
                         "\(feature.vertices.count) pts. \(features.count) features total."
    }

    func deleteLastFeature() {
        guard let removed = features.popLast() else {
            statusMessage = "No features to delete."
            return
        }
        statusMessage = "Deleted \(removed.kind.displayName), hole \(removed.hole)."
    }

    func export() {
        do {
            let url = try GeoJSONExporter.export(features: features, courseId: courseId)
            statusMessage = "Exported \(features.count) features -> \(url.path)"
        } catch {
            statusMessage = "Export failed: \(error.localizedDescription)"
        }
    }
}
