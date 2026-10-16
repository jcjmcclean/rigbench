# Tonebench

A lightweight, fast, native macOS guitar tone app. Load **VST3** plugins, **NAM** (Neural
Amp Modeler) amp models, and **IR** cab sims; chain them; save presets — and play through
your rig with low latency. A simple, light alternative to Reaper / Amplitube / AmpLocker.

## Architecture

- **Audio engine** — C++ / JUCE 8. CoreAudio I/O, VST3 hosting, NAM inference, IR convolution.
  An ordered chain (VST3 → NAM → IR) processed on the real-time audio thread.
- **UI** — React + TypeScript (Vite) running in a JUCE `WebBrowserComponent`, talking to the
  engine over the native JS↔C++ bridge (native functions + state/meter events). Separate thread
  from audio — the UI never affects latency.
- **NAM** — `NeuralAmpModelerCore` v0.6.0 (WaveNet). Models run at 48 kHz; a real-time Lagrange
  resampler converts around them when the device runs at another rate (e.g. 44.1 kHz).
- **IR** — `juce::dsp::Convolution`, zero added latency.

See `ROADMAP.md` for status, `docs/reviews/` for the UI/code/security/test/distribution
reviews + fix plan, `docs/research/` for the integration notes, `docs/testing.md` for the
test suites, `docs/distribution.md` for shipping, and `SECURITY.md` for the trust model.

## Build

Prereqs: CMake, Ninja, Node/npm, Xcode command-line tools (macOS, Apple Silicon).

```sh
# Install UI deps once; CMake builds + embeds the React UI for you on every build.
cd ui && npm install && cd ..

# First configure pulls JUCE + NAM core.
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target Tonebench

open build/Tonebench_artefacts/RelWithDebInfo/Tonebench.app
```

The `tonebench_ui` target runs `npm run build` and packs `assets/webui.zip` automatically
(it's build-generated, not committed), so the embedded UI can never go stale.

## Test

```sh
# C++ engine suite (deterministic DSP tests via the offline bench), + CI-strict mode:
ctest --test-dir build --output-on-failure        # runs selftest + selftest_strict
# UI unit tests (bridge logic, detection, Knob/Meter):
cd ui && npm test
```

`tonebench_cli` also renders audio offline (a simulated audio interface, no device):

```sh
cmake --build build --target tonebench_cli
./build/tonebench_cli_artefacts/RelWithDebInfo/tonebench_cli render \
    --gen pluck --nam model.nam --ir cab.wav --out out.wav
```

See `docs/testing.md` for coverage. CI (`.github/workflows/ci.yml`) runs both suites.

## Share it

```sh
cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTONEBENCH_UNIVERSAL=ON
cmake --build build-rel --target Tonebench
./packaging/make-dmg.sh        # -> dist/Tonebench-<version>.dmg (Universal: Intel + Apple Silicon)
```

Send the DMG. The recipient drags it to Applications and, on first launch, **right-clicks
→ Open → Open** (one-time, because it's self-signed). A zero-warning install needs Apple
notarization — see `docs/distribution.md`, which also covers Linux and Windows builds.

## Notes

- Third-party VST3s that are ad-hoc signed / quarantined may need de-quarantining + re-signing
  to load on Apple Silicon (`xattr -dr com.apple.quarantine X.vst3 && codesign --force --deep -s - X.vst3`).
- Dev builds are signed with a stable self-signed identity ("Tonebench Dev", auto-signed by
  CMake if the cert exists) so macOS remembers the mic grant across rebuilds.
- Loading a VST3 or opening a shared `.tonebench` preset runs third-party code in a
  mic-privileged process — see `SECURITY.md`.
