#pragma once

#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <optional>
#include <vector>

//==============================================================================
// A guitar tuner: the audio thread pushes the guitar's input in, the message
// thread asks for the pitch of the latest ~85 ms (YIN on a half-rate copy to
// find the period, then refined at the full rate). Covers 40 Hz (below a
// drop-tuned low string) to 1.4 kHz.
class Tuner
{
public:
    Tuner() = default;

    struct Reading
    {
        double hz = 0.0;
        int    midiNote = 0;        // nearest note (69 = A4)
        double cents = 0.0;         // -50..+50 from that note
        juce::String noteName;      // "E", "A#" ...
        int    octave = 0;          // scientific pitch: E2 is the low E string
    };

    void prepare (double sampleRate);

    // Audio thread. Cheap when the tuner is off.
    void push (const float* samples, int num) noexcept;

    void setActive (bool on) noexcept { active.store (on, std::memory_order_relaxed); }
    bool isActive() const noexcept    { return active.load (std::memory_order_relaxed); }

    // Message thread. The pitch of what's been played most recently, or nothing
    // if it's too quiet or not clearly pitched.
    std::optional<Reading> read();

    // The maths, exposed for tests: pitch of `x` (one channel) at `rate`, or 0.
    static double detectPitch (const float* x, int n, double rate);
    static Reading describe (double hz, double a4 = 440.0);

    static constexpr double minHz = 40.0, maxHz = 1400.0;

private:
    static constexpr int ringSize = 8192;   // power of two
    std::array<float, ringSize> ring {};
    std::atomic<int> writePos { 0 };
    std::atomic<bool> active { false };

    double sampleRate = 48000.0;
    int windowSamples = 2048;               // at the device rate
    std::vector<float> scratch;             // message thread only

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Tuner)
};
