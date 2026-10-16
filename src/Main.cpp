#include <juce_gui_extra/juce_gui_extra.h>
#include "ui/WebUIComponent.h"

//==============================================================================
class ToneStackApplication : public juce::JUCEApplication,
                             public juce::MenuBarModel
{
public:
    const juce::String getApplicationName() override    { return "ToneStack"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override          { return false; }

    void initialise (const juce::String&) override
    {
        mainWindow.reset (new MainWindow ("ToneStack", *this));

       #if JUCE_MAC
        juce::PopupMenu appleExtras;
        appleExtras.addItem (menuSettings, "Settings...");
        setMacMainMenu (this, &appleExtras);
       #endif
    }

    void shutdown() override
    {
       #if JUCE_MAC
        setMacMainMenu (nullptr);
       #endif
        mainWindow = nullptr;
    }

    void systemRequestedQuit() override { quit(); }

    //== MenuBarModel ==========================================================
    enum MenuIDs { menuSettings = 1, menuSavePreset, menuQuit };

    juce::StringArray getMenuBarNames() override { return { "File" }; }

    juce::PopupMenu getMenuForIndex (int, const juce::String& name) override
    {
        juce::PopupMenu menu;
        if (name == "File")
        {
            menu.addItem (menuSettings, "Audio Settings...");
            menu.addSeparator();
            menu.addItem (menuQuit, "Quit ToneStack");
        }
        return menu;
    }

    void menuItemSelected (int menuItemID, int) override
    {
        switch (menuItemID)
        {
            case menuSettings:
                if (mainWindow != nullptr)
                    if (auto* ui = mainWindow->getWebUI())
                        ui->openAudioSettings();
                break;
            case menuQuit:
                quit();
                break;
            default: break;
        }
    }

    //==========================================================================
    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow (const juce::String& name, JUCEApplication& appToUse)
            : DocumentWindow (name, juce::Colour (0xff141210), DocumentWindow::allButtons),
              app (appToUse)
        {
            auto* content = new WebUIComponent();
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
    std::unique_ptr<MainWindow> mainWindow;
};

//==============================================================================
START_JUCE_APPLICATION (ToneStackApplication)
