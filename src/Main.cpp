#include <juce_gui_extra/juce_gui_extra.h>
#include "ui/WebUIComponent.h"
#include <iostream>

//==============================================================================
class RigbenchApplication : public juce::JUCEApplication,
                             public juce::MenuBarModel
{
public:
    const juce::String getApplicationName() override    { return "Rigbench"; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override          { return false; }

    void initialise (const juce::String& commandLine) override
    {
        // --smoke: open the window without an audio device, wait for the React UI
        // to load and reach the engine over the bridge, then quit. Exit code 0 if
        // it did within the timeout, 1 if not. CI runs this on every OS: it's the
        // only test that boots the real WebView.
        if (commandLine.contains ("--smoke"))
        {
            WebUIComponent::Options opts;
            opts.openAudioDevice = false;
            opts.onUiReady = [this]
            {
                std::cout << "SMOKE OK: UI loaded and reached the engine" << std::endl;
                setApplicationReturnValue (0);
                quit();
            };
            mainWindow.reset (new MainWindow ("Rigbench", *this, std::move (opts)));
            smokeTimeout = std::make_unique<SmokeTimeout> (*this);
            return;
        }

        mainWindow.reset (new MainWindow ("Rigbench", *this));

       #if JUCE_MAC
        juce::PopupMenu appleExtras;
        appleExtras.addItem (menuSettings, juce::String::fromUTF8 ("Settings\xe2\x80\xa6"));
        setMacMainMenu (this, &appleExtras);
       #endif
    }

    void shutdown() override
    {
        smokeTimeout = nullptr;
       #if JUCE_MAC
        setMacMainMenu (nullptr);
       #endif
        mainWindow = nullptr;
    }

    void systemRequestedQuit() override { quit(); }

    //== MenuBarModel ==========================================================
    enum MenuIDs { menuSettings = 1 };

    // Settings and Quit live in the app menu (setMacMainMenu's extras), as on any
    // Mac app, so there's no File menu.
    juce::StringArray getMenuBarNames() override { return {}; }

    juce::PopupMenu getMenuForIndex (int, const juce::String&) override { return {}; }

    void menuItemSelected (int menuItemID, int) override
    {
        switch (menuItemID)
        {
            case menuSettings:
                if (mainWindow != nullptr)
                    if (auto* ui = mainWindow->getWebUI())
                        ui->openAudioSettings();
                break;
            default: break;
        }
    }

    //==========================================================================
    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow (const juce::String& name, JUCEApplication& appToUse,
                    WebUIComponent::Options options = {})
            : DocumentWindow (name, juce::Colour (0xff141210), DocumentWindow::allButtons),
              app (appToUse)
        {
            auto* content = new WebUIComponent (std::move (options));
            webUI = content;

            setUsingNativeTitleBar (true);
            setContentOwned (content, true);
            setResizable (true, true);
            setResizeLimits (640, 520, 2200, 1500);
            centreWithSize (getWidth(), getHeight());
            setVisible (true);
        }

        WebUIComponent* getWebUI() const noexcept { return webUI; }
        void closeButtonPressed() override { app.systemRequestedQuit(); }

    private:
        JUCEApplication& app;
        WebUIComponent* webUI = nullptr;
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainWindow)
    };

private:
    struct SmokeTimeout final : juce::Timer
    {
        explicit SmokeTimeout (RigbenchApplication& a) : app (a) { startTimer (30000); }
        void timerCallback() override
        {
            stopTimer();
            std::cout << "SMOKE FAIL: the UI didn't reach the engine within 30 s" << std::endl;
            app.setApplicationReturnValue (1);
            app.quit();
        }
        RigbenchApplication& app;
    };

    std::unique_ptr<MainWindow> mainWindow;
    std::unique_ptr<SmokeTimeout> smokeTimeout;
};

//==============================================================================
START_JUCE_APPLICATION (RigbenchApplication)
