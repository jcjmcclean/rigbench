#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Links the UI may open in the system browser (e.g. where to download models).
// Only well-formed https:// URLs with a host: no other schemes (file:, javascript:,
// custom app handlers), and nothing that could smuggle in extra arguments.
namespace ExternalLinks
{
    inline bool isOpenable (const juce::String& url)
    {
        if (! url.startsWithIgnoreCase ("https://") || url.length() > 2048
            || url.containsAnyOf (" \n\r\t\"'<>\\`")
            || url.substring (8).startsWithChar ('/'))   // "https:///x" has no host
            return false;

        const juce::URL u (url);
        return u.isWellFormed() && u.getDomain().isNotEmpty() && ! u.getDomain().startsWith (".");
    }
}
