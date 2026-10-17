#include "TestHelpers.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/Preset.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

using namespace testing;
using Catch::Matchers::WithinAbs;

namespace
{
juce::var readJson (const juce::File& f) { return juce::JSON::parse (f); }

juce::String presetJson (const juce::String& chain, const juce::String& io = R"({"masterGain": 0.5})",
                         int schemaVersion = 1, const juce::String& format = "tonebench-preset")
{
    return R"({"format": ")" + format + R"(", "schemaVersion": )" + juce::String (schemaVersion)
         + R"(, "name": "T", "io": )" + io + R"(, "chain": )" + chain + "}";
}

juce::String jsonPath (const juce::File& f)
{
    return juce::JSON::toString (f.getFullPathName());
}
} // namespace

TEST_CASE ("Preset: save writes the documented format", "[preset]")
{
    TempDir tmp;
    AudioEngine engine;
    engine.prepare (48000.0, 256);

    auto ir = std::make_unique<IRNode>();
    REQUIRE (ir->loadFile (writeSyntheticIR (tmp)));
    ir->setMix (0.25f);
    ir->setBypassed (true);
    engine.setNode (AudioEngine::irSlot, std::move (ir));

    auto nam = std::make_unique<NamNode>();
    juce::String err;
    REQUIRE (nam->loadFile (namFixture(), err));
    nam->setUiGain (0.75f);
    engine.setNode (AudioEngine::namSlot, std::move (nam));

    Preset::RigInfo info;
    info.inputGain = 0.3f;
    info.masterGain = 0.6f;
    info.sampleRateAtSave = 48000.0;
    info.name = "My Rig";

    const auto file = tmp.file ("rig.tonebench");
    REQUIRE (Preset::save (file, engine, info));

    const auto root = readJson (file);
    REQUIRE (root["format"] == juce::var ("tonebench-preset"));
    REQUIRE ((int) root["schemaVersion"] == 1);
    REQUIRE (root["name"] == juce::var ("My Rig"));
    REQUIRE_THAT ((double) root["io"]["inputGain"], WithinAbs (0.3, 1e-6));
    REQUIRE_THAT ((double) root["io"]["masterGain"], WithinAbs (0.6, 1e-6));

    auto* chain = root["chain"].getArray();
    REQUIRE (chain != nullptr);
    REQUIRE (chain->size() == 2);   // empty VST3 slot isn't written

    const auto& namVar = (*chain)[0];
    REQUIRE (namVar["type"] == juce::var ("nam"));
    REQUIRE ((int) namVar["slot"] == AudioEngine::namSlot);
    REQUIRE ((bool) namVar["enabled"]);
    REQUIRE_THAT ((double) namVar["level"], WithinAbs (0.75, 1e-6));

    const auto& irVar = (*chain)[1];
    REQUIRE (irVar["type"] == juce::var ("ir"));
    REQUIRE_FALSE ((bool) irVar["enabled"]);
    REQUIRE_THAT ((double) irVar["mix"], WithinAbs (0.25, 1e-6));
}

TEST_CASE ("Preset: everything the UI counts as the rig survives a round trip", "[preset]")
{
    TempDir tmp;
    AudioEngine original;
    original.prepare (48000.0, 256);

    auto ir = std::make_unique<IRNode>();
    REQUIRE (ir->loadFile (writeSyntheticIR (tmp)));
    ir->setMix (0.4f);
    original.setNode (AudioEngine::irSlot, std::move (ir));

    auto nam = std::make_unique<NamNode>();
    juce::String err;
    REQUIRE (nam->loadFile (namFixture(), err));
    nam->setUiGain (0.2f);
    nam->setBypassed (true);
    original.setNode (AudioEngine::namSlot, std::move (nam));

    Preset::RigInfo saved;
    saved.inputGain = 0.35f;
    saved.masterGain = 0.65f;
    const auto file = tmp.file ("rt.tonebench");
    REQUIRE (Preset::save (file, original, saved));

    AudioEngine restored;
    restored.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, restored, 48000.0, 256, info));

    REQUIRE_THAT (info.inputGain, WithinAbs (0.35, 1e-6));
    REQUIRE_THAT (info.masterGain, WithinAbs (0.65, 1e-6));
    REQUIRE (info.name == "rt");   // empty name falls back to the file name

    auto* restoredIr = dynamic_cast<IRNode*> (restored.getNode (AudioEngine::irSlot));
    REQUIRE (restoredIr != nullptr);
    REQUIRE_THAT (restoredIr->getMix(), WithinAbs (0.4, 1e-6));
    REQUIRE_FALSE (restoredIr->isBypassed());

    auto* restoredNam = dynamic_cast<NamNode*> (restored.getNode (AudioEngine::namSlot));
    REQUIRE (restoredNam != nullptr);
    REQUIRE_THAT (restoredNam->getUiGain(), WithinAbs (0.2, 1e-6));
    REQUIRE (restoredNam->isBypassed());
}

TEST_CASE ("Preset: loading clears slots the preset doesn't use", "[preset]")
{
    TempDir tmp;
    AudioEngine engine;
    engine.prepare (48000.0, 256);
    engine.setNode (AudioEngine::irSlot, adds (1.0f));
    engine.setNode (AudioEngine::namSlot, adds (1.0f));

    const auto file = tmp.file ("empty.tonebench");
    file.replaceWithText (presetJson ("[]"));

    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (engine.getNode (AudioEngine::irSlot) == nullptr);
    REQUIRE (engine.getNode (AudioEngine::namSlot) == nullptr);
}

TEST_CASE ("Preset: older presets without the newer fields get defaults", "[preset]")
{
    TempDir tmp;
    const auto nam = jsonPath (namFixture());
    const auto file = tmp.file ("old.tonebench");
    // A v1 preset from before input gain and NAM level were saved.
    file.replaceWithText (presetJson (R"([{"slot": 1, "type": "nam", "enabled": true, "path": )" + nam + "}]"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (info.inputGain == 0.8f);
    REQUIRE_THAT (info.masterGain, WithinAbs (0.5, 1e-6));

    auto* n = dynamic_cast<NamNode*> (engine.getNode (AudioEngine::namSlot));
    REQUIRE (n != nullptr);
    REQUIRE (n->getUiGain() == 0.5f);
}

TEST_CASE ("Preset: out-of-range values in a shared file are clamped", "[preset][security]")
{
    TempDir tmp;
    const auto file = tmp.file ("loud.tonebench");
    const auto irPath = jsonPath (writeSyntheticIR (tmp));
    file.replaceWithText (presetJson (R"([{"slot": 2, "type": "ir", "path": )" + irPath + R"(, "mix": 7}])",
                                      R"({"masterGain": 50, "inputGain": -3})"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (info.masterGain == 1.0f);
    REQUIRE (info.inputGain == 0.0f);
    REQUIRE (dynamic_cast<IRNode*> (engine.getNode (AudioEngine::irSlot))->getMix() == 1.0f);
}

TEST_CASE ("Preset: malformed files are refused without crashing", "[preset]")
{
    TempDir tmp;
    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;

    auto refuses = [&] (const juce::String& text)
    {
        const auto f = tmp.file ("bad.tonebench");
        f.replaceWithText (text);
        return ! Preset::load (f, engine, 48000.0, 256, info);
    };

    REQUIRE (refuses (""));
    REQUIRE (refuses ("garbage"));
    REQUIRE (refuses (R"({"format": "tonebench-preset", "schemaVersion": 1, "chain": [)"));   // truncated
    REQUIRE (refuses (presetJson ("[]", "{}", 2)));                       // future schema
    REQUIRE (refuses (presetJson ("[]", "{}", 0)));
    REQUIRE (refuses (presetJson ("[]", "{}", 1, "something-else")));      // wrong format
    REQUIRE (refuses ("[1, 2, 3]"));
    REQUIRE_FALSE (Preset::load (tmp.file ("missing.tonebench"), engine, 48000.0, 256, info));
}

TEST_CASE ("Preset: bad chain entries are skipped, good ones still load", "[preset]")
{
    TempDir tmp;
    const auto irPath = jsonPath (writeSyntheticIR (tmp));
    const auto file = tmp.file ("mixed.tonebench");
    file.replaceWithText (presetJson ("["
        R"({"slot": 9, "type": "ir", "path": )" + irPath + "},"     // slot out of range
        R"({"slot": 2, "type": "reverb", "path": )" + irPath + "},"  // unknown type
        R"({"slot": 1, "type": "nam", "path": "/definitely/not/here.nam"},)"
        R"("not an object",)"
        R"({"slot": 2, "type": "ir", "path": )" + irPath + "}"
        "]"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (engine.getNode (AudioEngine::irSlot) != nullptr);
    REQUIRE (engine.getNode (AudioEngine::namSlot) == nullptr);
}

#if ! JUCE_WINDOWS
TEST_CASE ("Preset: content outside the user's own folders is refused (SEC-3)", "[preset][security]")
{
    // /etc/hosts exists everywhere we build, and is outside home/temp/app-data.
    const juce::File outside ("/etc/hosts");
    REQUIRE (outside.existsAsFile());

    TempDir tmp;
    const auto file = tmp.file ("sneaky.tonebench");
    file.replaceWithText (presetJson (R"([{"slot": 2, "type": "ir", "path": "/etc/hosts"},)"
                                      R"( {"slot": 1, "type": "nam", "path": "/etc/hosts"}])"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (engine.getNode (AudioEngine::irSlot) == nullptr);
    REQUIRE (engine.getNode (AudioEngine::namSlot) == nullptr);
    REQUIRE (info.problems.size() == 2);
    REQUIRE (info.problems[0].contains ("only loads a preset's files from your home folder or an external drive"));
}
#endif

TEST_CASE ("Preset: VST3 slots are handed to the caller, never loaded directly (SEC-3)", "[preset][security]")
{
    TempDir tmp;
    const auto file = tmp.file ("plugin.tonebench");
    file.replaceWithText (presetJson (R"([{"slot": 0, "type": "vst3", "enabled": false,
        "path": "/Library/Audio/Plug-Ins/VST3/Amp.vst3", "identifier": "VST3-Amp-1234", "state": "QUJD"}])"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;

    SECTION ("with a callback, it gets the slot's details")
    {
        std::vector<Preset::VstSlot> got;
        REQUIRE (Preset::load (file, engine, 48000.0, 256, info, [&] (const Preset::VstSlot& v) { got.push_back (v); }));
        REQUIRE (got.size() == 1);
        REQUIRE (got[0].slot == AudioEngine::vst3Slot);
        REQUIRE_FALSE (got[0].enabled);
        REQUIRE (got[0].path.getFileName() == "Amp.vst3");
        REQUIRE (got[0].identifier == "VST3-Amp-1234");
        REQUIRE (got[0].stateBase64 == "QUJD");
        REQUIRE (engine.getNode (AudioEngine::vst3Slot) == nullptr);
    }

    SECTION ("without one, the slot is just skipped")
    {
        REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
        REQUIRE (engine.getNode (AudioEngine::vst3Slot) == nullptr);
    }
}

TEST_CASE ("Preset: presets live in the app's data folder", "[preset]")
{
    const auto dir = Preset::presetsDir();
    REQUIRE (dir.isDirectory());
    REQUIRE (dir.getFileName() == "Presets");
    REQUIRE (dir.getParentDirectory().getFileName() == "Tonebench");
   #if JUCE_MAC
    REQUIRE (dir.getParentDirectory().getParentDirectory().getFileName() == "Application Support");
   #endif
}

TEST_CASE ("Preset: every slot that can't be restored is explained", "[preset]")
{
    TempDir tmp;
    const auto file = tmp.file ("broken.tonebench");
    file.replaceWithText (presetJson ("["
        R"({"slot": 1, "type": "nam", "path": )" + jsonPath (tmp.file ("gone.nam")) + "},"
        R"({"slot": 2, "type": "ir", "path": )" + jsonPath (tmp.file ("gone.wav")) + "},"
        R"({"slot": 2, "type": "chorus", "path": "x"})"
        "]"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (info.problems.size() == 3);
    REQUIRE (info.problems[0] == "The amp model \"gone.nam\" wasn't found, so that slot is empty.");
    REQUIRE (info.problems[1] == "The cab IR \"gone.wav\" wasn't found, so that slot is empty.");
    REQUIRE (info.problems[2].contains ("chorus"));
}

TEST_CASE ("Preset: the type decides the slot, so an amp model can't land in the cab slot", "[preset]")
{
    TempDir tmp;
    const auto file = tmp.file ("mislabelled.tonebench");
    file.replaceWithText (presetJson (R"([{"slot": 2, "type": "nam", "path": )" + jsonPath (namFixture()) + "}]"));

    AudioEngine engine;
    engine.prepare (48000.0, 256);
    Preset::RigInfo info;
    REQUIRE (Preset::load (file, engine, 48000.0, 256, info));
    REQUIRE (dynamic_cast<NamNode*> (engine.getNode (AudioEngine::namSlot)) != nullptr);
    REQUIRE (engine.getNode (AudioEngine::irSlot) == nullptr);
}
