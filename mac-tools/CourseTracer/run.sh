#!/bin/bash
# Build + run CourseTracer as a proper .app bundle.
#
# A bare `swift run`/`swift build` executable has no LaunchServices
# registration — on this macOS, that means NSApplication never gets a real
# window session (confirmed: the process runs, MapKit even starts fetching
# tiles, but no window ever appears and Accessibility can't see the process
# at all). Wrapping the same binary in a minimal .app bundle fixes it.
#
# MapKit tile fetches also came back blank (a flat placeholder fill, no
# imagery/vector content, for BOTH .standard and .satellite) until the
# bundle was ad-hoc code-signed. That's still "no signing config" in the
# sense of no Apple Developer Program enrollment, no Team ID, no
# provisioning profile — `codesign --sign -` is free, local-only, and
# doesn't require an Apple ID. It just gives the binary a valid Mach-O
# signature, which MapKit's tile service apparently checks for even on a
# read-only local dev build.
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-debug}"
swift build --configuration "$CONFIG"

BIN=".build/arm64-apple-macosx/$CONFIG/CourseTracer"
if [ ! -f "$BIN" ]; then
  # universal/other-arch build layouts
  BIN=$(find .build -maxdepth 3 -name CourseTracer -type f -perm +111 | grep "/$CONFIG/" | head -1)
fi

APP="CourseTracer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/CourseTracer"
cp Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"

echo "Built + ad-hoc signed $APP — launching."
open "$APP"
