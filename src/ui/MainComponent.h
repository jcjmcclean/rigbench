#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include "engine/AudioEngine.h"
#include "engine/Vst3Node.h"
#include "ui/SlotStrip.h"

//==============================================================================
// Native scaffold UI for driving the engine during development (T2-T6).
// Replaced by the React WebView UI in T7.
class MainComponent : public juce::AudioAppComponent,
                      private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void prepareToPlay (int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock (const juce::AudioSourceChannelInfo& bufferToFill) override;
    void releaseResources() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void openAudioSettings();
    void loadVst();
    void loadNam();
    void loadIR();
    void openVstEditor();

    // Direct loaders (used by both the file choosers and the dev auto-load).
    void doLoadVst (const juce::File&);
    void doLoadNam (const juce::File&);
    void doLoadIR  (const juce::File&);
    void devAutoLoad();   // loads from /tmp/tonestack_autoload.txt if present
    bool autoLoadDone = false;
    bool autoOpenEditor = false;
    int  ticks = 0;

    double currentSr()    const { return engine.isPrepared() ? engine.getSampleRate()  : 48000.0; }
    int    currentBlock() const { return engine.isPrepared() ? engine.getMaxBlockSize() : 512; }

    AudioEngine engine;
    juce::AudioBuffer<float> monoBuffer;

    std::atomic<bool>  monitorOn { true };
    std::atomic<float> masterGain { 0.8f };

    // Header / master
    juce::Label  titleLabel, latencyLabel, masterLabel;
    juce::TextButton settingsButton { "Audio Settings" };
    juce::ToggleButton monitorButton { "Monitor" };
    juce::Slider masterSlider;

    // Chain slots (signal flows VST3 -> NAM -> IR)
    std::unique_ptr<SlotStrip> vstStrip, namStrip, irStrip;

    // Async VST load holder + editor window
    std::unique_ptr<Vst3Node> pendingVst;
    std::unique_ptr<juce::DocumentWindow> editorWindow;

    std::unique_ptr<juce::FileChooser> fileChooser;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainComponent)
};
