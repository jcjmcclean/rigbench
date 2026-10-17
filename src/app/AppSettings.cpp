#include "AppSettings.h"

AppSettings::AppSettings (juce::File fileToUse)
    : file (std::move (fileToUse))
{
    const auto root = juce::JSON::parse (file);
    if (root.isObject())
        setupComplete = (bool) root.getProperty ("setupComplete", false);
}

void AppSettings::setSetupComplete (bool done)
{
    setupComplete = done;
    save();
}

void AppSettings::save() const
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("setupComplete", setupComplete);
    file.getParentDirectory().createDirectory();
    file.replaceWithText (juce::JSON::toString (juce::var (o)));
}
