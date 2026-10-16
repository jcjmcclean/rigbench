#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <functional>

//==============================================================================
// Hosts a hosted plugin's own editor in a window. Destroyed BEFORE the plugin
// instance (a live editor on a freed instance crashes). The chrome background
// colour is passed by the caller so each host UI can match its own palette.
class PluginEditorWindow final : public juce::DocumentWindow
{
public:
    PluginEditorWindow (juce::AudioPluginInstance& p, juce::Colour background,
                        std::function<void()> onClose)
        : juce::DocumentWindow (p.getName(), background, juce::DocumentWindow::closeButton),
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
