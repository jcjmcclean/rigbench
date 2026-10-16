#include "Preset.h"
#include "IRNode.h"
#include "NamNode.h"
#include "Vst3Node.h"

namespace Preset
{

juce::File presetsDir()
{
    auto d = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                 .getChildFile ("ToneStack").getChildFile ("Presets");
    d.createDirectory();
    return d;
}

bool save (const juce::File& file, const AudioEngine& engine,
           float masterGain, double sampleRate, const juce::String& name)
{
    auto root = std::make_unique<juce::DynamicObject>();
    root->setProperty ("format", "tonestack-preset");
    root->setProperty ("schemaVersion", 1);
    root->setProperty ("name", name.isNotEmpty() ? name : file.getFileNameWithoutExtension());

    auto io = std::make_unique<juce::DynamicObject>();
    io->setProperty ("masterGain", masterGain);
    io->setProperty ("sampleRateAtSave", sampleRate);
    root->setProperty ("io", juce::var (io.release()));

    juce::Array<juce::var> chain;
    for (int slot = 0; slot < AudioEngine::numSlots; ++slot)
    {
        auto* node = engine.getNode (slot);
        if (node == nullptr)
            continue;

        auto s = std::make_unique<juce::DynamicObject>();
        s->setProperty ("slot", slot);
        s->setProperty ("type", node->getTypeName().toLowerCase());
        s->setProperty ("enabled", ! node->isBypassed());

        if (auto* ir = dynamic_cast<IRNode*> (node))
        {
            s->setProperty ("path", ir->getSourceFile().getFullPathName());
            s->setProperty ("mix", (double) ir->getMix());
        }
        else if (auto* nam = dynamic_cast<NamNode*> (node))
        {
            s->setProperty ("path", nam->getSourceFile().getFullPathName());
        }
        else if (auto* vst = dynamic_cast<Vst3Node*> (node))
        {
            s->setProperty ("path", vst->getSourceFile().getFullPathName());
            s->setProperty ("identifier", vst->getIdentifier());
            s->setProperty ("state", vst->getStateBase64());
        }

        chain.add (juce::var (s.release()));
    }
    root->setProperty ("chain", chain);

    const auto json = juce::JSON::toString (juce::var (root.release()),
                        juce::JSON::FormatOptions().withSpacing (juce::JSON::Spacing::multiLine));
    return file.replaceWithText (json);
}

bool load (const juce::File& file, AudioEngine& engine, double sampleRate, int maxBlock,
           RigInfo& info, std::function<void (const VstSlot&)> installVst)
{
    juce::ignoreUnused (maxBlock);

    const auto root = juce::JSON::parse (file);
    if (! root.isObject() || root.getProperty ("format", {}) != juce::var ("tonestack-preset"))
        return false;

    const auto ioVar = root.getProperty ("io", juce::var());
    info.masterGain      = (float) (double) ioVar.getProperty ("masterGain", 0.8);
    info.sampleRateAtSave = (double) ioVar.getProperty ("sampleRateAtSave", sampleRate);
    info.name            = root.getProperty ("name", {}).toString();

    // Clear all slots first so a partial preset doesn't leave stale nodes.
    for (int i = 0; i < AudioEngine::numSlots; ++i)
        engine.setNode (i, nullptr);

    const auto chain = root.getProperty ("chain", juce::var());
    auto* arr = chain.getArray();
    if (arr == nullptr)
        return true;

    for (const auto& s : *arr)
    {
        const int slot      = (int) s.getProperty ("slot", -1);
        const auto type     = s.getProperty ("type", {}).toString();
        const bool enabled  = (bool) s.getProperty ("enabled", true);
        if (slot < 0 || slot >= AudioEngine::numSlots)
            continue;

        if (type == "ir")
        {
            auto ir = std::make_unique<IRNode>();
            if (ir->loadFile (juce::File (s.getProperty ("path", {}).toString())))
            {
                ir->setMix ((float) (double) s.getProperty ("mix", 1.0));
                ir->setBypassed (! enabled);
                engine.setNode (slot, std::move (ir));
            }
        }
        else if (type == "nam")
        {
            auto nam = std::make_unique<NamNode>();
            juce::String err;
            if (nam->loadFile (juce::File (s.getProperty ("path", {}).toString()), err))
            {
                nam->setBypassed (! enabled);
                engine.setNode (slot, std::move (nam));
            }
        }
        else if (type == "vst3")
        {
            if (installVst)
                installVst (VstSlot {
                    slot, enabled,
                    juce::File (s.getProperty ("path", {}).toString()),
                    s.getProperty ("identifier", {}).toString(),
                    s.getProperty ("state", {}).toString() });
        }
    }
    return true;
}

} // namespace Preset
