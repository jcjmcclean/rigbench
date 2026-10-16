#include "PresetNames.h"
#include "engine/Preset.h"

namespace PresetNames
{

juce::File presetFileFor (const juce::File& dir, const juce::String& name)
{
    if (name.trim().isEmpty() || name == "." || name == ".."
        || name.containsAnyOf ("/\\:"))
        return {};

    const auto leaf = juce::File::createLegalFileName (name);
    if (leaf.isEmpty() || leaf == "." || leaf == "..")
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
