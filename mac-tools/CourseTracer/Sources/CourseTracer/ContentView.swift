import MapKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var viewModel: TracerViewModel

    var body: some View {
        HStack(spacing: 0) {
            ZStack {
                MapView(viewModel: viewModel)
                Crosshair().allowsHitTesting(false)
            }
            .frame(minWidth: 560)

            Divider()

            sidebar
                .frame(width: 300)
                .padding(16)
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Course Tracer").font(.title2).bold()

            VStack(alignment: .leading, spacing: 4) {
                Text("COURSE ID").font(.caption).foregroundStyle(.secondary)
                TextField("course-id", text: $viewModel.courseId)
                    .textFieldStyle(.roundedBorder)
            }

            Stepper(value: $viewModel.selectedHole, in: 1...18) {
                Text("Hole \(viewModel.selectedHole)")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("FEATURE KIND").font(.caption).foregroundStyle(.secondary)
                Picker("Kind", selection: $viewModel.selectedKind) {
                    ForEach(FeatureKind.allCases) { kind in
                        Text(kind.displayName).tag(kind)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("MAP TYPE").font(.caption).foregroundStyle(.secondary)
                Picker("Map type", selection: $viewModel.mapType) {
                    Text("Satellite").tag(MKMapType.satellite)
                    Text("Hybrid").tag(MKMapType.hybrid)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Button {
                    viewModel.addVertex()
                } label: {
                    Label("Add Point", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                HStack {
                    Button("Undo Point") { viewModel.undoLastPoint() }
                    Button("Close Polygon") { viewModel.closePolygon() }
                }
                Button("Delete Last Feature") { viewModel.deleteLastFeature() }
                    .foregroundStyle(.red)
            }

            Divider()

            VStack(alignment: .leading, spacing: 2) {
                Text("Vertices in progress: \(viewModel.vertexCount)")
                Text("Features closed: \(viewModel.featureCount)")
                Text("Altitude: \(Int(viewModel.currentAltitude)) m")
            }
            .font(.system(.body, design: .monospaced))

            if !viewModel.features.isEmpty {
                Divider()
                Text("FEATURES").font(.caption).foregroundStyle(.secondary)
                List(viewModel.features) { f in
                    Text("H\(f.hole) · \(f.kind.displayName) · \(f.vertices.count)pt")
                        .font(.caption)
                }
                .listStyle(.plain)
                .frame(maxHeight: 220)
            }

            Spacer()

            Button {
                viewModel.export()
            } label: {
                Label("Export GeoJSON", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Text(viewModel.statusMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Fixed at the view's exact center, independent of MapKit's own drawing.
/// This — not the cursor — is where addVertex() reads a coordinate from.
private struct Crosshair: View {
    var body: some View {
        GeometryReader { geo in
            let c = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)
            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: c.x - 14, y: c.y))
                    p.addLine(to: CGPoint(x: c.x + 14, y: c.y))
                    p.move(to: CGPoint(x: c.x, y: c.y - 14))
                    p.addLine(to: CGPoint(x: c.x, y: c.y + 14))
                }
                .stroke(Color.white, lineWidth: 1.5)
                Circle()
                    .stroke(Color.white, lineWidth: 1.5)
                    .frame(width: 10, height: 10)
                    .position(c)
            }
            .shadow(color: .black.opacity(0.8), radius: 1.5)
        }
    }
}
