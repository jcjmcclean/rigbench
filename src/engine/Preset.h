#pragma once

#include "AudioEngine.h"
#include <functional>

//==============================================================================
// Save / load the whole rig (chain + master) to a versioned JSON preset.
//
// IR and NAM slots are rebuilt synchronously on load. VST3 is asynchronous, so
// load() hands each VST3 slot to the caller-supplied `installVst` callback (the
// UI does the async load + state restore; headless callers can ignore it).
namespace Preset
{
    // Rig-level settings that live outside the chain. Written by save(), filled
    // in by load(). Fields missing from an older preset keep these defaults.
    struct RigInfo
    {
        float  inputGain  = 0.8f;
        float  masterGain = 0.8f;
        float  gate = 0.0f;          // input noise gate, 0 = off
        double sampleRateAtSave = 48000.0;
        juce::String name;

        // load(): why any slot in the preset couldn't be restored, in words for
        // the user ("The cab IR \"x.wav\" wasn't found."). Empty if all went well.
        juce::StringArray problems;
    };

    // Describes a VST3 slot found in a preset, to be installed asynchronously.
    struct VstSlot
    {
        int slot = AudioEngine::vst3Slot;
        bool enabled = true;
        juce::File   path;
        juce::String identifier;
        juce::String stateBase64;
    };

    static constexpr const char* fileExtension = ".rigbench";
    static constexpr const char* oldFileExtension = ".tonebench";   // before the rename

    // Gives any presets in `dir` saved before the rename the new extension.
    void migrateOldPresets (const juce::File& dir);

    juce::File presetsDir();

    // Serialize the engine's current chain + the rig-level settings in `info`
    // (an empty info.name falls back to the file name).
    bool save (const juce::File& file, const AudioEngine& engine, const RigInfo& info);

    // Rebuild IR + NAM slots into the engine; report the gains etc. in `info`.
    // For each VST3 slot, `installVst` is invoked (if provided).
    bool load (const juce::File& file, AudioEngine& engine, double sampleRate, int maxBlock,
               RigInfo& info, std::function<void (const VstSlot&)> installVst = {});
}
