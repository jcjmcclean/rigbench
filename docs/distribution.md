# Distribution & cross-platform builds

How to build Tonebench for each OS and share it with people. Short version:
**on macOS you can share a DMG today for free** (recipient does a one-time
right-click-Open); a zero-warning install needs a paid Apple Developer account.
Linux and Windows builds are feasible and wired into CI, but each OS must be
built on its own machine — you can't cross-compile from the Mac (the WebView,
VST3, and compiler toolchains are all native-only).

## macOS

### Make a shareable build right now (free, no Apple account)

```sh
# Universal (arm64 + Intel) so any Mac can run it:
cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTONEBENCH_UNIVERSAL=ON
cmake --build build-rel --target Tonebench
./packaging/make-dmg.sh            # -> dist/Tonebench-<version>.dmg
```

Send the `.dmg`. Tell the recipient:

1. Open the DMG, drag **Tonebench** to **Applications**.
2. First launch: **right-click Tonebench → Open → Open** (one-time), or run
   `xattr -dr com.apple.quarantine /Applications/Tonebench.app`.
3. Approve the microphone prompt.

Why the extra step: the app is signed with a local self-signed identity
("Tonebench Dev"), which only exists in your keychain, so Gatekeeper treats it as
"unidentified developer" on any other Mac. This is expected and the right-click
step is the standard override. (`arm64`-only builds simply won't launch on Intel
Macs — hence `TONEBENCH_UNIVERSAL=ON` for anything you share.)

### Zero-warning installs (paid: Apple Developer Program, $99/yr)

For a clean double-click open with no `xattr` dance:

1. Create a **Developer ID Application** certificate in your Apple Developer account.
2. Store a notary credential once:
   `xcrun notarytool store-credentials tonebench-notary --apple-id <you> --team-id <TEAM>`
3. Sign (hardened runtime + entitlements) and notarize:
   ```sh
   DEV_ID="Developer ID Application: Your Name (TEAMID)" ./packaging/notarize.sh dist/Tonebench-<v>.dmg
   ./packaging/make-dmg.sh build-rel        # repackage from the signed app
   xcrun notarytool submit dist/Tonebench-<v>.dmg --keychain-profile tonebench-notary --wait
   xcrun stapler staple dist/Tonebench-<v>.dmg
   ```

The hardened runtime is required for notarization and needs real entitlements —
`packaging/Tonebench.entitlements` supplies microphone access plus the
library-validation/JIT exemptions a VST3 host needs to load third-party plugins
(see [SECURITY.md](../SECURITY.md)).

## Linux

Feasible — NAM core and JUCE's VST3 host are cross-platform; the only
platform-specific piece is the WebView (WebKitGTK here). System build deps
(Ubuntu/Debian names):

```sh
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libasound2-dev libjack-jackd2-dev \
  libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev \
  libfreetype6-dev libfontconfig1-dev ninja-build
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target Tonebench
```

Package as a plain tarball (simplest), an **AppImage** (best double-click UX —
bundles the GTK/WebKit libs), or a `.deb`.

## Windows

Feasible with MSVC. The WebView is **WebView2** (the `NEEDS_WEBVIEW2 TRUE` flag
is already set in CMake — without it the UI↔engine bridge won't work). WebView2
runtime ships on current Windows 10/11; otherwise bundle the Evergreen
bootstrapper.

```bat
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --config RelWithDebInfo --target Tonebench
```

To avoid SmartScreen warnings, sign with Authenticode
(`signtool sign /fd sha256 /tr <timestamp-url> /td sha256 /a Tonebench.exe`); an
EV certificate buys instant reputation. Package as a `.zip` or an Inno Setup
installer (bundle the WebView2 bootstrapper).

## CI

`.github/workflows/build.yml` builds on `macos-latest` / `ubuntu-latest` /
`windows-latest` (native runners only — no cross-compilation). A **`v*` tag
publishes a GitHub Release** with all three binaries attached (DMG / tarball /
zip); a manual **Actions → build → Run workflow** leaves them as run artifacts.
`.github/workflows/ci.yml` runs the C++ selftest and the UI tests on every push.

Cut a release:

```sh
git tag v0.1.0
git push origin v0.1.0      # runs the matrix and creates the GitHub Release
```

Prerequisite: the repo must be on GitHub (push it + enable Actions) — a local-only
repo won't run CI.
