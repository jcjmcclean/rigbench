#include "Preset.h"
#include "AppPaths.h"
#include "IRNode.h"
#include "NamNode.h"
#include "Vst3Node.h"
#include "SlotTypes.h"
#include <cmath>

namespace Preset
{

namespace
{
// SEC-3: a .tonebench preset is shared freely and can name arbitrary absolute
// paths. Loading NAM/IR content from an attacker-chosen location is a DoS /
// information-disclosure vector (VST3 is full arbitrary-code-execution and is
// gated separately with a consent prompt in the UI layer). Constrain preset-
// referenced content files to locations the user actually controls — their home
// directory, the app-data dir, a per-user temp dir, and external drives — which
// rejects world-writable /tmp, system folders, and installed programs.
bool isAllowedContentPath (const juce::File& f)
{
    if (! f.existsAsFile())
        return false;

    const auto home    = juce::File::getSpecialLocation (juce::File::userHomeDirectory);
    const auto appData = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
    if (f.isAChildOf (home) || f.isAChildOf (appData))
        return true;

    // The temp dir only when it's private to this user: on Linux JUCE falls back
    // to the shared, world-writable /tmp.
    const auto temp = juce::File::getSpecialLocation (juce::File::tempDirectory);
    if (f.isAChildOf (temp) && temp != juce::File ("/tmp"))
        return true;

    // Sample libraries often live on another drive.
   #if JUCE_MAC
    return f.isAChildOf (juce::File ("/Volumes"));
   #elif JUCE_LINUX
    return f.isAChildOf (juce::File ("/media")) || f.isAChildOf (juce::File ("/mnt"))
        || f.isAChildOf (juce::File ("/run/media"));
   #elif JUCE_WINDOWS
    // Any drive, but not Windows itself or installed programs.
    const auto windows = juce::File::getSpecialLocation (juce::File::windowsSystemDirectory).getParentDirectory();
    const auto programs = juce::File::getSpecialLocation (juce::File::globalApplicationsDirectory);
    return ! f.isAChildOf (windows) && ! f.isAChildOf (programs);
   #else
    return false;
   #endif
}

// "the amp model", "the cab IR": how a slot is named in messages to the user.
juce::String describeSlot (int index)
{
    switch (index)
    {
        case AudioEngine::vst3Slot: return "the plugin";
        case AudioEngine::namSlot:  return "the amp model";
        case AudioEngine::irSlot:   return "the cab IR";
        default:                    return "a slot";
    }
}
} // namespace

juce::File presetsDir()
{
    auto d = AppPaths::dataDir().getChildFile ("Presets");
    d.createDirectory();
    return d;
}

bool save (const juce::File& file, const AudioEngine& engine, const RigInfo& info)
{
    auto root = std::make_unique<juce::DynamicObject>();
    root->setProperty ("format", "tonebench-preset");
    root->setProperty ("schemaVersion", 1);
    root->setProperty ("name", info.name.isNotEmpty() ? info.name : file.getFileNameWithoutExtension());

    auto io = std::make_unique<juce::DynamicObject>();
    io->setProperty ("inputGain", info.inputGain);
    io->setProperty ("masterGain", info.masterGain);
    io->setProperty ("sampleRateAtSave", info.sampleRateAtSave);
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
            s->setProperty ("level", (double) nam->getUiGain());
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

    // Gains come from a shared file: clamp to the 0..1 the UI works in, and fall
    // back to the default for anything non-finite.
    auto unit = [] (const juce::var& v, double fallback)
    {
        const double d = v.isVoid() ? fallback : (double) v;
        return (float) (std::isfinite (d) ? juce::jlimit (0.0, 1.0, d) : fallback);
    };

    const auto ioVar = root.getProperty ("io", juce::var());
    info.inputGain       = unit (ioVar.getProperty ("inputGain", {}), 0.8);
    info.masterGain      = unit (ioVar.getProperty ("masterGain", {}), 0.8);
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
        if (! s.isObject())
            continue;

        // The type decides the slot (SlotTypes.h is the single table); the "slot"
        // field is only sanity-checked, so a preset can't put an amp model in the
        // cab slot.
        const auto type = s.getProperty ("type", {}).toString();
        const auto* desc = SlotTypes::byId (type);
        if (desc == nullptr)
        {
            info.problems.add ("Skipped a slot of a type Tonebench doesn't know (\"" + type + "\").");
            continue;
        }
        const int slot = desc->index;
        const int savedSlot = (int) s.getProperty ("slot", slot);
        if (savedSlot < 0 || savedSlot >= AudioEngine::numSlots)
            continue;

        const bool enabled = (bool) s.getProperty ("enabled", true);
        const juce::File path (s.getProperty ("path", {}).toString());
        const auto what = describeSlot (slot) + " \"" + path.getFileName() + "\"";

        if (slot != AudioEngine::vst3Slot)
        {
            if (! path.existsAsFile())
            {
                info.problems.add (what.substring (0, 1).toUpperCase() + what.substring (1) + " wasn't found.");
                continue;
            }
            if (! isAllowedContentPath (path))   // SEC-3
            {
                info.problems.add ("Skipped " + what + ": it's outside your own folders.");
                continue;
            }
        }

        if (slot == AudioEngine::irSlot)
        {
            auto ir = std::make_unique<IRNode>();
            if (! ir->loadFile (path))
            {
                info.problems.add ("Couldn't load " + what + ".");
                continue;
            }
            ir->setMix (unit (s.getProperty ("mix", {}), 1.0));
            ir->setBypassed (! enabled);
            engine.setNode (slot, std::move (ir));
        }
        else if (slot == AudioEngine::namSlot)
        {
            auto nam = std::make_unique<NamNode>();
            juce::String err;
            if (! nam->loadFile (path, err))
            {
                info.problems.add ("Couldn't load " + what + (err.isNotEmpty() ? ": " + err : juce::String()) + ".");
                continue;
            }
            nam->setUiGain (unit (s.getProperty ("level", {}), 0.5));
            nam->setBypassed (! enabled);
            engine.setNode (slot, std::move (nam));
        }
        else
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
