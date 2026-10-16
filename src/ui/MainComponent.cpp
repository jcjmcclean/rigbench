#include "MainComponent.h"
#include "engine/IRNode.h"
#include "engine/NamNode.h"

namespace
{
constexpr int kMinBlockSizeAlloc = 4096;

//==============================================================================
// Hosts a plugin's own editor in a window. Destroyed before the plugin instance.
class PluginEditorWindow final : public juce::DocumentWindow
{
public:
    PluginEditorWindow (juce::AudioPluginInstance& p, std::function<void()> onClose)
        : juce::DocumentWindow (p.getName(), juce::Colour (0xff17181c),
                                juce::DocumentWindow::closeButton),
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
MainComponent::MainComponent()
{
    setAudioChannels (2, 2);

    titleLabel.setText ("ToneStack", juce::dontSendNotification);
    titleLabel.setFont (juce::FontOptions (22.0f, juce::Font::bold));
    titleLabel.setColour (juce::Label::textColourId, juce::Colour (0xfff2f2f2));
    addAndMakeVisible (titleLabel);

    settingsButton.onClick = [this] { openAudioSettings(); };
    addAndMakeVisible (settingsButton);

    latencyLabel.setFont (juce::FontOptions (13.0f));
    latencyLabel.setColour (juce::Label::textColourId, juce::Colour (0xffb9f27c));
    addAndMakeVisible (latencyLabel);

    monitorButton.setToggleState (true, juce::dontSendNotification);
    monitorButton.setColour (juce::ToggleButton::textColourId, juce::Colour (0xffb9bcc4));
    monitorButton.onClick = [this] { monitorOn.store (monitorButton.getToggleState()); };
    addAndMakeVisible (monitorButton);

    masterLabel.setText ("Output", juce::dontSendNotification);
    masterLabel.setFont (juce::FontOptions (14.0f));
    masterLabel.setColour (juce::Label::textColourId, juce::Colour (0xffb9bcc4));
    addAndMakeVisible (masterLabel);

    masterSlider.setSliderStyle (juce::Slider::LinearHorizontal);
    masterSlider.setRange (0.0, 1.0, 0.001);
    masterSlider.setValue (0.8);
    masterSlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 56, 20);
    masterSlider.onValueChange = [this] { masterGain.store ((float) masterSlider.getValue()); };
    addAndMakeVisible (masterSlider);

    //-- slots (signal flows top to bottom: VST3 -> NAM -> IR) ----------------
    vstStrip = std::make_unique<SlotStrip> ("VST3  —  Plugin", false, true);
    vstStrip->onLoad   = [this] { loadVst(); };
    vstStrip->onEditor = [this] { openVstEditor(); };
    vstStrip->onBypass = [this] (bool b) { if (auto* n = engine.getNode (AudioEngine::vst3Slot)) n->setBypassed (b); };
    addAndMakeVisible (*vstStrip);

    namStrip = std::make_unique<SlotStrip> ("NAM  —  Amp Model", false, false);
    namStrip->onLoad   = [this] { loadNam(); };
    namStrip->onBypass = [this] (bool b) { if (auto* n = engine.getNode (AudioEngine::namSlot)) n->setBypassed (b); };
    addAndMakeVisible (*namStrip);

    irStrip = std::make_unique<SlotStrip> ("IR  —  Cab", true, false);
    irStrip->onLoad   = [this] { loadIR(); };
    irStrip->onBypass = [this] (bool b) { if (auto* n = engine.getNode (AudioEngine::irSlot)) n->setBypassed (b); };
    irStrip->onMix    = [this] (float m) { if (auto* n = dynamic_cast<IRNode*> (engine.getNode (AudioEngine::irSlot))) n->setMix (m); };
    addAndMakeVisible (*irStrip);

    setSize (560, 560);
    startTimerHz (4);
}

MainComponent::~MainComponent()
{
    editorWindow = nullptr;
    shutdownAudio();
}

//==============================================================================
void MainComponent::prepareToPlay (int samplesPerBlockExpected, double sampleRate)
{
    const int alloc = juce::jmax (samplesPerBlockExpected, kMinBlockSizeAlloc);
    monoBuffer.setSize (1, alloc, false, false, true);
    engine.prepare (sampleRate, alloc);
}

void MainComponent::getNextAudioBlock (const juce::AudioSourceChannelInfo& bufferToFill)
{
    auto* buffer    = bufferToFill.buffer;
    const int start = bufferToFill.startSample;
    const int num   = bufferToFill.numSamples;
    const int numOut = buffer->getNumChannels();

    if (! monitorOn.load (std::memory_order_relaxed) || num > monoBuffer.getNumSamples())
    {
        bufferToFill.clearActiveBufferRegion();
        return;
    }

    monoBuffer.copyFrom (0, 0, *buffer, 0, start, num);

    float* chans[1] = { monoBuffer.getWritePointer (0) };
    juce::AudioBuffer<float> work (chans, 1, num);
    engine.processBlock (work);

    const float g = masterGain.load (std::memory_order_relaxed);
    for (int ch = 0; ch < numOut; ++ch)
    {
        buffer->copyFrom (ch, start, work, 0, 0, num);
        buffer->applyGain (ch, start, num, g);
    }
}

void MainComponent::releaseResources()
{
    engine.releaseResources();
}

//==============================================================================
namespace
{
void devLog (const juce::String& msg)
{
    juce::File ("/tmp/tonestack_dev.log").appendText (msg + "\n");
}
}

void MainComponent::loadVst()
{
    fileChooser = std::make_unique<juce::FileChooser> (
        "Load a VST3 plugin", juce::File ("/Library/Audio/Plug-Ins/VST3"), "*.vst3");

    fileChooser->launchAsync (
        juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles
            | juce::FileBrowserComponent::canSelectDirectories,
        [this] (const juce::FileChooser& fc)
        {
            const auto file = fc.getResult();
            if (file.exists())
                doLoadVst (file);
        });
}

void MainComponent::doLoadVst (const juce::File& file)
{
    auto node = std::make_unique<Vst3Node>();
    auto* raw = node.get();
    pendingVst = std::move (node);
    vstStrip->setFileName ("loading...");

    raw->loadAsync (file, currentSr(), currentBlock(),
        [this, raw] (bool ok, juce::String err)
        {
            if (ok)
            {
                vstStrip->setFileName (raw->getSourceName());
                vstStrip->setLoaded (true);
                engine.setNode (AudioEngine::vst3Slot, std::move (pendingVst));
                devLog ("VST3 loaded: " + raw->getSourceName());
                if (autoOpenEditor) { autoOpenEditor = false; openVstEditor(); }
            }
            else
            {
                vstStrip->setFileName ("load failed: " + err);
                pendingVst.reset();
                devLog ("VST3 FAILED: " + err);
            }
        });
}

void MainComponent::loadNam()
{
    fileChooser = std::make_unique<juce::FileChooser> (
        "Load a NAM model",
        juce::File::getSpecialLocation (juce::File::userDocumentsDirectory), "*.nam");

    fileChooser->launchAsync (
        juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [this] (const juce::FileChooser& fc)
        {
            const auto file = fc.getResult();
            if (file.existsAsFile())
                doLoadNam (file);
        });
}

void MainComponent::doLoadNam (const juce::File& file)
{
    auto nam = std::make_unique<NamNode>();
    juce::String err;
    if (nam->loadFile (file, err))
    {
        nam->setBypassed (namStrip->isBypassed());
        engine.setNode (AudioEngine::namSlot, std::move (nam));
        namStrip->setFileName (file.getFileName());
        devLog ("NAM loaded: " + file.getFileName());
    }
    else
    {
        namStrip->setFileName ("load failed: " + err);
        devLog ("NAM FAILED: " + err);
    }
}

void MainComponent::loadIR()
{
    fileChooser = std::make_unique<juce::FileChooser> (
        "Load an impulse response", juce::File(), "*.wav;*.aiff;*.aif;*.flac");

    fileChooser->launchAsync (
        juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [this] (const juce::FileChooser& fc)
        {
            const auto file = fc.getResult();
            if (file.existsAsFile())
                doLoadIR (file);
        });
}

void MainComponent::doLoadIR (const juce::File& file)
{
    auto ir = std::make_unique<IRNode>();
    if (ir->loadFile (file))
    {
        ir->setMix (irStrip->getMix());
        ir->setBypassed (irStrip->isBypassed());
        engine.setNode (AudioEngine::irSlot, std::move (ir));
        irStrip->setFileName (file.getFileName());
        devLog ("IR loaded: " + file.getFileName());
    }
    else
    {
        irStrip->setFileName ("load failed");
        devLog ("IR FAILED: " + file.getFileName());
    }
}

void MainComponent::devAutoLoad()
{
    juce::File sentinel ("/tmp/tonestack_autoload.txt");
    if (! sentinel.existsAsFile())
        return;

    devLog ("--- devAutoLoad @ sr " + juce::String (currentSr(), 0) + " block " + juce::String (currentBlock()) + " ---");
    const auto body = sentinel.loadFileAsString();
    if (body.contains ("editor"))
        autoOpenEditor = true;
    for (auto& line : juce::StringArray::fromLines (body))
    {
        const auto trimmed = line.trim();
        if (trimmed.startsWith ("vst=")) doLoadVst (juce::File (trimmed.fromFirstOccurrenceOf ("vst=", false, false)));
        else if (trimmed.startsWith ("nam=")) doLoadNam (juce::File (trimmed.fromFirstOccurrenceOf ("nam=", false, false)));
        else if (trimmed.startsWith ("ir="))  doLoadIR  (juce::File (trimmed.fromFirstOccurrenceOf ("ir=", false, false)));
    }
}

void MainComponent::openVstEditor()
{
    auto* vst = dynamic_cast<Vst3Node*> (engine.getNode (AudioEngine::vst3Slot));
    if (vst == nullptr || vst->getInstance() == nullptr)
        return;

    if (editorWindow != nullptr)
    {
        editorWindow->toFront (true);
        return;
    }

    editorWindow = std::make_unique<PluginEditorWindow> (
        *vst->getInstance(), [this] { editorWindow = nullptr; });
}

void MainComponent::openAudioSettings()
{
    auto selector = std::make_unique<juce::AudioDeviceSelectorComponent> (
        deviceManager, 1, 2, 1, 2, false, false, true, false);
    selector->setSize (450, 350);

    juce::DialogWindow::LaunchOptions o;
    o.content.setOwned (selector.release());
    o.dialogTitle = "Audio Settings";
    o.dialogBackgroundColour = juce::Colour (0xff17181c);
    o.escapeKeyTriggersCloseButton = true;
    o.useNativeTitleBar = true;
    o.resizable = false;
    o.launchAsync();
}

//==============================================================================
void MainComponent::timerCallback()
{
    // Dev auto-load shortly after launch (a stepping stone to presets in T6).
    // Not gated on the audio device so it works even if input permission is pending;
    // nodes are (re)prepared when the device opens.
    if (! autoLoadDone && ++ticks >= 3)
    {
        autoLoadDone = true;
        devAutoLoad();
    }

    juce::String text;
    if (auto* dev = deviceManager.getCurrentAudioDevice())
    {
        const double sr = dev->getCurrentSampleRate();
        const int buf   = dev->getCurrentBufferSizeSamples();
        auto ms = [sr] (double s) { return sr > 0 ? s / sr * 1000.0 : 0.0; };
        const double rt = ms (dev->getInputLatencyInSamples() + dev->getOutputLatencyInSamples());
        text << dev->getName() << "   " << juce::String (sr / 1000.0, 1) << " kHz   buffer "
             << buf << "   round-trip " << juce::String (rt, 2) << " ms";
    }
    else
    {
        text = "No audio device. Click Audio Settings.";
    }
    latencyLabel.setText (text, juce::dontSendNotification);
}

//==============================================================================
void MainComponent::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff17181c));
}

void MainComponent::resized()
{
    auto r = getLocalBounds().reduced (16);

    auto top = r.removeFromTop (30);
    settingsButton.setBounds (top.removeFromRight (130));
    titleLabel.setBounds (top);
    r.removeFromTop (6);

    latencyLabel.setBounds (r.removeFromTop (22));
    r.removeFromTop (10);

    auto masterRow = r.removeFromTop (26);
    monitorButton.setBounds (masterRow.removeFromLeft (90));
    masterLabel.setBounds (masterRow.removeFromLeft (56));
    masterSlider.setBounds (masterRow);
    r.removeFromTop (14);

    vstStrip->setBounds (r.removeFromTop (SlotStrip::preferredHeight (false)));
    r.removeFromTop (10);
    namStrip->setBounds (r.removeFromTop (SlotStrip::preferredHeight (false)));
    r.removeFromTop (10);
    irStrip->setBounds (r.removeFromTop (SlotStrip::preferredHeight (true)));
}
