#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>
#include <cmath>
#include <cstring>

//==============================================================================
// Mono, allocation-free, arbitrary-ratio resampler. Converts a block at srcRate
// into a VARIABLE number of samples at dstRate using a continuous Lagrange
// interpolator + an input FIFO that carries unconsumed samples across blocks
// (glitch-free; never reset between blocks). All buffers sized in prepare().
class RealtimeResampler
{
public:
    void prepare (double srcRate, double dstRate, int maxSrcBlock)
    {
        ratio = srcRate / dstRate;                 // input samples consumed per output sample
        fifoCapacity = maxSrcBlock + 8;
        fifo.assign ((size_t) fifoCapacity, 0.0f);
        fifoFill = 0;
        maxOut = (int) std::ceil ((double) maxSrcBlock / ratio) + 2;
        interp.reset();
    }

    void reset() { interp.reset(); fifoFill = 0; std::fill (fifo.begin(), fifo.end(), 0.0f); }

    int getMaxOutputSamples() const { return maxOut; }
    double getRatio() const { return ratio; }

    // Push an input block; writes produced samples into out (capacity >= getMaxOutputSamples()).
    // Returns the (variable) number of output samples produced.
    int process (const float* in, int numIn, float* out, int outCapacity) noexcept
    {
        if (fifoFill + numIn > fifoCapacity)       // safety clamp (shouldn't happen)
            numIn = fifoCapacity - fifoFill;
        std::memcpy (fifo.data() + fifoFill, in, sizeof (float) * (size_t) numIn);
        fifoFill += numIn;

        int numOut = (int) std::floor (((double) fifoFill - 1.0) / ratio);
        numOut = juce::jlimit (0, outCapacity, numOut);

        if (numOut > 0)
        {
            const int used = interp.process (ratio, fifo.data(), out, numOut, fifoFill, 0);
            const int remaining = fifoFill - used;
            if (remaining > 0)
                std::memmove (fifo.data(), fifo.data() + used, sizeof (float) * (size_t) remaining);
            fifoFill = juce::jmax (0, remaining);
        }
        return numOut;
    }

private:
    juce::LagrangeInterpolator interp;
    std::vector<float> fifo;
    double ratio = 1.0;
    int fifoCapacity = 0, fifoFill = 0, maxOut = 0;
};
