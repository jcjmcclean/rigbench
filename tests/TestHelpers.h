#pragma once

// Shared helpers for the Catch2 unit tests: signals, temp dirs, fixtures, and
// fake chain nodes whose behaviour is easy to predict.

#include "engine/AudioEngine.h"
#include "engine/ProcessorNode.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>
#include <functional>

namespace testing
{
//==============================================================================
// A fresh, empty directory under the temp dir, deleted when it goes out of scope.
struct TempDir
{
    juce::File dir;

    TempDir()
        : dir (juce::File::getSpecialLocation (juce::File::tempDirectory)
                   .getNonexistentChildFile ("tonebench-test", {}, false))
    {
        dir.createDirectory();
    }
    ~TempDir() { dir.deleteRecursively(); }

    juce::File file (const juce::String& name) const { return dir.getChildFile (name); }
};

//==============================================================================
inline juce::AudioBuffer<float> constant (int n, float value)
{
    juce::AudioBuffer<float> b (1, n);
    juce::FloatVectorOperations::fill (b.getWritePointer (0), value, n);
    return b;
}

inline juce::AudioBuffer<float> impulse (int n, float amp = 1.0f)
{
    juce::AudioBuffer<float> b (1, n);
    b.clear();
    b.setSample (0, 0, amp);
    return b;
}

inline juce::AudioBuffer<float> sine (double sr, int n, double hz = 220.0, float amp = 0.5f)
{
    juce::AudioBuffer<float> b (1, n);
    for (int i = 0; i < n; ++i)
        b.setSample (0, i, amp * (float) std::sin (juce::MathConstants<double>::twoPi * hz * i / sr));
    return b;
}

inline float rms (const juce::AudioBuffer<float>& b)
{
    return b.getRMSLevel (0, 0, b.getNumSamples());
}

inline bool allFinite (const juce::AudioBuffer<float>& b)
{
    for (int ch = 0; ch < b.getNumChannels(); ++ch)
        for (int i = 0; i < b.getNumSamples(); ++i)
            if (! std::isfinite (b.getSample (ch, i)))
                return false;
    return true;
}

// Run `in` through the engine block by block, like the live callback does.
inline juce::AudioBuffer<float> render (AudioEngine& engine, const juce::AudioBuffer<float>& in, int block)
{
    juce::AudioBuffer<float> out (in);
    for (int pos = 0; pos < out.getNumSamples(); pos += block)
    {
        const int n = juce::jmin (block, out.getNumSamples() - pos);
        float* chans[1] = { out.getWritePointer (0, pos) };
        juce::AudioBuffer<float> view (chans, 1, n);
        engine.processBlock (view);
    }
    return out;
}

//==============================================================================
// Writes a mono 24-bit WAV.
inline bool writeWav (const juce::File& f, const juce::AudioBuffer<float>& b, double sr)
{
    f.deleteFile();
    juce::WavAudioFormat wav;
    std::unique_ptr<juce::OutputStream> os (f.createOutputStream().release());
    if (os == nullptr)
        return false;
    auto options = juce::AudioFormatWriterOptions{}.withSampleRate (sr).withNumChannels (1).withBitsPerSample (24);
    auto writer = wav.createWriterFor (os, options);
    if (writer == nullptr)
        return false;
    return writer->writeFromAudioSampleBuffer (b, 0, b.getNumSamples());
}

// A short decaying-noise cab IR, deterministic.
inline juce::AudioBuffer<float> syntheticIR (int len = 512)
{
    juce::AudioBuffer<float> ir (1, len);
    juce::Random rng (1234);
    float last = 0.0f;
    for (int i = 0; i < len; ++i)
    {
        last = 0.6f * last + 0.4f * (rng.nextFloat() * 2.0f - 1.0f);
        ir.setSample (0, i, last * std::exp (-(float) i / 90.0f));
    }
    ir.setSample (0, 0, 1.0f);
    return ir;
}

inline juce::File writeSyntheticIR (const TempDir& tmp, double sr = 48000.0, const juce::String& name = "cab.wav")
{
    auto f = tmp.file (name);
    writeWav (f, syntheticIR(), sr);
    return f;
}

// The committed, valid NAM model (a 2-tap linear model at 48 kHz).
inline juce::File namFixture()
{
    return juce::File (TONEBENCH_FIXTURES_DIR).getChildFile ("minimal.nam");
}

// Convolution loads its IR on a background thread and swaps it in during
// process(). Pump blocks until the output stops being the dry input.
inline bool waitUntilProcessed (const std::function<bool()>& changed, int timeoutMs = 4000)
{
    const auto deadline = juce::Time::getMillisecondCounter() + (juce::uint32) timeoutMs;
    while (juce::Time::getMillisecondCounter() < deadline)
    {
        if (changed())
            return true;
        juce::Thread::sleep (20);
    }
    return false;
}

//==============================================================================
// Fake nodes with obvious, order-sensitive maths, so chain behaviour is exact.
struct FnNode final : ProcessorNode
{
    explicit FnNode (std::function<float (float)> f, juce::String nameToUse = "fake")
        : fn (std::move (f)), name (std::move (nameToUse)) {}

    juce::String getTypeName() const override { return "FAKE"; }
    juce::String getSourceName() const override { return name; }

    void prepare (double sr, int block) override { preparedRate = sr; preparedBlock = block; ++prepareCount; }
    void reset() override { ++resetCount; }

    void process (juce::AudioBuffer<float>& mono) noexcept override
    {
        auto* d = mono.getWritePointer (0);
        for (int i = 0; i < mono.getNumSamples(); ++i)
            d[i] = fn (d[i]);
    }

    std::function<float (float)> fn;
    juce::String name;
    double preparedRate = 0.0;
    int preparedBlock = 0, prepareCount = 0, resetCount = 0;
};

inline std::unique_ptr<FnNode> adds (float k)       { return std::make_unique<FnNode> ([k] (float x) { return x + k; }); }
inline std::unique_ptr<FnNode> multiplies (float k) { return std::make_unique<FnNode> ([k] (float x) { return x * k; }); }

} // namespace testing
