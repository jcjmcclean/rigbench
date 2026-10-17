#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Where Rigbench keeps its own files (presets, settings, WebView data).
//
//   macOS:   ~/Library/Application Support/Rigbench
//   Windows: %APPDATA%\Rigbench
//   Linux:   ~/.config/Rigbench
//
// The app used to be called Tonebench, and older Mac builds wrote to ~/Library
// rather than ~/Library/Application Support. The first call moves the newest of
// those old folders across, so presets and settings carry over.
namespace AppPaths
{
    inline juce::File dataDir()
    {
        static const juce::File dir = []
        {
            const auto base = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
           #if JUCE_MAC
            const auto home = base.getChildFile ("Application Support");
            const juce::File legacy[] { home.getChildFile ("Tonebench"), base.getChildFile ("Tonebench") };
           #else
            const auto home = base;
            const juce::File legacy[] { base.getChildFile ("Tonebench") };
           #endif
            const auto d = home.getChildFile ("Rigbench");

            if (! d.exists())
                for (const auto& old : legacy)
                    if (old.isDirectory() && old.moveFileTo (d))
                        break;

            d.createDirectory();
            return d;
        }();
        return dir;
    }
}
