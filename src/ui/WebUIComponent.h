#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "engine/AudioEngine.h"
#include "engine/Vst3Node.h"
#include <optional>

//==============================================================================
// Hosts the React UI in a WebView and bridges it to the audio engine.
//  - JS -> C++ : native functions (loadSlot, setMix, savePreset, ...)
//  - C++ -> JS : "state" (full rig) and "meters" (levels) events on a timer.
class WebUIComponent : public juce::AudioAppComponent,
                       private juce::Timer,
                       private juce::ChangeListener
{
public:
    WebUIComponent();
    ~WebUIComponent() override;

    void prepareToPlay (int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock (const juce::AudioSourceChannelInfo&) override;
    void releaseResources() override;
    void resized() override;

    void openAudioSettings();   // also invoked from the native menu bar

private:
    void timerCallback() override;
    void changeListenerCallback (juce::ChangeBroadcaster*) override; // device changes -> persist
    juce::File audioSettingsFile() const;

    // Commands
    void loadSlotChooser (const juce::String& type);
    void doLoadVst (const juce::File&);
    void doLoadNam (const juce::File&);
    void doLoadIR  (const juce::File&);
    void openVstEditorWindow();
    void savePreset (const juce::String& name);
    void loadPreset (const juce::String& name);

    // State push
    juce::var buildStateVar();
    void markDirty() { stateDirty = true; }

    // Resource provider (serves the embedded React build)
    std::optional<juce::WebBrowserComponent::Resource> provideResource (const juce::String& path);

    AudioEngine engine;
    juce::AudioBuffer<float> monoBuffer;

    std::atomic<bool>  monitorOn { true };
    std::atomic<float> inputGain { 0.8f };
    std::atomic<float> masterGain { 0.8f };
    std::atomic<float> inPeak { 0.0f };
    std::atomic<float> outPeak { 0.0f };
    float smoothedIn = 0.0f, smoothedOut = 0.0f;

    juce::String activePreset;
    std::unique_ptr<Vst3Node> pendingVst;
    std::unique_ptr<juce::DocumentWindow> editorWindow;
    std::unique_ptr<juce::FileChooser> fileChooser;

    std::unique_ptr<juce::WebBrowserComponent> web;
    bool stateDirty = true;

    void devAutoLoad();   // loads /tmp/tonestack_autoload.txt if present (dev only)
    bool didAutoLoad = false;
    int  ticks = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebUIComponent)
};
