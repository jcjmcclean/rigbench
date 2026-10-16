#include <juce_gui_extra/juce_gui_extra.h>
#include "ui/WebUIComponent.h"

//==============================================================================
class ToneStackApplication : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override    { return "ToneStack"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override          { return false; }

    void initialise (const juce::String&) override
    {
        mainWindow.reset (new MainWindow ("ToneStack", *this));
    }

    void shutdown() override { mainWindow = nullptr; }
    void systemRequestedQuit() override { quit(); }

    //==========================================================================
    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow (const juce::String& name, JUCEApplication& appToUse)
            : DocumentWindow (name, juce::Colour (0xff17181c), DocumentWindow::allButtons),
              app (appToUse)
        {
            setUsingNativeTitleBar (true);
            setContentOwned (new WebUIComponent(), true);
            setResizable (true, true);
            setResizeLimits (640, 520, 2200, 1500);
            centreWithSize (getWidth(), getHeight());
            setVisible (true);
        }

        void closeButtonPressed() override { app.systemRequestedQuit(); }

    private:
        JUCEApplication& app;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainWindow)
    };

private:
    std::unique_ptr<MainWindow> mainWindow;
};

//==============================================================================
START_JUCE_APPLICATION (ToneStackApplication)
