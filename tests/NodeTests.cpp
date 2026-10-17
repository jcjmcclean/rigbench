#include "TestHelpers.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/RealtimeResampler.h"
#include "engine/Vst3Node.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

using namespace testing;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;
using Catch::Matchers::ContainsSubstring;

namespace
{
// Convolution loads the IR on a background thread, then crossfades from the old
// IR to the new one over several blocks of process(). Wait for the load, let
// the crossfade finish, then render an impulse from a clean state.
juce::AudioBuffer<float> impulseThroughIR (IRNode& ir, int block = 256)
{
    waitUntilProcessed ([&]
    {
        auto probe = impulse (block);
        ir.process (probe);
        return probe.getSample (0, 1) != 0.0f;   // a tail only exists once the IR is live
    });

    for (int i = 0; i < 200; ++i)   // finish the crossfade
    {
        auto silence = constant (block, 0.0f);
        ir.process (silence);
    }
    ir.reset();
    auto out = impulse (block);
    ir.process (out);
    return out;
}
} // namespace

//==============================================================================
TEST_CASE ("IR: an impulse reproduces the cab's shape", "[ir]")
{
    TempDir tmp;
    IRNode ir;
    ir.prepare (48000.0, 512);
    REQUIRE (ir.loadFile (writeSyntheticIR (tmp)));
    REQUIRE (ir.getSourceName() == "cab.wav");

    const auto out = impulseThroughIR (ir, 512);
    const auto src = syntheticIR();

    // Normalised on load, so compare shape: one global scale fits every tap.
    const double scale = out.getSample (0, 0) / src.getSample (0, 0);
    for (int i = 0; i < 256; ++i)
        REQUIRE_THAT (out.getSample (0, i), WithinAbs (scale * src.getSample (0, i), 1e-5));
}

TEST_CASE ("IR: mix blends dry and wet", "[ir]")
{
    TempDir tmp;
    IRNode ir;
    ir.prepare (48000.0, 256);
    REQUIRE (ir.loadFile (writeSyntheticIR (tmp)));
    const auto wet = impulseThroughIR (ir);

    SECTION ("mix 0 is the dry signal, exactly")
    {
        ir.setMix (0.0f);
        ir.reset();
        auto b = impulse (256);
        ir.process (b);
        REQUIRE (b.getSample (0, 0) == 1.0f);
        for (int i = 1; i < 256; ++i)
            REQUIRE (b.getSample (0, i) == 0.0f);
    }

    SECTION ("mix 0.5 is halfway between")
    {
        ir.setMix (0.5f);
        ir.reset();
        auto b = impulse (256);
        ir.process (b);
        REQUIRE_THAT (b.getSample (0, 0), WithinAbs (0.5 * wet.getSample (0, 0) + 0.5, 1e-5));
        REQUIRE_THAT (b.getSample (0, 10), WithinAbs (0.5 * wet.getSample (0, 10), 1e-5));
    }

    SECTION ("changing mix ramps across the next block")
    {
        ir.setMix (1.0f);
        ir.reset();
        auto b = constant (256, 0.0f);
        ir.process (b);                 // settle at fully wet
        ir.setMix (0.0f);
        b = impulse (256);
        ir.process (b);
        // The impulse at sample 0 is still mostly wet; the ramp only reaches dry at the end.
        REQUIRE_THAT (b.getSample (0, 0), WithinAbs (wet.getSample (0, 0), 0.02));
    }

    SECTION ("mix is clamped to 0..1")
    {
        ir.setMix (3.0f);
        REQUIRE (ir.getMix() == 1.0f);
        ir.setMix (-1.0f);
        REQUIRE (ir.getMix() == 0.0f);
    }
}

TEST_CASE ("IR: adds no latency", "[ir]")
{
    TempDir tmp;
    IRNode ir;
    ir.prepare (48000.0, 256);
    REQUIRE (ir.loadFile (writeSyntheticIR (tmp)));
    const auto out = impulseThroughIR (ir);

    int peak = 0;
    for (int i = 1; i < out.getNumSamples(); ++i)
        if (std::abs (out.getSample (0, i)) > std::abs (out.getSample (0, peak))) peak = i;
    REQUIRE (peak == 0);
}

TEST_CASE ("IR: refuses missing and oversized files", "[ir][security]")
{
    TempDir tmp;
    IRNode ir;
    REQUIRE_FALSE (ir.loadFile (tmp.file ("nope.wav")));

    // SEC-4: anything over 16 MB is refused before the convolver sees it.
    auto big = tmp.file ("huge.wav");
    {
        juce::FileOutputStream os (big);
        juce::HeapBlock<char> chunk (1 << 20, true);
        for (int i = 0; i < 17; ++i)
            os.write (chunk.getData(), 1 << 20);
    }
    REQUIRE_FALSE (ir.loadFile (big));
}

TEST_CASE ("IR: a file that isn't audio is refused, whatever it's called", "[ir]")
{
    TempDir tmp;
    IRNode ir;
    auto fake = tmp.file ("cab.wav");
    fake.replaceWithText ("RIFF but not really");
    REQUIRE_FALSE (ir.loadFile (fake));
    REQUIRE (ir.getSourceName().isEmpty());

    auto empty = tmp.file ("empty.wav");
    writeWav (empty, juce::AudioBuffer<float> (1, 0), 48000.0);
    REQUIRE_FALSE (ir.loadFile (empty));
}

TEST_CASE ("IR: a block bigger than prepared is left alone", "[ir]")
{
    TempDir tmp;
    IRNode ir;
    ir.prepare (48000.0, 64);
    REQUIRE (ir.loadFile (writeSyntheticIR (tmp)));
    auto b = constant (128, 0.25f);
    ir.process (b);
    REQUIRE (b.getSample (0, 100) == 0.25f);
}

//==============================================================================
TEST_CASE ("NAM: loads the fixture model and reports its rate", "[nam]")
{
    NamNode nam;
    juce::String err;
    REQUIRE (nam.loadFile (namFixture(), err));
    REQUIRE (err.isEmpty());
    REQUIRE (nam.getSourceName() == "minimal.nam");
    REQUIRE (nam.getExpectedSampleRate() == 48000.0);

    nam.prepare (48000.0, 256);
    REQUIRE (nam.sampleRateMatches());
    nam.prepare (44100.0, 256);
    REQUIRE_FALSE (nam.sampleRateMatches());
}

TEST_CASE ("NAM: bad files fail with a message, not a crash", "[nam]")
{
    TempDir tmp;
    juce::String err;

    SECTION ("missing")
    {
        NamNode nam;
        REQUIRE_FALSE (nam.loadFile (tmp.file ("missing.nam"), err));
        REQUIRE_THAT (err.toStdString(), ContainsSubstring ("isn't there any more"));
    }

    SECTION ("not JSON")
    {
        NamNode nam;
        auto f = tmp.file ("garbage.nam");
        f.replaceWithText ("this is not a model");
        REQUIRE_FALSE (nam.loadFile (f, err));
        REQUIRE (err.isNotEmpty());
    }

    SECTION ("JSON but not a model")
    {
        NamNode nam;
        auto f = tmp.file ("wrong.nam");
        f.replaceWithText (R"({"version": "0.5.0", "architecture": "Nope", "config": {}, "weights": []})");
        REQUIRE_FALSE (nam.loadFile (f, err));
        REQUIRE (err.isNotEmpty());
    }

    SECTION ("too large (SEC-4)")
    {
        NamNode nam;
        auto f = tmp.file ("huge.nam");
        {
            juce::FileOutputStream os (f);
            juce::HeapBlock<char> chunk (1 << 20, true);
            for (int i = 0; i < 65; ++i)
                os.write (chunk.getData(), 1 << 20);
        }
        REQUIRE_FALSE (nam.loadFile (f, err));
        REQUIRE_THAT (err.toStdString(), ContainsSubstring ("over 64 MB"));
    }
}

TEST_CASE ("NAM: without a model the node passes audio through", "[nam]")
{
    NamNode nam;
    nam.prepare (48000.0, 64);
    auto b = constant (64, 0.3f);
    nam.process (b);
    REQUIRE (b.getSample (0, 0) == 0.3f);
}

TEST_CASE ("NAM: the Level knob maps 0..1 to -24..+24 dB", "[nam]")
{
    NamNode nam;
    juce::String err;
    REQUIRE (nam.loadFile (namFixture(), err));
    nam.prepare (48000.0, 256);

    auto run = [&] (float level)
    {
        nam.setUiGain (level);
        nam.reset();
        auto b = sine (48000.0, 256, 220.0, 0.1f);
        nam.process (b);
        return rms (b);
    };

    const float unity = run (0.5f);
    REQUIRE (unity > 0.0f);
    REQUIRE_THAT (run (1.0f) / unity, WithinRel (juce::Decibels::decibelsToGain (24.0f), 1e-3f));
    REQUIRE_THAT (run (0.0f) / unity, WithinRel (juce::Decibels::decibelsToGain (-24.0f), 1e-3f));
    REQUIRE (nam.getUiGain() == 0.0f);
}

TEST_CASE ("NAM: turning the Level knob ramps instead of jumping", "[nam]")
{
    NamNode nam;
    juce::String err;
    REQUIRE (nam.loadFile (namFixture(), err));
    nam.prepare (48000.0, 256);

    auto dc = [] { return constant (256, 0.1f); };
    auto b = dc();
    nam.process (b);
    const float unity = b.getSample (0, 255);

    nam.setUiGain (1.0f);   // +24 dB
    b = dc();
    nam.process (b);
    REQUIRE (b.getSample (0, 10) < unity * 4.0f);   // still near the old level early on
    REQUIRE_THAT (b.getSample (0, 255) / unity, WithinRel (juce::Decibels::decibelsToGain (24.0f), 1e-3f));
}

TEST_CASE ("NAM: the model is deterministic", "[nam]")
{
    NamNode a, b;
    juce::String err;
    REQUIRE (a.loadFile (namFixture(), err));
    REQUIRE (b.loadFile (namFixture(), err));
    a.prepare (48000.0, 128);
    b.prepare (48000.0, 128);

    auto x = sine (48000.0, 128), y = sine (48000.0, 128);
    a.process (x);
    b.process (y);
    for (int i = 0; i < 128; ++i)
        REQUIRE (x.getSample (0, i) == y.getSample (0, i));
}

TEST_CASE ("NAM: a model at another rate is resampled, with constant block sizes", "[nam][resampler]")
{
    for (double deviceRate : { 44100.0, 88200.0, 96000.0 })
    {
        CAPTURE (deviceRate);
        NamNode nam;
        juce::String err;
        REQUIRE (nam.loadFile (namFixture(), err));
        nam.prepare (deviceRate, 256);

        const auto in = sine (deviceRate, 256 * 200, 220.0, 0.3f);
        auto out = in;
        for (int pos = 0; pos < out.getNumSamples(); pos += 256)
        {
            float* ch[1] = { out.getWritePointer (0, pos) };
            juce::AudioBuffer<float> view (ch, 1, 256);
            nam.process (view);
        }

        REQUIRE (allFinite (out));
        // After priming, the signal comes through at a similar level.
        juce::AudioBuffer<float> tailIn (1, 256 * 100), tailOut (1, 256 * 100);
        tailIn.copyFrom (0, 0, in, 0, 256 * 100, 256 * 100);
        tailOut.copyFrom (0, 0, out, 0, 256 * 100, 256 * 100);
        REQUIRE (rms (tailOut) > 0.1f * rms (tailIn));
    }
}

//==============================================================================
TEST_CASE ("Resampler: output count follows the ratio over time", "[resampler]")
{
    RealtimeResampler r;
    r.prepare (44100.0, 48000.0, 512);

    std::vector<float> in (512, 0.1f), out ((size_t) r.getMaxOutputSamples());
    long total = 0;
    for (int i = 0; i < 1000; ++i)
        total += r.process (in.data(), 512, out.data(), (int) out.size());

    const double expected = 512.0 * 1000.0 * 48000.0 / 44100.0;
    REQUIRE_THAT ((double) total, WithinAbs (expected, 4.0));
}

TEST_CASE ("Resampler: an identity ratio is transparent (after its fixed delay)", "[resampler]")
{
    RealtimeResampler r;
    r.prepare (48000.0, 48000.0, 256);
    const auto in = sine (48000.0, 256 * 8);

    std::vector<float> out;
    std::vector<float> chunk ((size_t) r.getMaxOutputSamples());
    for (int pos = 0; pos < in.getNumSamples(); pos += 256)
    {
        const int n = r.process (in.getReadPointer (0, pos), 256, chunk.data(), (int) chunk.size());
        out.insert (out.end(), chunk.begin(), chunk.begin() + n);
    }
    REQUIRE (out.size() >= (size_t) in.getNumSamples() - 8);

    // The Lagrange interpolator delays by a few samples: find that delay, then
    // the rest must match the input sample for sample.
    int bestLag = -1;
    double bestErr = 1e9;
    for (int lag = 0; lag <= 8; ++lag)
    {
        double err = 0.0;
        for (int i = 64; i < 1024; ++i)
            err = juce::jmax (err, (double) std::abs (out[(size_t) (i + lag)] - in.getSample (0, i)));
        if (err < bestErr) { bestErr = err; bestLag = lag; }
    }
    CAPTURE (bestLag);
    REQUIRE (bestLag <= 4);
    REQUIRE (bestErr < 1e-5);
}

TEST_CASE ("Resampler: never writes past the output buffer", "[resampler]")
{
    RealtimeResampler r;
    r.prepare (96000.0, 48000.0, 512);
    std::vector<float> in (512, 0.5f), out (8, -99.0f);
    const int n = r.process (in.data(), 512, out.data(), 4);
    REQUIRE (n <= 4);
    REQUIRE (out[4] == -99.0f);
}

//==============================================================================
TEST_CASE ("VST3: a missing plugin fails straight away with a message", "[vst3]")
{
    TempDir tmp;
    Vst3Node node;
    bool called = false, ok = true;
    juce::String err;
    node.loadAsync (tmp.file ("Missing.vst3"), 48000.0, 256, [&] (bool o, juce::String e) { called = true; ok = o; err = e; });

    REQUIRE (called);
    REQUIRE_FALSE (ok);
    REQUIRE_THAT (err.toStdString(), ContainsSubstring ("isn't there any more"));
}

// Not on Windows: there JUCE hands the file to LoadLibrary, which can put up a
// "not a valid application" box that nobody can dismiss on a headless CI runner
// (the test hung there). Worth checking by hand in the app on Windows.
#if ! JUCE_WINDOWS
TEST_CASE ("VST3: a file that isn't a plugin fails with a message", "[vst3]")
{
    TempDir tmp;
    auto fake = tmp.file ("Fake.vst3");
    fake.replaceWithText ("not a plugin");

    Vst3Node node;
    bool called = false, ok = true;
    node.loadAsync (fake, 48000.0, 256, [&] (bool o, juce::String) { called = true; ok = o; });
    REQUIRE (called);
    REQUIRE_FALSE (ok);
}
#endif

TEST_CASE ("VST3: an empty node passes audio through", "[vst3]")
{
    Vst3Node node;
    node.prepare (48000.0, 64);
    auto b = constant (64, 0.4f);
    node.process (b);
    REQUIRE (b.getSample (0, 0) == 0.4f);
    REQUIRE (node.getStateBase64().isEmpty());
}
