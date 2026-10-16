#include "TestHelpers.h"
#include "app/PluginScanner.h"
#include <catch2/catch_test_macros.hpp>

using namespace testing;

namespace
{
juce::File bundle (const juce::File& dir, const juce::String& name)
{
    auto b = dir.getChildFile (name + ".vst3");
    b.getChildFile ("Contents").getChildFile ("MacOS").createDirectory();
    b.getChildFile ("Contents").getChildFile ("MacOS").getChildFile (name).replaceWithText ("x");
    return b;
}

juce::StringArray names (const juce::Array<PluginScanner::Plugin>& ps)
{
    juce::StringArray out;
    for (auto& p : ps) out.add (p.name);
    return out;
}
} // namespace

TEST_CASE ("PluginScanner: finds bundles and single-file plugins, in vendor folders too", "[plugins]")
{
    TempDir tmp;
    const auto system = tmp.file ("System"), user = tmp.file ("User");
    bundle (system, "Zeta Amp");
    bundle (system.getChildFile ("ChowDSP"), "BYOD");
    system.getChildFile ("Old Plugin.vst3").replaceWithText ("dll");   // Windows single file
    system.getChildFile ("readme.txt").replaceWithText ("not a plugin");
    bundle (user, "alpha Reverb");

    const auto found = PluginScanner::scan ({ system, user });
    REQUIRE (names (found) == juce::StringArray { "alpha Reverb", "BYOD", "Old Plugin", "Zeta Amp" });
    for (auto& p : found)
        REQUIRE (p.file.getFileExtension() == ".vst3");
}

TEST_CASE ("PluginScanner: doesn't look inside bundles or list a plugin twice", "[plugins]")
{
    TempDir tmp;
    const auto system = tmp.file ("System"), user = tmp.file ("User");
    auto outer = bundle (system, "Suite");
    bundle (outer.getChildFile ("Contents").getChildFile ("Resources"), "Hidden Inner");   // nested
    bundle (system, "Shared");
    bundle (user, "shared");   // same plugin, per-user copy

    const auto found = PluginScanner::scan ({ system, user });
    REQUIRE (names (found) == juce::StringArray { "Shared", "Suite" });
    REQUIRE (found[0].file.isAChildOf (system));   // the system-wide one wins
}

TEST_CASE ("PluginScanner: missing folders and deep trees are fine", "[plugins]")
{
    TempDir tmp;
    REQUIRE (PluginScanner::scan ({ tmp.file ("nope") }).isEmpty());

    auto deep = tmp.file ("a/b/c/d/e/f");
    bundle (deep, "Too Deep");
    bundle (tmp.file ("a/b"), "Shallow");
    REQUIRE (names (PluginScanner::scan ({ tmp.dir }, 4)) == juce::StringArray { "Shallow" });
}
