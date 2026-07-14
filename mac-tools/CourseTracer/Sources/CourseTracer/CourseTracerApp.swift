import AppKit
import SwiftUI

/// A Swift-Package executable (no .app bundle, no Info.plist) launched via
/// `swift run` otherwise comes up with the wrong NSApplication activation
/// policy — the process runs, but no window ever appears and it never takes
/// focus. Forcing `.regular` + activating fixes it; a bundled/Xcode-built app
/// wouldn't need this.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct CourseTracerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var viewModel = TracerViewModel()

    var body: some Scene {
        WindowGroup("Course Tracer") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 960, minHeight: 640)
        }
        // Global shortcuts via the menu-command system (works regardless of
        // first responder, including while the hole-number field has focus —
        // see docs/TRACING.md for the one place that bites: Space while
        // typing in a text field still fires Add Point).
        .commands {
            CommandMenu("Trace") {
                Button("Add Point") { viewModel.addVertex() }
                    .keyboardShortcut(.space, modifiers: [])
                Button("Undo Last Point") { viewModel.undoLastPoint() }
                    .keyboardShortcut("z", modifiers: .command)
                Button("Close Polygon") { viewModel.closePolygon() }
                    .keyboardShortcut(.return, modifiers: [])
                Button("Delete Last Feature") { viewModel.deleteLastFeature() }
                    .keyboardShortcut(.delete, modifiers: .command)
                Divider()
                Button("Export GeoJSON") { viewModel.export() }
                    .keyboardShortcut("e", modifiers: .command)
            }
        }
    }
}
