#pragma once

#include "AppSettings.h"
#include "AudioPath.h"
#include "engine/AppPaths.h"
#include "engine/AudioEngine.h"
#include "engine/Preset.h"
#include <functional>
#include <memory>

class Vst3Node;

//==============================================================================
// Everything the UI can do to the rig, minus the GUI: the bridge operations,
// preset save/load, and the state snapshot sent to the UI. WebUIComponent wires
// the WebView's native functions to these methods; tests drive them directly.
//
// Message thread only (except via AudioPath, which the audio callback uses).
// Slot ids are the bridge/preset strings from SlotTypes ("vst3", "nam", "ir").
class RigController
{
public:
    // Until first-run setup is finished, monitoring starts off.
    explicit RigController (juce::File presetsDirectory = Preset::presetsDir(),
                            juce::File settingsFile = AppPaths::dataDir().getChildFile ("settings.json"));
    ~RigController();

    AudioEngine& getEngine() noexcept { return engine; }
    AudioPath&   getAudio() noexcept  { return audio; }

    //== bridge operations =====================================================
    // Values arrive as untrusted JS values: gains are clamped to 0..1 and
    // non-finite numbers become 0. Unknown slot ids are ignored.
    void clearSlot (const juce::String& slotId);
    void setBypass (const juce::String& slotId, bool bypassed);
    void setMix    (const juce::String& slotId, const juce::var& value);   // IR wet/dry
    void setGain   (const juce::String& slotId, const juce::var& value);   // NAM level
    void setInput  (const juce::var& value);
    void setMaster (const juce::var& value);
    void setMonitor (bool on);

    //== first-run setup =======================================================
    bool isSetupComplete() const noexcept { return settings.isSetupComplete(); }
    void finishSetup();          // remembers it, and turns monitoring on
    void playTestSound()         { audio.playTestSound(); }

    //== tuner =================================================================
    void setTuner (bool on)      { audio.getTuner().setActive (on); }
    // { note, octave, cents, hz } while the tuner hears a clear pitch, else void.
    juce::var readTuner();

    //== loading content (synchronous for NAM/IR) ==============================
    // Each returns an empty string on success, or a message for the user.
    juce::String loadNam (const juce::File& file);
    juce::String loadIR  (const juce::File& file);
    void installVst (std::unique_ptr<Vst3Node> node);   // an already-loaded plugin

    //== presets ===============================================================
    juce::File getPresetsDir() const { return presetsDir; }
    juce::StringArray listPresets() const;
    const juce::String& getActivePreset() const noexcept { return activePreset; }

    juce::String savePreset (const juce::String& name);   // "" on success
    // VST3 slots are handed to `installVst` (the GUI asks for consent first).
    juce::String loadPreset (const juce::String& name,
                             std::function<void (const Preset::VstSlot&)> installVstSlot = {});

    //== state for the UI ======================================================
    struct DeviceInfo
    {
        juce::String name { "No device" };
        double sampleRate  = 0.0;
        int    bufferSize  = 0;
        double roundTripMs = 0.0;
    };

    // The full rig as the UI's EngineState (ui/src/types.ts).
    juce::var buildState (const DeviceInfo& device, float inputLevel, float outputLevel) const;

    // 0..1 from an untrusted JS value; NaN/Inf -> 0.
    static float clampUnit (const juce::var& v);

private:
    AudioEngine engine;
    AudioPath   audio { engine };
    juce::File  presetsDir;
    AppSettings settings;
    juce::String activePreset;

    juce::var slotState (int index, const char* id) const;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (RigController)
};
