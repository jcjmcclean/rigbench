#pragma once

#include "engine/AudioEngine.h"
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

    //== meters + scope (message thread) =======================================
    // Latest block peaks (input after trim; output after master).
    float getInputPeak() const noexcept  { return inPeak.load (std::memory_order_relaxed); }
    float getOutputPeak() const noexcept { return outPeak.load (std::memory_order_relaxed); }

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
    std::atomic<float> inPeak  { 0.0f };
    std::atomic<float> outPeak { 0.0f };

    // Lock-free SPSC: the audio thread writes decimated signed peaks, the
    // message thread drains them.
    juce::AbstractFifo scopeFifo { scopeCapacity };
    std::array<float, scopeCapacity> scopeRing {};

    void pushScope (const float* data, int num, float gain, bool gateOpen) noexcept;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (AudioPath)
};
