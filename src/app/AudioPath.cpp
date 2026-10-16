#include "AudioPath.h"

void AudioPath::prepare (int samplesPerBlockExpected, double sampleRate)
{
    const int alloc = juce::jmax (samplesPerBlockExpected, kMinBlockAlloc);
    monoBuffer.setSize (1, alloc, false, false, true);
    engine.prepare (sampleRate, alloc);
}

void AudioPath::release()
{
    engine.releaseResources();
}

void AudioPath::process (juce::AudioBuffer<float>& io, int start, int num) noexcept
{
    const int numChans = io.getNumChannels();

    if (! isMonitoring() || num > monoBuffer.getNumSamples() || numChans == 0)
    {
        for (int ch = 0; ch < numChans; ++ch)
            io.clear (ch, start, num);
        inPeak.store (0.0f, std::memory_order_relaxed);
        outPeak.store (0.0f, std::memory_order_relaxed);
        return;
    }

    monoBuffer.copyFrom (0, 0, io, 0, start, num);
    const float ig = getInputGain();
    if (ig != 1.0f)
        monoBuffer.applyGain (0, 0, num, ig);
    const float inLevel = monoBuffer.getMagnitude (0, 0, num);
    inPeak.store (inLevel, std::memory_order_relaxed);

    float* chans[1] = { monoBuffer.getWritePointer (0) };
    juce::AudioBuffer<float> work (chans, 1, num);
    engine.processBlock (work);

    const float g = getMasterGain();
    for (int ch = 0; ch < numChans; ++ch)
    {
        io.copyFrom (ch, start, work, 0, 0, num);
        io.applyGain (ch, start, num, g);
    }
    outPeak.store (work.getMagnitude (0, 0, num) * g, std::memory_order_relaxed);

    pushScope (work.getReadPointer (0), num, g, inLevel > scopeGate);
}

void AudioPath::pushScope (const float* data, int num, float gain, bool gateOpen) noexcept
{
    // ~3 signed peaks per 128-sample block: enough for a smooth scope at 30 Hz
    // without flooding the bridge.
    const int buckets = juce::jmax (1, num / 42);
    const int stride  = juce::jmax (1, num / buckets);

    int start1, size1, start2, size2;
    scopeFifo.prepareToWrite (buckets, start1, size1, start2, size2);
    const int toWrite = juce::jmin (buckets, size1 + size2);

    for (int b = 0; b < toWrite; ++b)
    {
        float peak = 0.0f;
        const int s = b * stride, e = juce::jmin (num, s + stride);
        for (int i = s; i < e; ++i)
            if (std::abs (data[i]) > std::abs (peak))
                peak = data[i];

        const float v = gateOpen ? peak * gain : 0.0f;
        if (b < size1) scopeRing[(size_t) (start1 + b)] = v;
        else           scopeRing[(size_t) (start2 + (b - size1))] = v;
    }
    scopeFifo.finishedWrite (toWrite);
}

void AudioPath::drainScope (std::vector<float>& out)
{
    const int ready = scopeFifo.getNumReady();
    if (ready <= 0)
        return;

    int start1, size1, start2, size2;
    scopeFifo.prepareToRead (ready, start1, size1, start2, size2);
    out.reserve (out.size() + (size_t) ready);
    for (int i = 0; i < size1; ++i) out.push_back (scopeRing[(size_t) (start1 + i)]);
    for (int i = 0; i < size2; ++i) out.push_back (scopeRing[(size_t) (start2 + i)]);
    scopeFifo.finishedRead (size1 + size2);
}
