#include "PresetNames.h"
#include "engine/Preset.h"

namespace PresetNames
{

bool isReservedName (const juce::String& leaf)
{
    // Windows won't create these (in any case, with or without an extension).
    static const juce::StringArray reserved { "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };
    return reserved.contains (leaf.upToFirstOccurrenceOf (".", false, false).trim(), true);
}

juce::File presetFileFor (const juce::File& dir, const juce::String& name)
{
    if (name.trim().isEmpty() || name == "." || name == ".."
        || name.containsAnyOf ("/\\:"))
        return {};

    const auto leaf = juce::File::createLegalFileName (name.trim());
    if (leaf.isEmpty() || leaf == "." || leaf == ".." || isReservedName (leaf))
        return {};

    const auto file = dir.getChildFile (leaf + Preset::fileExtension);
    if (! file.isAChildOf (dir))
        return {};
    return file;
}

juce::StringArray list (const juce::File& dir)
{
    juce::StringArray names;
    for (auto& f : dir.findChildFiles (juce::File::findFiles, false,
                                       juce::String ("*") + Preset::fileExtension))
        names.add (f.getFileNameWithoutExtension());
    names.sortNatural();
    return names;
}

} // namespace PresetNames
