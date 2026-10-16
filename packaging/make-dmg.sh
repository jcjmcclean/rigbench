#!/usr/bin/env bash
# Build a shareable macOS DMG of Tonebench.
#
#   ./packaging/make-dmg.sh [build-dir]
#
# Produces dist/Tonebench-<version>.dmg from an already-built app bundle. By
# default it uses build-rel/ (the Universal release build — see below). If the
# app isn't built yet, configure + build it first:
#
#   cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTONEBENCH_UNIVERSAL=ON
#   cmake --build build-rel --target Tonebench
#
# TONEBENCH_UNIVERSAL=ON gives an arm64+x86_64 binary so Intel-Mac friends can
# run it too. The DMG is self-signed ("Tonebench Dev") and NOT notarized, so the
# recipient needs the one-time Gatekeeper step printed at the end (see
# docs/distribution.md). To make a clean double-click-open DMG, notarize first
# with packaging/notarize.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-$REPO/build-rel}"
VERSION="$(sed -n 's/^project(Tonebench VERSION \([0-9.]*\).*/\1/p' "$REPO/CMakeLists.txt")"
APP="$BUILD_DIR/Tonebench_artefacts/RelWithDebInfo/Tonebench.app"
[ -d "$APP" ] || APP="$BUILD_DIR/Tonebench_artefacts/Tonebench.app"

if [ ! -d "$APP" ]; then
    echo "error: $APP not found. Build it first (see the header of this script)." >&2
    exit 1
fi

echo "App:     $APP"
echo "Arch:    $(lipo -archs "$APP/Contents/MacOS/Tonebench" 2>/dev/null || echo '?')"
echo "Version: $VERSION"

mkdir -p "$REPO/dist"
DMG="$REPO/dist/Tonebench-$VERSION.dmg"
rm -f "$DMG"

# Stage so the DMG shows the app next to an Applications shortcut.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

hdiutil create -volname "Tonebench $VERSION" -srcfolder "$STAGE" \
    -ov -format UDZO "$DMG" >/dev/null

echo ""
echo "Created $DMG ($(du -h "$DMG" | cut -f1))"
echo ""
echo "To share with someone (self-signed, not notarized):"
echo "  1. Send them the .dmg."
echo "  2. They drag Tonebench to Applications."
echo "  3. First launch: right-click Tonebench -> Open -> Open  (one-time"
echo "     Gatekeeper override), OR run:"
echo "       xattr -dr com.apple.quarantine /Applications/Tonebench.app"
echo "  4. Approve the microphone prompt on first launch."
