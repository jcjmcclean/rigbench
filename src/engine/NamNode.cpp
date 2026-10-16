#include "NamNode.h"
#include <filesystem>
#include <cstring>

bool NamNode::loadFile (const juce::File& file, juce::String& error)
{
    if (! file.existsAsFile())
    {
        error = "File not found: " + file.getFullPathName();
        return false;
    }

    // SEC-4: .nam is attacker-controlled JSON whose declared dimensions drive Eigen
    // allocations inside third-party namcore. Cap the on-disk size before parsing so
    // a hand-crafted model can't trigger a multi-GB allocation / OOM-kill (DoS).
    constexpr juce::int64 maxBytes = 64ll * 1024 * 1024; // 64 MB
    if (file.getSize() > maxBytes)
    {
        error = "Model file too large (over 64 MB): " + file.getFileName();
        return false;
    }

    try
    {
        nam::DspLoadOptions opt;
        opt.prewarm = false; // we prewarm inside Reset() during prepare()
        const std::filesystem::path path (file.getFullPathName().toStdString());
        auto fresh = nam::get_dsp (path, opt);
        if (fresh == nullptr)
        {
            error = "Failed to load model";
            return false;
        }

        model = std::move (fresh);
        fileName = file.getFileName();
        sourceFile = file;
        ready.store (false, std::memory_order_release);

        // If we already know the stream format, prepare right away so the node
        // is usable even if the engine was prepared before this load.
        if (maxBlock > 0)
            prepare (hostSampleRate, maxBlock);

        return true;
    }
    catch (const std::exception& e)
    {
        error = e.what();
        model.reset();
        return false;
    }
}

void NamNode::prepare (double sampleRate, int maxBlockSize)
{
    hostSampleRate = sampleRate;
    maxBlock       = maxBlockSize;
    ready.store (false, std::memory_order_release);

    if (model == nullptr)
        return;

    const double modelRate = model->GetExpectedSampleRate();
    resampling = (modelRate > 0.0 && std::abs (modelRate - sampleRate) > 1.0);

    if (resampling)
    {
        // Device rate -> model rate -> inference -> back to device rate, re-blocked
        // through an output FIFO so the engine always gets exactly maxBlock samples.
        up.prepare (sampleRate, modelRate, maxBlockSize);
        const int maxUp = up.getMaxOutputSamples();
        down.prepare (modelRate, sampleRate, maxUp);

        upBuf.assign   ((size_t) maxUp, 0.0f);
        modelBuf.assign ((size_t) maxUp, 0.0f);
        downBuf.assign ((size_t) down.getMaxOutputSamples(), 0.0f);
        outFifo.assign ((size_t) (maxBlockSize + down.getMaxOutputSamples() + maxUp + 16), 0.0f);
        outFill = 0;

        model->Reset (modelRate, maxUp);   // NAM runs at the model rate, up to maxUp frames
    }
    else
    {
        model->Reset (sampleRate, maxBlockSize);
    }

    ready.store (true, std::memory_order_release);
}

void NamNode::process (juce::AudioBuffer<float>& mono) noexcept
{
    if (model == nullptr || ! ready.load (std::memory_order_acquire))
        return; // pass dry until a model is loaded + prepared

    const int n = mono.getNumSamples();
    if (n > maxBlock)
        return;

    float* data = mono.getWritePointer (0);
    const float ig = inGain.load (std::memory_order_relaxed);
    const float og = outGain.load (std::memory_order_relaxed);

    if (! resampling)
    {
        if (ig != 1.0f) juce::FloatVectorOperations::multiply (data, ig, n);
        float* in[1]  { data };
        float* out[1] { data };
        model->process (in, out, n); // in-place, allocation-free when n <= maxBlock
        if (og != 1.0f) juce::FloatVectorOperations::multiply (data, og, n);
        return;
    }

    // --- resampled path: up -> inference at model rate -> down -> re-block ---
    const int nUp = up.process (data, n, upBuf.data(), (int) upBuf.size());
    if (ig != 1.0f) juce::FloatVectorOperations::multiply (upBuf.data(), ig, nUp);

    float* in[1]  { upBuf.data() };
    float* out[1] { modelBuf.data() };
    model->process (in, out, nUp);
    if (og != 1.0f) juce::FloatVectorOperations::multiply (modelBuf.data(), og, nUp);

    const int nDown = down.process (modelBuf.data(), nUp, downBuf.data(), (int) downBuf.size());

    // Push into the output FIFO and pull exactly n samples (zero-pad while priming).
    const int canAdd = juce::jmin (nDown, (int) outFifo.size() - outFill);
    if (canAdd > 0) { std::memcpy (outFifo.data() + outFill, downBuf.data(), sizeof (float) * (size_t) canAdd); outFill += canAdd; }

    const int give = juce::jmin (n, outFill);
    if (give > 0) std::memcpy (data, outFifo.data(), sizeof (float) * (size_t) give);
    if (give < n) std::memset (data + give, 0, sizeof (float) * (size_t) (n - give));

    const int rem = outFill - give;
    if (rem > 0) std::memmove (outFifo.data(), outFifo.data() + give, sizeof (float) * (size_t) rem);
    outFill = rem;
}

void NamNode::reset()
{
    if (resampling)
    {
        up.reset();
        down.reset();
        std::fill (outFifo.begin(), outFifo.end(), 0.0f);
        outFill = 0;
    }
}

double NamNode::getExpectedSampleRate() const
{
    return model != nullptr ? model->GetExpectedSampleRate() : -1.0;
}

bool NamNode::sampleRateMatches() const
{
    const double expected = getExpectedSampleRate();
    if (expected <= 0.0)
        return true; // unknown / arbitrary-rate model: assume ok
    return std::abs (expected - hostSampleRate) < 1.0;
}
