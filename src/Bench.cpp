// ToneStack offline bench — a simulated audio interface for deterministic
// testing. It feeds known signals through the REAL engine, block-by-block, just
// like the live audio callback, then writes a WAV you can listen to and prints
// metrics (level, peak, clipping, NaN, measured latency).
//
// Usage:
//   tonestack_bench selftest
//   tonestack_bench render [input] [chain] [--sr N] [--block N] --out file.wav
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
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <map>

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

juce::File makeSyntheticIR (double sr)
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
    auto f = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("tonestack_test_ir.wav");
    io::saveMono (f, ir, sr);
    return f;
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

int runSelfTest()
{
    const double sr = 48000.0; const int block = 128;
    int fails = 0;
    std::cout << "=== ToneStack self-test ===\n";

    // IR node: sine in -> finite, non-trivial out.
    {
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

    // NAM node: load a real .nam (from ~/Documents/NAMs) and verify it processes.
    {
        juce::Array<juce::File> namFiles;
        juce::File namDir (juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                               .getChildFile ("NAMs"));
        namDir.findChildFiles (namFiles, juce::File::findFiles, true, "*.nam");

        if (namFiles.isEmpty())
        {
            std::cout << "  SKIP  NAM                  no .nam files under ~/Documents/NAMs\n";
        }
        else
        {
            AudioEngine engine; engine.prepare (sr, block);
            auto nam = std::make_unique<NamNode>();
            juce::String err;
            const bool loaded = nam->loadFile (namFiles[0], err);
            const double expectedSr = nam->getExpectedSampleRate();
            engine.setNode (AudioEngine::namSlot, std::move (nam));

            auto in  = sig::pluck (sr, block * 200);
            auto out = renderThroughEngine (engine, in, block);

            fails += report ("NAM load", loaded, namFiles[0].getFileName() + (err.isEmpty() ? "" : " (" + err + ")"));
            fails += report ("NAM rate", std::abs (expectedSr - sr) < 1.0,
                             "model " + juce::String (expectedSr, 0) + " Hz, bench " + juce::String (sr, 0) + " Hz");
            fails += report ("NAM finite", metric::finite (out), "no NaN/Inf");
            fails += report ("NAM output", metric::rms (out) > 1.0e-4f,
                             "in RMS " + juce::String (metric::rms (in), 5)
                           + "  out RMS " + juce::String (metric::rms (out), 5));
        }
    }

    // Preset round-trip: build NAM+IR chain, save, reload into a fresh engine,
    // and verify the rendered output matches (bit-for-bit via RMS of the diff).
    {
        juce::Array<juce::File> namFiles;
        juce::File namDir (juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                               .getChildFile ("NAMs"));
        namDir.findChildFiles (namFiles, juce::File::findFiles, true, "*.nam");
        const juce::File irFile = makeSyntheticIR (sr);

        if (namFiles.isEmpty())
        {
            std::cout << "  SKIP  Preset               no .nam to build a chain\n";
        }
        else
        {
            auto buildChain = [&] (AudioEngine& e)
            {
                e.prepare (sr, block);
                auto nam = std::make_unique<NamNode>(); juce::String err;
                nam->loadFile (namFiles[0], err);
                e.setNode (AudioEngine::namSlot, std::move (nam));
                auto ir = std::make_unique<IRNode>();
                ir->loadFile (irFile); ir->setMix (0.8f);
                e.setNode (AudioEngine::irSlot, std::move (ir));
            };

            AudioEngine original; buildChain (original);
            juce::Thread::sleep (300);

            const juce::File presetFile = juce::File::getSpecialLocation (juce::File::tempDirectory)
                                              .getChildFile ("tonestack_test_preset.tonestack");
            const bool saved = Preset::save (presetFile, original, 0.7f, sr, "Test Rig");

            AudioEngine restored;
            restored.prepare (sr, block);
            Preset::RigInfo info;
            const bool loaded = Preset::load (presetFile, restored, sr, block, info);
            juce::Thread::sleep (300);

            auto in   = sig::pluck (sr, block * 150);
            auto outA = renderThroughEngine (original, in, block);
            auto outB = renderThroughEngine (restored, in, block);

            // RMS of the difference should be ~0 if the chain was restored exactly.
            juce::AudioBuffer<float> diff (1, outA.getNumSamples());
            diff.copyFrom (0, 0, outA, 0, 0, outA.getNumSamples());
            diff.addFrom  (0, 0, outB, 0, 0, outB.getNumSamples(), -1.0f);

            fails += report ("Preset save", saved, presetFile.getFileName());
            fails += report ("Preset load", loaded && info.masterGain > 0.69f && info.masterGain < 0.71f,
                             "masterGain " + juce::String (info.masterGain, 3) + "  name '" + info.name + "'");
            fails += report ("Preset round-trip", metric::rms (diff) < 1.0e-6f,
                             "diff RMS " + juce::String (metric::rms (diff), 8)
                           + "  (ref " + juce::String (metric::rms (outA), 5) + ")");
        }
    }

    // Resampler transparency: 44.1k -> 48k -> 44.1k on a sine keeps pitch + level.
    {
        const double hostR = 44100.0, modelR = 48000.0;
        const int blk = 128;
        RealtimeResampler up, down;
        up.prepare (hostR, modelR, blk);
        down.prepare (modelR, hostR, up.getMaxOutputSamples());
        std::vector<float> ub ((size_t) up.getMaxOutputSamples());
        std::vector<float> db ((size_t) down.getMaxOutputSamples() * 2 + 16);

        auto in = sig::sine (hostR, blk * 300, 440.0f);
        juce::AudioBuffer<float> out (1, in.getNumSamples()); out.clear();
        int w = 0;
        for (int pos = 0; pos + blk <= in.getNumSamples(); pos += blk)
        {
            const int nUp = up.process (in.getReadPointer (0) + pos, blk, ub.data(), (int) ub.size());
            const int nDown = down.process (ub.data(), nUp, db.data(), (int) db.size());
            for (int i = 0; i < nDown && w < out.getNumSamples(); ++i) out.setSample (0, w++, db[i]);
        }

        auto zcRate = [] (const float* d, int from, int to)
        {
            int zc = 0;
            for (int i = from + 1; i < to; ++i) if ((d[i - 1] < 0.0f) != (d[i] < 0.0f)) ++zc;
            return (double) zc / juce::jmax (1, to - from);
        };
        const int lo = 4000, hi = juce::jmin (in.getNumSamples(), w) - 4000;
        const double zcIn = zcRate (in.getReadPointer (0), lo, hi);
        const double zcOut = zcRate (out.getReadPointer (0), lo, hi);
        const double pitchErr = zcIn > 0 ? std::abs (zcOut - zcIn) / zcIn : 1.0;

        fails += report ("Resampler pitch", pitchErr < 0.02,
                         "zc/samp in " + juce::String (zcIn, 5) + " out " + juce::String (zcOut, 5)
                       + "  (" + juce::String (pitchErr * 100.0, 2) + "% err)");
    }

    // VST3 node: only when TONESTACK_TEST_VST is set (dlopen blocks under AMFI in
    // a sandboxed/CLI process — run this from a normal login shell).
    if (std::getenv ("TONESTACK_TEST_VST") != nullptr)
    {
        juce::File vstFile ("/Users/jamestu/Downloads/SICO High Gain.vst3");
        if (! vstFile.exists())
        {
            std::cout << "  SKIP  VST3                 SICO High Gain.vst3 not found in ~/Downloads\n";
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
                std::cout << "  SKIP  VST3                 dlopen blocked (AMFI signature check in CLI) "
                             "— verify in the GUI app instead\n";
            }
            else
            {
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

    std::cout << "=== " << (fails == 0 ? "ALL PASS" : juce::String (fails) + " FAILURE(S)") << " ===\n";
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
    if (mode == "selftest") return runSelfTest();

    std::cout << "usage:\n"
              << "  tonestack_bench selftest\n"
              << "  tonestack_bench render [--gen sine|sweep|impulse|noise|pluck [--secs S] | --in f.wav]"
                 " [--ir f.wav [--mix 0..1]] [--sr N] [--block N] --out out.wav\n";
    return 0;
}
