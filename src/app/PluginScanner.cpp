#include "PluginScanner.h"

namespace PluginScanner
{

namespace
{
void scanFolder (const juce::File& dir, int depth, juce::Array<Plugin>& out)
{
    if (depth < 0 || ! dir.isDirectory())
        return;

    for (const auto& entry : juce::RangedDirectoryIterator (dir, false, "*", juce::File::findFilesAndDirectories))
    {
        const auto f = entry.getFile();
        if (f.getFileExtension().equalsIgnoreCase (".vst3"))
            out.add ({ f.getFileNameWithoutExtension(), f });
        else if (entry.isDirectory() && ! entry.isHidden())
            scanFolder (f, depth - 1, out);
    }
}
} // namespace

juce::Array<Plugin> scan (const juce::Array<juce::File>& folders, int maxDepth)
{
    juce::Array<Plugin> found;
    for (const auto& folder : folders)
        scanFolder (folder, maxDepth, found);

    // The same plugin can be installed per-user and system-wide: list it once,
    // keeping the first (system-wide folders come first).
    juce::Array<Plugin> unique;
    for (const auto& p : found)
    {
        bool seen = false;
        for (const auto& u : unique)
            seen = seen || u.name.equalsIgnoreCase (p.name);
        if (! seen)
            unique.add (p);
    }

    std::sort (unique.begin(), unique.end(), [] (const Plugin& a, const Plugin& b)
               { return a.name.compareNatural (b.name) < 0; });
    return unique;
}

} // namespace PluginScanner
