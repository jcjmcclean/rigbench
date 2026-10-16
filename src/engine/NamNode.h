#pragma once

#include "ProcessorNode.h"
#include "RealtimeResampler.h"
#include <NAM/get_dsp.h>
#include <memory>
#include <vector>

//==============================================================================
// Neural Amp Modeler node. Loads a .nam model and runs inference per block.
//
// Ownership/threading: the AudioEngine swaps whole nodes under a lock, so this
// node owns its nam::DSP directly (no internal atomic swap needed). Loading
// (get_dsp) and prepare (Reset + prewarm) are heavy and must run on the message
// thread BEFORE the engine swaps the node into the live chain.
//
// NB: WaveNet models (all real amp captures, incl. the Hiwatt files) do NOT
// adapt their sample rate. They must be fed audio at GetExpectedSampleRate()
// (48 kHz here). Resampling for mismatched device rates is handled by a wrapper
// added after the matched-rate path is verified.
class NamNode : public ProcessorNode
{
public:
    NamNode() = default;

    juce::String getTypeName()  const override { return "NAM"; }
    juce::String getSourceName() const override { return fileName; }
    juce::File   getSourceFile() const { return sourceFile; }

    void prepare (double sampleRate, int maxBlockSize) override;
    void process (juce::AudioBuffer<float>& mono) noexcept override;
    void reset() override;

    // Message thread. Loads the model (get_dsp). Returns false + error on failure.
    bool loadFile (const juce::File& file, juce::String& error);

    double getExpectedSampleRate() const;   // model training rate, or -1 if unknown
    bool   sampleRateMatches()     const;   // host rate == model rate (within tolerance)

    void setInputTrimDb  (float db) noexcept { inGain.store  (juce::Decibels::decibelsToGain (db), std::memory_order_relaxed); }
    void setOutputTrimDb (float db) noexcept { outGain.store (juce::Decibels::decibelsToGain (db), std::memory_order_relaxed); }

    // UI "Level" knob: 0..1 where 0.5 == 0 dB, mapped to +/-24 dB output trim.
    void  setUiGain (float v01) noexcept { uiGain.store (v01, std::memory_order_relaxed); setOutputTrimDb ((v01 - 0.5f) * 48.0f); }
    float getUiGain() const noexcept     { return uiGain.load (std::memory_order_relaxed); }

private:
    std::unique_ptr<nam::DSP> model;
    juce::String fileName;
    juce::File   sourceFile;

    double hostSampleRate = 48000.0;
    int    maxBlock = 0;

    // Sample-rate conversion (only when the device rate != the model's rate).
    bool resampling = false;
    RealtimeResampler up, down;
    std::vector<float> upBuf, modelBuf, downBuf, outFifo;
    int outFill = 0;

    std::atomic<bool>  ready { false };     // true once Reset() has run
    std::atomic<float> inGain  { 1.0f };
    std::atomic<float> outGain { 1.0f };
    std::atomic<float> uiGain  { 0.5f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (NamNode)
};
