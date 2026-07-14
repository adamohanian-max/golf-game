// swift-tools-version: 5.9
import PackageDescription

// Internal dev tool — no signing, no App Store config. Build/run with
// `swift run` from this directory. See docs/TRACING.md for the workflow.
let package = Package(
    name: "CourseTracer",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "CourseTracer",
            path: "Sources/CourseTracer"
        )
    ]
)
