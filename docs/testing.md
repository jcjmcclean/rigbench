# Testing

Tonebench has two automated test suites: a C++ offline self-test that drives the
real audio engine, and a React/Vitest suite for the WebView UI. Both run in CI
(`.github/workflows/ci.yml`) on every push and pull request.

## C++ self-test (offline bench + CTest)

The self-test lives in `src/Bench.cpp` (the `tonebench_cli` console target). It
feeds known signals through the **real** `AudioEngine`, block-by-block, exactly
like the live audio callback — no audio device or GUI required.

### Run it

```sh
# Build the bench (shares the engine sources with the app; needs no Node/WebUI).
cmake --build build --target tonebench_cli

# Run directly:
./build/tonebench_cli_artefacts/RelWithDebInfo/tonebench_cli selftest
./build/tonebench_cli_artefacts/RelWithDebInfo/tonebench_cli selftest --strict

# ...or via CTest (registered in CMakeLists.txt):
ctest --test-dir build --output-on-failure
```

CTest registers two cases:

| Test              | Command                      | Purpose                                   |
| ----------------- | ---------------------------- | ----------------------------------------- |
| `selftest`        | `tonebench_cli selftest`          | Human-facing run; skips are allowed.      |
| `selftest_strict` | `tonebench_cli selftest --strict` | CI gate: a skipped **core** suite fails.  |

The summary line reports suite counts, e.g. `=== ALL PASS (12 run, 0 skipped) ===`.
A nonzero exit code (any `FAIL`) fails the gate.

### `--strict` mode

Normally a suite that can't run (no model, no VST) prints `SKIP` and the run can
still be `ALL PASS`. Under `--strict`, skipping a **core** suite — the preset
round-trip or the resampler — is a hard failure. This prevents the classic
green-but-skipped lie where CI stays green because the code under test never ran.
CI uses `--strict`.

### What's covered

- **IR node** — loads a synthetic cab IR; output is finite and non-trivial.
- **IR correctness oracle** — an impulse through the convolver reproduces the IR
  itself (least-squares scale recovery vs. the source samples; max abs err < 1e-5).
- **RT-safety: zero allocations** — a global `operator new`/`delete` counter is
  armed around 128 `processBlock` calls with IR + a resampling NAM active, and
  asserts zero heap growth on the audio thread.
- **Engine identities** — empty chain is bit-exact passthrough; a bypassed slot
  is identical to an absent slot; a cleared slot (`setNode(nullptr)`) is a clean
  dry passthrough.
- **Preset (IR-only) round-trip** — hermetic (no model): save → reload → render,
  bit-for-bit match. Always runs, so preset serialization is never skipped.
- **Preset malformed input** — truncated JSON, garbage, wrong `schemaVersion`,
  wrong `format`, and a missing file all return `false` without crashing.
- **NAM** — loads the committed fixture (below); determinism oracle (same pluck
  rendered twice is bit-identical) plus a louder-in → louder-out gain check.
- **Preset (NAM+IR) round-trip** — full chain save/reload, both slots restored.
- **RealtimeResampler** — 44.1↔48k round-trip (pitch < 2%, level within 0.5 dB),
  identity ratio (transparent), pure downsample (96→48k), and the FIFO
  safety-clamp branch (feeding more than capacity never overruns/corrupts).
- **IR latency** — zero-latency convolution: impulse peak at sample 0.

### Test fixtures

`assets/test-fixtures/minimal.nam` is a tiny, committed, **valid** NAM model (a
bias-free 2-tap `Linear` architecture at 48 kHz). It is NOT a real amp capture —
it exists purely so the NAM and preset suites are deterministic and never
silently skip on a clean checkout or CI box. The bench finds it via the
`TONEBENCH_FIXTURES_DIR` compile definition and falls back to the user's
`~/Documents/NAMs` library if the fixture is ever absent.

### Still skipped / not covered

- **VST3 hosting** — opt-in only (`TONEBENCH_TEST_VST=1` plus `TONEBENCH_VST_PATH`
  pointing at a `.vst3` bundle). Hosting a code-signed plugin reliably needs a
  GUI/login session — `dlopen` blocks under AMFI in a headless CLI process — and
  there is no hermetic `.vst3` fixture to commit, so this is a non-core suite
  whose skip never fails `--strict`. Verify VST3 in the GUI app instead.
- **Concurrent `setNode` / dry-passthrough swap** — the lock-free swap path
  (`AudioEngine.cpp` `ScopedTryLock`) is not yet exercised under thread
  contention; the bench is single-threaded.

## UI tests (Vitest + Testing Library)

The UI suite lives alongside the source in `ui/src/**/*.test.ts(x)` and runs in
jsdom via Vitest (config in `ui/vitest.config.ts`).

### Run it

```sh
cd ui
npm install          # first time (adds vitest, Testing Library, jsdom)
npm test             # vitest run (one-shot, used by CI)
npx vitest           # watch mode for development
```

CI additionally runs `npm run lint` and `npm run build` before `npm test`.

### What's covered

- **`juceDetect.ts`** — the "real backend vs. stub" detection and the ordering
  contract (the module imports nothing, so it can capture the genuine
  `window.__JUCE__` state *before* the Juce import installs its placeholder).
- **`bridge.ts`** — mock-vs-real selection, native-function wiring,
  subscribe/replay/unsubscribe, the meter state-merge (`{...current, ...m}`), and
  the documented null-current hazard (a meters event before the first state event
  is silently dropped).
- **`Knob`** — keyboard value math (coarse/fine arrow steps, range mapping, clamp
  at both ends, disabled no-op).
- **`Meter`** — level → lit-segment geometry (`round(clamp01(value) * segments)`),
  clamping, and orientation independence.

### Not yet covered

`ScopeWaveform` (points → SVG path), `SignalChain` (slot state), and the pointer-
drag path of `Knob` (jsdom lacks full Pointer Events / `setPointerCapture`) are
still untested.
