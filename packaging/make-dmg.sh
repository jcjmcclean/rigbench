#!/usr/bin/env bash
# Build a shareable macOS DMG of Rigbench.
#
#   ./packaging/make-dmg.sh [build-dir]
#
# Produces dist/Rigbench-<version>.dmg from an already-built app bundle. By
# default it uses build-rel/ (the Universal release build — see below). If the
# app isn't built yet, configure + build it first:
#
#   cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DRIGBENCH_UNIVERSAL=ON
#   cmake --build build-rel --target Rigbench
#
# RIGBENCH_UNIVERSAL=ON gives an arm64+x86_64 binary so Intel-Mac friends can
# run it too. The DMG is self-signed ("Rigbench Dev") and NOT notarized, so the
# recipient needs the one-time Gatekeeper step printed at the end (see
# docs/distribution.md). To make a clean double-click-open DMG, notarize first
# with packaging/notarize.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-$REPO/build-rel}"
VERSION="$(sed -n 's/^project(Rigbench VERSION \([0-9.]*\).*/\1/p' "$REPO/CMakeLists.txt")"
APP="$BUILD_DIR/Rigbench_artefacts/RelWithDebInfo/Rigbench.app"
[ -d "$APP" ] || APP="$BUILD_DIR/Rigbench_artefacts/Rigbench.app"

if [ ! -d "$APP" ]; then
    echo "error: $APP not found. Build it first (see the header of this script)." >&2
    exit 1
fi

echo "App:     $APP"
echo "Arch:    $(lipo -archs "$APP/Contents/MacOS/Rigbench" 2>/dev/null || echo '?')"
echo "Version: $VERSION"

mkdir -p "$REPO/dist"
DMG="$REPO/dist/Rigbench-$VERSION.dmg"
rm -f "$DMG"

# Stage so the DMG shows the app next to an Applications shortcut.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create -volname "Rigbench $VERSION" -srcfolder "$STAGE" \
    -ov -format UDZO "$DMG" >/dev/null

echo ""
echo "Created $DMG ($(du -h "$DMG" | cut -f1))"
echo ""
echo "To share with someone (self-signed, not notarised):"
echo "  1. Send them the .dmg."
echo "  2. They drag Rigbench to Applications."
echo "  3. First launch: macOS blocks it. Then System Settings > Privacy & Security >"
echo "     Open Anyway (one-time; on macOS 14 and earlier, right-click > Open also"
echo "     works), OR run:"
echo "       xattr -dr com.apple.quarantine /Applications/Rigbench.app"
echo "  4. Approve the microphone prompt on first launch."
