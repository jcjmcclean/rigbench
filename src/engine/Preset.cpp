#include "Preset.h"
#include "IRNode.h"
#include "NamNode.h"
#include "Vst3Node.h"
#include "SlotTypes.h"

namespace Preset
{

namespace
{
// SEC-3: a .tonebench preset is shared freely and can name arbitrary absolute
// paths. Loading NAM/IR content from an attacker-chosen location is a DoS /
// information-disclosure vector (VST3 is full arbitrary-code-execution and is
// gated separately with a consent prompt in the UI layer). Constrain preset-
// referenced content files to locations the user actually controls — their home
// directory, the app-data dir, and the PER-USER (private, mode-0700) temp dir —
// which rejects world-writable /tmp, system dirs, and other users' homes.
bool isAllowedContentPath (const juce::File& f)
{
    if (! f.existsAsFile())
        return false;

    const auto home    = juce::File::getSpecialLocation (juce::File::userHomeDirectory);
    const auto temp    = juce::File::getSpecialLocation (juce::File::tempDirectory);
    const auto appData = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
    return f.isAChildOf (home) || f.isAChildOf (temp) || f.isAChildOf (appData);
}
} // namespace

juce::File presetsDir()
{
    auto d = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                 .getChildFile ("Tonebench").getChildFile ("Presets");
    d.createDirectory();
    return d;
}

bool save (const juce::File& file, const AudioEngine& engine,
           float masterGain, double sampleRate, const juce::String& name)
{
    auto root = std::make_unique<juce::DynamicObject>();
    root->setProperty ("format", "tonebench-preset");
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
    if (! root.isObject() || root.getProperty ("format", {}) != juce::var ("tonebench-preset"))
        return false;

    // Refuse unknown/future schema versions rather than mis-parsing (or crashing) on
    // a layout we don't understand. Only version 1 exists today.
    const int schemaVersion = (int) root.getProperty ("schemaVersion", 0);
    if (schemaVersion != 1)
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

        // Resolve the type string against the single slot-type table (SlotTypes.h).
        const auto* desc = SlotTypes::byId (type);
        if (desc == nullptr)
            continue;

        const juce::File path (s.getProperty ("path", {}).toString());

        if (desc->index == AudioEngine::irSlot)
        {
            if (! isAllowedContentPath (path))   // SEC-3
                continue;
            auto ir = std::make_unique<IRNode>();
            if (ir->loadFile (path))
            {
                ir->setMix ((float) (double) s.getProperty ("mix", 1.0));
                ir->setBypassed (! enabled);
                engine.setNode (slot, std::move (ir));
            }
        }
        else if (desc->index == AudioEngine::namSlot)
        {
            if (! isAllowedContentPath (path))   // SEC-3
                continue;
            auto nam = std::make_unique<NamNode>();
            juce::String err;
            if (nam->loadFile (path, err))
            {
                nam->setBypassed (! enabled);
                engine.setNode (slot, std::move (nam));
            }
        }
        else if (desc->index == AudioEngine::vst3Slot)
        {
            // SEC-3: VST3 = arbitrary code execution. Do NOT load here; hand the
            // slot to the UI, which requires explicit user consent (see
            // WebUIComponent::loadPreset) before instantiating the bundle.
            if (installVst)
                installVst (VstSlot {
                    slot, enabled,
                    path,
                    s.getProperty ("identifier", {}).toString(),
                    s.getProperty ("state", {}).toString() });
        }
    }
    return true;
}

} // namespace Preset
