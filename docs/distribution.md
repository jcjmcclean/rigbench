# Distribution & cross-platform builds

How to build Rigbench for each OS and share it with people. Short version:
**on macOS you can share a DMG today for free** (recipient approves it once in
System Settings > Privacy & Security); a zero-warning install needs a paid Apple Developer account.
Linux and Windows builds are feasible and wired into CI, but each OS must be
built on its own machine — you can't cross-compile from the Mac (the WebView,
VST3, and compiler toolchains are all native-only).

## macOS

### Make a shareable build right now (free, no Apple account)

```sh
# Universal (arm64 + Intel) so any Mac can run it:
cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DRIGBENCH_UNIVERSAL=ON
cmake --build build-rel --target Rigbench
./packaging/make-dmg.sh            # -> dist/Rigbench-<version>.dmg
```

Send the `.dmg`. Tell the recipient:

1. Open the DMG, drag **Rigbench** to **Applications**.
2. First launch: macOS blocks it. Go to **System Settings → Privacy & Security**,
   scroll down, and click **Open Anyway** (one-time). On macOS 14 and earlier,
   **right-click → Open → Open** also works. Or run
   `xattr -dr com.apple.quarantine /Applications/Rigbench.app`.
3. Approve the microphone prompt.

Why the extra step: the app is signed with a local self-signed identity
("Rigbench Dev"), which only exists in your keychain, so Gatekeeper treats it as
"unidentified developer" on any other Mac. This is expected, and Open Anyway is
the standard override (since macOS 15 the right-click shortcut no longer works
for apps that aren't notarised). (`arm64`-only builds simply won't launch on Intel
Macs — hence `RIGBENCH_UNIVERSAL=ON` for anything you share.)

### Zero-warning installs (paid: Apple Developer Program, $99/yr)

For a clean double-click open with no `xattr` dance:

1. Create a **Developer ID Application** certificate in your Apple Developer account.
2. Store a notary credential once:
   `xcrun notarytool store-credentials rigbench-notary --apple-id <you> --team-id <TEAM>`
3. Sign (hardened runtime + entitlements) and notarize:
   ```sh
   DEV_ID="Developer ID Application: Your Name (TEAMID)" ./packaging/notarize.sh dist/Rigbench-<v>.dmg
   ./packaging/make-dmg.sh build-rel        # repackage from the signed app
   xcrun notarytool submit dist/Rigbench-<v>.dmg --keychain-profile rigbench-notary --wait
   xcrun stapler staple dist/Rigbench-<v>.dmg
   ```

The hardened runtime is required for notarization and needs real entitlements —
`packaging/Rigbench.entitlements` supplies microphone access plus the
library-validation/JIT exemptions a VST3 host needs to load third-party plugins
.

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
cmake --build build --target Rigbench
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
cmake --build build --config RelWithDebInfo --target Rigbench
```

To avoid SmartScreen warnings, sign with Authenticode
(`signtool sign /fd sha256 /tr <timestamp-url> /td sha256 /a Rigbench.exe`); an
EV certificate buys instant reputation. Package as a `.zip` or an Inno Setup
installer (bundle the WebView2 bootstrapper).

## CI

`.github/workflows/build.yml` builds on `macos-latest` / `ubuntu-latest` /
`windows-latest` (native runners only — no cross-compilation). A **`v*` tag
publishes a GitHub Release** with all three binaries attached (DMG / tarball /
zip); a manual **Actions → build → Run workflow** leaves them as run artifacts.
`.github/workflows/ci.yml` runs the tests on every push and pull request.

### Releases and the changelog

Releases come from the commit messages. Every PR title is a
[conventional commit](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`,
`docs: …`; `pr-title.yml` checks it), and PRs are squash-merged, so each one is
a single conventional commit on `main`.

`release.yml` runs [release-please](https://github.com/googleapis/release-please)
on every push to `main`. It keeps a release PR open that:

- bumps the version (`feat` → minor, `fix` → patch; while we're on 0.x, a
  breaking change bumps the minor version too) in `version.txt`, `CMakeLists.txt`,
  the app's version string, the site and the README (lines marked
  `x-release-please-version`);
- adds the changes to `CHANGELOG.md`.

Merging the release PR tags `vX.Y.Z`, publishes the GitHub Release with the
changelog as its notes, and runs `build.yml` to attach the macOS, Windows and
Linux binaries.

Prerequisite: the repo must be on GitHub (push it + enable Actions) — a local-only
repo won't run CI.
