#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Messages for users are written in the source with plain ASCII ' and "
// (a JUCE String from a char literal must be ASCII). Before one is shown it goes
// through typeset(), so it matches the UI's typography: curly apostrophes and
// quotes, and a real ellipsis.
namespace UserText
{
    inline juce::String typeset (const juce::String& s)
    {
        constexpr juce::juce_wchar lsquo = 0x2018, rsquo = 0x2019, ldquo = 0x201C, rdquo = 0x201D, ellipsis = 0x2026;

        juce::String out;
        out.preallocateBytes ((size_t) s.getNumBytesAsUTF8() + 16);
        bool inDouble = false;
        for (int i = 0; i < s.length(); ++i)
        {
            const auto c = s[i];
            const auto prev = i > 0 ? s[i - 1] : ' ';
            if (c == '"')
            {
                out << juce::String::charToString (inDouble ? rdquo : ldquo);
                inDouble = ! inDouble;
            }
            else if (c == '\'')
            {
                // An apostrophe or closing quote unless it opens a word.
                const bool opens = i == 0 || prev == ' ' || prev == '\n' || prev == '(';
                out << juce::String::charToString (opens ? lsquo : rsquo);
            }
            else if (c == '.' && s.substring (i, i + 3) == "...")
            {
                out << juce::String::charToString (ellipsis);
                i += 2;
            }
            else
            {
                out << juce::String::charToString (c);
            }
        }
        return out;
    }
}
