# Tonebench

**A lightweight, fast, free guitar-tone app for macOS.** Load [VST3](https://www.steinberg.net/developers/)
plugins, [NAM](https://www.neuralampmodeler.com/) (Neural Amp Modeler) amp models, and impulse-response
(IR) cab sims; chain them; save presets; and play through your rig with low latency — a simple, light
alternative to Reaper / AmpliTube / Bias FX for just plugging in and playing.

> **Status:** early (v0.1.0). macOS builds today; Linux and Windows build via CI (see below).

## Features

- **Host VST3 plugins** — your amp sims, drives, and effects run inside the chain.
- **NAM amp models** — load `.nam` captures; a real-time resampler handles sample-rate mismatches transparently.
- **IR cab sims** — zero-latency convolution for speaker/cab impulse responses.
- **A real signal chain** — VST3 → amp → cab, each slot bypassable, with a live signal scope.
- **Presets** — save and recall whole rigs.
- **Native + fast** — a C++/JUCE audio engine with a React UI in a WebView; the UI never touches the audio thread, so it doesn't cost you latency.

## Build

Prereqs: CMake, Ninja, Node/npm, Xcode command-line tools (macOS, Apple Silicon or Intel).

```sh
# Install UI deps once; CMake builds + embeds the React UI for you on every build.
cd ui && npm install && cd ..

# First configure pulls JUCE + NAM core.
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target Tonebench

open build/Tonebench_artefacts/RelWithDebInfo/Tonebench.app
```

The `tonebench_ui` CMake target runs `npm run build` and packs the UI into `assets/webui.zip`
automatically (build-generated, not committed), so the embedded UI can never go stale.

## Test

```sh
ctest --test-dir build --output-on-failure   # C++ engine suite (DSP oracles, RT-safety, presets)
cd ui && npm test                             # UI unit tests (bridge logic, Knob/Meter)
```

`tonebench_cli` also renders audio offline — a simulated interface, no device needed:

```sh
cmake --build build --target tonebench_cli
./build/tonebench_cli_artefacts/RelWithDebInfo/tonebench_cli render \
    --gen pluck --nam model.nam --ir cab.wav --out out.wav
```

See [`docs/testing.md`](docs/testing.md) for coverage. CI runs both suites on every push.

## Download

Tagged releases publish ready-to-run builds for macOS, Linux, and Windows on the
[Releases](https://github.com/jcjmcclean/tonebench/releases) page.

On macOS the app is self-signed, so on first launch **right-click → Open → Open** (one-time), then
approve the microphone prompt. To build a shareable Universal DMG yourself:

```sh
cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DTONEBENCH_UNIVERSAL=ON
cmake --build build-rel --target Tonebench
./packaging/make-dmg.sh      # -> dist/Tonebench-<version>.dmg (Intel + Apple Silicon)
```

See [`docs/distribution.md`](docs/distribution.md) for signing/notarization and the Linux/Windows details.

## How it works

- **Audio engine** — C++ / JUCE 8: CoreAudio I/O, VST3 hosting, NAM inference, IR convolution, processed
  as an ordered chain on the real-time audio thread (allocation-free, lock-free swaps).
- **UI** — React + TypeScript (Vite) in a JUCE `WebBrowserComponent`, talking to the engine over the
  native JS↔C++ bridge (native functions + state/meter events) on a separate thread from audio.
- **NAM** — [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) (WaveNet). Models run
  at 48 kHz; a real-time Lagrange resampler converts around them at other device rates.
- **IR** — `juce::dsp::Convolution`, zero added latency.

Integration notes live in [`docs/research/`](docs/research/); the security/trust model is in
[`docs/SECURITY.md`](docs/SECURITY.md) — note that loading a VST3 or opening a shared `.tonebench` preset
runs third-party code in a mic-privileged process.

## Licence

Tonebench is licensed under the **GNU Affero General Public License v3.0** ([`LICENSE`](LICENSE)). This is
required because it builds on JUCE under its free AGPLv3 licence — so Tonebench's source is, and must stay,
open under AGPLv3. You're free to use, study, modify, and redistribute it under those terms.

Built on:
- [JUCE 8](https://juce.com) — audio framework (AGPLv3 / commercial; used here under AGPLv3)
- [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) by Steven Atkinson (MIT)
- [Eigen](https://eigen.tuxfamily.org) (MPL2)
