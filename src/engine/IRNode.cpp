#include "IRNode.h"

IRNode::IRNode() = default;

void IRNode::prepare (double newSampleRate, int newMaxBlockSize)
{
    sampleRate   = newSampleRate;
    maxBlockSize = newMaxBlockSize;

    juce::dsp::ProcessSpec spec;
    spec.sampleRate       = sampleRate;
    spec.maximumBlockSize = (juce::uint32) maxBlockSize;
    spec.numChannels      = 1;

    conv.prepare (spec);
    dryBuffer.setSize (1, maxBlockSize, false, false, true);
}

bool IRNode::loadFile (const juce::File& file)
{
    if (! file.existsAsFile())
        return false;

    // Load as mono, trim silence, keep full length, normalise.
    // This loads on a background thread inside Convolution and swaps in safely
    // while audio is running.
    conv.loadImpulseResponse (file,
                              juce::dsp::Convolution::Stereo::no,
                              juce::dsp::Convolution::Trim::yes,
                              0,
                              juce::dsp::Convolution::Normalise::yes);

    fileName = file.getFileName();
    sourceFile = file;
    return true;
}

void IRNode::process (juce::AudioBuffer<float>& mono) noexcept
{
    const int numSamples = mono.getNumSamples();
    const float wet = mix.load (std::memory_order_relaxed);

    // Keep a dry copy if we're blending.
    const bool blend = wet < 0.999f;
    if (blend)
        dryBuffer.copyFrom (0, 0, mono, 0, 0, numSamples);

    juce::dsp::AudioBlock<float> block (mono);
    juce::dsp::ProcessContextReplacing<float> ctx (block);
    conv.process (ctx);

    if (blend)
    {
        mono.applyGain (0, 0, numSamples, wet);
        mono.addFrom (0, 0, dryBuffer, 0, 0, numSamples, 1.0f - wet);
    }
}

void IRNode::reset()
{
    conv.reset();
}
