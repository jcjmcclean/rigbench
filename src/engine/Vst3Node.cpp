#include "Vst3Node.h"

Vst3Node::Vst3Node()
{
    // Free function — the member addDefaultFormats() is = delete in JUCE 8.
    juce::addDefaultFormatsToManager (formatManager);
}

Vst3Node::~Vst3Node()
{
    // Instance is destroyed on the message thread (this node is removed from the
    // chain under the engine lock, so the audio thread is not using it).
    ready.store (false, std::memory_order_release);
    if (instance != nullptr)
        instance->releaseResources();
}

void Vst3Node::loadAsync (const juce::File& file, double sr, int maxBlockSize,
                          std::function<void (bool, juce::String)> onDone)
{
    if (! file.exists())
    {
        onDone (false, "File not found: " + file.getFullPathName());
        return;
    }

    juce::VST3PluginFormat fmt;
    juce::OwnedArray<juce::PluginDescription> found;
    fmt.findAllTypesForFile (found, file.getFullPathName());
    if (found.isEmpty())
    {
        onDone (false, "No VST3 types found in " + file.getFileName());
        return;
    }

    sampleRate = sr;
    maxBlock   = maxBlockSize;
    sourceFile = file;
    identifier = found[0]->createIdentifierString();

    formatManager.createPluginInstanceAsync (*found[0], sr, maxBlockSize,
        [this, cb = std::move (onDone)] (std::unique_ptr<juce::AudioPluginInstance> inst,
                                         const juce::String& err)
        {
            if (inst == nullptr)
            {
                cb (false, err.isNotEmpty() ? err : juce::String ("Failed to create plugin"));
                return;
            }

            prepareInstance (*inst);
            pluginName = inst->getName();
            instance   = std::move (inst);
            ready.store (true, std::memory_order_release);
            cb (true, {});
        });
}

void Vst3Node::prepareInstance (juce::AudioPluginInstance& p)
{
    p.setNonRealtime (false);

    // Prefer true mono->mono; most amp-sim VST3s only offer stereo, so fall back.
    juce::AudioProcessor::BusesLayout mono;
    mono.inputBuses.add  (juce::AudioChannelSet::mono());
    mono.outputBuses.add (juce::AudioChannelSet::mono());

    if (! (p.checkBusesLayoutSupported (mono) && p.setBusesLayout (mono)))
    {
        p.enableAllBuses();
        juce::AudioProcessor::BusesLayout st;
        st.inputBuses.add  (juce::AudioChannelSet::stereo());
        st.outputBuses.add (juce::AudioChannelSet::stereo());
        p.setBusesLayout (st); // best effort
    }

    const int ins  = p.getTotalNumInputChannels();
    const int outs = p.getTotalNumOutputChannels();
    p.setPlayConfigDetails (ins, outs, sampleRate, maxBlock);
    p.setRateAndBufferSizeDetails (sampleRate, maxBlock);
    p.prepareToPlay (sampleRate, maxBlock);

    pluginChans = juce::jmax (ins, outs, 1);
    scratch.setSize (pluginChans, juce::jmax (1, maxBlock), false, true, true);
}

void Vst3Node::prepare (double sr, int maxBlockSize)
{
    if (instance == nullptr)
    {
        sampleRate = sr;
        maxBlock   = maxBlockSize;
        return;
    }

    if (! juce::approximatelyEqual (sr, sampleRate) || maxBlockSize != maxBlock)
    {
        sampleRate = sr;
        maxBlock   = maxBlockSize;
        prepareInstance (*instance);
    }
}

void Vst3Node::process (juce::AudioBuffer<float>& mono) noexcept
{
    if (instance == nullptr || ! ready.load (std::memory_order_acquire))
        return;

    const int n = mono.getNumSamples();
    if (n > maxBlock)
        return;

    const float* in = mono.getReadPointer (0);

    // Feed the mono guitar signal into every plugin input channel.
    for (int ch = 0; ch < pluginChans; ++ch)
        juce::FloatVectorOperations::copy (scratch.getWritePointer (ch), in, n);

    // Wrap scratch at the current block length (no allocation; n <= maxBlock).
    juce::AudioBuffer<float> view (scratch.getArrayOfWritePointers(), pluginChans, n);

    midi.clear();
    instance->processBlock (view, midi);

    // Take the plugin's channel-0 output back out as mono.
    juce::FloatVectorOperations::copy (mono.getWritePointer (0), view.getReadPointer (0), n);
}

void Vst3Node::reset()
{
    if (instance != nullptr)
        instance->reset();
}

juce::String Vst3Node::getStateBase64() const
{
    if (instance == nullptr)
        return {};
    juce::MemoryBlock mb;
    instance->getStateInformation (mb);
    return mb.toBase64Encoding();
}

void Vst3Node::setStateBase64 (const juce::String& b64)
{
    if (instance == nullptr || b64.isEmpty())
        return;
    juce::MemoryBlock mb;
    if (mb.fromBase64Encoding (b64))
        instance->setStateInformation (mb.getData(), (int) mb.getSize());
}
