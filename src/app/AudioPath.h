#pragma once

#include "Tuner.h"
#include "engine/AudioEngine.h"
#include <juce_dsp/juce_dsp.h>
#include <array>
#include <atomic>
#include <vector>

//==============================================================================
// The live audio path around the engine: input trim -> chain -> master, fanned
// out to every output channel, plus the level meters and the scope feed.
//
// Input: the device's FIRST active input channel. Which physical input that is
// is chosen in the device setup (only the selected input is enabled), so the
// guitar can be on any input of the interface.
//
// Threading: process() is the audio callback (RT-safe: no allocation, no locks).
// The setters are atomics, safe from any thread. drainScope() is the single
// consumer of the scope FIFO and runs on the message thread.
class AudioPath
{
public:
    explicit AudioPath (AudioEngine& engineToUse) : engine (engineToUse) {}

    // Message thread (or the device's prepare callback).
    void prepare (int samplesPerBlockExpected, double sampleRate);
    void release();

    // Audio thread. Reads input channel 0 of `io`, writes the result to every
    // channel of `io` over [start, start + num).
    void process (juce::AudioBuffer<float>& io, int start, int num) noexcept;

    //== controls (any thread) =================================================
    void  setMonitoring (bool on) noexcept     { monitorOn.store (on, std::memory_order_relaxed); }
    bool  isMonitoring() const noexcept        { return monitorOn.load (std::memory_order_relaxed); }
    void  setInputGain (float g) noexcept      { inputGain.store (g, std::memory_order_relaxed); }
    float getInputGain() const noexcept        { return inputGain.load (std::memory_order_relaxed); }
    void  setMasterGain (float g) noexcept     { masterGain.store (g, std::memory_order_relaxed); }
    float getMasterGain() const noexcept       { return masterGain.load (std::memory_order_relaxed); }

    // Noise gate on the input, after the input gain: 0 = off, otherwise the
    // threshold runs from -80 dB (just above 0) to -20 dB (at 1).
    void  setGate (float amount01) noexcept    { gate.store (juce::jlimit (0.0f, 1.0f, amount01), std::memory_order_relaxed); }
    float getGate() const noexcept             { return gate.load (std::memory_order_relaxed); }
    static float gateThresholdDb (float amount01) noexcept { return -80.0f + 60.0f * amount01; }

    //== meters + scope (message thread) =======================================
    // Peaks held since the last take (input after trim; output after master), so a
    // 30 Hz meter still sees a pick attack that lasted one block. take*() resets.
    float getInputPeak() const noexcept  { return inPeak.load (std::memory_order_relaxed); }
    float getOutputPeak() const noexcept { return outPeak.load (std::memory_order_relaxed); }
    float takeInputPeak() noexcept       { return inPeak.exchange (0.0f, std::memory_order_relaxed); }
    float takeOutputPeak() noexcept      { return outPeak.exchange (0.0f, std::memory_order_relaxed); }

    // Raw peak of each device input channel (before trim), held like the above.
    // Lets first-run setup see which input the guitar is on. Channels the device
    // doesn't have read 0.
    static constexpr int maxChannelMeters = 16;
    float takeChannelPeak (int channel) noexcept;

    //== tuner =================================================================
    // While the tuner is on it hears the guitar's input and the output is muted.
    Tuner& getTuner() noexcept { return tuner; }

    //== test sound ============================================================
    // A short, quiet tone on every output, played even with monitoring off (it's
    // how setup checks you can hear the output). Safe from any thread.
    void playTestSound() noexcept { testToneRemaining.store (testToneLength, std::memory_order_relaxed); }
    bool isPlayingTestSound() const noexcept { return testToneRemaining.load (std::memory_order_relaxed) > 0; }

    // Input peak above which the scope shows signal (below it the scope is flat,
    // so nothing appears to flow when you're not playing).
    static constexpr float scopeGate = 0.008f;

    // Appends every scope point the audio thread has produced since the last call.
    void drainScope (std::vector<float>& out);

    static constexpr int scopeCapacity = 8192;

private:
    AudioEngine& engine;
    juce::AudioBuffer<float> monoBuffer;

    std::atomic<bool>  monitorOn  { true };
    std::atomic<float> inputGain  { 0.8f };
    std::atomic<float> masterGain { 0.8f };
    std::atomic<float> gate { 0.0f };
    juce::dsp::NoiseGate<float> noiseGate;   // audio thread
    float appliedGate = -1.0f;               // audio thread: last threshold set
    std::atomic<float> inPeak  { 0.0f };
    std::atomic<float> outPeak { 0.0f };
    std::array<std::atomic<float>, maxChannelMeters> channelPeaks {};
    Tuner tuner;

    // The gains last applied, so a knob move ramps across the next block instead
    // of jumping (which crackles). Audio thread only; snapped after prepare().
    float appliedInputGain = 0.0f, appliedMasterGain = 0.0f;
    bool snapGains = true;

    double sampleRate = 48000.0;
    int testToneLength = 0;                     // samples (set in prepare)
    std::atomic<int> testToneRemaining { 0 };
    double testTonePhase = 0.0;

    // Lock-free SPSC: the audio thread writes decimated signed peaks, the
    // message thread drains them.
    juce::AbstractFifo scopeFifo { scopeCapacity };
    std::array<float, scopeCapacity> scopeRing {};

    void pushScope (const float* data, int num, float gain, bool gateOpen) noexcept;
    void addTestTone (juce::AudioBuffer<float>& io, int start, int num) noexcept;
    static void holdMax (std::atomic<float>& peak, float value) noexcept;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AudioPath)
};
