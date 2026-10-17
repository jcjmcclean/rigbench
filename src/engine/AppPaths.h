#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Where Tonebench keeps its own files (presets, settings, WebView data).
//
//   macOS:   ~/Library/Application Support/Tonebench
//   Windows: %APPDATA%\Tonebench
//   Linux:   ~/.config/Tonebench
//
// JUCE's userApplicationDataDirectory is ~/Library on macOS, so older builds
// wrote to ~/Library/Tonebench. The first call moves that folder across.
namespace AppPaths
{
    inline juce::File dataDir()
    {
        static const juce::File dir = []
        {
            const auto base = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
           #if JUCE_MAC
            const auto d = base.getChildFile ("Application Support").getChildFile ("Tonebench");
            const auto legacy = base.getChildFile ("Tonebench");
            if (legacy.isDirectory() && ! d.exists())
                legacy.moveFileTo (d);
           #else
            const auto d = base.getChildFile ("Tonebench");
           #endif
            d.createDirectory();
            return d;
        }();
        return dir;
    }
}
