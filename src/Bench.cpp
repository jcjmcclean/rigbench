// Tonebench offline bench — a simulated audio interface for deterministic
// testing. It feeds known signals through the REAL engine, block-by-block, just
// like the live audio callback, then writes a WAV you can listen to and prints
// metrics (level, peak, clipping, NaN, measured latency).
//
// Usage:
//   tonebench_cli selftest
//   tonebench_cli render [input] [chain] [--sr N] [--block N] --out file.wav
//     input:  --gen sine|sweep|impulse|noise|pluck [--secs S]  |  --in file.wav
//     chain:  --ir file.wav [--mix 0..1]
//             (--nam / --vst added as those nodes land)

#include "engine/AudioEngine.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/Vst3Node.h"
#include "engine/Preset.h"
#include "engine/RealtimeResampler.h"
#include <juce_gui_basics/juce_gui_basics.h>  // ScopedJuceInitialiser_GUI (VST3 hosting needs a MessageManager)

#include <juce_audio_formats/juce_audio_formats.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <map>
#include <new>

//==============================================================================
// RT-safety instrumentation: a global allocation counter. Defining operator
// new/delete in this TU replaces them PROGRAM-WIDE (they are the single
// replaceable global symbols), so every allocation — in the engine, JUCE, and
// NAM core — is counted while tracking is armed. We only arm it around a tight
// processBlock loop in the self-test, so the overhead and the count are both
// zero in normal operation. Aligned (over-aligned) new/delete are deliberately
// left as the library defaults: C++ guarantees aligned-new pairs with
// aligned-delete, so there is no cross-pairing hazard; those (rare) allocations
// simply aren't counted.
namespace alloc_probe
{
std::atomic<std::uint64_t> count { 0 };
std::atomic<bool>          tracking { false };
inline void note() noexcept
{
    if (tracking.load (std::memory_order_relaxed))
        count.fetch_add (1, std::memory_order_relaxed);
}
} // namespace alloc_probe

void* operator new (std::size_t s)                          { alloc_probe::note(); void* p = std::malloc (s ? s : 1); if (! p) throw std::bad_alloc(); return p; }
void* operator new[] (std::size_t s)                        { alloc_probe::note(); void* p = std::malloc (s ? s : 1); if (! p) throw std::bad_alloc(); return p; }
void* operator new (std::size_t s, const std::nothrow_t&) noexcept   { alloc_probe::note(); return std::malloc (s ? s : 1); }
void* operator new[] (std::size_t s, const std::nothrow_t&) noexcept { alloc_probe::note(); return std::malloc (s ? s : 1); }
void operator delete (void* p) noexcept                     { std::free (p); }
void operator delete[] (void* p) noexcept                   { std::free (p); }
void operator delete (void* p, std::size_t) noexcept        { std::free (p); }
void operator delete[] (void* p, std::size_t) noexcept      { std::free (p); }
void operator delete (void* p, const std::nothrow_t&) noexcept   { std::free (p); }
void operator delete[] (void* p, const std::nothrow_t&) noexcept { std::free (p); }

//==============================================================================
namespace sig
{
juce::AudioBuffer<float> impulse (double, int len)
{
    juce::AudioBuffer<float> b (1, len); b.clear();
    b.setSample (0, 0, 1.0f);
    return b;
}

juce::AudioBuffer<float> sine (double sr, int len, float hz = 440.0f, float amp = 0.3f)
{
    juce::AudioBuffer<float> b (1, len);
    auto* d = b.getWritePointer (0);
    const double inc = juce::MathConstants<double>::twoPi * hz / sr;
    double ph = 0.0;
    for (int i = 0; i < len; ++i) { d[i] = amp * (float) std::sin (ph); ph += inc; }
    return b;
}

juce::AudioBuffer<float> sweep (double sr, int len, float f0 = 20.0f, float f1 = 20000.0f, float amp = 0.3f)
{
    juce::AudioBuffer<float> b (1, len);
    auto* d = b.getWritePointer (0);
    const double T = len / sr;
    const double k = std::log (f1 / f0);
    double ph = 0.0;
    for (int i = 0; i < len; ++i)
    {
        const double t = i / sr;
        const double f = f0 * std::exp (k * t / T);
        ph += juce::MathConstants<double>::twoPi * f / sr;
        d[i] = amp * (float) std::sin (ph);
    }
    return b;
}

juce::AudioBuffer<float> noise (double, int len, float amp = 0.3f)
{
    juce::AudioBuffer<float> b (1, len);
    auto* d = b.getWritePointer (0);
    juce::Random rng (7);
    for (int i = 0; i < len; ++i) d[i] = amp * (rng.nextFloat() * 2.0f - 1.0f);
    return b;
}

// Karplus-Strong plucked string — a guitar-ish transient for listening tests.
juce::AudioBuffer<float> pluck (double sr, int len, float hz = 82.41f /*E2*/, float amp = 0.5f)
{
    juce::AudioBuffer<float> b (1, len); b.clear();
    auto* d = b.getWritePointer (0);
    const int N = juce::jmax (2, (int) std::round (sr / hz));
    std::vector<float> ring ((size_t) N);
    juce::Random rng (3);

    const int plucks = juce::jmax (1, len / (int) (sr * 1.2)); // re-pluck ~every 1.2s
    for (int p = 0; p < plucks; ++p)
    {
        const int startSample = p * (len / plucks);
        for (auto& s : ring) s = rng.nextFloat() * 2.0f - 1.0f; // excite
        int idx = 0;
        for (int i = startSample; i < len; ++i)
        {
            const float cur  = ring[(size_t) idx];
            const float next = ring[(size_t) ((idx + 1) % N)];
            const float out  = 0.5f * (cur + next) * 0.996f; // average + decay
            ring[(size_t) idx] = out;
            d[i] += amp * cur;
            idx = (idx + 1) % N;
        }
    }
    return b;
}
} // namespace sig

//==============================================================================
namespace io
{
juce::AudioBuffer<float> loadMono (const juce::File& f, double& srOut)
{
    juce::AudioFormatManager fm; fm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> r (fm.createReaderFor (f));
    if (r == nullptr) { std::cerr << "Could not read " << f.getFullPathName() << "\n"; return {}; }

    srOut = r->sampleRate;
    juce::AudioBuffer<float> tmp ((int) r->numChannels, (int) r->lengthInSamples);
    r->read (&tmp, 0, (int) r->lengthInSamples, 0, true, true);

    juce::AudioBuffer<float> mono (1, tmp.getNumSamples());
    mono.clear();
    for (int ch = 0; ch < tmp.getNumChannels(); ++ch)
        mono.addFrom (0, 0, tmp, ch, 0, tmp.getNumSamples(), 1.0f / (float) tmp.getNumChannels());
    return mono;
}

bool saveMono (const juce::File& f, const juce::AudioBuffer<float>& b, double sr)
{
    f.deleteFile();
    juce::WavAudioFormat fmt;
    if (auto out = std::unique_ptr<juce::FileOutputStream> (f.createOutputStream()))
    {
        std::unique_ptr<juce::AudioFormatWriter> w (fmt.createWriterFor (out.get(), sr, 1, 24, {}, 0));
        if (w == nullptr) return false;
        out.release();
        return w->writeFromAudioSampleBuffer (b, 0, b.getNumSamples());
    }
    return false;
}
} // namespace io

//==============================================================================
namespace metric
{
float rms (const juce::AudioBuffer<float>& b)
{
    double s = 0.0; const int n = b.getNumSamples(); const auto* d = b.getReadPointer (0);
    for (int i = 0; i < n; ++i) s += (double) d[i] * d[i];
    return (float) std::sqrt (s / juce::jmax (1, n));
}
float peak (const juce::AudioBuffer<float>& b) { return b.getMagnitude (0, b.getNumSamples()); }
int clipped (const juce::AudioBuffer<float>& b)
{
    int c = 0; const int n = b.getNumSamples(); const auto* d = b.getReadPointer (0);
    for (int i = 0; i < n; ++i) if (std::abs (d[i]) > 0.999f) ++c;
    return c;
}
bool finite (const juce::AudioBuffer<float>& b)
{
    const int n = b.getNumSamples(); const auto* d = b.getReadPointer (0);
    for (int i = 0; i < n; ++i) if (! std::isfinite (d[i])) return false;
    return true;
}
// Latency = index of peak magnitude (useful when input is an impulse).
int peakIndex (const juce::AudioBuffer<float>& b)
{
    int idx = 0; float m = 0.0f; const int n = b.getNumSamples(); const auto* d = b.getReadPointer (0);
    for (int i = 0; i < n; ++i) if (std::abs (d[i]) > m) { m = std::abs (d[i]); idx = i; }
    return idx;
}
} // namespace metric

//==============================================================================
struct RenderStats
{
    double totalProcSec = 0.0;  // wall-clock spent in processBlock
    double maxBlockSec  = 0.0;  // slowest single block
    int    blocks       = 0;
};

// Simulated audio interface: push `input` through the engine in fixed blocks,
// timing each block so we can check real-time headroom.
juce::AudioBuffer<float> renderThroughEngine (AudioEngine& engine,
                                              const juce::AudioBuffer<float>& input,
                                              int blockSize,
                                              RenderStats* stats = nullptr)
{
    using clock = std::chrono::high_resolution_clock;
    const int total = input.getNumSamples();
    juce::AudioBuffer<float> output (1, total);
    output.clear();

    juce::AudioBuffer<float> block (1, blockSize);
    for (int pos = 0; pos < total; pos += blockSize)
    {
        const int n = juce::jmin (blockSize, total - pos);
        block.clear();
        block.copyFrom (0, 0, input, 0, pos, n);

        float* chans[1] = { block.getWritePointer (0) };
        juce::AudioBuffer<float> view (chans, 1, n);

        const auto t0 = clock::now();
        engine.processBlock (view);
        const double dt = std::chrono::duration<double> (clock::now() - t0).count();

        if (stats != nullptr)
        {
            stats->totalProcSec += dt;
            stats->maxBlockSec = juce::jmax (stats->maxBlockSec, dt);
            ++stats->blocks;
        }

        output.copyFrom (0, pos, block, 0, 0, n);
    }
    return output;
}

//==============================================================================
namespace
{
std::map<juce::String, juce::String> parseArgs (int argc, char** argv, int from)
{
    std::map<juce::String, juce::String> m;
    for (int i = from; i < argc; ++i)
    {
        juce::String a (argv[i]);
        if (a.startsWith ("--"))
        {
            const juce::String key = a.substring (2);
            if (i + 1 < argc && ! juce::String (argv[i + 1]).startsWith ("--"))
                m[key] = argv[++i];
            else
                m[key] = "true";
        }
    }
    return m;
}

// Deterministic synthetic cab IR (seeded), peak at sample 0 so there's no
// leading silence to trim. Returned as a buffer so the IR-correctness oracle
// can diff the rendered impulse response against these exact source samples.
juce::AudioBuffer<float> synthIRBuffer()
{
    const int len = 512;
    juce::AudioBuffer<float> ir (1, len);
    auto* d = ir.getWritePointer (0);
    juce::Random rng (1234); float last = 0.0f;
    for (int i = 0; i < len; ++i)
    {
        const float nz = rng.nextFloat() * 2.0f - 1.0f;
        last = 0.6f * last + 0.4f * nz;
        d[i] = last * std::exp (-(float) i / 90.0f);
    }
    d[0] = 1.0f;
    return ir;
}

juce::File makeSyntheticIR (double sr)
{
    auto ir = synthIRBuffer();
    auto f = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("tonebench_test_ir.wav");
    io::saveMono (f, ir, sr);
    return f;
}

// Hermetic NAM model: prefer the committed test fixture (deterministic, present
// on any checkout incl. CI); fall back to the user's personal library so a
// developer with ~/Documents/NAMs still exercises a real capture.
juce::File findNamModel()
{
   #ifdef TONEBENCH_FIXTURES_DIR
    const juce::File fixture = juce::File (TONEBENCH_FIXTURES_DIR).getChildFile ("minimal.nam");
    if (fixture.existsAsFile())
        return fixture;
   #endif
    juce::Array<juce::File> namFiles;
    juce::File namDir (juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                           .getChildFile ("NAMs"));
    namDir.findChildFiles (namFiles, juce::File::findFiles, true, "*.nam");
    return namFiles.isEmpty() ? juce::File() : namFiles[0];
}

enum class VstLoad { loaded, failed, timeout };

// Drive an async VST3 load to completion by pumping the message loop (headless).
// NB: in a sandboxed/CLI process, dlopen of a code-signed .vst3 can block in AMFI
// signature validation — so this can time out here even though the real app loads
// the same plugin fine. Run the bench from your own terminal for a true result.
VstLoad loadVstBlocking (Vst3Node& node, const juce::File& file, double sr, int block,
                         juce::String& error, int timeoutSec = 15)
{
    bool done = false, ok = false;
    juce::String err;
    node.loadAsync (file, sr, block, [&] (bool o, juce::String e) { ok = o; err = e; done = true; });

    if (auto* mm = juce::MessageManager::getInstanceWithoutCreating())
    {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds (timeoutSec);
        while (! done && std::chrono::steady_clock::now() < deadline)
            mm->runDispatchLoopUntil (20);
    }
    error = err;
    if (! done)   return VstLoad::timeout;
    return ok ? VstLoad::loaded : VstLoad::failed;
}

int report (const juce::String& name, bool pass, const juce::String& detail)
{
    std::cout << (pass ? "  PASS  " : "  FAIL  ") << name.paddedRight (' ', 22) << detail << "\n";
    return pass ? 0 : 1;
}

int runSelfTest (bool strict)
{
    const double sr = 48000.0; const int block = 128;
    int fails = 0;
    int suitesRun = 0, suitesSkipped = 0;
    std::cout << "=== Tonebench self-test" << (strict ? " (--strict)" : "") << " ===\n";

    // Record a skipped suite. In --strict mode, skipping a CORE suite (the ones
    // CI must always exercise: preset round-trip, resampler) is a HARD FAILURE
    // so a green-but-skipped run can never pass a CI gate.
    auto skipSuite = [&] (const juce::String& name, const juce::String& reason, bool core)
    {
        std::cout << "  SKIP  " << name.paddedRight (' ', 22) << reason << "\n";
        ++suitesSkipped;
        if (strict && core)
        {
            std::cout << "  FAIL  " << juce::String (name + " (strict)").paddedRight (' ', 22)
                      << "core suite skipped under --strict\n";
            ++fails;
        }
    };

    // IR node: sine in -> finite, non-trivial out.
    {
        ++suitesRun;
        AudioEngine engine; engine.prepare (sr, block);
        auto ir = std::make_unique<IRNode>();
        const bool loaded = ir->loadFile (makeSyntheticIR (sr));
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (600); // let convolution load the IR

        auto in = sig::sine (sr, block * 40);
        auto out = renderThroughEngine (engine, in, block);

        fails += report ("IR load", loaded, "synthetic cab IR");
        fails += report ("IR finite", metric::finite (out), "no NaN/Inf");
        fails += report ("IR output", metric::rms (out) > 1.0e-4f,
                         "in RMS " + juce::String (metric::rms (in), 5)
                       + "  out RMS " + juce::String (metric::rms (out), 5));
    }

    // IR correctness oracle: an impulse through the convolver reproduces the IR
    // itself (that is the definition of an impulse response). The IR is loaded
    // with Trim+Normalise, so recover the single global scale by least squares
    // over the first N taps, then diff sample-for-sample. Catches channel swaps,
    // gain/shape bugs, and a wrong-IR regression that "RMS > 1e-4" never would.
    {
        ++suitesRun;
        const auto irBuf = synthIRBuffer();
        AudioEngine engine; engine.prepare (sr, block);
        auto ir = std::make_unique<IRNode>();
        ir->loadFile (makeSyntheticIR (sr));
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (600);

        auto in  = sig::impulse (sr, block * 8);
        auto out = renderThroughEngine (engine, in, block);
        const int lat = metric::peakIndex (out);

        const int N = 256;
        double num = 0.0, den = 0.0;
        for (int i = 0; i < N; ++i)
        {
            const double o = out.getSample (0, lat + i);
            const double h = irBuf.getSample (0, i);
            num += o * h; den += h * h;
        }
        const double scale = den > 0.0 ? num / den : 0.0;
        double maxErr = 0.0;
        for (int i = 0; i < N; ++i)
            maxErr = juce::jmax (maxErr, std::abs (out.getSample (0, lat + i) - scale * irBuf.getSample (0, i)));

        fails += report ("IR oracle", maxErr < 1.0e-5,
                         "impulse reproduces IR: max abs err " + juce::String (maxErr, 8)
                       + "  (scale " + juce::String (scale, 4) + ", latency " + juce::String (lat) + ")");
    }

    // RT-safety: processBlock must perform ZERO heap allocations. Arm the global
    // allocation counter around a tight loop with IR + a resampling NAM active
    // (engine at 44.1 kHz, model at 48 kHz => the RealtimeResampler hot path).
    {
        ++suitesRun;
        const double srA = 44100.0;
        AudioEngine engine; engine.prepare (srA, block);

        auto ir = std::make_unique<IRNode>();
        ir->loadFile (makeSyntheticIR (srA));
        engine.setNode (AudioEngine::irSlot, std::move (ir));

        const juce::File namFile = findNamModel();
        const bool haveNam = namFile.existsAsFile();
        juce::String resampleNote = "IR";
        if (haveNam)
        {
            auto nam = std::make_unique<NamNode>(); juce::String err;
            if (nam->loadFile (namFile, err))
            {
                engine.setNode (AudioEngine::namSlot, std::move (nam));
                resampleNote = "IR+NAM(resampling 48k@44.1k)";
            }
        }
        juce::Thread::sleep (700); // IR convolution load

        auto in = sig::pluck (srA, block * 24);
        juce::AudioBuffer<float> blk (1, block);

        // Warm up so any one-time lazy setup inside the convolver/model settles.
        for (int k = 0; k < 16; ++k)
        {
            blk.copyFrom (0, 0, in, 0, (k % 20) * block, block);
            engine.processBlock (blk);
        }

        const auto before = alloc_probe::count.load();
        alloc_probe::tracking.store (true, std::memory_order_relaxed);
        for (int k = 0; k < 128; ++k)
        {
            blk.copyFrom (0, 0, in, 0, (k % 20) * block, block);
            engine.processBlock (blk);
        }
        alloc_probe::tracking.store (false, std::memory_order_relaxed);
        const auto growth = alloc_probe::count.load() - before;

        fails += report ("RT alloc-free", growth == 0,
                         juce::String ((juce::int64) growth) + " allocs over 128 processBlock calls ("
                       + resampleNote + ")");
    }

    // Empty chain is a perfect wire: no nodes => output bit-exact == input.
    {
        ++suitesRun;
        AudioEngine engine; engine.prepare (sr, block);
        auto in  = sig::sine (sr, block * 10);
        auto out = renderThroughEngine (engine, in, block);
        float maxd = 0.0f;
        for (int i = 0; i < in.getNumSamples(); ++i)
            maxd = juce::jmax (maxd, std::abs (out.getSample (0, i) - in.getSample (0, i)));
        fails += report ("Empty-chain identity", maxd == 0.0f, "max|out-in| " + juce::String (maxd, 8));
    }

    // A bypassed slot must be indistinguishable from an absent slot.
    {
        ++suitesRun;
        auto in = sig::sine (sr, block * 10);

        AudioEngine bypassed; bypassed.prepare (sr, block);
        auto ir = std::make_unique<IRNode>();
        ir->loadFile (makeSyntheticIR (sr));
        ir->setBypassed (true);
        bypassed.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (600);
        auto outBypass = renderThroughEngine (bypassed, in, block);

        AudioEngine absent; absent.prepare (sr, block);
        auto outAbsent = renderThroughEngine (absent, in, block);

        float maxd = 0.0f;
        for (int i = 0; i < in.getNumSamples(); ++i)
            maxd = juce::jmax (maxd, std::abs (outBypass.getSample (0, i) - outAbsent.getSample (0, i)));
        fails += report ("Bypass==absent", maxd == 0.0f, "max|bypass-absent| " + juce::String (maxd, 8));
    }

    // Clearing a slot (setNode nullptr) must leave a clean dry passthrough.
    {
        ++suitesRun;
        AudioEngine engine; engine.prepare (sr, block);
        auto ir = std::make_unique<IRNode>();
        ir->loadFile (makeSyntheticIR (sr));
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (600);
        engine.setNode (AudioEngine::irSlot, nullptr); // clear

        auto in  = sig::sine (sr, block * 10);
        auto out = renderThroughEngine (engine, in, block);
        float maxd = 0.0f;
        for (int i = 0; i < in.getNumSamples(); ++i)
            maxd = juce::jmax (maxd, std::abs (out.getSample (0, i) - in.getSample (0, i)));
        fails += report ("Clear-slot dry", maxd == 0.0f, "max|out-in| " + juce::String (maxd, 8));
    }

    // Hermetic IR-only preset round-trip (no NAM) — so preset serialization is
    // ALWAYS exercised, even on a machine with no models. CORE under --strict.
    {
        ++suitesRun;
        const juce::File irFile = makeSyntheticIR (sr);
        auto build = [&] (AudioEngine& e)
        {
            e.prepare (sr, block);
            auto ir = std::make_unique<IRNode>();
            ir->loadFile (irFile); ir->setMix (0.8f);
            e.setNode (AudioEngine::irSlot, std::move (ir));
        };

        AudioEngine original; build (original);
        juce::Thread::sleep (300);

        const juce::File presetFile = juce::File::getSpecialLocation (juce::File::tempDirectory)
                                          .getChildFile ("tonebench_test_ir_preset.tonebench");
        const bool saved = Preset::save (presetFile, original, 0.65f, sr, "IR Only");

        AudioEngine restored; restored.prepare (sr, block);
        Preset::RigInfo info;
        const bool loaded = Preset::load (presetFile, restored, sr, block, info);
        juce::Thread::sleep (300);

        auto in   = sig::pluck (sr, block * 120);
        auto outA = renderThroughEngine (original, in, block);
        auto outB = renderThroughEngine (restored, in, block);
        juce::AudioBuffer<float> diff (1, outA.getNumSamples());
        diff.copyFrom (0, 0, outA, 0, 0, outA.getNumSamples());
        diff.addFrom  (0, 0, outB, 0, 0, outB.getNumSamples(), -1.0f);

        fails += report ("Preset(IR) save", saved, presetFile.getFileName());
        fails += report ("Preset(IR) load", loaded && info.masterGain > 0.64f && info.masterGain < 0.66f,
                         "masterGain " + juce::String (info.masterGain, 3) + "  name '" + info.name + "'");
        fails += report ("Preset(IR) round-trip", metric::rms (diff) < 1.0e-6f,
                         "diff RMS " + juce::String (metric::rms (diff), 8)
                       + "  (ref " + juce::String (metric::rms (outA), 5) + ")");
    }

    // Malformed presets must be rejected cleanly (return false, never crash).
    {
        ++suitesRun;
        AudioEngine engine; engine.prepare (sr, block);
        Preset::RigInfo info;
        const auto temp = juce::File::getSpecialLocation (juce::File::tempDirectory);

        const juce::File f1 = temp.getChildFile ("tonebench_bad_truncated.tonebench");
        f1.replaceWithText ("{ \"format\": \"tonebench-preset\", \"schemaVersion\": 1, \"chain\": [");
        const bool r1 = Preset::load (f1, engine, sr, block, info);

        const juce::File f2 = temp.getChildFile ("tonebench_bad_garbage.tonebench");
        f2.replaceWithText ("not json at all %%%");
        const bool r2 = Preset::load (f2, engine, sr, block, info);

        const juce::File f3 = temp.getChildFile ("tonebench_bad_schema.tonebench");
        f3.replaceWithText ("{ \"format\": \"tonebench-preset\", \"schemaVersion\": 99, \"chain\": [] }");
        const bool r3 = Preset::load (f3, engine, sr, block, info);

        const juce::File f4 = temp.getChildFile ("tonebench_bad_wrongformat.tonebench");
        f4.replaceWithText ("{ \"hello\": 123 }");
        const bool r4 = Preset::load (f4, engine, sr, block, info);

        const bool r5 = Preset::load (temp.getChildFile ("tonebench_nonexistent.tonebench"),
                                      engine, sr, block, info);

        fails += report ("Preset malformed", ! r1 && ! r2 && ! r3 && ! r4 && ! r5,
                         "truncated/garbage/badschema/wrongformat/missing all rejected");
    }

    // NAM node: load a .nam (committed fixture, else ~/Documents/NAMs) and verify
    // it processes. The headline assertion is a DETERMINISM oracle — NAM inference
    // is deterministic, so the same pluck rendered twice must be bit-identical —
    // plus a louder-in => louder-out gain relationship, both far stronger than the
    // old "RMS > 1e-4" liveness check. SKIP (counted) only if no model exists.
    {
        const juce::File namFile = findNamModel();
        if (! namFile.existsAsFile())
        {
            skipSuite ("NAM", "no .nam fixture or ~/Documents/NAMs model", /*core*/ false);
        }
        else
        {
            ++suitesRun;

            auto build = [&] (AudioEngine& e, juce::String& err) -> bool
            {
                e.prepare (sr, block);
                auto nam = std::make_unique<NamNode>();
                const bool ok = nam->loadFile (namFile, err);
                const double expected = nam->getExpectedSampleRate();
                e.setNode (AudioEngine::namSlot, std::move (nam));
                juce::ignoreUnused (expected);
                return ok;
            };

            juce::String err;
            AudioEngine e1; const bool loaded = build (e1, err);
            const double expectedSr = e1.getNode (AudioEngine::namSlot) != nullptr
                                        ? static_cast<NamNode*> (e1.getNode (AudioEngine::namSlot))->getExpectedSampleRate()
                                        : -1.0;

            auto in   = sig::pluck (sr, block * 120);
            auto out1 = renderThroughEngine (e1, in, block);

            AudioEngine e2; build (e2, err);
            auto out2 = renderThroughEngine (e2, in, block);

            float detMax = 0.0f;
            for (int i = 0; i < out1.getNumSamples(); ++i)
                detMax = juce::jmax (detMax, std::abs (out1.getSample (0, i) - out2.getSample (0, i)));

            auto rmsForAmp = [&] (float amp)
            {
                AudioEngine e; juce::String e0; build (e, e0);
                auto sig = sig::pluck (sr, block * 120, 82.41f, amp);
                return metric::rms (renderThroughEngine (e, sig, block));
            };
            const float rmsLo = rmsForAmp (0.15f);
            const float rmsHi = rmsForAmp (0.45f);

            fails += report ("NAM load", loaded, namFile.getFileName() + (err.isEmpty() ? "" : " (" + err + ")"));
            fails += report ("NAM rate", std::abs (expectedSr - sr) < 1.0,
                             "model " + juce::String (expectedSr, 0) + " Hz, bench " + juce::String (sr, 0) + " Hz");
            fails += report ("NAM finite", metric::finite (out1), "no NaN/Inf");
            fails += report ("NAM determinism", detMax == 0.0f, "same pluck x2 bit-identical, max diff " + juce::String (detMax, 8));
            fails += report ("NAM gain", rmsHi > rmsLo * 1.5f,
                             "out RMS lo " + juce::String (rmsLo, 5) + " -> hi " + juce::String (rmsHi, 5));
        }
    }

    // Full NAM+IR preset round-trip: save, reload into a fresh engine, verify the
    // rendered output matches bit-for-bit (RMS of the diff). This additionally
    // covers the NAM slot in preset serialization. SKIP (counted) if no model —
    // the hermetic IR-only round-trip above keeps preset coverage either way.
    {
        const juce::File model = findNamModel();
        if (! model.existsAsFile())
        {
            skipSuite ("Preset(NAM+IR)", "no .nam to build a chain", /*core*/ false);
        }
        else
        {
            // Copy the model under the per-user temp dir so Preset's SEC-3
            // allow-list accepts the referenced path on any machine (incl. CI,
            // where the checkout may live outside the user's home).
            const juce::File namFile = juce::File::getSpecialLocation (juce::File::tempDirectory)
                                           .getChildFile ("tonebench_test_model.nam");
            model.copyFileTo (namFile);
            const juce::File irFile = makeSyntheticIR (sr);

            auto buildChain = [&] (AudioEngine& e)
            {
                e.prepare (sr, block);
                auto nam = std::make_unique<NamNode>(); juce::String err;
                nam->loadFile (namFile, err);
                e.setNode (AudioEngine::namSlot, std::move (nam));
                auto ir = std::make_unique<IRNode>();
                ir->loadFile (irFile); ir->setMix (0.8f);
                e.setNode (AudioEngine::irSlot, std::move (ir));
            };

            AudioEngine original; buildChain (original);
            juce::Thread::sleep (300);

            const juce::File presetFile = juce::File::getSpecialLocation (juce::File::tempDirectory)
                                              .getChildFile ("tonebench_test_preset.tonebench");
            const bool saved = Preset::save (presetFile, original, 0.7f, sr, "Test Rig");

            AudioEngine restored;
            restored.prepare (sr, block);
            Preset::RigInfo info;
            const bool loaded = Preset::load (presetFile, restored, sr, block, info);
            juce::Thread::sleep (300);

            // Confirm both slots actually came back (catches a silently-dropped node).
            const bool slotsRestored = restored.getNode (AudioEngine::namSlot) != nullptr
                                    && restored.getNode (AudioEngine::irSlot)  != nullptr;

            auto in   = sig::pluck (sr, block * 150);
            auto outA = renderThroughEngine (original, in, block);
            auto outB = renderThroughEngine (restored, in, block);

            // RMS of the difference should be ~0 if the chain was restored exactly.
            juce::AudioBuffer<float> diff (1, outA.getNumSamples());
            diff.copyFrom (0, 0, outA, 0, 0, outA.getNumSamples());
            diff.addFrom  (0, 0, outB, 0, 0, outB.getNumSamples(), -1.0f);

            ++suitesRun;
            fails += report ("Preset save", saved, presetFile.getFileName());
            fails += report ("Preset load", loaded && slotsRestored
                                            && info.masterGain > 0.69f && info.masterGain < 0.71f,
                             "masterGain " + juce::String (info.masterGain, 3) + "  name '" + info.name + "'"
                           + (slotsRestored ? "" : "  [slot missing]"));
            fails += report ("Preset round-trip", metric::rms (diff) < 1.0e-6f,
                             "diff RMS " + juce::String (metric::rms (diff), 8)
                           + "  (ref " + juce::String (metric::rms (outA), 5) + ")");
        }
    }

    // RealtimeResampler: beyond the single 44.1<->48 round-trip + pitch metric,
    // exercise identity, downsample, amplitude preservation, and the FIFO clamp.
    // CORE under --strict (the resampler sits on the hot path for every
    // sample-rate-mismatched NAM and is pure, deterministic C++).
    {
        ++suitesRun;
        const int blk = 128;

        auto zcRate = [] (const float* d, int from, int to)
        {
            int zc = 0;
            for (int i = from + 1; i < to; ++i) if ((d[i - 1] < 0.0f) != (d[i] < 0.0f)) ++zc;
            return (double) zc / juce::jmax (1, to - from);
        };
        // RMS over a window, skipping interpolator priming at the edges.
        auto rmsWin = [] (const float* d, int from, int to)
        {
            double s = 0.0; for (int i = from; i < to; ++i) s += (double) d[i] * d[i];
            return std::sqrt (s / juce::jmax (1, to - from));
        };

        // Run a chained up->down resample of a 440 Hz sine, returning the output
        // (same device rate in and out) so pitch AND amplitude can be measured.
        auto roundTrip = [&] (double hostR, double modelR)
        {
            RealtimeResampler up, down;
            up.prepare (hostR, modelR, blk);
            down.prepare (modelR, hostR, up.getMaxOutputSamples());
            std::vector<float> ub ((size_t) up.getMaxOutputSamples());
            std::vector<float> db ((size_t) down.getMaxOutputSamples() * 2 + 16);

            auto in = sig::sine (hostR, blk * 300, 440.0f, 0.3f);
            juce::AudioBuffer<float> out (1, in.getNumSamples()); out.clear();
            int w = 0;
            for (int pos = 0; pos + blk <= in.getNumSamples(); pos += blk)
            {
                const int nUp = up.process (in.getReadPointer (0) + pos, blk, ub.data(), (int) ub.size());
                const int nDown = down.process (ub.data(), nUp, db.data(), (int) db.size());
                for (int i = 0; i < nDown && w < out.getNumSamples(); ++i) out.setSample (0, w++, db[(size_t) i]);
            }
            return std::make_pair (std::move (in), std::move (out));
        };

        // (1) 44.1k <-> 48k round-trip: pitch within 2%, amplitude within 0.5 dB.
        {
            auto [in, out] = roundTrip (44100.0, 48000.0);
            const int lo = 4000, hi = in.getNumSamples() - 4000;
            const double zcIn = zcRate (in.getReadPointer (0), lo, hi);
            const double zcOut = zcRate (out.getReadPointer (0), lo, hi);
            const double pitchErr = zcIn > 0 ? std::abs (zcOut - zcIn) / zcIn : 1.0;
            const double rIn  = rmsWin (in.getReadPointer (0), lo, hi);
            const double rOut = rmsWin (out.getReadPointer (0), lo, hi);
            const double dB   = 20.0 * std::log10 (juce::jmax (1.0e-9, rOut) / juce::jmax (1.0e-9, rIn));

            fails += report ("Resampler pitch", pitchErr < 0.02,
                             "zc/samp in " + juce::String (zcIn, 5) + " out " + juce::String (zcOut, 5)
                           + "  (" + juce::String (pitchErr * 100.0, 2) + "% err)");
            fails += report ("Resampler level", std::abs (dB) < 0.5,
                             "44.1<->48 amplitude " + juce::String (dB, 3) + " dB");
        }

        // (2) Identity ratio (48k->48k): transparent passthrough — pitch exact,
        // amplitude within 0.5 dB (a Lagrange interpolator at integer positions
        // returns the node samples, offset only by its priming delay).
        {
            auto [in, out] = roundTrip (48000.0, 48000.0);
            const int lo = 2000, hi = in.getNumSamples() - 2000;
            const double zcIn = zcRate (in.getReadPointer (0), lo, hi);
            const double zcOut = zcRate (out.getReadPointer (0), lo, hi);
            const double pitchErr = zcIn > 0 ? std::abs (zcOut - zcIn) / zcIn : 1.0;
            const double dB = 20.0 * std::log10 (juce::jmax (1.0e-9, rmsWin (out.getReadPointer (0), lo, hi))
                                                / juce::jmax (1.0e-9, rmsWin (in.getReadPointer (0), lo, hi)));
            fails += report ("Resampler identity", pitchErr < 0.005 && std::abs (dB) < 0.5,
                             "pitch err " + juce::String (pitchErr * 100.0, 3) + "%  level " + juce::String (dB, 3) + " dB");
        }

        // (3) Pure downsample (96k->48k): pitch preserved, output finite.
        {
            RealtimeResampler down;
            down.prepare (96000.0, 48000.0, blk);
            std::vector<float> db ((size_t) down.getMaxOutputSamples() + 16);
            auto in = sig::sine (96000.0, blk * 300, 440.0f, 0.3f);
            juce::AudioBuffer<float> out (1, in.getNumSamples()); out.clear();
            int w = 0; bool fin = true;
            for (int pos = 0; pos + blk <= in.getNumSamples(); pos += blk)
            {
                const int n = down.process (in.getReadPointer (0) + pos, blk, db.data(), (int) db.size());
                for (int i = 0; i < n && w < out.getNumSamples(); ++i)
                {
                    if (! std::isfinite (db[(size_t) i])) fin = false;
                    out.setSample (0, w++, db[(size_t) i]);
                }
            }
            // 96k 440Hz has half the zc/sample of the 48k output; compare scaled.
            const double zcIn  = zcRate (in.getReadPointer (0), 4000, in.getNumSamples() - 4000);
            const double zcOut = zcRate (out.getReadPointer (0), 2000, w - 2000);
            const double pitchErr = zcIn > 0 ? std::abs (zcOut - 2.0 * zcIn) / (2.0 * zcIn) : 1.0;
            fails += report ("Resampler downsample", fin && pitchErr < 0.02,
                             "96k->48k pitch err " + juce::String (pitchErr * 100.0, 2) + "%  finite " + (fin ? "yes" : "NO"));
        }

        // (4) FIFO safety-clamp: feeding MORE than the prepared max block must
        // clamp to capacity instead of overrunning the FIFO or corrupting output.
        {
            RealtimeResampler rs;
            rs.prepare (48000.0, 48000.0, blk);     // fifoCapacity == blk + 8
            std::vector<float> big ((size_t) blk * 4, 0.25f);
            std::vector<float> out ((size_t) rs.getMaxOutputSamples() + 16, 0.0f);
            const int n = rs.process (big.data(), (int) big.size(), out.data(), (int) out.size());
            bool fin = n >= 0 && n <= (int) out.size();
            for (int i = 0; i < n; ++i) if (! std::isfinite (out[(size_t) i])) fin = false;
            fails += report ("Resampler FIFO clamp", fin,
                             "fed " + juce::String ((int) big.size()) + " > capacity, produced "
                           + juce::String (n) + " finite samples (no overrun)");
        }
    }

    // VST3 node: only when TONEBENCH_TEST_VST is set (dlopen blocks under AMFI in
    // a sandboxed/CLI process — run this from a normal login shell).
    // VST3: hosting a real plugin reliably needs a GUI/login session (dlopen of a
    // code-signed bundle blocks under AMFI in a CLI process), and there is no
    // hermetic .vst3 fixture to commit, so this stays opt-in + env-gated and is
    // NOT a core suite (its skip never fails --strict). Point TONEBENCH_TEST_VST
    // at a bundle via TONEBENCH_VST_PATH to exercise it locally.
    if (std::getenv ("TONEBENCH_TEST_VST") != nullptr)
    {
        const char* envPath = std::getenv ("TONEBENCH_VST_PATH");
        juce::File vstFile (envPath != nullptr ? juce::String (envPath) : juce::String());
        if (! vstFile.exists())
        {
            skipSuite ("VST3", "set TONEBENCH_VST_PATH to a .vst3 bundle to run", /*core*/ false);
        }
        else
        {
            AudioEngine engine; engine.prepare (sr, block);
            auto vst = std::make_unique<Vst3Node>();
            juce::String err;
            std::cout << "  ....  VST3 loading " << vstFile.getFileName() << " ...\n";
            const auto status = loadVstBlocking (*vst, vstFile, sr, block, err, 8);

            if (status == VstLoad::timeout)
            {
                skipSuite ("VST3", "dlopen blocked (AMFI signature check in CLI) — verify in the GUI app", /*core*/ false);
            }
            else
            {
                ++suitesRun;
                const juce::String name = vst->getSourceName();
                engine.setNode (AudioEngine::vst3Slot, std::move (vst));

                auto in  = sig::pluck (sr, block * 200);
                auto out = renderThroughEngine (engine, in, block);

                fails += report ("VST3 load", status == VstLoad::loaded, status == VstLoad::loaded ? name : err);
                fails += report ("VST3 finite", metric::finite (out), "no NaN/Inf");
                fails += report ("VST3 output", metric::rms (out) > 1.0e-5f,
                                 "in RMS " + juce::String (metric::rms (in), 5)
                               + "  out RMS " + juce::String (metric::rms (out), 5));
            }
        }
    }

    // Zero-latency check: impulse in -> peak near sample 0.
    {
        ++suitesRun;
        AudioEngine engine; engine.prepare (sr, block);
        auto ir = std::make_unique<IRNode>();
        ir->loadFile (makeSyntheticIR (sr));
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (600);

        auto in = sig::impulse (sr, block * 8);
        auto out = renderThroughEngine (engine, in, block);
        const int lat = metric::peakIndex (out);
        fails += report ("IR latency", lat <= 64,
                         "peak at sample " + juce::String (lat) + " (zero-latency conv)");
    }

    std::cout << "=== "
              << (fails == 0 ? juce::String ("ALL PASS") : juce::String (fails) + " FAILURE(S)")
              << " (" << suitesRun << " run, " << suitesSkipped << " skipped)"
              << " ===\n";
    return fails == 0 ? 0 : 1;
}

int runRender (int argc, char** argv)
{
    auto args = parseArgs (argc, argv, 2);
    const double sr = args.count ("sr")    ? args["sr"].getDoubleValue()  : 48000.0;
    const int block = args.count ("block") ? args["block"].getIntValue()  : 128;

    // ---- input ----
    juce::AudioBuffer<float> input;
    double inSr = sr;
    if (args.count ("in"))
    {
        input = io::loadMono (juce::File (args["in"]), inSr);
        if (inSr != sr) std::cout << "note: input file is " << inSr << " Hz, bench running at " << sr << " Hz\n";
    }
    else
    {
        const juce::String gen = args.count ("gen") ? args["gen"] : "pluck";
        const double secs = args.count ("secs") ? args["secs"].getDoubleValue() : 3.0;
        const int len = (int) (sr * secs);
        if      (gen == "sine")    input = sig::sine (sr, len);
        else if (gen == "sweep")   input = sig::sweep (sr, len);
        else if (gen == "impulse") input = sig::impulse (sr, len);
        else if (gen == "noise")   input = sig::noise (sr, len);
        else                       input = sig::pluck (sr, len);
    }
    if (input.getNumSamples() == 0) { std::cerr << "no input\n"; return 1; }

    // ---- chain ----
    AudioEngine engine; engine.prepare (sr, block);
    if (args.count ("vst"))
    {
        auto vst = std::make_unique<Vst3Node>();
        juce::String err;
        const auto st = loadVstBlocking (*vst, juce::File (args["vst"]), sr, block, err, 20);
        if (st == VstLoad::timeout) { std::cerr << "VST3 load timed out (AMFI/dlopen) — run from a normal terminal\n"; return 1; }
        if (st == VstLoad::failed)  { std::cerr << "bad VST3: " << err << "\n"; return 1; }
        std::cout << "loaded VST3: " << vst->getSourceName() << "\n";
        engine.setNode (AudioEngine::vst3Slot, std::move (vst));
    }
    if (args.count ("nam"))
    {
        auto nam = std::make_unique<NamNode>();
        juce::String err;
        if (! nam->loadFile (juce::File (args["nam"]), err)) { std::cerr << "bad NAM: " << err << "\n"; return 1; }
        const double exp = nam->getExpectedSampleRate();
        if (exp > 0 && std::abs (exp - sr) >= 1.0)
            std::cout << "note: NAM model is " << exp << " Hz; device " << sr
                      << " Hz — resampling active\n";
        engine.setNode (AudioEngine::namSlot, std::move (nam));
    }
    if (args.count ("ir"))
    {
        auto ir = std::make_unique<IRNode>();
        if (! ir->loadFile (juce::File (args["ir"]))) { std::cerr << "bad IR\n"; return 1; }
        if (args.count ("mix")) ir->setMix ((float) args["mix"].getDoubleValue());
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        juce::Thread::sleep (700);
    }

    // ---- render ----
    RenderStats stats;
    auto output = renderThroughEngine (engine, input, block, &stats);

    const double blockBudget = block / sr;                 // real-time budget per block
    const double audioSec    = output.getNumSamples() / sr;
    const double rtFactor     = stats.totalProcSec / juce::jmax (1.0e-9, audioSec);
    const double worstHeadroom = stats.maxBlockSec / blockBudget;

    std::cout << "rendered " << juce::String (audioSec, 2) << " s @ "
              << sr << " Hz, block " << block << "\n"
              << "  in : RMS " << juce::String (metric::rms (input), 5)
              << "  peak " << juce::String (metric::peak (input), 4) << "\n"
              << "  out: RMS " << juce::String (metric::rms (output), 5)
              << "  peak " << juce::String (metric::peak (output), 4)
              << "  clipped " << metric::clipped (output)
              << "  finite " << (metric::finite (output) ? "yes" : "NO") << "\n"
              << "  cpu: " << juce::String (rtFactor * 100.0, 2) << "% of real-time"
              << "   (worst block " << juce::String (worstHeadroom * 100.0, 1)
              << "% of its " << juce::String (blockBudget * 1000.0, 2) << " ms budget)\n";
    if (worstHeadroom >= 1.0)
        std::cout << "  WARNING: a block exceeded its real-time budget — would glitch live\n";

    if (args.count ("out"))
    {
        const juce::File outFile (args["out"]);
        if (io::saveMono (outFile, output, sr)) std::cout << "wrote " << outFile.getFullPathName() << "\n";
        else { std::cerr << "write failed\n"; return 1; }
    }
    return 0;
}
} // namespace

//==============================================================================
int main (int argc, char** argv)
{
    std::cout << std::unitbuf; // flush every write so we can see progress / hangs
    juce::ScopedJuceInitialiser_GUI juceInit; // MessageManager, required to host VST3

    const juce::String mode = argc > 1 ? juce::String (argv[1]) : "selftest";
    if (mode == "render") return runRender (argc, argv);
    if (mode == "selftest")
    {
        bool strict = false;
        for (int i = 2; i < argc; ++i)
            if (juce::String (argv[i]) == "--strict") strict = true;
        return runSelfTest (strict);
    }

    std::cout << "usage:\n"
              << "  tonebench_cli selftest [--strict]   (--strict: a skipped CORE suite fails; used by CI)\n"
              << "  tonebench_cli render [--gen sine|sweep|impulse|noise|pluck [--secs S] | --in f.wav]"
                 " [--ir f.wav [--mix 0..1]] [--sr N] [--block N] --out out.wav\n";
    return 0;
}
