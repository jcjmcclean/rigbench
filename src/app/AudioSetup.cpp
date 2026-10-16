#include "AudioSetup.h"

namespace AudioSetup
{

namespace
{
juce::var toVar (const juce::StringArray& a)
{
    juce::Array<juce::var> out;
    for (auto& s : a) out.add (s);
    return out;
}

template <typename T>
juce::var toVar (const juce::Array<T>& a)
{
    juce::Array<juce::var> out;
    for (auto v : a) out.add (v);
    return out;
}

// The one input the guitar is on: the lowest enabled input channel.
int selectedInput (const juce::AudioDeviceManager::AudioDeviceSetup& setup, int numInputs)
{
    const int bit = setup.inputChannels.findNextSetBit (0);
    return (bit >= 0 && bit < numInputs) ? bit : -1;
}
} // namespace

bool looksBuiltIn (const juce::String& name)
{
    const auto n = name.toLowerCase();
    return n.contains ("built-in") || n.contains ("macbook") || n.contains ("imac")
        || n.contains ("internal") || n.contains ("realtek") || n.contains ("microphone array")
        || n == "default" || n.startsWith ("microphone (");
}

juce::var describe (juce::AudioDeviceManager& dm)
{
    auto* o = new juce::DynamicObject();
    juce::var result (o);

    juce::StringArray drivers;
    for (auto* t : dm.getAvailableDeviceTypes())
        drivers.add (t->getTypeName());
    o->setProperty ("drivers", toVar (drivers));
    o->setProperty ("driver", dm.getCurrentAudioDeviceType());

    juce::StringArray inputDevices, outputDevices;
    if (auto* type = dm.getCurrentDeviceTypeObject())
    {
        type->scanForDevices();
        inputDevices = type->getDeviceNames (true);
        outputDevices = type->getDeviceNames (false);
    }
    o->setProperty ("inputDevices", toVar (inputDevices));
    o->setProperty ("outputDevices", toVar (outputDevices));

    const auto setup = dm.getAudioDeviceSetup();
    o->setProperty ("inputDevice", setup.inputDeviceName);
    o->setProperty ("outputDevice", setup.outputDeviceName);
    o->setProperty ("builtInInput", looksBuiltIn (setup.inputDeviceName));

    juce::StringArray inputs;
    juce::Array<double> rates;
    juce::Array<int> buffers;
    double sampleRate = 0.0, latencyMs = 0.0;
    int bufferSize = 0;
    bool listeningToAll = false;

    if (auto* dev = dm.getCurrentAudioDevice())
    {
        inputs = dev->getInputChannelNames();
        rates = dev->getAvailableSampleRates();
        buffers = dev->getAvailableBufferSizes();
        sampleRate = dev->getCurrentSampleRate();
        bufferSize = dev->getCurrentBufferSizeSamples();
        if (sampleRate > 0)
            latencyMs = (2.0 * bufferSize + dev->getInputLatencyInSamples() + dev->getOutputLatencyInSamples())
                        / sampleRate * 1000.0;

        const int open = dev->getActiveInputChannels().countNumberOfSetBits();
        listeningToAll = inputs.size() > 1 && open == juce::jmin (inputs.size(), maxInputs);
    }

    o->setProperty ("inputs", toVar (inputs));
    o->setProperty ("input", listeningToAll ? -1 : selectedInput (setup, inputs.size()));
    o->setProperty ("listeningToAll", listeningToAll);
    o->setProperty ("sampleRate", sampleRate);
    o->setProperty ("sampleRates", toVar (rates));
    o->setProperty ("bufferSize", bufferSize);
    o->setProperty ("bufferSizes", toVar (buffers));
    o->setProperty ("latencyMs", latencyMs);
    o->setProperty ("error", dm.getCurrentAudioDevice() == nullptr && ! inputDevices.isEmpty()
                                 ? juce::String ("Couldn't open the audio device. Check it's plugged in and no other app is using it, then pick it again.") : juce::String());
    return result;
}

juce::String apply (juce::AudioDeviceManager& dm, const juce::var& changes)
{
    if (! changes.isObject())
        return "Nothing to change.";

    // Changing the driver resets the devices to that driver's defaults, so do it
    // first and then apply the rest on top.
    if (changes.hasProperty ("driver"))
    {
        const auto driver = changes["driver"].toString();
        bool known = false;
        for (auto* t : dm.getAvailableDeviceTypes())
            known = known || t->getTypeName() == driver;
        if (! known)
            return "Unknown driver: " + driver;
        if (driver != dm.getCurrentAudioDeviceType())
            dm.setCurrentAudioDeviceType (driver, true);
    }

    auto setup = dm.getAudioDeviceSetup();
    auto* type = dm.getCurrentDeviceTypeObject();

    auto checkDevice = [&] (const juce::var& v, bool isInput, juce::String& into) -> juce::String
    {
        const auto name = v.toString();
        if (type != nullptr && name.isNotEmpty() && ! type->getDeviceNames (isInput).contains (name))
            return "\"" + name + "\" isn't available. Check it's plugged in, then pick it again.";
        into = name;
        return {};
    };

    if (changes.hasProperty ("inputDevice"))
        if (auto err = checkDevice (changes["inputDevice"], true, setup.inputDeviceName); err.isNotEmpty())
            return err;
    if (changes.hasProperty ("outputDevice"))
        if (auto err = checkDevice (changes["outputDevice"], false, setup.outputDeviceName); err.isNotEmpty())
            return err;

    if (changes.hasProperty ("sampleRate"))
    {
        const double sr = changes["sampleRate"];
        if (! (sr > 0.0 && sr <= 768000.0))
            return "That sample rate isn't valid.";
        setup.sampleRate = sr;
    }
    if (changes.hasProperty ("bufferSize"))
    {
        const int bs = changes["bufferSize"];
        if (bs <= 0 || bs > 16384)
            return "That buffer size isn't valid.";
        setup.bufferSize = bs;
    }

    // Inputs: either every input at once (to find the guitar), or exactly one.
    if ((bool) changes.getProperty ("listenToAllInputs", false))
    {
        setup.inputChannels.clear();
        setup.inputChannels.setRange (0, maxInputs, true);
        setup.useDefaultInputChannels = false;
    }
    else if (changes.hasProperty ("input"))
    {
        const int input = changes["input"];
        if (input < 0 || input >= 64)
            return "That input isn't valid.";
        setup.inputChannels.clear();
        setup.inputChannels.setBit (input);
        setup.useDefaultInputChannels = false;
    }

    // Output: always a stereo pair (the mono signal goes to both).
    setup.outputChannels.clear();
    setup.outputChannels.setRange (0, 2, true);
    setup.useDefaultOutputChannels = false;

    const auto err = dm.setAudioDeviceSetup (setup, true);
    return err.isEmpty() ? err : "Couldn't use that setting: " + err;
}

} // namespace AudioSetup
