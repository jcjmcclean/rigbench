#pragma once

#include <juce_core/juce_core.h>

//==============================================================================
// Small app-wide preferences, kept as JSON in the app's data folder. (The audio
// device itself is saved separately, as JUCE's own XML.)
class AppSettings
{
public:
    explicit AppSettings (juce::File fileToUse);

    // True once the first-run setup has been finished (or skipped). Until then
    // the app starts with monitoring off, so a laptop's built-in mic and
    // speakers can't feed back before anyone has chosen a device.
    bool isSetupComplete() const noexcept { return setupComplete; }
    void setSetupComplete (bool done);

private:
    juce::File file;
    bool setupComplete = false;

    void save() const;
};
