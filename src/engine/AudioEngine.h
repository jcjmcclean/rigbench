#pragma once

#include "ProcessorNode.h"
#include <array>
#include <memory>

// Minimum buffer the audio components allocate for, so a host that reports a tiny
// (or zero) expected block size still has headroom. Shared by every audio front
// end (WebUIComponent, the offline bench, ...) — single source of truth.
inline constexpr int kMinBlockAlloc = 4096;

//==============================================================================
// Owns the ordered signal chain and runs it on the audio thread.
//
// Default slot order (signal flows top to bottom):
//   slot 0: VST3   (amp sim / effect plugin)
//   slot 1: NAM    (neural amp model)
//   slot 2: IR     (cab impulse response)
//
// Node lifecycle (RT-safe swap):
//   setNode() prepares the new node OFF the audio thread, then swaps the pointer
//   under a short lock. The audio thread uses a tryLock and passes the block
//   through dry if a swap is momentarily in progress.
class AudioEngine
{
public:
    enum Slot { vst3Slot = 0, namSlot = 1, irSlot = 2, numSlots = 3 };

    AudioEngine() = default;

    // Message thread.
    void prepare (double sampleRate, int maxBlockSize);
    void releaseResources();

    // Install an already-constructed node (or nullptr to clear the slot).
    // Prepares it here (message thread) before swapping it in.
    void setNode (int slot, std::unique_ptr<ProcessorNode> newNode);

    // Message-thread access for the UI / editor windows. Do NOT call from audio.
    ProcessorNode* getNode (int slot) const noexcept;

    double getSampleRate()  const noexcept { return sampleRate; }
    int    getMaxBlockSize() const noexcept { return maxBlockSize; }
    bool   isPrepared()     const noexcept { return prepared; }

    // Audio thread. Processes a MONO buffer in place through the whole chain.
    void processBlock (juce::AudioBuffer<float>& mono) noexcept;

private:
    std::array<std::unique_ptr<ProcessorNode>, (size_t) numSlots> slots;
    juce::CriticalSection lock;

    double sampleRate  = 0.0;
    int    maxBlockSize = 0;
    bool   prepared    = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AudioEngine)
};
