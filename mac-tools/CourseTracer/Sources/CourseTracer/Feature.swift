import AppKit
import CoreLocation

/// Feature kinds the tracer can author. Superset of the kinds the web viewer's
/// hole schema (docs/web_course_viewer_spec.md §8) currently samples (tee,
/// green, slope) — bunker/fairway/water/cartpath are named there as OSM-tag
/// "extra furniture" without an explicit kind sample, so this enum's raw
/// values are the ones that land in exported `properties.kind`.
enum FeatureKind: String, CaseIterable, Identifiable, Hashable {
    case green, tee, bunker, fairway, water, cartpath

    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }

    /// Overlay color, distinct per kind so a busy hole reads at a glance.
    var color: NSColor {
        switch self {
        case .green:    return .systemGreen
        case .tee:      return .systemBlue
        case .bunker:   return .systemYellow
        case .fairway:  return .systemTeal
        case .water:    return .systemIndigo
        case .cartpath: return .systemOrange
        }
    }
}

/// One completed (closed) polygon, in memory, before export.
struct TracedFeature: Identifiable {
    let id = UUID()
    var kind: FeatureKind
    var hole: Int
    /// Crosshair-captured coordinates, in trace order. Not yet ring-closed —
    /// GeoJSONExporter closes the ring (repeats the first point) on export.
    var vertices: [CLLocationCoordinate2D]
}
