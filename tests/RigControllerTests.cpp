#include "TestHelpers.h"
#include "app/PresetNames.h"
#include "app/RigController.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/SlotTypes.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>
#include <limits>

using namespace testing;
using Catch::Matchers::WithinAbs;
using Catch::Matchers::ContainsSubstring;

namespace
{
const juce::String badName = "That name won't work as a file name. Leave out / \\ and :, and try again.";

struct Rig
{
    TempDir tmp;
    RigController rig { tmp.file ("Presets") };

    Rig() { rig.getAudio().prepare (256, 48000.0); }

    void loadIR()  { REQUIRE (rig.loadIR (writeSyntheticIR (tmp)).isEmpty()); }
    void loadNam() { REQUIRE (rig.loadNam (namFixture()).isEmpty()); }

    juce::var state() const { return rig.buildState ({}, 0.0f, 0.0f); }
    juce::var slot (const char* id) const { return state()["slots"][id]; }
};
} // namespace

//== loading ===================================================================
TEST_CASE ("Controller: loading NAM and IR fills their slots", "[controller]")
{
    Rig r;
    r.loadNam();
    r.loadIR();

    REQUIRE ((bool) r.slot ("nam")["loaded"]);
    REQUIRE (r.slot ("nam")["name"] == juce::var ("minimal.nam"));
    REQUIRE ((bool) r.slot ("ir")["loaded"]);
    REQUIRE (r.slot ("ir")["name"] == juce::var ("cab.wav"));
    REQUIRE_FALSE ((bool) r.slot ("vst3")["loaded"]);
}

TEST_CASE ("Controller: a file that won't load says why and leaves the slot alone", "[controller]")
{
    Rig r;
    r.loadNam();

    const auto err = r.rig.loadNam (r.tmp.file ("missing.nam"));
    REQUIRE_THAT (err.toStdString(), ContainsSubstring ("Couldn't load the amp model \"missing.nam\". The file isn't there any more."));
    REQUIRE (r.slot ("nam")["name"] == juce::var ("minimal.nam"));   // the old model is still there

    REQUIRE_THAT (r.rig.loadIR (r.tmp.file ("missing.wav")).toStdString(),
                  ContainsSubstring ("Couldn't load the cab IR \"missing.wav\". It needs to be a WAV, AIFF, or FLAC file under 16 MB."));
}

//== bridge operations =========================================================
TEST_CASE ("Controller: bypass, clear, mix and level act on the right slot", "[controller]")
{
    Rig r;
    r.loadNam();
    r.loadIR();

    r.rig.setBypass ("ir", true);
    REQUIRE ((bool) r.slot ("ir")["bypassed"]);
    REQUIRE_FALSE ((bool) r.slot ("nam")["bypassed"]);

    r.rig.setMix ("ir", 0.3);
    REQUIRE_THAT ((double) r.slot ("ir")["mix"], WithinAbs (0.3, 1e-6));

    r.rig.setGain ("nam", 0.9);
    REQUIRE_THAT ((double) r.slot ("nam")["gain"], WithinAbs (0.9, 1e-6));

    r.rig.clearSlot ("nam");
    REQUIRE_FALSE ((bool) r.slot ("nam")["loaded"]);
    REQUIRE ((bool) r.slot ("ir")["loaded"]);
}

TEST_CASE ("Controller: mix only applies to the cab, level only to the amp", "[controller]")
{
    Rig r;
    r.loadNam();
    r.loadIR();

    r.rig.setMix ("nam", 0.1);     // NAM has no mix
    r.rig.setGain ("ir", 0.1);     // IR has no level
    REQUIRE_THAT ((double) r.slot ("ir")["mix"], WithinAbs (1.0, 1e-6));
    REQUIRE_THAT ((double) r.slot ("nam")["gain"], WithinAbs (0.5, 1e-6));
}

TEST_CASE ("Controller: unknown slots and empty slots are ignored", "[controller]")
{
    Rig r;
    r.rig.setBypass ("reverb", true);
    r.rig.setMix ("", 0.2);
    r.rig.clearSlot ("../../etc");
    r.rig.setBypass ("ir", true);   // nothing loaded there
    r.rig.clearSlot ("vst3");
    REQUIRE_FALSE ((bool) r.slot ("ir")["bypassed"]);
}

TEST_CASE ("Controller: gains from the UI are clamped and NaN-proof (SEC-6)", "[controller][security]")
{
    Rig r;
    r.loadIR();

    const double inf = std::numeric_limits<double>::infinity();
    const double nan = std::numeric_limits<double>::quiet_NaN();

    r.rig.setInput (2.5);
    REQUIRE (r.rig.getAudio().getInputGain() == 1.0f);
    r.rig.setInput (-1.0);
    REQUIRE (r.rig.getAudio().getInputGain() == 0.0f);
    r.rig.setMaster (nan);
    REQUIRE (r.rig.getAudio().getMasterGain() == 0.0f);
    r.rig.setMaster (inf);
    REQUIRE (r.rig.getAudio().getMasterGain() == 0.0f);
    r.rig.setMix ("ir", juce::var ("loud"));   // a string: not a number
    REQUIRE (std::isfinite ((double) r.slot ("ir")["mix"]));

    REQUIRE (RigController::clampUnit (0.25) == 0.25f);
    REQUIRE (RigController::clampUnit (juce::var()) == 0.0f);
}

TEST_CASE ("Controller: monitor switches the output on and off", "[controller]")
{
    Rig r;
    r.rig.setMonitor (false);
    REQUIRE_FALSE ((bool) r.state()["monitoring"]);
    REQUIRE_FALSE (r.rig.getAudio().isMonitoring());
    r.rig.setMonitor (true);
    REQUIRE ((bool) r.state()["monitoring"]);
}

//== presets ===================================================================
TEST_CASE ("Controller: save then load brings the whole rig back", "[controller][preset]")
{
    Rig r;
    r.loadNam();
    r.loadIR();
    r.rig.setInput (0.4);
    r.rig.setMaster (0.6);
    r.rig.setGain ("nam", 0.7);
    r.rig.setMix ("ir", 0.2);
    r.rig.setBypass ("nam", true);
    r.rig.setGate (0.3);

    REQUIRE (r.rig.savePreset ("Crunch").isEmpty());
    REQUIRE (r.rig.getActivePreset() == "Crunch");
    REQUIRE (r.state()["activePreset"] == juce::var ("Crunch"));

    // Change everything, then load it back.
    r.rig.setInput (1.0);
    r.rig.setMaster (1.0);
    r.rig.setGate (0.0);
    r.rig.clearSlot ("nam");
    r.rig.setMix ("ir", 1.0);

    REQUIRE (r.rig.loadPreset ("Crunch").isEmpty());
    const auto s = r.state();
    REQUIRE_THAT ((double) s["inputGain"], WithinAbs (0.4, 1e-6));
    REQUIRE_THAT ((double) s["masterGain"], WithinAbs (0.6, 1e-6));
    REQUIRE_THAT ((double) s["gate"], WithinAbs (0.3, 1e-6));
    REQUIRE_THAT ((double) s["slots"]["nam"]["gain"], WithinAbs (0.7, 1e-6));
    REQUIRE ((bool) s["slots"]["nam"]["bypassed"]);
    REQUIRE_THAT ((double) s["slots"]["ir"]["mix"], WithinAbs (0.2, 1e-6));
}

TEST_CASE ("Controller: presets are listed sorted, and the list updates after a save", "[controller][preset]")
{
    Rig r;
    REQUIRE (r.rig.listPresets().isEmpty());
    REQUIRE (r.rig.savePreset ("b clean").isEmpty());
    REQUIRE (r.rig.savePreset ("A lead").isEmpty());
    REQUIRE (r.rig.savePreset ("c crunch").isEmpty());

    const auto list = r.rig.listPresets();
    REQUIRE (list == juce::StringArray { "A lead", "b clean", "c crunch" });

    const auto state = r.state();
    auto* arr = state["presets"].getArray();
    REQUIRE (arr != nullptr);
    REQUIRE (arr->size() == 3);
}

TEST_CASE ("Controller: the active preset is the name the list shows", "[controller][preset]")
{
    Rig r;
    REQUIRE (r.rig.savePreset ("  Gilmour? \"Clean\"  ").isEmpty());
    const auto list = r.rig.listPresets();
    REQUIRE (list.size() == 1);
    REQUIRE (r.rig.getActivePreset() == list[0]);
    REQUIRE (r.state()["activePreset"] == juce::var (list[0]));
}

TEST_CASE ("Controller: saving over an existing preset replaces it", "[controller][preset]")
{
    Rig r;
    r.rig.setMaster (0.2);
    REQUIRE (r.rig.savePreset ("Same").isEmpty());
    r.rig.setMaster (0.9);
    REQUIRE (r.rig.savePreset ("Same").isEmpty());
    REQUIRE (r.rig.listPresets().size() == 1);

    r.rig.setMaster (0.0);
    REQUIRE (r.rig.loadPreset ("Same").isEmpty());
    REQUIRE_THAT (r.rig.getAudio().getMasterGain(), WithinAbs (0.9, 1e-6));
}

TEST_CASE ("Controller: bad preset names are refused and touch nothing on disk (SEC-2)", "[controller][preset][security]")
{
    Rig r;
    for (auto bad : { "", "   ", ".", "..", "../escape", "a/b", "a\\b", "C:evil" })
    {
        CAPTURE (bad);
        REQUIRE (r.rig.savePreset (bad) == badName);
        REQUIRE (r.rig.loadPreset (bad) == badName);
    }
    REQUIRE (r.rig.listPresets().isEmpty());
    REQUIRE_FALSE (r.tmp.file ("escape.tonebench").exists());
}

TEST_CASE ("Controller: loading a preset that doesn't exist reports it and keeps the rig", "[controller][preset]")
{
    Rig r;
    r.loadIR();
    REQUIRE_THAT (r.rig.loadPreset ("Nope").toStdString(), ContainsSubstring ("Couldn't load the preset \"Nope\". The file may be damaged"));
    REQUIRE ((bool) r.slot ("ir")["loaded"]);
    REQUIRE (r.state()["activePreset"].isVoid());
}

TEST_CASE ("Controller: a preset with missing files still loads, and says what's missing", "[controller][preset]")
{
    Rig r;
    r.loadIR();
    r.loadNam();
    REQUIRE (r.rig.savePreset ("Moved").isEmpty());
    r.tmp.file ("cab.wav").deleteFile();

    const auto msg = r.rig.loadPreset ("Moved");
    REQUIRE (msg == "Loaded \"Moved\". The cab IR \"cab.wav\" wasn't found, so that slot is empty.");
    REQUIRE ((bool) r.slot ("nam")["loaded"]);
    REQUIRE_FALSE ((bool) r.slot ("ir")["loaded"]);
    REQUIRE (r.rig.getActivePreset() == "Moved");
}

TEST_CASE ("Controller: a preset's VST3 slot is passed out for consent", "[controller][preset]")
{
    Rig r;
    const auto f = PresetNames::presetFileFor (r.rig.getPresetsDir(), "With Plugin");
    f.replaceWithText (R"({"format": "tonebench-preset", "schemaVersion": 1, "io": {},
        "chain": [{"slot": 0, "type": "vst3", "path": "/x/Amp.vst3", "identifier": "id", "state": ""}]})");

    int asked = 0;
    REQUIRE (r.rig.loadPreset ("With Plugin", [&] (const Preset::VstSlot&) { ++asked; }).isEmpty());
    REQUIRE (asked == 1);
    REQUIRE_FALSE ((bool) r.slot ("vst3")["loaded"]);
}

//== state =====================================================================
TEST_CASE ("Controller: state carries the device details it's given", "[controller][state]")
{
    Rig r;
    RigController::DeviceInfo d;
    d.name = "Scarlett 2i2";
    d.sampleRate = 44100.0;
    d.bufferSize = 64;
    d.roundTripMs = 5.5;

    const auto s = r.rig.buildState (d, 0.25f, 0.5f);
    REQUIRE (s["device"] == juce::var ("Scarlett 2i2"));
    REQUIRE ((double) s["sampleRate"] == 44100.0);
    REQUIRE ((int) s["bufferSize"] == 64);
    REQUIRE ((double) s["roundTripMs"] == 5.5);
    REQUIRE ((double) s["inputLevel"] == 0.25);
    REQUIRE ((double) s["outputLevel"] == 0.5);
}

TEST_CASE ("Controller: with no device the state says so", "[controller][state]")
{
    Rig r;
    const auto s = r.state();
    REQUIRE (s["device"] == juce::var ("No device"));
    REQUIRE ((double) s["sampleRate"] == 0.0);
}

TEST_CASE ("Controller: every slot is always present, keyed by its id", "[controller][state]")
{
    Rig r;
    for (auto& d : SlotTypes::table())
    {
        CAPTURE (d.id);
        const auto sl = r.slot (d.id);
        REQUIRE (sl.isObject());
        REQUIRE (sl["type"] == juce::var (d.id));
        REQUIRE_FALSE ((bool) sl["loaded"]);
        REQUIRE (sl["name"] == juce::var (juce::String()));
    }
}

TEST_CASE ("Controller: renaming a preset moves it, keeps it active, and updates its stored name", "[controller][preset]")
{
    Rig r;
    r.rig.setMaster (0.3);
    REQUIRE (r.rig.savePreset ("Old").isEmpty());
    REQUIRE (r.rig.savePreset ("Other").isEmpty());
    REQUIRE (r.rig.loadPreset ("Old").isEmpty());

    REQUIRE (r.rig.renamePreset ("Old", "New").isEmpty());
    REQUIRE (r.rig.listPresets() == juce::StringArray { "New", "Other" });
    REQUIRE (r.rig.getActivePreset() == "New");
    const auto json = juce::JSON::parse (PresetNames::presetFileFor (r.rig.getPresetsDir(), "New"));
    REQUIRE (json["name"] == juce::var ("New"));

    r.rig.setMaster (1.0);
    REQUIRE (r.rig.loadPreset ("New").isEmpty());
    REQUIRE_THAT (r.rig.getAudio().getMasterGain(), WithinAbs (0.3, 1e-6));   // same contents

    REQUIRE (r.rig.renamePreset ("New", "NEW").isEmpty());   // just the case
    REQUIRE (r.rig.listPresets().contains ("NEW"));
}

TEST_CASE ("Controller: renaming refuses to clobber another preset or use a bad name", "[controller][preset]")
{
    Rig r;
    REQUIRE (r.rig.savePreset ("A").isEmpty());
    REQUIRE (r.rig.savePreset ("B").isEmpty());
    REQUIRE (r.rig.renamePreset ("A", "b") == "There's already a preset called \"B\". Pick another name.");
    REQUIRE (r.rig.renamePreset ("A", "../x") == badName);
    REQUIRE (r.rig.renamePreset ("Missing", "C") == "There's no preset called \"Missing\" any more. It may have been renamed or deleted outside Tonebench.");
    REQUIRE (r.rig.listPresets() == juce::StringArray { "A", "B" });
}

TEST_CASE ("Controller: deleting a preset removes the file but leaves the rig playing", "[controller][preset]")
{
    Rig r;
    r.loadIR();
    REQUIRE (r.rig.savePreset ("Gone").isEmpty());
    REQUIRE (r.rig.getActivePreset() == "Gone");

    REQUIRE (r.rig.deletePreset ("Gone").isEmpty());
    REQUIRE (r.rig.listPresets().isEmpty());
    REQUIRE (r.state()["activePreset"].isVoid());
    REQUIRE ((bool) r.slot ("ir")["loaded"]);

    REQUIRE (r.rig.deletePreset ("Gone") == "There's no preset called \"Gone\" any more. It may have been renamed or deleted outside Tonebench.");
    REQUIRE (r.rig.deletePreset ("..") == badName);
}

TEST_CASE ("Controller: the state says when a preset's plugin is still on its way", "[controller][state]")
{
    Rig r;
    REQUIRE_FALSE ((bool) r.state()["loadingPreset"]);
    r.rig.setPresetPluginPending (true);
    REQUIRE ((bool) r.state()["loadingPreset"]);
    r.rig.setPresetPluginPending (false);
    REQUIRE_FALSE ((bool) r.state()["loadingPreset"]);
}
