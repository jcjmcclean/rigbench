#include "TestHelpers.h"
#include "app/AudioPath.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

using namespace testing;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::WithinRel;

namespace
{
// A stereo device buffer with `value` on input 1 and `other` on input 2.
juce::AudioBuffer<float> deviceBuffer (int n, float value, float other = 0.0f)
{
    juce::AudioBuffer<float> b (2, n);
    juce::FloatVectorOperations::fill (b.getWritePointer (0), value, n);
    juce::FloatVectorOperations::fill (b.getWritePointer (1), other, n);
    return b;
}
} // namespace

TEST_CASE ("Audio goes in on the first input and out on every output, through both gains", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (128, 48000.0);
    path.setInputGain (0.5f);
    path.setMasterGain (0.5f);

    auto io = deviceBuffer (128, 0.8f, 0.3f);
    path.process (io, 0, 128);

    // 0.8 * 0.5 (input) * 0.5 (master) = 0.2 on both outputs; input 2 is ignored.
    REQUIRE_THAT (io.getSample (0, 0), WithinAbs (0.2, 1e-6));
    REQUIRE_THAT (io.getSample (1, 127), WithinAbs (0.2, 1e-6));
}

TEST_CASE ("The chain sits between the input and master gains", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    engine.setNode (AudioEngine::irSlot, adds (1.0f));
    path.setInputGain (0.5f);
    path.setMasterGain (0.25f);

    auto io = deviceBuffer (64, 1.0f);
    path.process (io, 0, 64);
    REQUIRE_THAT (io.getSample (0, 10), WithinAbs ((1.0 * 0.5 + 1.0) * 0.25, 1e-6));
}

TEST_CASE ("Monitoring off outputs silence and zeroes the meters", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setInputGain (1.0f);

    auto io = deviceBuffer (64, 0.5f);
    path.process (io, 0, 64);
    REQUIRE (path.getInputPeak() > 0.0f);

    path.setMonitoring (false);
    io = deviceBuffer (64, 0.5f);
    path.process (io, 0, 64);
    REQUIRE (io.getMagnitude (0, 64) == 0.0f);
    REQUIRE (path.getInputPeak() == 0.0f);
    REQUIRE (path.getOutputPeak() == 0.0f);
}

TEST_CASE ("Only the requested region of the device buffer is touched", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (256, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (0.5f);

    auto io = deviceBuffer (256, 1.0f, 1.0f);
    path.process (io, 64, 128);

    REQUIRE (io.getSample (0, 0) == 1.0f);      // before the region
    REQUIRE (io.getSample (0, 63) == 1.0f);
    REQUIRE_THAT (io.getSample (0, 64), WithinAbs (0.5, 1e-6));
    REQUIRE_THAT (io.getSample (0, 191), WithinAbs (0.5, 1e-6));
    REQUIRE (io.getSample (0, 192) == 1.0f);    // after it
}

TEST_CASE ("A block bigger than the prepared size is muted, not overrun", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);   // allocates at least kMinBlockAlloc

    const int tooBig = kMinBlockAlloc + 1;
    auto io = deviceBuffer (tooBig, 0.5f);
    path.process (io, 0, tooBig);
    REQUIRE (io.getMagnitude (0, tooBig) == 0.0f);
}

TEST_CASE ("Meters report block peaks after each gain", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setInputGain (0.5f);
    path.setMasterGain (0.25f);

    auto io = deviceBuffer (64, -0.8f);
    path.process (io, 0, 64);
    REQUIRE_THAT (path.getInputPeak(), WithinAbs (0.4, 1e-6));
    REQUIRE_THAT (path.getOutputPeak(), WithinAbs (0.1, 1e-6));
}

TEST_CASE ("A mono device (one channel) still works", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (1.0f);

    juce::AudioBuffer<float> io (1, 64);
    juce::FloatVectorOperations::fill (io.getWritePointer (0), 0.25f, 64);
    path.process (io, 0, 64);
    REQUIRE (io.getSample (0, 5) == 0.25f);
}

TEST_CASE ("The scope gets signed peaks while playing and stays flat when quiet", "[audiopath][scope]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (128, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (1.0f);

    SECTION ("playing: about 3 points per 128 samples, carrying the sign")
    {
        auto io = deviceBuffer (128, -0.5f);
        path.process (io, 0, 128);

        std::vector<float> pts;
        path.drainScope (pts);
        REQUIRE (pts.size() == 3);
        for (float v : pts)
            REQUIRE_THAT (v, WithinAbs (-0.5, 1e-6));

        pts.clear();
        path.drainScope (pts);
        REQUIRE (pts.empty());   // drained
    }

    SECTION ("quiet input below the gate: points are zero")
    {
        auto io = deviceBuffer (128, AudioPath::scopeGate * 0.5f);
        path.process (io, 0, 128);

        std::vector<float> pts;
        path.drainScope (pts);
        REQUIRE_FALSE (pts.empty());
        for (float v : pts)
            REQUIRE (v == 0.0f);
    }

    SECTION ("the feed never overflows when nobody drains it")
    {
        for (int i = 0; i < 10000; ++i)
        {
            auto io = deviceBuffer (128, 0.5f);
            path.process (io, 0, 128);
        }
        std::vector<float> pts;
        path.drainScope (pts);
        REQUIRE (pts.size() < (size_t) AudioPath::scopeCapacity);
    }
}

TEST_CASE ("Gain changes ramp across a block instead of jumping", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (0.0f);

    auto io = deviceBuffer (64, 1.0f);
    path.process (io, 0, 64);
    REQUIRE (io.getMagnitude (0, 0, 64) == 0.0f);   // first block after prepare: no ramp

    path.setMasterGain (1.0f);
    io = deviceBuffer (64, 1.0f);
    path.process (io, 0, 64);
    REQUIRE (io.getSample (0, 0) < 0.1f);                        // starts near the old gain
    REQUIRE_THAT (io.getSample (0, 63), WithinAbs (1.0, 0.05));  // ends at the new one
    for (int i = 1; i < 64; ++i)
        REQUIRE (io.getSample (0, i) >= io.getSample (0, i - 1));

    io = deviceBuffer (64, 1.0f);
    path.process (io, 0, 64);
    REQUIRE (io.getSample (0, 0) == 1.0f);                       // settled
}

TEST_CASE ("The noise gate is off by default, cuts hiss when on, and lets playing through", "[audiopath][gate]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (256, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (1.0f);

    // Steady input at `level` for ~0.5 s; returns the output level at the end.
    auto settle = [&] (float level)
    {
        float out = 0.0f;
        for (int i = 0; i < 100; ++i)
        {
            auto io = deviceBuffer (256, 0.0f);
            for (int s = 0; s < 256; ++s)   // a 375 Hz square wave at `level`
                io.setSample (0, s, ((s / 64) % 2 == 0) ? level : -level);
            path.process (io, 0, 256);
            out = io.getMagnitude (0, 0, 256);
        }
        return out;
    };

    const float hiss = juce::Decibels::decibelsToGain (-60.0f);
    const float note = juce::Decibels::decibelsToGain (-12.0f);

    REQUIRE (path.getGate() == 0.0f);
    REQUIRE_THAT (settle (hiss), WithinAbs (hiss, 1e-6));   // off: untouched

    path.setGate (0.5f);   // threshold -50 dB
    REQUIRE (AudioPath::gateThresholdDb (0.5f) == -50.0f);
    REQUIRE (settle (hiss) < hiss * 0.1f);                    // hiss well below where it was
    REQUIRE_THAT (settle (note), WithinRel (note, 0.05f));    // playing passes

    path.setGate (5.0f);   // clamped
    REQUIRE (path.getGate() == 1.0f);
}
