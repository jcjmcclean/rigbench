#include "RigController.h"
#include "PresetNames.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/SlotTypes.h"
#include "engine/Vst3Node.h"
#include <cmath>

RigController::RigController (juce::File presetsDirectory, juce::File settingsFile)
    : presetsDir (std::move (presetsDirectory)),
      settings (std::move (settingsFile))
{
    presetsDir.createDirectory();
    audio.setMonitoring (settings.isSetupComplete());
}

void RigController::finishSetup()
{
    settings.setSetupComplete (true);
    audio.setMonitoring (true);
}

RigController::~RigController() = default;

float RigController::clampUnit (const juce::var& v)
{
    const double d = (double) v;
    return std::isfinite (d) ? (float) juce::jlimit (0.0, 1.0, d) : 0.0f;
}

//==============================================================================
void RigController::clearSlot (const juce::String& slotId)
{
    const int s = SlotTypes::indexForId (slotId);
    if (s >= 0)
        engine.setNode (s, nullptr);
}

void RigController::setBypass (const juce::String& slotId, bool bypassed)
{
    if (auto* node = engine.getNode (SlotTypes::indexForId (slotId)))
        node->setBypassed (bypassed);
}

void RigController::setMix (const juce::String& slotId, const juce::var& value)
{
    if (auto* ir = dynamic_cast<IRNode*> (engine.getNode (SlotTypes::indexForId (slotId))))
        ir->setMix (clampUnit (value));
}

void RigController::setGain (const juce::String& slotId, const juce::var& value)
{
    if (auto* nam = dynamic_cast<NamNode*> (engine.getNode (SlotTypes::indexForId (slotId))))
        nam->setUiGain (clampUnit (value));
}

void RigController::setInput (const juce::var& value)  { audio.setInputGain (clampUnit (value)); }
void RigController::setMaster (const juce::var& value) { audio.setMasterGain (clampUnit (value)); }
void RigController::setMonitor (bool on)               { audio.setMonitoring (on); }

//==============================================================================
juce::String RigController::loadNam (const juce::File& file)
{
    auto nam = std::make_unique<NamNode>();
    juce::String err;
    if (! nam->loadFile (file, err))
        return "Could not load NAM model: " + (err.isNotEmpty() ? err : juce::String ("unknown error"));

    engine.setNode (AudioEngine::namSlot, std::move (nam));
    return {};
}

juce::String RigController::loadIR (const juce::File& file)
{
    auto ir = std::make_unique<IRNode>();
    if (! ir->loadFile (file))
        return "Could not load impulse response: " + file.getFileName();

    engine.setNode (AudioEngine::irSlot, std::move (ir));
    return {};
}

void RigController::installVst (std::unique_ptr<Vst3Node> node)
{
    engine.setNode (AudioEngine::vst3Slot, std::move (node));
}

//==============================================================================
juce::StringArray RigController::listPresets() const
{
    return PresetNames::list (presetsDir);
}

juce::String RigController::savePreset (const juce::String& name)
{
    const auto file = PresetNames::presetFileFor (presetsDir, name);   // SEC-2
    if (file == juce::File())
        return "Invalid preset name.";

    Preset::RigInfo info;
    info.inputGain  = audio.getInputGain();
    info.masterGain = audio.getMasterGain();
    info.sampleRateAtSave = engine.getSampleRate();
    info.name = name;

    if (! Preset::save (file, engine, info))
        return "Could not save preset \"" + name + "\".";

    activePreset = name;
    return {};
}

juce::String RigController::loadPreset (const juce::String& name,
                                        std::function<void (const Preset::VstSlot&)> installVstSlot)
{
    const auto file = PresetNames::presetFileFor (presetsDir, name);   // SEC-2
    if (file == juce::File())
        return "Invalid preset name.";

    Preset::RigInfo info;
    if (! Preset::load (file, engine, engine.getSampleRate(), engine.getMaxBlockSize(), info,
                        std::move (installVstSlot)))
        return "Could not load preset \"" + name + "\".";

    audio.setInputGain (info.inputGain);
    audio.setMasterGain (info.masterGain);
    activePreset = name;

    if (info.problems.isEmpty())
        return {};
    return "Loaded \"" + name + "\", but " + info.problems.joinIntoString (" ").replaceFirstOccurrenceOf ("The ", "the ");
}

//==============================================================================
juce::var RigController::slotState (int index, const char* id) const
{
    auto* o = new juce::DynamicObject();
    auto* node = engine.getNode (index);
    const bool loaded = node != nullptr;

    o->setProperty ("type", id);
    o->setProperty ("loaded", loaded);
    o->setProperty ("name", loaded ? node->getSourceName() : juce::String());
    o->setProperty ("bypassed", loaded && node->isBypassed());

    if (auto* ir = dynamic_cast<IRNode*> (node))   o->setProperty ("mix", (double) ir->getMix());
    if (auto* nam = dynamic_cast<NamNode*> (node)) o->setProperty ("gain", (double) nam->getUiGain());
    if (index == AudioEngine::vst3Slot)            o->setProperty ("hasEditor", loaded);

    return juce::var (o);
}

juce::var RigController::buildState (const DeviceInfo& device, float inputLevel, float outputLevel) const
{
    auto* o = new juce::DynamicObject();

    o->setProperty ("device", device.name);
    o->setProperty ("sampleRate", device.sampleRate);
    o->setProperty ("bufferSize", device.bufferSize);
    o->setProperty ("roundTripMs", device.roundTripMs);

    o->setProperty ("setupComplete", settings.isSetupComplete());
    o->setProperty ("monitoring", audio.isMonitoring());
    o->setProperty ("playing", audio.isMonitoring());
    o->setProperty ("inputGain", (double) audio.getInputGain());
    o->setProperty ("masterGain", (double) audio.getMasterGain());
    o->setProperty ("inputLevel", inputLevel);
    o->setProperty ("outputLevel", outputLevel);

    auto* slots = new juce::DynamicObject();
    for (auto& d : SlotTypes::table())
        slots->setProperty (d.id, slotState (d.index, d.id));
    o->setProperty ("slots", juce::var (slots));

    juce::Array<juce::var> presets;
    for (auto& p : listPresets())
        presets.add (p);
    o->setProperty ("presets", presets);
    o->setProperty ("activePreset", activePreset.isEmpty() ? juce::var() : juce::var (activePreset));

    return juce::var (o);
}
