#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// SEC-2: preset names arrive straight from the JS bridge, and File::getChildFile
// resolves ".." segments, so an unsanitized name is a path-traversal read/write
// primitive. presetFileFor() legalizes the name, rejects separators / empty / dot
// names, and confirms the result stays inside `dir` before any disk access.
namespace PresetNames
{
    // The preset file for `name` inside `dir`, or an invalid File() if rejected.
    juce::File presetFileFor (const juce::File& dir, const juce::String& name);

    // Device names Windows reserves (CON, NUL, COM1...), which can't be file names.
    bool isReservedName (const juce::String& leaf);

    // Preset names (file names without extension) in `dir`, sorted case-insensitively.
    juce::StringArray list (const juce::File& dir);
}
