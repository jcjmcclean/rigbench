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
            { AudioEngine::namSlot,  "nam",  "Load a NAM model",        "*.nam",                      false },
            { AudioEngine::irSlot,   "ir",   "Load an impulse response", "*.wav;*.aiff;*.aif;*.flac", false },
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

    // Chooser start directory — computed (depends on user dirs), not a literal.
    inline juce::File startDirFor (const juce::String& id)
    {
        if (id == "vst3") return juce::File ("/Library/Audio/Plug-Ins/VST3");
        if (id == "nam")  return juce::File::getSpecialLocation (juce::File::userDocumentsDirectory);
        return juce::File();
    }
}
