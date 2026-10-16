#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Finds the VST3 plugins installed in the standard folders (SlotTypes::vst3Folders),
// without loading any of them: a .vst3 is either a bundle folder (macOS, Linux,
// modern Windows) or a single file (older Windows plugins). Vendor subfolders
// are searched; bundles aren't looked inside.
namespace PluginScanner
{
    struct Plugin
    {
        juce::String name;   // file name without ".vst3"
        juce::File   file;
    };

    juce::Array<Plugin> scan (const juce::Array<juce::File>& folders, int maxDepth = 4);
}
