#pragma once

#include "ProcessorNode.h"
#include <juce_audio_processors/juce_audio_processors.h>

//==============================================================================
// Hosts one VST3 plugin, mono-in / mono-out.
//
// Loading is synchronous (VST3 does not require the async path). The whole node
// is swapped into the chain by the AudioEngine under its lock, so no intra-node
// atomic pointer juggling is needed — the audio thread never touches the
// instance while it is being created or destroyed.
class Vst3Node : public ProcessorNode
{
public:
    Vst3Node();
    ~Vst3Node() override;

    juce::String getTypeName()  const override { return "VST3"; }
    juce::String getSourceName() const override { return pluginName; }

    void prepare (double sampleRate, int maxBlockSize) override;
    void process (juce::AudioBuffer<float>& mono) noexcept override;
    void reset() override;

    // Message thread. Scans + instantiates the plugin asynchronously (VST3 creation
    // needs the message loop to dispatch), prepares it, then fires onDone(ok, error)
    // — also on the message thread. The node must stay alive until onDone fires.
    void loadAsync (const juce::File& file, double sampleRate, int maxBlockSize,
                    std::function<void (bool, juce::String)> onDone);

    // Message thread only — for hosting the plugin's editor window.
    juce::AudioPluginInstance* getInstance() const noexcept { return instance.get(); }

    // Preset state (message thread).
    juce::String getStateBase64() const;
    void         setStateBase64 (const juce::String& b64);
    juce::String getIdentifier() const { return identifier; } // for preset reload matching
    juce::File   getSourceFile() const { return sourceFile; }

private:
    void prepareInstance (juce::AudioPluginInstance& p);

    juce::AudioPluginFormatManager formatManager;
    std::unique_ptr<juce::AudioPluginInstance> instance;
    juce::AudioBuffer<float> scratch;
    juce::MidiBuffer midi;

    juce::String pluginName, identifier;
    juce::File   sourceFile;
    double sampleRate  = 48000.0;
    int    maxBlock    = 0;
    int    pluginChans = 1;
    std::atomic<bool> ready { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Vst3Node)
};
