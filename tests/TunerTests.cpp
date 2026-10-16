#include "TestHelpers.h"
#include "app/AudioPath.h"
#include "app/RigController.h"
#include "app/Tuner.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

using namespace testing;
using Catch::Matchers::WithinAbs;

namespace
{
// A plucked-string-ish tone: fundamental plus decaying harmonics and a little noise.
std::vector<float> guitarNote (double hz, double rate, int n, float amp = 0.3f)
{
    std::vector<float> x ((size_t) n);
    juce::Random rng (7);
    for (int i = 0; i < n; ++i)
    {
        const double t = i / rate;
        double v = 0.0;
        for (int h = 1; h <= 6; ++h)
            v += std::sin (juce::MathConstants<double>::twoPi * hz * h * t) / (h * 1.3);
        x[(size_t) i] = amp * (float) v + 0.002f * (rng.nextFloat() - 0.5f);
    }
    return x;
}

double cents (double a, double b) { return 1200.0 * std::log2 (a / b); }
} // namespace

TEST_CASE ("Tuner: finds the pitch of every open string within a cent or two", "[tuner]")
{
    // Standard tuning, plus drop D's low D and a fretted high note.
    for (double hz : { 82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 73.42, 659.26, 1046.5 })
    {
        for (double rate : { 44100.0, 48000.0, 88200.0, 96000.0, 176400.0, 192000.0 })
        {
            CAPTURE (hz, rate);
            const int n = Tuner::windowFor (rate);   // the window the app reads
            const auto x = guitarNote (hz, rate, n);
            const double found = Tuner::detectPitch (x.data(), n, rate);
            REQUIRE (found > 0.0);
            REQUIRE (std::abs (cents (found, hz)) < 2.0);
        }
    }
}

TEST_CASE ("Tuner: says nothing for silence, hiss, or a quiet room", "[tuner]")
{
    const int n = 4096;
    std::vector<float> silence ((size_t) n, 0.0f);
    REQUIRE (Tuner::detectPitch (silence.data(), n, 48000.0) == 0.0);

    std::vector<float> noise ((size_t) n);
    juce::Random rng (3);
    for (auto& v : noise) v = 0.3f * (rng.nextFloat() * 2.0f - 1.0f);
    REQUIRE (Tuner::detectPitch (noise.data(), n, 48000.0) == 0.0);

    const auto faint = guitarNote (110.0, 48000.0, n, 0.001f);
    REQUIRE (Tuner::detectPitch (faint.data(), n, 48000.0) == 0.0);
}

TEST_CASE ("Tuner: names notes and how far off they are", "[tuner]")
{
    auto e2 = Tuner::describe (82.41);
    REQUIRE (e2.noteName == "E");
    REQUIRE (e2.octave == 2);
    REQUIRE_THAT (e2.cents, WithinAbs (0.0, 0.5));

    auto a4 = Tuner::describe (440.0);
    REQUIRE (a4.noteName == "A");
    REQUIRE (a4.octave == 4);
    REQUIRE (a4.midiNote == 69);

    auto sharp = Tuner::describe (440.0 * std::pow (2.0, 20.0 / 1200.0));
    REQUIRE (sharp.noteName == "A");
    REQUIRE_THAT (sharp.cents, WithinAbs (20.0, 0.01));

    auto flat = Tuner::describe (440.0 * std::pow (2.0, -30.0 / 1200.0));
    REQUIRE_THAT (flat.cents, WithinAbs (-30.0, 0.01));

    REQUIRE (Tuner::describe (466.16).noteName == "A#");
    REQUIRE (Tuner::describe (261.63).noteName == "C");
    REQUIRE (Tuner::describe (261.63).octave == 4);
}

TEST_CASE ("Tuner: reads what the guitar input played, and mutes the output while on", "[tuner][audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (256, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (1.0f);

    const auto note = guitarNote (110.0, 48000.0, 256 * 40);
    auto feed = [&]
    {
        float last = 0.0f;
        for (int pos = 0; pos < (int) note.size(); pos += 256)
        {
            juce::AudioBuffer<float> io (2, 256);
            io.copyFrom (0, 0, note.data() + pos, 256);
            io.clear (1, 0, 256);
            path.process (io, 0, 256);
            last = io.getMagnitude (0, 0, 256);
        }
        return last;
    };

    REQUIRE_FALSE (path.getTuner().read().has_value());   // off: nothing
    REQUIRE (feed() > 0.0f);                               // and the output plays

    path.getTuner().setActive (true);
    REQUIRE (feed() == 0.0f);                              // tuning: muted
    const auto r = path.getTuner().read();
    REQUIRE (r.has_value());
    REQUIRE (r->noteName == "A");
    REQUIRE (r->octave == 2);
    REQUIRE (std::abs (r->cents) < 2.0);

    path.getTuner().setActive (false);
    REQUIRE (feed() > 0.0f);                               // back to playing
}

TEST_CASE ("Tuner: the controller reports readings in the contract's shape", "[tuner][contract]")
{
    TempDir tmp;
    RigController rig (tmp.file ("Presets"), tmp.file ("settings.json"));
    rig.getAudio().prepare (256, 48000.0);
    REQUIRE (rig.readTuner().isVoid());

    rig.setTuner (true);
    const auto note = guitarNote (329.63, 48000.0, 8192);
    for (int pos = 0; pos < 8192; pos += 256)
    {
        juce::AudioBuffer<float> io (1, 256);
        io.copyFrom (0, 0, note.data() + pos, 256);
        rig.getAudio().process (io, 0, 256);
    }

    const auto r = rig.readTuner();
    REQUIRE (r.isObject());
    REQUIRE (r["note"] == juce::var ("E"));
    REQUIRE ((int) r["octave"] == 4);

    const auto contract = juce::JSON::parse (juce::File (TONEBENCH_SOURCE_DIR).getChildFile ("tests/contract/bridge.json"));
    juce::StringArray expected, actual;
    for (auto& k : *contract["tunerKeys"].getArray()) expected.add (k.toString());
    for (auto& p : r.getDynamicObject()->getProperties()) actual.add (p.name.toString());
    expected.sort (false);
    actual.sort (false);
    REQUIRE (actual == expected);
}

TEST_CASE ("Tuner: turning it on forgets what it heard last time", "[tuner]")
{
    Tuner tuner;
    tuner.prepare (48000.0);
    tuner.setActive (true);
    const auto note = guitarNote (110.0, 48000.0, 8192);
    tuner.push (note.data(), (int) note.size());
    REQUIRE (tuner.read().has_value());

    tuner.setActive (false);
    tuner.setActive (true);
    REQUIRE_FALSE (tuner.read().has_value());   // silence until something's played
}

TEST_CASE ("Tuner: the input meter keeps working while tuning", "[tuner][audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (256, 48000.0);
    path.setInputGain (1.0f);
    path.getTuner().setActive (true);

    juce::AudioBuffer<float> io (1, 256);
    juce::FloatVectorOperations::fill (io.getWritePointer (0), 0.25f, 256);
    path.process (io, 0, 256);
    REQUIRE_THAT (path.takeInputPeak(), WithinAbs (0.25, 1e-6));
    REQUIRE (path.takeOutputPeak() == 0.0f);
}
