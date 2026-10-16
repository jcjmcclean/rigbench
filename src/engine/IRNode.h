#pragma once

#include "ProcessorNode.h"
#include <juce_dsp/juce_dsp.h>

//==============================================================================
// Cab / speaker impulse response via zero-latency convolution.
class IRNode : public ProcessorNode
{
public:
    IRNode();

    juce::String getTypeName()  const override { return "IR"; }
    juce::String getSourceName() const override { return fileName; }
    juce::File   getSourceFile() const { return sourceFile; }

    void prepare (double sampleRate, int maxBlockSize) override;
    void process (juce::AudioBuffer<float>& mono) noexcept override;
    void reset() override;

    // Message thread. Loads the IR (async inside Convolution, hot-swap safe).
    bool loadFile (const juce::File& file);

    void  setMix (float wet01) noexcept { mix.store (juce::jlimit (0.0f, 1.0f, wet01), std::memory_order_relaxed); }
    float getMix() const noexcept       { return mix.load (std::memory_order_relaxed); }

private:
    // Latency{0} => no added latency, at some extra CPU. Fine for short cab IRs.
    juce::dsp::Convolution conv { juce::dsp::Convolution::Latency { 0 } };
    juce::AudioBuffer<float> dryBuffer;
    juce::String fileName;
    juce::File   sourceFile;

    double sampleRate  = 0.0;
    int    maxBlockSize = 0;
    std::atomic<float> mix { 1.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (IRNode)
};
