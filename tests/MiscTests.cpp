#include "TestHelpers.h"
#include "app/PresetNames.h"
#include "app/RigController.h"
#include "engine/Preset.h"
#include "engine/SlotTypes.h"
#include <catch2/catch_test_macros.hpp>
#include <set>

using namespace testing;

//== PresetNames ===============================================================
TEST_CASE ("PresetNames: ordinary names map into the presets folder", "[presetnames]")
{
    TempDir tmp;
    const auto f = PresetNames::presetFileFor (tmp.dir, "Hiwatt Lead");
    REQUIRE (f.getParentDirectory() == tmp.dir);
    REQUIRE (f.getFileName() == "Hiwatt Lead.tonebench");

    // Characters that are legal in a name but not in a file name are made safe.
    const auto odd = PresetNames::presetFileFor (tmp.dir, "Gilmour? \"Clean\"*");
    REQUIRE (odd != juce::File());
    REQUIRE (odd.getParentDirectory() == tmp.dir);
}

TEST_CASE ("PresetNames: traversal and empty names are rejected (SEC-2)", "[presetnames][security]")
{
    TempDir tmp;
    for (auto bad : { "", " ", ".", "..", "../x", "..\\x", "x/y", "/abs", "C:\\x", "a:b" })
    {
        CAPTURE (bad);
        REQUIRE (PresetNames::presetFileFor (tmp.dir, bad) == juce::File());
    }
}

TEST_CASE ("PresetNames: list ignores other files and folders", "[presetnames]")
{
    TempDir tmp;
    tmp.file ("Zed.tonebench").replaceWithText ("{}");
    tmp.file ("alpha.tonebench").replaceWithText ("{}");
    tmp.file ("notes.txt").replaceWithText ("x");
    tmp.file ("Folder.tonebench").createDirectory();

    REQUIRE (PresetNames::list (tmp.dir) == juce::StringArray { "alpha", "Zed" });
}

//== SlotTypes =================================================================
TEST_CASE ("SlotTypes: one entry per engine slot, ids unique and in chain order", "[slottypes]")
{
    const auto& t = SlotTypes::table();
    REQUIRE ((int) t.size() == AudioEngine::numSlots);

    std::set<std::string> ids;
    for (int i = 0; i < (int) t.size(); ++i)
    {
        REQUIRE (t[(size_t) i].index == i);
        ids.insert (t[(size_t) i].id);
    }
    REQUIRE (ids.size() == t.size());

    REQUIRE (SlotTypes::indexForId ("vst3") == AudioEngine::vst3Slot);
    REQUIRE (SlotTypes::indexForId ("nam") == AudioEngine::namSlot);
    REQUIRE (SlotTypes::indexForId ("ir") == AudioEngine::irSlot);
    REQUIRE (SlotTypes::indexForId ("VST3") == -1);   // ids are exact
    REQUIRE (SlotTypes::indexForId ("") == -1);
    REQUIRE (SlotTypes::byId ("cab") == nullptr);
}

TEST_CASE ("SlotTypes: file pickers ask for the right kind of file", "[slottypes]")
{
    REQUIRE (SlotTypes::byId ("vst3")->selectDirs);   // a .vst3 can be a bundle folder
    REQUIRE (juce::String (SlotTypes::byId ("nam")->filter) == "*.nam");
    REQUIRE (juce::String (SlotTypes::byId ("ir")->filter).contains ("*.wav"));
}

TEST_CASE ("SlotTypes: the VST3 folders are this platform's standard ones", "[slottypes]")
{
    const auto folders = SlotTypes::vst3Folders();
    REQUIRE_FALSE (folders.isEmpty());
    for (auto& f : folders)
        REQUIRE (f.getFileName().equalsIgnoreCase ("vst3"));

   #if JUCE_MAC
    REQUIRE (folders[0].getFullPathName() == "/Library/Audio/Plug-Ins/VST3");
   #elif JUCE_LINUX
    REQUIRE (folders[0].getFullPathName().endsWith ("/.vst3"));
   #endif

    // The start dir is one of those, or nothing if none exist here.
    const auto start = SlotTypes::startDirFor ("vst3");
    REQUIRE ((start == juce::File() || folders.contains (start)));
}

//== The JS <-> C++ bridge contract ===========================================
namespace
{
juce::var contract()
{
    return juce::JSON::parse (juce::File (TONEBENCH_SOURCE_DIR).getChildFile ("tests/contract/bridge.json"));
}

juce::StringArray strings (const juce::var& arr)
{
    juce::StringArray out;
    if (auto* a = arr.getArray())
        for (auto& v : *a)
            out.add (v.toString());
    return out;
}

juce::StringArray keys (const juce::var& obj)
{
    juce::StringArray out;
    if (auto* o = obj.getDynamicObject())
        for (auto& p : o->getProperties())
            out.add (p.name.toString());
    out.sort (false);
    return out;
}

juce::StringArray sorted (juce::StringArray a) { a.sort (false); return a; }
} // namespace

TEST_CASE ("Contract: the C++ side registers exactly the contract's native functions", "[contract]")
{
    // WebUIComponent needs a WebView, so read its registrations from the source.
    const auto src = juce::File (TONEBENCH_SOURCE_DIR).getChildFile ("src/ui/WebUIComponent.cpp").loadFileAsString();
    juce::StringArray registered;
    for (int pos = src.indexOf (".withNativeFunction (\""); pos >= 0; pos = src.indexOf (pos + 1, ".withNativeFunction (\""))
    {
        const int start = pos + juce::String (".withNativeFunction (\"").length();
        registered.add (src.substring (start, src.indexOf (start, "\"")));
    }
    REQUIRE (sorted (registered) == sorted (strings (contract()["nativeFunctions"])));
}

TEST_CASE ("Contract: the state the C++ side sends has exactly the contract's keys", "[contract]")
{
    TempDir tmp;
    RigController rig (tmp.file ("Presets"));
    rig.getAudio().prepare (256, 48000.0);
    REQUIRE (rig.loadIR (writeSyntheticIR (tmp)).isEmpty());
    REQUIRE (rig.loadNam (namFixture()).isEmpty());

    const auto c = contract();
    const auto state = rig.buildState ({}, 0.0f, 0.0f);
    REQUIRE (keys (state) == sorted (strings (c["stateKeys"])));
    REQUIRE (keys (state["slots"]) == sorted (strings (c["slotIds"])));

    for (auto id : strings (c["slotIds"]))
    {
        CAPTURE (id);
        // Common keys plus the slot's own (VST3 always has hasEditor; NAM and IR
        // have gain/mix once loaded, which they are here).
        auto expected = strings (c["slotKeys"]["common"]);
        expected.addArray (strings (c["slotKeys"][juce::Identifier (id)]));
        REQUIRE (keys (state["slots"][juce::Identifier (id)]) == sorted (expected));
    }
}

TEST_CASE ("Contract: the C++ side emits exactly the contract's events", "[contract]")
{
    const auto src = juce::File (TONEBENCH_SOURCE_DIR).getChildFile ("src/ui/WebUIComponent.cpp").loadFileAsString();
    juce::StringArray emitted;
    for (int pos = src.indexOf ("emitEventIfBrowserIsVisible (\""); pos >= 0; pos = src.indexOf (pos + 1, "emitEventIfBrowserIsVisible (\""))
    {
        const int start = pos + juce::String ("emitEventIfBrowserIsVisible (\"").length();
        emitted.addIfNotAlreadyThere (src.substring (start, src.indexOf (start, "\"")));
    }
    REQUIRE (sorted (emitted) == sorted (strings (contract()["events"])));
}

//== External links ============================================================
#include "app/ExternalLinks.h"

TEST_CASE ("ExternalLinks: only plain https links open in the browser", "[links][security]")
{
    REQUIRE (ExternalLinks::isOpenable ("https://www.tone3000.com/search?format=nam"));
    REQUIRE (ExternalLinks::isOpenable ("https://github.com/jcjmcclean/tonebench/issues"));

    for (auto bad : { "", "http://example.com", "file:///etc/passwd", "javascript:alert(1)",
                      "https://", "https:///nohost", "ftp://x.com", "tonebench://open",
                      "https://example.com/a b", "https://example.com/\"onload", "HTTPS:/x.com",
                      "https://example.com/\nSet-Cookie" })
    {
        CAPTURE (bad);
        REQUIRE_FALSE (ExternalLinks::isOpenable (bad));
    }
}
