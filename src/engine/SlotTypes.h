#pragma once

#include "AudioEngine.h"
#include <juce_core/juce_core.h>
#include <array>

//==============================================================================
// Single source of truth for the engine's slot types. Each descriptor ties
// together the slot index, the id string used across BOTH the JS bridge and the
// preset JSON ("vst3"/"nam"/"ir"), and the file-chooser presentation (title,
// wildcard filter, whether the picker selects a directory — VST3 bundles are
// directories). Consumed by WebUIComponent (slotIndex / loadSlotChooser) and
// Preset.cpp (type-string handling) so the mapping can never drift between them.
namespace SlotTypes
{
    struct Desc
    {
        int         index;       // AudioEngine::Slot
        const char* id;          // bridge + preset type string
        const char* title;       // file-chooser title
        const char* filter;      // file-chooser wildcard
        bool        selectDirs;  // VST3 bundles are directories
    };

    inline const std::array<Desc, (size_t) AudioEngine::numSlots>& table()
    {
        static const std::array<Desc, (size_t) AudioEngine::numSlots> t { {
            { AudioEngine::vst3Slot, "vst3", "Load a VST3 plugin",      "*.vst3",                     true  },
            { AudioEngine::namSlot,  "nam",  "Load an amp model",        "*.nam",                      false },
            { AudioEngine::irSlot,   "ir",   "Load a cab IR", "*.wav;*.aiff;*.aif;*.flac", false },
        } };
        return t;
    }

    inline const Desc* byId (const juce::String& id)
    {
        for (auto& d : table())
            if (id == d.id)
                return &d;
        return nullptr;
    }

    inline int indexForId (const juce::String& id)
    {
        const auto* d = byId (id);
        return d != nullptr ? d->index : -1;
    }

    // The standard per-platform VST3 folders, system-wide first. See
    // https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Locations+Format/Plugin+Locations.html
    inline juce::Array<juce::File> vst3Folders()
    {
        const auto home = juce::File::getSpecialLocation (juce::File::userHomeDirectory);
       #if JUCE_MAC
        return { juce::File ("/Library/Audio/Plug-Ins/VST3"),
                 home.getChildFile ("Library/Audio/Plug-Ins/VST3") };
       #elif JUCE_WINDOWS
        return { juce::File::getSpecialLocation (juce::File::globalApplicationsDirectory)
                     .getChildFile ("Common Files").getChildFile ("VST3"),
                 juce::File::getSpecialLocation (juce::File::windowsLocalAppData)
                     .getChildFile ("Programs").getChildFile ("Common").getChildFile ("VST3") };
       #else
        return { home.getChildFile (".vst3"),
                 juce::File ("/usr/lib/vst3"),
                 juce::File ("/usr/local/lib/vst3") };
       #endif
    }

    // Chooser start directory — computed (depends on user dirs), not a literal.
    // For VST3, the first standard folder that exists on this machine.
    inline juce::File startDirFor (const juce::String& id)
    {
        if (id == "vst3")
        {
            for (auto& dir : vst3Folders())
                if (dir.isDirectory())
                    return dir;
            return {};
        }
        if (id == "nam")  return juce::File::getSpecialLocation (juce::File::userDocumentsDirectory);
        return juce::File();
    }
}
