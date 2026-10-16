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

    // SEC-4: an IR is an untrusted audio file. A valid header with a giant data
    // chunk becomes a large heap allocation + long FFT-partition setup inside
    // Convolution — a cheap DoS. Reject anything over a sane cab-IR size first.
    // (Convolution::loadImpulseResponse is fire-and-forget / returns void, so this
    // pre-flight size check is the only guard we can apply before it runs.)
    constexpr juce::int64 maxBytes = 16ll * 1024 * 1024; // 16 MB
    if (file.getSize() > maxBytes)
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
    if (numSamples > maxBlockSize)
        return; // block larger than prepared would overflow dryBuffer (matches NAM/VST3)

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
