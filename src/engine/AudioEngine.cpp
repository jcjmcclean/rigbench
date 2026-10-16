#include "AudioEngine.h"

void AudioEngine::prepare (double newSampleRate, int newMaxBlockSize)
{
    const juce::ScopedLock sl (lock);

    sampleRate   = newSampleRate;
    maxBlockSize = newMaxBlockSize;
    prepared     = true;

    for (auto& node : slots)
        if (node != nullptr)
            node->prepare (sampleRate, maxBlockSize);
}

void AudioEngine::releaseResources()
{
    const juce::ScopedLock sl (lock);
    prepared = false;

    for (auto& node : slots)
        if (node != nullptr)
            node->reset();
}

void AudioEngine::setNode (int slot, std::unique_ptr<ProcessorNode> newNode)
{
    jassert (juce::isPositiveAndBelow (slot, (int) numSlots));

    // Prepare the incoming node fully off the audio thread (can be slow).
    if (newNode != nullptr && prepared)
        newNode->prepare (sampleRate, maxBlockSize);

    {
        // Brief lock just to swap the pointer. The outgoing node ends up in
        // newNode and is destroyed after we release the lock.
        const juce::ScopedLock sl (lock);
        slots[(size_t) slot].swap (newNode);
    }
}

ProcessorNode* AudioEngine::getNode (int slot) const noexcept
{
    if (! juce::isPositiveAndBelow (slot, (int) numSlots))
        return nullptr;

    return slots[(size_t) slot].get();
}

void AudioEngine::processBlock (juce::AudioBuffer<float>& mono) noexcept
{
    // Flush denormals for the whole chain — NAM/IR tails and any feedback can
    // generate them, causing large CPU spikes otherwise.
    juce::ScopedNoDenormals noDenormals;

    // If a node swap is in progress, pass the block through dry rather than
    // blocking the audio thread.
    const juce::ScopedTryLock stl (lock);
    if (! stl.isLocked())
        return;

    for (auto& node : slots)
        if (node != nullptr && ! node->isBypassed())
            node->process (mono);
}
