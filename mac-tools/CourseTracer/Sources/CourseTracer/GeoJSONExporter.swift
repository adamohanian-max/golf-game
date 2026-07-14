import Foundation
import CoreLocation

enum ExportError: Error, LocalizedError {
    case repoRootNotFound
    case noFeatures

    var errorDescription: String? {
        switch self {
        case .repoRootNotFound:
            return "Could not find the repo root — looked for a `courses/` directory " +
                   "in the current directory and its parents. Run this tool from " +
                   "somewhere inside the golf-game checkout."
        case .noFeatures:
            return "No closed features to export."
        }
    }
}

/// Writes traced features to `data/traced/{courseId}-apple.geojson`, matching
/// the hole schema in docs/web_course_viewer_spec.md §8 (FeatureCollection of
/// Features, `properties.kind`, `[lng, lat]` coordinate order), plus a
/// `frame: "apple"` property on every feature — this is geometry traced
/// directly against Apple's own MapKit projection, not true WGS84, and
/// anything downstream must know that (see scripts/apply-correction.mjs,
/// which asserts on this field rather than assuming).
enum GeoJSONExporter {
    /// Walks up from a starting directory looking for `courses/`.
    static func findRepoRoot(startingAt start: URL) -> URL? {
        var dir = start.standardizedFileURL
        for _ in 0..<8 {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("courses").path) {
                return dir
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { return nil }
            dir = parent
        }
        return nil
    }

    /// Tries the process's current working directory first (works for `swift
    /// run` from anywhere inside the checkout), then falls back to the app
    /// bundle's own on-disk location — launched via `open`/double-click, a GUI
    /// app's cwd is reset to "/" or the user's home directory regardless of
    /// where it was launched from, but `CourseTracer.app` itself still
    /// physically lives at `mac-tools/CourseTracer/CourseTracer.app` inside
    /// the repo checkout (see run.sh), so walking up from there works too.
    static func findRepoRoot() -> URL? {
        if let hit = findRepoRoot(startingAt: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)) {
            return hit
        }
        return findRepoRoot(startingAt: Bundle.main.bundleURL)
    }

    @discardableResult
    static func export(features: [TracedFeature], courseId: String) throws -> URL {
        guard !features.isEmpty else { throw ExportError.noFeatures }
        guard let root = findRepoRoot() else { throw ExportError.repoRootNotFound }

        let dir = root.appendingPathComponent("data/traced", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(courseId)-apple.geojson")

        let collection: [String: Any] = [
            "type": "FeatureCollection",
            "features": features.map(featureDict),
        ]
        let data = try JSONSerialization.data(withJSONObject: collection, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
        return url
    }

    private static func featureDict(_ f: TracedFeature) -> [String: Any] {
        [
            "type": "Feature",
            "properties": [
                "kind": f.kind.rawValue,
                "hole": f.hole,
                "frame": "apple",
            ],
            "geometry": [
                "type": "Polygon",
                "coordinates": [closedRing(f.vertices)],
            ],
        ]
    }

    /// GeoJSON polygon rings must be closed (first point repeated at the end).
    private static func closedRing(_ coords: [CLLocationCoordinate2D]) -> [[Double]] {
        var ring = coords.map { [$0.longitude, $0.latitude] }
        if let first = coords.first, let last = coords.last,
           first.latitude != last.latitude || first.longitude != last.longitude {
            ring.append([first.longitude, first.latitude])
        }
        return ring
    }
}
