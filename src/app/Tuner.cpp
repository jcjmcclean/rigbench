#include "Tuner.h"
#include <cmath>

void Tuner::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0 ? newSampleRate : 48000.0;
    // Enough for two periods of the lowest note, rounded to keep the maths quick.
    windowSamples = juce::jlimit (512, ringSize / 2, juce::nextPowerOfTwo ((int) (sampleRate * 2.0 / minHz)));
    scratch.assign ((size_t) ringSize, 0.0f);
}

void Tuner::push (const float* samples, int num) noexcept
{
    if (! isActive())
        return;

    // Single writer; the reader copies a window behind writePos. A torn read at
    // the seam only ever costs one noisy reading.
    int pos = writePos.load (std::memory_order_relaxed);
    for (int i = 0; i < num; ++i)
    {
        ring[(size_t) pos] = samples[i];
        pos = (pos + 1) & (ringSize - 1);
    }
    writePos.store (pos, std::memory_order_release);
}

std::optional<Tuner::Reading> Tuner::read()
{
    if (! isActive() || scratch.empty())
        return std::nullopt;

    const int end = writePos.load (std::memory_order_acquire);
    const int n = windowSamples;
    for (int i = 0; i < n; ++i)
        scratch[(size_t) i] = ring[(size_t) ((end - n + i + ringSize) & (ringSize - 1))];

    const double hz = detectPitch (scratch.data(), n, sampleRate);
    if (hz <= 0.0)
        return std::nullopt;
    return describe (hz);
}

double Tuner::detectPitch (const float* x, int n, double rate)
{
    if (n < 64 || rate <= 0)
        return 0.0;

    // Too quiet to be a played note (about -50 dBFS peak).
    float peak = 0.0f;
    for (int i = 0; i < n; ++i)
        peak = std::max (peak, std::abs (x[i]));
    if (peak < 0.003f)
        return 0.0;

    // Decimate by 2 (averaging pairs is enough of a low-pass for pitch) to halve
    // the work; guitar fundamentals are far below the new Nyquist.
    const int m = n / 2;
    const double r = rate / 2.0;
    std::vector<float> y ((size_t) m);
    for (int i = 0; i < m; ++i)
        y[(size_t) i] = 0.5f * (x[2 * i] + x[2 * i + 1]);

    // YIN (de Cheveigné & Kawahara 2002): difference function, cumulative mean
    // normalised, first dip under the threshold, parabolic interpolation.
    const int tauMin = std::max (2, (int) std::floor (r / maxHz));
    const int tauMax = std::min (m / 2, (int) std::ceil (r / minHz));
    if (tauMax <= tauMin + 2)
        return 0.0;

    const int w = m - tauMax;
    std::vector<double> d ((size_t) tauMax + 1, 0.0);
    for (int tau = 1; tau <= tauMax; ++tau)
    {
        double sum = 0.0;
        for (int i = 0; i < w; ++i)
        {
            const double diff = (double) y[(size_t) i] - (double) y[(size_t) (i + tau)];
            sum += diff * diff;
        }
        d[(size_t) tau] = sum;
    }

    std::vector<double> cmnd ((size_t) tauMax + 1, 1.0);
    double running = 0.0;
    for (int tau = 1; tau <= tauMax; ++tau)
    {
        running += d[(size_t) tau];
        cmnd[(size_t) tau] = running > 0.0 ? d[(size_t) tau] * tau / running : 1.0;
    }

    constexpr double threshold = 0.15;
    int best = -1;
    for (int tau = tauMin; tau < tauMax; ++tau)
    {
        if (cmnd[(size_t) tau] < threshold)
        {
            while (tau + 1 < tauMax && cmnd[(size_t) tau + 1] < cmnd[(size_t) tau])
                ++tau;
            best = tau;
            break;
        }
    }
    if (best < 0)
        return 0.0;   // not clearly pitched (noise, chords)

    // Refine at the full rate: the half-rate period is only ~20 samples for high
    // notes, too coarse for cent accuracy. Find the dip of the difference
    // function around 2 * best, then interpolate between neighbours.
    const int lo = std::max (1, 2 * best - 3), hi = std::min (n / 2 - 1, 2 * best + 3);
    const int fw = n - hi - 1;
    auto diffAt = [&] (int tau)
    {
        double sum = 0.0;
        for (int i = 0; i < fw; ++i)
        {
            const double dlt = (double) x[i] - (double) x[i + tau];
            sum += dlt * dlt;
        }
        return sum;
    };

    std::vector<double> fd ((size_t) (hi - lo + 1));
    int fb = lo;
    for (int tau = lo; tau <= hi; ++tau)
    {
        fd[(size_t) (tau - lo)] = diffAt (tau);
        if (fd[(size_t) (tau - lo)] < fd[(size_t) (fb - lo)])
            fb = tau;
    }

    double period = fb;
    if (fb > lo && fb < hi)
    {
        const double a = fd[(size_t) (fb - lo - 1)], b = fd[(size_t) (fb - lo)], c = fd[(size_t) (fb - lo + 1)];
        const double denom = a - 2.0 * b + c;
        if (std::abs (denom) > 1e-12)
            period = fb + 0.5 * (a - c) / denom;
    }

    const double hz = rate / period;
    return (hz >= minHz && hz <= maxHz) ? hz : 0.0;
}

Tuner::Reading Tuner::describe (double hz, double a4)
{
    static const char* names[] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };

    Reading r;
    r.hz = hz;
    const double midi = 69.0 + 12.0 * std::log2 (hz / a4);
    r.midiNote = (int) std::lround (midi);
    r.cents = (midi - r.midiNote) * 100.0;
    r.noteName = names[((r.midiNote % 12) + 12) % 12];
    r.octave = r.midiNote / 12 - 1;
    return r;
}
