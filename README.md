# Rigbench

A small, fast desktop app for playing guitar through amp sims, on macOS, Windows, and Linux. Load a
VST3 plugin, a Neural Amp Modeler (NAM) amp model, and a cab impulse response (IR), chain them up, and
play. That's the whole idea.

<picture>
  <source srcset="site/assets/hero.webp" type="image/webp">
  <img src="site/assets/hero.png" alt="The Rigbench signal chain: a VST3 plugin, a NAM amp model, and an IR cab, with the live signal threading through them">
</picture>

Early days: this is v0.1.0. It runs on macOS (Apple Silicon and Intel), Windows, and Linux.

## Why I built this

A friend of mine built a guitar amp and sent it over as a VST3 plugin. I wanted to actually play
through it, and I didn't want to buy a whole amp-sim app just to try out the one amp he'd made.

I've paid for a few apps like this before. The cheaper ones tend to run out of features fast. The
expensive ones go the other way: fiddly, and stuffed with things I'm never going to touch. I wanted
something in between. Something small and simple where I could drop his VST in next to the NAM models
and the cab IRs I was already using, and flip each part of the chain on and off.

His plugin turned out really good and worked a treat, and building a little rig around it was a lot
of fun. I'm happy with where it ended up.

## What it does

- Loads VST3 plugins: amps, drives, effects.
- Loads NAM (Neural Amp Modeler) `.nam` amp models. If a model's sample rate doesn't match your
  interface, it resamples in real time so you don't have to care.
- Loads cab IRs (WAV, AIFF, or FLAC), with no added latency.
- Runs the three as an ordered chain (plugin, then amp, then cab), and you can bypass any slot.
- Has a tuner, and a one-knob noise gate on the input (off until you turn it up).
- Saves and recalls whole rigs as presets.
- Shows the live signal moving through the chain while you play.
- Walks you through setup the first time: pick your interface, play a few notes so it can find
  which input your guitar is on, and check you can hear it.

Under the hood it's a C++/JUCE audio engine with a React interface in a webview. The interface runs
on its own thread, so it never costs you any latency.

## Build

You'll need CMake, Ninja, and Node/npm, plus your platform's toolchain: the Xcode command-line tools
on macOS, MSVC on Windows, or GCC/Clang and the GTK/WebKit dev packages on Linux (see
[`docs/distribution.md`](docs/distribution.md) for the exact Linux packages).

```sh
# Install the UI deps once. CMake builds and embeds the React UI on every build after that.
cd ui && npm install && cd ..

# The first configure pulls in JUCE and the NAM core.
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build --target Rigbench

open build/Rigbench_artefacts/RelWithDebInfo/Rigbench.app   # macOS
```

On Windows and Linux the app lands in the same `build/Rigbench_artefacts/` folder.

The `rigbench_ui` target runs `npm run build` and packs the UI into `assets/webui.zip` for you (it's
generated at build time, not committed), so the embedded UI can't drift out of date.

## Test

```sh
ctest --test-dir build --output-on-failure   # C++: unit tests (Catch2) + the offline self-test
cd ui && npm test                             # UI unit tests (Vitest)
cd ui && npm run test:e2e                     # UI end-to-end in Chromium, against the mock engine
./build/Rigbench_artefacts/RelWithDebInfo/Rigbench.app/Contents/MacOS/Rigbench --smoke
                                              # boots the real app and checks the UI reaches the engine
```

`rigbench_cli` also renders audio offline, through a simulated interface, so no device is needed:

```sh
cmake --build build --target rigbench_cli
./build/rigbench_cli_artefacts/RelWithDebInfo/rigbench_cli render \
    --gen pluck --nam model.nam --ir cab.wav --out out.wav
```

See [`docs/testing.md`](docs/testing.md) for what's covered. CI runs all of it on macOS, Linux, and
Windows on every push and pull request.

## Download

Tagged releases publish ready-to-run builds on the
[Releases](https://github.com/jcjmcclean/rigbench/releases) page:

- **macOS**: a Universal `.dmg` (Apple Silicon and Intel)
- **Windows**: a `.zip` (needs the WebView2 runtime, which current Windows 10/11 already has)
- **Linux**: a `.tar.gz`

The macOS build is self-signed, not notarised, so macOS blocks it the first time. Try to open it,
then go to System Settings > Privacy & Security and click Open Anyway. (On macOS 14 and earlier,
right-clicking the app and choosing Open also works.) You only do this once. After that, approve the
microphone prompt so it can hear your guitar. On Windows, SmartScreen may warn you the first time
because the app isn't signed: click More info, then Run anyway. To build a Universal DMG yourself (runs on both Intel and Apple Silicon):

```sh
cmake -B build-rel -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DRIGBENCH_UNIVERSAL=ON
cmake --build build-rel --target Rigbench
./packaging/make-dmg.sh      # writes dist/Rigbench-<version>.dmg
```

[`docs/distribution.md`](docs/distribution.md) covers signing, notarisation, and the Linux and
Windows specifics.

## How it works

The audio engine is C++ on JUCE 8: native audio I/O (CoreAudio, WASAPI, ALSA, and JACK), VST3 hosting, NAM inference, and IR
convolution, all run as an ordered chain on the realtime audio thread with no allocations or locks in
the hot path. Each NAM model runs at its own sample rate (nearly always 48 kHz), and a Lagrange resampler converts to and from your device's rate around it.
IR uses `juce::dsp::Convolution` and adds no latency. The UI is React and TypeScript (built with Vite)
inside a JUCE webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux), talking to the engine over a native JavaScript-to-C++ bridge, on a separate
thread from audio.

One thing worth knowing up front: loading a VST3, or opening a `.rigbench` preset someone shared with
you, runs third-party code inside an app that has microphone access. Rigbench asks before it loads a
plugin named in a preset, but only load plugins and presets you trust, the same as you would with any
amp sim.

## Licence

Rigbench is under the GNU Affero General Public License v3.0 (see [`LICENSE`](LICENSE)). It has to be:
it builds on JUCE, whose free licence is AGPLv3, so Rigbench's source is open and stays that way. You
can use it, read it, change it, and pass it on under those terms.

Built with:
- [JUCE 8](https://juce.com), the audio framework (AGPLv3 or commercial; used here under AGPLv3)
- [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) by Steven Atkinson (MIT)
- [Eigen](https://eigen.tuxfamily.org) (MPL2)
