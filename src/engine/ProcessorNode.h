#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>

//==============================================================================
// Base class for one slot in the signal chain (IR, NAM, or VST3).
//
// Threading contract:
//   - prepare() / loadXXX() run on the MESSAGE thread (may be slow: file IO,
//     plugin instantiation). A node must be fully prepared before the engine
//     swaps it into the live chain.
//   - process() runs on the AUDIO thread. It must be real-time safe:
//     no allocation, no locks, no file IO, no logging.
class ProcessorNode
{
public:
    virtual ~ProcessorNode() = default;

    // Short type tag, e.g. "IR", "NAM", "VST3".
    virtual juce::String getTypeName() const = 0;

    // What's loaded (file name, plugin name). For display only.
    virtual juce::String getSourceName() const { return {}; }

    // Message thread. Allocate internal buffers here.
    virtual void prepare (double sampleRate, int maxBlockSize) = 0;

    // Audio thread. Process a MONO buffer (1 channel) in place. RT-safe.
    virtual void process (juce::AudioBuffer<float>& mono) noexcept = 0;

    // Clear internal state (tails, filters). Message or audio thread.
    virtual void reset() {}

    //==========================================================================
    void setBypassed (bool shouldBypass) noexcept
    {
        bypassed.store (shouldBypass, std::memory_order_relaxed);
    }

    bool isBypassed() const noexcept
    {
        return bypassed.load (std::memory_order_relaxed);
    }

private:
    std::atomic<bool> bypassed { false };
};
