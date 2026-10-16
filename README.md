# ToneStack

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

See `ROADMAP.md` for status and `docs/research/` for the integration notes behind each piece.

## Build

Prereqs: CMake, Ninja, Node/npm, Xcode command-line tools (macOS, Apple Silicon).

```sh
# 1) Build the React UI and embed it
cd ui && npm install && npm run build
mkdir -p ../assets && (cd dist && zip -rq ../../assets/webui.zip .)

# 2) Build the app (first configure pulls JUCE + NAM core)
cd ..
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target ToneStack

open build/ToneStack_artefacts/RelWithDebInfo/ToneStack.app
```

### Offline bench (testing)

A simulated audio interface that runs the real engine headlessly — deterministic DSP tests
and WAV rendering, no device needed:

```sh
cmake --build build --target tonestack_bench
./build/tonestack_bench_artefacts/RelWithDebInfo/tonestack_bench selftest
./build/tonestack_bench_artefacts/RelWithDebInfo/tonestack_bench render --gen pluck --nam model.nam --ir cab.wav --out out.wav
```

## Notes

- Third-party VST3s that are ad-hoc signed / quarantined may need de-quarantining + re-signing
  to load on Apple Silicon (`xattr -dr com.apple.quarantine X.vst3 && codesign --force --deep -s - X.vst3`).
- Dev builds are ad-hoc signed, so macOS re-prompts for mic access each rebuild; sign with a
  stable identity ("ToneStack Dev") to make the grant stick (auto-signed by CMake if the cert exists).
