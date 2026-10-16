#include "AudioPath.h"

void AudioPath::prepare (int samplesPerBlockExpected, double newSampleRate)
{
    const int alloc = juce::jmax (samplesPerBlockExpected, kMinBlockAlloc);
    monoBuffer.setSize (1, alloc, false, false, true);
    sampleRate = newSampleRate > 0 ? newSampleRate : 48000.0;
    testToneLength = (int) (sampleRate * 0.8);
    snapGains = true;
    tuner.prepare (sampleRate);
    engine.prepare (sampleRate, alloc);
}

void AudioPath::holdMax (std::atomic<float>& peak, float value) noexcept
{
    float prev = peak.load (std::memory_order_relaxed);
    while (value > prev && ! peak.compare_exchange_weak (prev, value, std::memory_order_relaxed)) {}
}

float AudioPath::takeChannelPeak (int channel) noexcept
{
    if (! juce::isPositiveAndBelow (channel, maxChannelMeters))
        return 0.0f;
    return channelPeaks[(size_t) channel].exchange (0.0f, std::memory_order_relaxed);
}

void AudioPath::release()
{
    engine.releaseResources();
}

void AudioPath::process (juce::AudioBuffer<float>& io, int start, int num) noexcept
{
    const int numChans = io.getNumChannels();

    // Raw input levels per channel, before anything else touches the buffer.
    for (int ch = 0; ch < juce::jmin (numChans, maxChannelMeters); ++ch)
        holdMax (channelPeaks[(size_t) ch], io.getMagnitude (ch, start, num));

    if (numChans > 0)
        tuner.push (io.getReadPointer (0, start), num);

    if (! isMonitoring() || tuner.isActive() || num > monoBuffer.getNumSamples() || numChans == 0)
    {
        for (int ch = 0; ch < numChans; ++ch)
            io.clear (ch, start, num);
        inPeak.store (0.0f, std::memory_order_relaxed);
        outPeak.store (0.0f, std::memory_order_relaxed);
        addTestTone (io, start, num);
        return;
    }

    const float ig = getInputGain(), g = getMasterGain();
    if (snapGains)
    {
        appliedInputGain = ig;
        appliedMasterGain = g;
        snapGains = false;
    }

    monoBuffer.copyFrom (0, 0, io, 0, start, num);
    monoBuffer.applyGainRamp (0, 0, num, appliedInputGain, ig);
    appliedInputGain = ig;
    const float inLevel = monoBuffer.getMagnitude (0, 0, num);
    holdMax (inPeak, inLevel);

    float* chans[1] = { monoBuffer.getWritePointer (0) };
    juce::AudioBuffer<float> work (chans, 1, num);
    engine.processBlock (work);

    work.applyGainRamp (0, 0, num, appliedMasterGain, g);
    appliedMasterGain = g;
    for (int ch = 0; ch < numChans; ++ch)
        io.copyFrom (ch, start, work, 0, 0, num);
    holdMax (outPeak, work.getMagnitude (0, 0, num));

    pushScope (work.getReadPointer (0), num, 1.0f, inLevel > scopeGate);
    addTestTone (io, start, num);
}

void AudioPath::addTestTone (juce::AudioBuffer<float>& io, int start, int num) noexcept
{
    int remaining = testToneRemaining.load (std::memory_order_relaxed);
    if (remaining <= 0)
        return;

    // A soft 440 Hz tone with a short fade in and out, about -18 dBFS.
    const double step = juce::MathConstants<double>::twoPi * 440.0 / sampleRate;
    const int fade = juce::jmax (1, (int) (sampleRate * 0.02));
    const int n = juce::jmin (num, remaining);
    for (int i = 0; i < n; ++i)
    {
        const int pos = testToneLength - remaining + i;
        const float env = (float) juce::jmin (1.0, juce::jmin ((double) pos / fade, (double) (testToneLength - pos) / fade));
        const float v = 0.125f * env * (float) std::sin (testTonePhase);
        testTonePhase += step;
        for (int ch = 0; ch < io.getNumChannels(); ++ch)
            io.addSample (ch, start + i, v);
    }
    testTonePhase = std::fmod (testTonePhase, juce::MathConstants<double>::twoPi);
    testToneRemaining.store (remaining - n, std::memory_order_relaxed);
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
