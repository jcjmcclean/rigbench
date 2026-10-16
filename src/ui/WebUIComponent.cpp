#include "WebUIComponent.h"
#include "PluginEditorWindow.h"
#include "app/AudioSetup.h"
#include "app/ExternalLinks.h"
#include "app/PluginScanner.h"
#include "engine/AppPaths.h"
#include "engine/SlotTypes.h"
#include "BinaryData.h"

#include <unordered_map>

using Resource = juce::WebBrowserComponent::Resource;
using Completion = juce::WebBrowserComponent::NativeFunctionCompletion;

namespace
{
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

// SEC-5: lock navigation. The WebView must only ever load our own embedded
// resource origin — any other URL (an injected <a>/redirect, a future remote
// asset) is refused so the 13 native bridge functions can't be driven from
// off-origin content. (about:/empty is allowed for JUCE's own bootstrapping.)
class LockedWebBrowser final : public juce::WebBrowserComponent
{
public:
    using juce::WebBrowserComponent::WebBrowserComponent;

    bool pageAboutToLoad (const juce::String& url) override
    {
        return url.isEmpty()
            || url.startsWith ("about:")
            || url.startsWith (juce::WebBrowserComponent::getResourceProviderRoot());
    }
};

} // namespace

//==============================================================================
WebUIComponent::WebUIComponent (Options componentOptions)
    : onUiReady (std::move (componentOptions.onUiReady))
{
    using BrowserOptions = juce::WebBrowserComponent::Options;

    // Each native function forwards to the rig (or a GUI action), marks the
    // state dirty so the next timer tick pushes it, and completes immediately.
    auto op = [this] (std::function<void (const juce::Array<juce::var>&)> fn)
    {
        return [this, f = std::move (fn)] (const juce::Array<juce::var>& args, Completion done)
        {
            f (args);
            markDirty();
            done (juce::var());
        };
    };
    auto arg = [] (const juce::Array<juce::var>& a, int i) { return i < a.size() ? a[i] : juce::var(); };

    // JUCE's default backend on Windows is Internet Explorer, which has neither the
    // resource provider nor the native bridge, so ask for WebView2 explicitly. Its
    // default user-data folder sits next to the exe (unwritable under Program
    // Files), so keep it in the app's data folder. Both are ignored elsewhere.
    const auto webViewData = AppPaths::dataDir().getChildFile ("WebView2");

    BrowserOptions options = BrowserOptions{}
        .withBackend (BrowserOptions::Backend::webview2)
        .withWinWebView2Options (BrowserOptions::WinWebView2{}
                                     .withUserDataFolder (webViewData)
                                     .withBackgroundColour (juce::Colour (0xff0a0b0d))
                                     .withStatusBarDisabled())
        .withNativeIntegrationEnabled()
        .withResourceProvider ([this] (const auto& p) { return provideResource (p); })
        .withNativeFunction ("getState", [this] (const juce::Array<juce::var>&, Completion done)
            {
                done (buildStateVar());
                if (auto ready = std::exchange (onUiReady, nullptr))
                    ready();   // the page loaded and reached the engine
            })
        .withNativeFunction ("loadSlot",  op ([this, arg] (auto& a) { loadSlotChooser (arg (a, 0).toString()); }))
        // The plugins installed in the standard VST3 folders, as [{ name, path }].
        // loadPlugin only accepts a path from the latest list (the UI can't
        // name an arbitrary file to load and run).
        .withNativeFunction ("listPlugins", [this] (const juce::Array<juce::var>&, Completion done)
            {
                scannedPlugins = PluginScanner::scan (SlotTypes::vst3Folders());
                juce::Array<juce::var> list;
                for (auto& p : scannedPlugins)
                {
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("name", p.name);
                    o->setProperty ("path", p.file.getFullPathName());
                    list.add (juce::var (o));
                }
                done (list);
            })
        .withNativeFunction ("loadPlugin", op ([this, arg] (auto& a)
            {
                const juce::File chosen (arg (a, 0).toString());
                for (auto& p : scannedPlugins)
                    if (p.file == chosen)
                        return loadFile (AudioEngine::vst3Slot, chosen);
                reportError ("That plugin isn't in the list any more. Try opening the list again.");
            }))
        .withNativeFunction ("clearSlot", op ([this, arg] (auto& a)
            {
                const auto id = arg (a, 0).toString();
                if (SlotTypes::indexForId (id) == AudioEngine::vst3Slot)
                    editorWindow = nullptr;   // close the editor before destroying the plugin
                rig.clearSlot (id);
            }))
        .withNativeFunction ("setBypass", op ([this, arg] (auto& a) { rig.setBypass (arg (a, 0).toString(), (bool) arg (a, 1)); }))
        .withNativeFunction ("setMix",    op ([this, arg] (auto& a) { rig.setMix  (arg (a, 0).toString(), arg (a, 1)); }))
        .withNativeFunction ("setGain",   op ([this, arg] (auto& a) { rig.setGain (arg (a, 0).toString(), arg (a, 1)); }))
        .withNativeFunction ("setInput",  op ([this, arg] (auto& a) { rig.setInput  (arg (a, 0)); }))
        .withNativeFunction ("setMaster", op ([this, arg] (auto& a) { rig.setMaster (arg (a, 0)); }))
        .withNativeFunction ("setMonitor", op ([this, arg] (auto& a) { rig.setMonitor ((bool) arg (a, 0)); }))
        .withNativeFunction ("setGate",    op ([this, arg] (auto& a) { rig.setGate (arg (a, 0)); }))
        .withNativeFunction ("openEditor", op ([this] (auto&) { openVstEditorWindow(); }))
        // Audio device setup (Settings screen + first-run setup). setAudioSetup
        // resolves with the new setup; its "error" says why a change failed.
        .withNativeFunction ("getAudioSetup", [this] (const juce::Array<juce::var>&, Completion done)
            { done (AudioSetup::describe (deviceManager)); })
        .withNativeFunction ("setAudioSetup", [this, arg] (const juce::Array<juce::var>& a, Completion done)
            {
                const auto err = AudioSetup::apply (deviceManager, arg (a, 0));
                auto setup = AudioSetup::describe (deviceManager);
                if (err.isNotEmpty())
                    setup.getDynamicObject()->setProperty ("error", err);
                markDirty();
                done (setup);
            })
        // Links (e.g. where to download models) open in the system browser; the
        // WebView itself never navigates away (SEC-5). https only.
        .withNativeFunction ("openUrl", op ([this, arg] (auto& a) { openExternalUrl (arg (a, 0).toString()); }))
        .withNativeFunction ("playTestSound", op ([this] (auto&) { rig.playTestSound(); }))
        .withNativeFunction ("finishSetup", op ([this] (auto&) { rig.finishSetup(); }))
        .withNativeFunction ("setTuner", op ([this, arg] (auto& a) { rig.setTuner ((bool) arg (a, 0)); }))
        .withNativeFunction ("savePreset", op ([this, arg] (auto& a) { reportError (rig.savePreset (arg (a, 0).toString())); }))
        .withNativeFunction ("loadPreset", op ([this, arg] (auto& a) { loadPreset (arg (a, 0).toString()); }))
        .withNativeFunction ("renamePreset", op ([this, arg] (auto& a) { reportError (rig.renamePreset (arg (a, 0).toString(), arg (a, 1).toString())); }))
        .withNativeFunction ("deletePreset", op ([this, arg] (auto& a) { reportError (rig.deletePreset (arg (a, 0).toString())); }));

    web = std::make_unique<LockedWebBrowser> (options);
    addAndMakeVisible (*web);
    // Cache-bust per launch so WKWebView never serves a stale embedded UI.
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot()
                  + "?v=" + juce::String ((juce::int64) juce::Time::getMillisecondCounterHiRes()));

    setSize (1180, 760);

    // Restore the audio device from last session (device, rate, buffer).
    if (componentOptions.openAudioDevice)
    {
        std::unique_ptr<juce::XmlElement> savedAudio (juce::XmlDocument::parse (audioSettingsFile()));
        setAudioChannels (2, 2, savedAudio.get());
    }
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
    return AppPaths::dataDir().getChildFile ("audio-settings.xml");
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
    rig.getAudio().prepare (samplesPerBlockExpected, sampleRate);
    markDirty();
}

void WebUIComponent::getNextAudioBlock (const juce::AudioSourceChannelInfo& bufferToFill)
{
    rig.getAudio().process (*bufferToFill.buffer, bufferToFill.startSample, bufferToFill.numSamples);
}

void WebUIComponent::releaseResources()
{
    rig.getAudio().release();
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
    auto& audio = rig.getAudio();
    smooth (smoothedIn, audio.takeInputPeak());
    smooth (smoothedOut, audio.takeOutputPeak());

   #if JUCE_DEBUG
    if (! didAutoLoad && ++ticks >= 4)
    {
        didAutoLoad = true;
        devAutoLoad();
    }
   #endif

    if (web == nullptr)
        return;

    auto* mo = new juce::DynamicObject();
    mo->setProperty ("inputLevel", smoothedIn);
    mo->setProperty ("outputLevel", smoothedOut);
    mo->setProperty ("playing", audio.isMonitoring());

    // Raw level of each input the device has open, for first-run setup.
    juce::Array<juce::var> inputPeaks;
    if (auto* dev = deviceManager.getCurrentAudioDevice())
        for (int ch = 0; ch < juce::jmin (dev->getActiveInputChannels().countNumberOfSetBits(), AudioPath::maxChannelMeters); ++ch)
            inputPeaks.add (audio.takeChannelPeak (ch));
    mo->setProperty ("inputPeaks", inputPeaks);
    mo->setProperty ("tuner", audio.getTuner().isActive() ? rig.readTuner() : juce::var());
    web->emitEventIfBrowserIsVisible ("meters", juce::var (mo));

    // Drain the scope feed and push the live waveform to the UI.
    scopeScratch.clear();
    audio.drainScope (scopeScratch);
    if (! scopeScratch.empty())
    {
        juce::Array<juce::var> pts;
        pts.ensureStorageAllocated ((int) scopeScratch.size());
        for (float v : scopeScratch) pts.add (v);
        web->emitEventIfBrowserIsVisible ("scope", juce::var (pts));
    }

    if (stateDirty)
    {
        stateDirty = false;
        web->emitEventIfBrowserIsVisible ("state", buildStateVar());
    }
}

//==============================================================================
RigController::DeviceInfo WebUIComponent::currentDeviceInfo() const
{
    RigController::DeviceInfo info;
    if (auto* dev = deviceManager.getCurrentAudioDevice())
    {
        const double sr = dev->getCurrentSampleRate();
        info.name = dev->getName();
        info.sampleRate = sr;
        info.bufferSize = dev->getCurrentBufferSizeSamples();
        info.roundTripMs = sr > 0 ? (dev->getInputLatencyInSamples() + dev->getOutputLatencyInSamples()) / sr * 1000.0 : 0.0;
    }
    return info;
}

juce::var WebUIComponent::buildStateVar() const
{
    return rig.buildState (currentDeviceInfo(), smoothedIn, smoothedOut);
}

//==============================================================================
void WebUIComponent::loadSlotChooser (const juce::String& type)
{
    const auto* desc = SlotTypes::byId (type);   // single source of truth (SlotTypes.h)
    if (desc == nullptr)
        return;

    fileChooser = std::make_unique<juce::FileChooser> (desc->title, SlotTypes::startDirFor (type), desc->filter);
    auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
               | (desc->selectDirs ? juce::FileBrowserComponent::canSelectDirectories : 0);

    fileChooser->launchAsync (flags, [this, idx = desc->index] (const juce::FileChooser& fc)
    {
        const auto file = fc.getResult();
        if (idx == AudioEngine::vst3Slot ? file.exists() : file.existsAsFile())
            loadFile (idx, file);
    });
}

void WebUIComponent::loadFile (int slot, const juce::File& file)
{
    if (slot == AudioEngine::vst3Slot) doLoadVst (file);
    else if (slot == AudioEngine::namSlot) reportError (rig.loadNam (file));
    else reportError (rig.loadIR (file));
    markDirty();
}

void WebUIComponent::doLoadVst (const juce::File& file)
{
    editorWindow = nullptr; // close the editor of the plugin we're replacing
    auto node = std::make_unique<Vst3Node>();
    auto* raw = node.get();
    pendingVst = std::move (node);
    const int gen = ++vstGeneration;

    auto& engine = rig.getEngine();
    const double sr = engine.isPrepared() ? engine.getSampleRate() : 48000.0;
    const int block = engine.isPrepared() ? engine.getMaxBlockSize() : 512;

    raw->loadAsync (file, sr, block, [this, raw, gen] (bool ok, juce::String err)
    {
        finishVstLoad (raw, gen, ok, err, {}, true);
    });
}

void WebUIComponent::reportError (const juce::String& message)
{
    if (web == nullptr || message.isEmpty())
        return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("message", message);
    web->emitEventIfBrowserIsVisible ("error", juce::var (o));
}

void WebUIComponent::openVstEditorWindow()
{
    auto* vst = dynamic_cast<Vst3Node*> (rig.getEngine().getNode (AudioEngine::vst3Slot));
    if (vst == nullptr || vst->getInstance() == nullptr)
        return;

    if (editorWindow != nullptr) { editorWindow->toFront (true); return; }
    editorWindow = std::make_unique<PluginEditorWindow> (*vst->getInstance(),
                                                         juce::Colour (0xff141210),
                                                         [this] { editorWindow = nullptr; });
}

void WebUIComponent::openExternalUrl (const juce::String& url)
{
    if (ExternalLinks::isOpenable (url))
        juce::URL (url).launchInDefaultBrowser();
}

void WebUIComponent::openAudioSettings()
{
    // The Settings screen is part of the React UI; ask it to open.
    if (web != nullptr)
        web->emitEventIfBrowserIsVisible ("showSettings", juce::var());
}

void WebUIComponent::finishVstLoad (Vst3Node* node, int gen, bool ok, const juce::String& err,
                                    const juce::String& state, bool enabled)
{
    // Only the plugin we're waiting for counts. (A replaced one is destroyed with
    // its pending callback, but don't rely on that.)
    if (node == nullptr || pendingVst.get() != node)
        return;

    // This runs inside the node's own completion callback, so don't destroy it
    // here: hand it on, or drop it on a later message.
    std::unique_ptr<Vst3Node> loaded (pendingVst.release());
    auto dropLater = [&loaded]
    {
        juce::MessageManager::callAsync ([n = std::shared_ptr<Vst3Node> (loaded.release())] {});
    };
    if (gen != vstGeneration)
    {
        dropLater();   // superseded by a newer load
        return;
    }

    if (ok)
    {
        loaded->setStateBase64 (state);
        loaded->setBypassed (! enabled);
        rig.installVst (std::move (loaded));
    }
    else
    {
        dropLater();
        reportError ("Could not load plugin: " + (err.isNotEmpty() ? err : juce::String ("unknown error")));
    }
    markDirty();
}

void WebUIComponent::loadPreset (const juce::String& name)
{
    // Close any open plugin editor BEFORE the preset load clears slots (which
    // destroys the current VST3 instance) — a live editor on a freed instance crashes.
    editorWindow = nullptr;
    ++vstGeneration;   // any plugin still loading belongs to the old rig
    reportError (rig.loadPreset (name, [this] (const Preset::VstSlot& v) { startVstFromPreset (v); }));
}

void WebUIComponent::startVstFromPreset (const Preset::VstSlot& v)
{
    // SEC-3: a shared preset can name an arbitrary .vst3 bundle; loading one is
    // arbitrary code execution inside this mic-privileged process. Require the
    // bundle to exist and get explicit, path-naming user consent before we
    // dlopen/instantiate it. Decline => skip the slot.
    if (! v.path.exists())
    {
        reportError ("Preset references a missing plugin:\n" + v.path.getFullPathName());
        return;
    }

    const int presetGen = vstGeneration;   // loadPreset bumped it just before this

    auto startLoad = [this, v, presetGen]
    {
        if (presetGen != vstGeneration)
            return;   // another preset or plugin was loaded while the prompt was open

        auto node = std::make_unique<Vst3Node>();
        auto* raw = node.get();
        pendingVst = std::move (node);
        const int gen = ++vstGeneration;
        auto& engine = rig.getEngine();
        const double sr = engine.isPrepared() ? engine.getSampleRate() : 48000.0;   // M3: never 0/0
        const int block = engine.isPrepared() ? engine.getMaxBlockSize() : 512;
        raw->loadAsync (v.path, sr, block,
            [this, raw, gen, state = v.stateBase64, enabled = v.enabled] (bool loaded, juce::String err)
            {
                finishVstLoad (raw, gen, loaded, err, state, enabled);
            });
    };

    const auto message = "This preset wants to load a VST3 plugin, which runs "
                         "third-party code inside Tonebench:\n\n"
                         + v.path.getFullPathName()
                         + "\n\nOnly continue if you trust the source of this preset.";
    juce::AlertWindow::showOkCancelBox (
        juce::MessageBoxIconType::WarningIcon, "Load plugin from preset?", message,
        "Load plugin", "Cancel", nullptr,
        juce::ModalCallbackFunction::create ([startLoad] (int result)
        {
            if (result == 1) startLoad();   // 1 == first button ("Load plugin")
        }));
}

//==============================================================================
#if JUCE_DEBUG
void WebUIComponent::devAutoLoad()
{
    // SEC-1: DEBUG-ONLY dev convenience. This silently loads (and for VST3,
    // executes) whatever paths the sentinel names, so it must NEVER exist in a
    // release build, and the sentinel lives in the app-private data dir — not
    // world-writable /tmp, where any local process could plant a malicious entry.
    const auto sentinel = AppPaths::dataDir().getChildFile ("tonebench_autoload.txt");
    if (! sentinel.existsAsFile())
        return;

    for (auto& line : juce::StringArray::fromLines (sentinel.loadFileAsString()))
    {
        const auto t = line.trim();
        if (t.startsWith ("vst=")) loadFile (AudioEngine::vst3Slot, juce::File (t.fromFirstOccurrenceOf ("vst=", false, false)));
        else if (t.startsWith ("nam=")) loadFile (AudioEngine::namSlot, juce::File (t.fromFirstOccurrenceOf ("nam=", false, false)));
        else if (t.startsWith ("ir="))  loadFile (AudioEngine::irSlot, juce::File (t.fromFirstOccurrenceOf ("ir=", false, false)));
    }
}
#endif

std::optional<Resource> WebUIComponent::provideResource (const juce::String& path)
{
    const auto clean = path.upToFirstOccurrenceOf ("?", false, false); // drop cache-bust query
    const auto entryName = (clean == "/" || clean.isEmpty()) ? juce::String ("index.html")
                                         : clean.fromFirstOccurrenceOf ("/", false, false);

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
