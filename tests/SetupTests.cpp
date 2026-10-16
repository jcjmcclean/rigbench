#include "TestHelpers.h"
#include "app/AppSettings.h"
#include "app/AudioPath.h"
#include "app/AudioSetup.h"
#include "app/RigController.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

using namespace testing;
using Catch::Matchers::WithinAbs;

//== AppSettings ===============================================================
TEST_CASE ("Settings: setup starts unfinished and is remembered once finished", "[settings]")
{
    TempDir tmp;
    const auto file = tmp.file ("settings.json");

    {
        AppSettings s (file);
        REQUIRE_FALSE (s.isSetupComplete());
        s.setSetupComplete (true);
    }
    REQUIRE (AppSettings (file).isSetupComplete());
}

TEST_CASE ("Settings: a broken settings file is treated as a fresh install", "[settings]")
{
    TempDir tmp;
    const auto file = tmp.file ("settings.json");
    file.replaceWithText ("{ not json");
    REQUIRE_FALSE (AppSettings (file).isSetupComplete());
}

//== RigController + setup =====================================================
TEST_CASE ("Controller: on a fresh install, monitoring stays off until setup is finished", "[controller][settings]")
{
    TempDir tmp;
    const auto settingsFile = tmp.file ("settings.json");

    {
        RigController rig (tmp.file ("Presets"), settingsFile);
        REQUIRE_FALSE (rig.isSetupComplete());
        REQUIRE_FALSE (rig.getAudio().isMonitoring());
        REQUIRE_FALSE ((bool) rig.buildState ({}, 0, 0)["setupComplete"]);

        rig.finishSetup();
        REQUIRE (rig.isSetupComplete());
        REQUIRE (rig.getAudio().isMonitoring());
    }

    RigController next (tmp.file ("Presets"), settingsFile);
    REQUIRE (next.isSetupComplete());
    REQUIRE (next.getAudio().isMonitoring());
    REQUIRE ((bool) next.buildState ({}, 0, 0)["setupComplete"]);
}

//== AudioPath: per-input meters and the test sound ============================
TEST_CASE ("AudioPath: each input channel has its own held meter", "[audiopath][setup]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setMonitoring (false);   // setup listens with monitoring off

    juce::AudioBuffer<float> io (3, 64);
    io.clear();
    io.setSample (1, 10, -0.6f);   // guitar on input 2
    io.setSample (2, 3, 0.1f);
    path.process (io, 0, 64);

    // A quiet block afterwards doesn't lower the held peak.
    io.clear();
    path.process (io, 0, 64);

    REQUIRE (path.takeChannelPeak (0) == 0.0f);
    REQUIRE_THAT (path.takeChannelPeak (1), WithinAbs (0.6, 1e-6));
    REQUIRE_THAT (path.takeChannelPeak (2), WithinAbs (0.1, 1e-6));
    REQUIRE (path.takeChannelPeak (1) == 0.0f);   // taken
    REQUIRE (path.takeChannelPeak (-1) == 0.0f);
    REQUIRE (path.takeChannelPeak (AudioPath::maxChannelMeters) == 0.0f);
}

TEST_CASE ("AudioPath: the main meters hold the loudest block until taken", "[audiopath]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (64, 48000.0);
    path.setInputGain (1.0f);
    path.setMasterGain (1.0f);

    juce::AudioBuffer<float> loud (1, 64), quiet (1, 64);
    juce::FloatVectorOperations::fill (loud.getWritePointer (0), 0.9f, 64);
    juce::FloatVectorOperations::fill (quiet.getWritePointer (0), 0.1f, 64);
    path.process (loud, 0, 64);
    path.process (quiet, 0, 64);

    REQUIRE_THAT (path.takeInputPeak(), WithinAbs (0.9, 1e-6));
    REQUIRE_THAT (path.takeOutputPeak(), WithinAbs (0.9, 1e-6));
    REQUIRE (path.takeInputPeak() == 0.0f);
}

TEST_CASE ("AudioPath: the test sound plays on every output, even with monitoring off", "[audiopath][setup]")
{
    AudioEngine engine;
    AudioPath path (engine);
    path.prepare (512, 48000.0);
    path.setMonitoring (false);

    juce::AudioBuffer<float> io (2, 512);
    io.clear();
    path.process (io, 0, 512);
    REQUIRE (io.getMagnitude (0, 512) == 0.0f);   // silent until asked

    path.playTestSound();
    REQUIRE (path.isPlayingTestSound());

    float loudest = 0.0f;
    int blocks = 0;
    while (path.isPlayingTestSound() && blocks < 1000)
    {
        io.clear();
        path.process (io, 0, 512);
        loudest = juce::jmax (loudest, io.getMagnitude (0, 0, 512));
        REQUIRE (io.getMagnitude (1, 0, 512) == io.getMagnitude (0, 0, 512));
        REQUIRE (allFinite (io));
        ++blocks;
    }

    REQUIRE_FALSE (path.isPlayingTestSound());
    REQUIRE (loudest > 0.05f);
    REQUIRE (loudest <= 0.13f);                         // quiet: about -18 dBFS
    REQUIRE (blocks == (int) std::ceil (48000.0 * 0.8 / 512));   // under a second
}

//== AudioSetup ================================================================
TEST_CASE ("AudioSetup: built-in mics are recognised by name", "[setup]")
{
    REQUIRE (AudioSetup::looksBuiltIn ("MacBook Pro Microphone"));
    REQUIRE (AudioSetup::looksBuiltIn ("Built-in Microphone"));
    REQUIRE (AudioSetup::looksBuiltIn ("Microphone (Realtek(R) Audio)"));
    REQUIRE (AudioSetup::looksBuiltIn ("Microphone Array (Intel® Smart Sound)"));
    REQUIRE_FALSE (AudioSetup::looksBuiltIn ("Scarlett 2i2 USB"));
    REQUIRE_FALSE (AudioSetup::looksBuiltIn ("Universal Audio Apollo"));
    REQUIRE_FALSE (AudioSetup::looksBuiltIn ("Focusrite USB ASIO"));
}

TEST_CASE ("AudioSetup: describe has every key the UI expects, even with no device open", "[setup][contract]")
{
    juce::AudioDeviceManager dm;   // never initialised: no device
    const auto setup = AudioSetup::describe (dm);

    const auto contract = juce::JSON::parse (juce::File (TONEBENCH_SOURCE_DIR).getChildFile ("tests/contract/bridge.json"));
    juce::StringArray expected, actual;
    for (auto& k : *contract["audioSetupKeys"].getArray()) expected.add (k.toString());
    for (auto& p : setup.getDynamicObject()->getProperties()) actual.add (p.name.toString());
    expected.sort (false);
    actual.sort (false);
    REQUIRE (actual == expected);

    REQUIRE ((int) setup["input"] == -1);
    REQUIRE ((double) setup["sampleRate"] == 0.0);
    REQUIRE (setup["drivers"].isArray());
}

TEST_CASE ("AudioSetup: bad changes are refused with a reason", "[setup]")
{
    juce::AudioDeviceManager dm;

    REQUIRE (AudioSetup::apply (dm, juce::var()) == "Nothing to change.");
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"driver": "Imaginary"})")).startsWith ("Unknown driver"));
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"sampleRate": -1})")) == "That sample rate isn't valid.");
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"sampleRate": 1e9})")) == "That sample rate isn't valid.");
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"bufferSize": 0})")) == "That buffer size isn't valid.");
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"input": -2})")) == "That input isn't valid.");
    REQUIRE (AudioSetup::apply (dm, juce::JSON::parse (R"({"inputDevice": "No Such Interface 9000"})"))
                 == "\"No Such Interface 9000\" isn't available. Check it's plugged in, then pick it again.");
}
