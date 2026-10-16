#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "app/PluginScanner.h"
#include "app/RigController.h"
#include "engine/Vst3Node.h"
#include <optional>
#include <vector>

struct WebUIOptions
{
    bool openAudioDevice = true;            // false for --smoke (no device, no mic prompt)
    std::function<void()> onUiReady;        // first time the page reaches the engine
};

//==============================================================================
// Hosts the React UI in a WebView and bridges it to the rig.
//  - JS -> C++ : native functions (loadSlot, setMix, savePreset, ...), most of
//                which forward straight to RigController.
//  - C++ -> JS : "state" (full rig), "meters", "scope" and "error" events.
// This class keeps only what needs the GUI: the WebView, file choosers, the
// plugin editor window, consent prompts, and the audio device.
class WebUIComponent : public juce::AudioAppComponent,
                       private juce::Timer,
                       private juce::ChangeListener
{
public:
    using Options = WebUIOptions;
    explicit WebUIComponent (Options options = {});
    ~WebUIComponent() override;

    void prepareToPlay (int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock (const juce::AudioSourceChannelInfo&) override;
    void releaseResources() override;
    void resized() override;

    void openAudioSettings();   // from the native menu bar: opens the React Settings screen

private:
    void timerCallback() override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override; // device changes -> persist
    juce::File audioSettingsFile() const;

    // Commands that need the GUI
    void loadSlotChooser (const juce::String& type);
    void doLoadVst (const juce::File&);
    void loadFile (int slot, const juce::File&);
    void openVstEditorWindow();
    void openExternalUrl (const juce::String& url);
    void loadPreset (const juce::String& name);
    void startVstFromPreset (const Preset::VstSlot&);
    void finishVstLoad (Vst3Node* node, int generation, bool ok, const juce::String& error,
                        const juce::String& state, bool enabled);

    // State push
    juce::var buildStateVar() const;
    RigController::DeviceInfo currentDeviceInfo() const;
    void markDirty() { stateDirty = true; }
    void reportError (const juce::String& message);   // C++ -> JS "error" event (no-op if empty)

    // Resource provider (serves the embedded React build)
    std::optional<juce::WebBrowserComponent::Resource> provideResource (const juce::String& path);

    RigController rig;
    float smoothedIn = 0.0f, smoothedOut = 0.0f;
    std::vector<float> scopeScratch;

    std::unique_ptr<Vst3Node> pendingVst;
    juce::Array<PluginScanner::Plugin> scannedPlugins;   // the latest listPlugins answer
    // Bumped by every plugin load and preset load. A plugin that finishes loading
    // (or a preset's consent prompt answered) after something newer started is
    // dropped instead of landing in the wrong rig (audit M2).
    int vstGeneration = 0;
    bool listeningToAllInputs = false;   // first-run setup's "play a few notes" step
    std::unique_ptr<juce::DocumentWindow> editorWindow;
    std::unique_ptr<juce::FileChooser> fileChooser;

    std::unique_ptr<juce::WebBrowserComponent> web;
    bool stateDirty = true;
    std::function<void()> onUiReady;

   #if JUCE_DEBUG
    void devAutoLoad();   // DEBUG-ONLY: loads an app-private sentinel file if present (SEC-1)
    bool didAutoLoad = false;
    int  ticks = 0;
   #endif

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebUIComponent)
};
