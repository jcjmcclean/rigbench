#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

//==============================================================================
// One slot row in the native scaffold UI: title, loaded-file name, Load / Bypass,
// plus optional Mix slider (IR) and Editor button (VST3). Wired to the engine via
// the callbacks. Replaced by the React UI in T7.
class SlotStrip : public juce::Component
{
public:
    SlotStrip (const juce::String& titleText, bool withMix, bool withEditor)
        : hasMix (withMix), hasEditor (withEditor)
    {
        title.setText (titleText, juce::dontSendNotification);
        title.setFont (juce::FontOptions (16.0f, juce::Font::bold));
        title.setColour (juce::Label::textColourId, juce::Colour (0xffe8e8e8));
        addAndMakeVisible (title);

        fileLabel.setText ("(empty)", juce::dontSendNotification);
        fileLabel.setFont (juce::FontOptions (13.0f));
        fileLabel.setColour (juce::Label::textColourId, juce::Colour (0xff9a9fa8));
        addAndMakeVisible (fileLabel);

        loadBtn.setButtonText ("Load...");
        loadBtn.onClick = [this] { if (onLoad) onLoad(); };
        addAndMakeVisible (loadBtn);

        bypassBtn.setColour (juce::ToggleButton::textColourId, juce::Colour (0xffb9bcc4));
        bypassBtn.onClick = [this] { if (onBypass) onBypass (bypassBtn.getToggleState()); };
        addAndMakeVisible (bypassBtn);

        if (hasEditor)
        {
            editorBtn.setButtonText ("Editor");
            editorBtn.setEnabled (false);
            editorBtn.onClick = [this] { if (onEditor) onEditor(); };
            addAndMakeVisible (editorBtn);
        }

        if (hasMix)
        {
            mixLabel.setText ("Mix", juce::dontSendNotification);
            mixLabel.setFont (juce::FontOptions (13.0f));
            mixLabel.setColour (juce::Label::textColourId, juce::Colour (0xffb9bcc4));
            addAndMakeVisible (mixLabel);

            mix.setSliderStyle (juce::Slider::LinearHorizontal);
            mix.setRange (0.0, 1.0, 0.001);
            mix.setValue (1.0);
            mix.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 20);
            mix.onValueChange = [this] { if (onMix) onMix ((float) mix.getValue()); };
            addAndMakeVisible (mix);
        }
    }

    void setFileName (const juce::String& name) { fileLabel.setText (name, juce::dontSendNotification); }
    void setLoaded (bool loaded)                { if (hasEditor) editorBtn.setEnabled (loaded); }
    float getMix() const                        { return (float) mix.getValue(); }
    bool  isBypassed() const                    { return bypassBtn.getToggleState(); }

    std::function<void()>      onLoad;
    std::function<void()>      onEditor;
    std::function<void (bool)> onBypass;
    std::function<void (float)> onMix;

    void paint (juce::Graphics& g) override
    {
        g.setColour (juce::Colour (0xff202228));
        g.fillRoundedRectangle (getLocalBounds().toFloat(), 8.0f);
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced (12);

        auto top = r.removeFromTop (22);
        if (hasEditor) editorBtn.setBounds (top.removeFromRight (80));
        bypassBtn.setBounds (top.removeFromRight (hasEditor ? 90 : 90));
        title.setBounds (top);

        r.removeFromTop (6);
        auto fileRow = r.removeFromTop (24);
        loadBtn.setBounds (fileRow.removeFromLeft (100));
        fileRow.removeFromLeft (10);
        fileLabel.setBounds (fileRow);

        if (hasMix)
        {
            r.removeFromTop (8);
            auto mixRow = r.removeFromTop (24);
            mixLabel.setBounds (mixRow.removeFromLeft (40));
            mix.setBounds (mixRow);
        }
    }

    static constexpr int preferredHeight (bool withMix) { return withMix ? 108 : 76; }

private:
    bool hasMix, hasEditor;
    juce::Label title, fileLabel, mixLabel;
    juce::TextButton loadBtn, editorBtn;
    juce::ToggleButton bypassBtn { "Bypass" };
    juce::Slider mix;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SlotStrip)
};
