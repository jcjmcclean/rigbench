#!/usr/bin/env bash
# Sign (Developer ID + hardened runtime) and notarize a Rigbench DMG so it
# opens with no Gatekeeper warnings on any Mac. Requires an Apple Developer
# Program membership ($99/yr) and a "Developer ID Application" certificate.
#
#   APPLE_ID=you@example.com TEAM_ID=XXXXXXXXXX \
#   DEV_ID="Developer ID Application: Your Name (XXXXXXXXXX)" \
#   ./packaging/notarize.sh dist/Rigbench-0.1.0.dmg
#
# Set up the notary credential once:
#   xcrun notarytool store-credentials rigbench-notary \
#       --apple-id "$APPLE_ID" --team-id "$TEAM_ID"   # prompts for an app-specific password
set -euo pipefail

DMG="${1:?usage: notarize.sh <dmg>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DEV_ID:?set DEV_ID to your 'Developer ID Application: ...' identity}"
APP="$(hdiutil attach "$DMG" -nobrowse -readonly | awk '/\/Volumes\//{print $3}' | head -1)/Rigbench.app"

# 1. Re-sign the app with Developer ID + hardened runtime + entitlements.
#    --deep is needed so the embedded frameworks/helpers are signed too.
codesign --force --deep --options runtime \
    --entitlements "$REPO/packaging/Rigbench.entitlements" \
    --sign "$DEV_ID" "$APP"
codesign --verify --strict --verbose=2 "$APP"

# (re-create the DMG from the signed app before submitting — notarization
#  checks the contents, so sign the app, then repackage, then notarize the DMG.)
echo "App signed. Repackage the DMG from the signed app (packaging/make-dmg.sh)"
echo "then submit it:"
echo "  xcrun notarytool submit \"$DMG\" --keychain-profile rigbench-notary --wait"
echo "  xcrun stapler staple \"$DMG\""
