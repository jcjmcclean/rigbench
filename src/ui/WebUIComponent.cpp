#include "WebUIComponent.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"
#include "engine/Preset.h"
#include "BinaryData.h"

#include <unordered_map>

using Resource = juce::WebBrowserComponent::Resource;
using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

namespace
{
constexpr int kMinBlockAlloc = 4096;

int slotIndex (const juce::String& type)
{
    if (type == "vst3") return AudioEngine::vst3Slot;
    if (type == "nam")  return AudioEngine::namSlot;
    if (type == "ir")   return AudioEngine::irSlot;
    return -1;
}

const char* mimeForExt (const juce::String& ext)
{
    static const std::unordered_map<std::string, const char*> m {
        {"html","text/html"}, {"js","text/javascript"}, {"mjs","text/javascript"},
        {"css","text/css"}, {"json","application/json"}, {"map","application/json"},
        {"svg","image/svg+xml"}, {"png","image/png"}, {"jpg","image/jpeg"},
        {"jpeg","image/jpeg"}, {"ico","image/vnd.microsoft.icon"},
        {"woff","font/woff"}, {"woff2","font/woff2"}, {"wasm","application/wasm"} };
    auto it = m.find (ext.toLowerCase().toStdString());
    return it != m.end() ? it->second : "application/octet-stream";
}

juce::ZipFile* getWebZip()
{
    static std::unique_ptr<juce::MemoryInputStream> stream = []() -> std::unique_ptr<juce::MemoryInputStream>
    {
        int sz = 0;
        auto* d = BinaryData::getNamedResource ("webui_zip", sz);
        return d != nullptr ? std::make_unique<juce::MemoryInputStream> (d, (size_t) sz, false) : nullptr;
    }();
    static std::unique_ptr<juce::ZipFile> zip = stream != nullptr ? std::make_unique<juce::ZipFile> (*stream) : nullptr;
    return zip.get();
}

// Host the plugin's own editor; destroyed before the plugin instance.
class PluginEditorWindow final : public juce::DocumentWindow
{
public:
    PluginEditorWindow (juce::AudioPluginInstance& p, std::function<void()> onClose)
        : juce::DocumentWindow (p.getName(), juce::Colour (0xff141210), juce::DocumentWindow::closeButton),
          closeCb (std::move (onClose))
    {
        setUsingNativeTitleBar (true);
        juce::AudioProcessorEditor* ui = p.hasEditor() ? p.createEditorAndMakeActive() : nullptr;
        if (ui == nullptr)
            ui = new juce::GenericAudioProcessorEditor (p);
        setContentOwned (ui, true);
        setResizable (ui->isResizable(), false);
        centreWithSize (juce::jmax (320, getWidth()), juce::jmax (200, getHeight()));
        setVisible (true);
    }
    ~PluginEditorWindow() override { clearContentComponent(); }
    void closeButtonPressed() override { if (closeCb) closeCb(); }
private:
    std::function<void()> closeCb;
};
} // namespace

//==============================================================================
WebUIComponent::WebUIComponent()
{
    using Options = juce::WebBrowserComponent::Options;

    auto fileCmd = [this] (void (WebUIComponent::*)(const juce::File&)) {};
    juce::ignoreUnused (fileCmd);

    auto cmd0 = [] (Completion done) { done (juce::var()); };
    juce::ignoreUnused (cmd0);

    Options options = Options{}
        .withNativeIntegrationEnabled()
        .withResourceProvider ([this] (const auto& p) { return provideResource (p); })
        .withNativeFunction ("getState", [this] (const juce::Array<juce::var>&, Completion done)
            { done (buildStateVar()); })
        .withNativeFunction ("loadSlot", [this] (const juce::Array<juce::var>& a, Completion done)
            { if (! a.isEmpty()) loadSlotChooser (a[0].toString()); done (juce::var()); })
        .withNativeFunction ("clearSlot", [this] (const juce::Array<juce::var>& a, Completion done)
            { const int s = slotIndex (a.isEmpty() ? juce::String() : a[0].toString());
              if (s >= 0) { engine.setNode (s, nullptr); markDirty(); } done (juce::var()); })
        .withNativeFunction ("setBypass", [this] (const juce::Array<juce::var>& a, Completion done)
            { const int s = slotIndex (a[0].toString());
              if (auto* n = engine.getNode (s)) n->setBypassed ((bool) a[1]); markDirty(); done (juce::var()); })
        .withNativeFunction ("setMix", [this] (const juce::Array<juce::var>& a, Completion done)
            { if (auto* ir = dynamic_cast<IRNode*> (engine.getNode (slotIndex (a[0].toString()))))
                  ir->setMix ((float) (double) a[1]); markDirty(); done (juce::var()); })
        .withNativeFunction ("setGain", [this] (const juce::Array<juce::var>& a, Completion done)
            { if (auto* nam = dynamic_cast<NamNode*> (engine.getNode (slotIndex (a[0].toString()))))
                  nam->setUiGain ((float) (double) a[1]); markDirty(); done (juce::var()); })
        .withNativeFunction ("setInput", [this] (const juce::Array<juce::var>& a, Completion done)
            { inputGain.store ((float) (double) a[0]); markDirty(); done (juce::var()); })
        .withNativeFunction ("setMaster", [this] (const juce::Array<juce::var>& a, Completion done)
            { masterGain.store ((float) (double) a[0]); markDirty(); done (juce::var()); })
        .withNativeFunction ("setMonitor", [this] (const juce::Array<juce::var>& a, Completion done)
            { monitorOn.store ((bool) a[0]); markDirty(); done (juce::var()); })
        .withNativeFunction ("openEditor", [this] (const juce::Array<juce::var>&, Completion done)
            { openVstEditorWindow(); done (juce::var()); })
        .withNativeFunction ("openAudioSettings", [this] (const juce::Array<juce::var>&, Completion done)
            { openAudioSettings(); done (juce::var()); })
        .withNativeFunction ("savePreset", [this] (const juce::Array<juce::var>& a, Completion done)
            { if (! a.isEmpty()) savePreset (a[0].toString()); done (juce::var()); })
        .withNativeFunction ("loadPreset", [this] (const juce::Array<juce::var>& a, Completion done)
            { if (! a.isEmpty()) loadPreset (a[0].toString()); done (juce::var()); });

    web = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*web);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setSize (1180, 760);

    // Restore the audio device from last session (device, rate, buffer).
    std::unique_ptr<juce::XmlElement> savedAudio (juce::XmlDocument::parse (audioSettingsFile()));
    setAudioChannels (2, 2, savedAudio.get());
    deviceManager.addChangeListener (this);

    startTimerHz (30);
}

WebUIComponent::~WebUIComponent()
{
    deviceManager.removeChangeListener (this);
    editorWindow = nullptr;
    shutdownAudio();
}

juce::File WebUIComponent::audioSettingsFile() const
{
    auto dir = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                   .getChildFile ("ToneStack");
    dir.createDirectory();
    return dir.getChildFile ("audio-settings.xml");
}

void WebUIComponent::changeListenerCallback (juce::ChangeBroadcaster*)
{
    // Persist the device setup whenever it changes, and refresh the UI telemetry.
    if (auto xml = deviceManager.createStateXml())
        xml->writeTo (audioSettingsFile());
    markDirty();
}

//==============================================================================
void WebUIComponent::prepareToPlay (int samplesPerBlockExpected, double sampleRate)
{
    const int alloc = juce::jmax (samplesPerBlockExpected, kMinBlockAlloc);
    monoBuffer.setSize (1, alloc, false, false, true);
    engine.prepare (sampleRate, alloc);
    markDirty();
}

void WebUIComponent::getNextAudioBlock (const juce::AudioSourceChannelInfo& bufferToFill)
{
    auto* buffer = bufferToFill.buffer;
    const int start = bufferToFill.startSample;
    const int num = bufferToFill.numSamples;
    const int numOut = buffer->getNumChannels();

    if (! monitorOn.load (std::memory_order_relaxed) || num > monoBuffer.getNumSamples())
    {
        bufferToFill.clearActiveBufferRegion();
        inPeak.store (0.0f); outPeak.store (0.0f);
        return;
    }

    monoBuffer.copyFrom (0, 0, *buffer, 0, start, num);
    const float ig = inputGain.load (std::memory_order_relaxed);
    if (ig != 1.0f)
        monoBuffer.applyGain (0, 0, num, ig);
    inPeak.store (monoBuffer.getMagnitude (0, 0, num), std::memory_order_relaxed);

    float* chans[1] = { monoBuffer.getWritePointer (0) };
    juce::AudioBuffer<float> work (chans, 1, num);
    engine.processBlock (work);

    const float g = masterGain.load (std::memory_order_relaxed);
    for (int ch = 0; ch < numOut; ++ch)
    {
        buffer->copyFrom (ch, start, work, 0, 0, num);
        buffer->applyGain (ch, start, num, g);
    }
    outPeak.store (work.getMagnitude (0, 0, num) * g, std::memory_order_relaxed);
}

void WebUIComponent::releaseResources()
{
    engine.releaseResources();
}

void WebUIComponent::resized()
{
    if (web != nullptr)
        web->setBounds (getLocalBounds());
}

//==============================================================================
void WebUIComponent::timerCallback()
{
    // Smooth meters: fast attack, slow release.
    auto smooth = [] (float& s, float target)
    {
        s = target > s ? target : s * 0.80f + target * 0.20f;
    };
    smooth (smoothedIn, inPeak.load (std::memory_order_relaxed));
    smooth (smoothedOut, outPeak.load (std::memory_order_relaxed));

    if (! didAutoLoad && ++ticks >= 4)
    {
        didAutoLoad = true;
        devAutoLoad();
    }

    if (web == nullptr)
        return;

    auto* mo = new juce::DynamicObject();
    mo->setProperty ("inputLevel", smoothedIn);
    mo->setProperty ("outputLevel", smoothedOut);
    mo->setProperty ("playing", monitorOn.load());
    web->emitEventIfBrowserIsVisible ("meters", juce::var (mo));

    if (stateDirty)
    {
        stateDirty = false;
        web->emitEventIfBrowserIsVisible ("state", buildStateVar());
    }
}

//==============================================================================
static juce::var slotVar (AudioEngine& engine, int idx, const char* type)
{
    auto* o = new juce::DynamicObject();
    auto* node = engine.getNode (idx);
    const bool loaded = node != nullptr;
    o->setProperty ("type", type);
    o->setProperty ("loaded", loaded);
    o->setProperty ("name", loaded ? node->getSourceName() : juce::String());
    o->setProperty ("bypassed", loaded && node->isBypassed());
    if (auto* ir = dynamic_cast<IRNode*> (node))   o->setProperty ("mix", (double) ir->getMix());
    if (auto* nam = dynamic_cast<NamNode*> (node))  o->setProperty ("gain", (double) nam->getUiGain());
    if (juce::String (type) == "vst3")             o->setProperty ("hasEditor", loaded);
    return juce::var (o);
}

juce::var WebUIComponent::buildStateVar()
{
    auto* o = new juce::DynamicObject();

    if (auto* dev = deviceManager.getCurrentAudioDevice())
    {
        const double sr = dev->getCurrentSampleRate();
        o->setProperty ("device", dev->getName());
        o->setProperty ("sampleRate", sr);
        o->setProperty ("bufferSize", dev->getCurrentBufferSizeSamples());
        o->setProperty ("roundTripMs", sr > 0 ? (dev->getInputLatencyInSamples() + dev->getOutputLatencyInSamples()) / sr * 1000.0 : 0.0);
    }
    else
    {
        o->setProperty ("device", "No device");
        o->setProperty ("sampleRate", 0);
        o->setProperty ("bufferSize", 0);
        o->setProperty ("roundTripMs", 0);
    }

    o->setProperty ("monitoring", monitorOn.load());
    o->setProperty ("inputGain", (double) inputGain.load());
    o->setProperty ("masterGain", (double) masterGain.load());
    o->setProperty ("playing", monitorOn.load());
    o->setProperty ("inputLevel", smoothedIn);
    o->setProperty ("outputLevel", smoothedOut);

    auto* slots = new juce::DynamicObject();
    slots->setProperty ("vst3", slotVar (engine, AudioEngine::vst3Slot, "vst3"));
    slots->setProperty ("nam",  slotVar (engine, AudioEngine::namSlot,  "nam"));
    slots->setProperty ("ir",   slotVar (engine, AudioEngine::irSlot,   "ir"));
    o->setProperty ("slots", juce::var (slots));

    juce::Array<juce::var> presets;
    for (auto& f : Preset::presetsDir().findChildFiles (juce::File::findFiles, false, "*.tonestack"))
        presets.add (f.getFileNameWithoutExtension());
    o->setProperty ("presets", presets);
    o->setProperty ("activePreset", activePreset.isEmpty() ? juce::var() : juce::var (activePreset));

    return juce::var (o);
}

//==============================================================================
void WebUIComponent::loadSlotChooser (const juce::String& type)
{
    const juce::String title = type == "vst3" ? "Load a VST3 plugin"
                             : type == "nam"  ? "Load a NAM model"
                                              : "Load an impulse response";
    const juce::File start = type == "vst3" ? juce::File ("/Library/Audio/Plug-Ins/VST3")
                           : type == "nam"  ? juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                                            : juce::File();
    const juce::String filter = type == "vst3" ? "*.vst3" : type == "nam" ? "*.nam" : "*.wav;*.aiff;*.aif;*.flac";

    fileChooser = std::make_unique<juce::FileChooser> (title, start, filter);
    auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
               | (type == "vst3" ? juce::FileBrowserComponent::canSelectDirectories : 0);

    fileChooser->launchAsync (flags, [this, type] (const juce::FileChooser& fc)
    {
        const auto file = fc.getResult();
        if (type == "vst3" ? file.exists() : file.existsAsFile())
        {
            if (type == "vst3") doLoadVst (file);
            else if (type == "nam") doLoadNam (file);
            else doLoadIR (file);
        }
    });
}

void WebUIComponent::doLoadVst (const juce::File& file)
{
    auto node = std::make_unique<Vst3Node>();
    auto* raw = node.get();
    pendingVst = std::move (node);

    const double sr = engine.isPrepared() ? engine.getSampleRate() : 48000.0;
    const int block = engine.isPrepared() ? engine.getMaxBlockSize() : 512;

    raw->loadAsync (file, sr, block, [this, raw] (bool ok, juce::String)
    {
        if (ok)
            engine.setNode (AudioEngine::vst3Slot, std::move (pendingVst));
        else
            pendingVst.reset();
        juce::ignoreUnused (raw);
        markDirty();
    });
}

void WebUIComponent::doLoadNam (const juce::File& file)
{
    auto nam = std::make_unique<NamNode>();
    juce::String err;
    if (nam->loadFile (file, err))
        engine.setNode (AudioEngine::namSlot, std::move (nam));
    markDirty();
}

void WebUIComponent::doLoadIR (const juce::File& file)
{
    auto ir = std::make_unique<IRNode>();
    if (ir->loadFile (file))
        engine.setNode (AudioEngine::irSlot, std::move (ir));
    markDirty();
}

void WebUIComponent::openVstEditorWindow()
{
    auto* vst = dynamic_cast<Vst3Node*> (engine.getNode (AudioEngine::vst3Slot));
    if (vst == nullptr || vst->getInstance() == nullptr)
        return;

    if (editorWindow != nullptr) { editorWindow->toFront (true); return; }
    editorWindow = std::make_unique<PluginEditorWindow> (*vst->getInstance(),
                                                         [this] { editorWindow = nullptr; });
}

void WebUIComponent::openAudioSettings()
{
    auto selector = std::make_unique<juce::AudioDeviceSelectorComponent> (
        deviceManager, 1, 2, 1, 2, false, false, true, false);
    selector->setSize (460, 360);

    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (selector.release());
    o.dialogTitle = "Audio Settings";
    o.dialogBackgroundColour = juce::Colour (0xff141210);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    o.launchAsync();
}

void WebUIComponent::savePreset (const juce::String& name)
{
    const auto file = Preset::presetsDir().getChildFile (name + Preset::fileExtension);
    if (Preset::save (file, engine, masterGain.load(), engine.getSampleRate(), name))
        activePreset = name;
    markDirty();
}

void WebUIComponent::loadPreset (const juce::String& name)
{
    const auto file = Preset::presetsDir().getChildFile (name + Preset::fileExtension);
    Preset::RigInfo info;
    const bool ok = Preset::load (file, engine, engine.getSampleRate(), engine.getMaxBlockSize(), info,
        [this] (const Preset::VstSlot& v)
        {
            // VST3 slots load asynchronously.
            auto node = std::make_unique<Vst3Node>();
            auto* raw = node.get();
            pendingVst = std::move (node);
            const juce::String state = v.stateBase64;
            raw->loadAsync (v.path, engine.getSampleRate(), engine.getMaxBlockSize(),
                [this, raw, state, enabled = v.enabled] (bool loaded, juce::String)
                {
                    if (loaded)
                    {
                        raw->setStateBase64 (state);
                        raw->setBypassed (! enabled);
                        engine.setNode (AudioEngine::vst3Slot, std::move (pendingVst));
                    }
                    else { pendingVst.reset(); }
                    markDirty();
                });
        });

    if (ok)
    {
        masterGain.store (info.masterGain);
        activePreset = name;
    }
    markDirty();
}

//==============================================================================
void WebUIComponent::devAutoLoad()
{
    juce::File sentinel ("/tmp/tonestack_autoload.txt");
    if (! sentinel.existsAsFile())
        return;

    for (auto& line : juce::StringArray::fromLines (sentinel.loadFileAsString()))
    {
        const auto t = line.trim();
        if (t.startsWith ("vst=")) doLoadVst (juce::File (t.fromFirstOccurrenceOf ("vst=", false, false)));
        else if (t.startsWith ("nam=")) doLoadNam (juce::File (t.fromFirstOccurrenceOf ("nam=", false, false)));
        else if (t.startsWith ("ir="))  doLoadIR  (juce::File (t.fromFirstOccurrenceOf ("ir=", false, false)));
    }
}

std::optional<Resource> WebUIComponent::provideResource (const juce::String& path)
{
    const auto entryName = (path == "/") ? juce::String ("index.html")
                                         : path.fromFirstOccurrenceOf ("/", false, false);

    if (auto* zip = getWebZip())
    {
        if (auto* e = zip->getEntry (entryName))
        {
            std::unique_ptr<juce::InputStream> in (zip->createStreamForEntry (*e));
            if (in != nullptr)
            {
                std::vector<std::byte> data ((size_t) in->getTotalLength());
                in->setPosition (0);
                in->read (data.data(), (int) data.size());
                const auto ext = entryName.fromLastOccurrenceOf (".", false, false);
                return Resource { std::move (data), juce::String (mimeForExt (ext)) };
            }
        }
    }
    return std::nullopt;
}
