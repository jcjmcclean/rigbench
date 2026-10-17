#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

//==============================================================================
// The audio device choices, as plain data for the UI's Settings screen and
// first-run setup, and a way to apply changes to them.
//
// describe() returns (see ui/src/types.ts AudioSetup):
//   driver, drivers[]               device type ("CoreAudio", "Windows Audio", "ASIO", "ALSA", ...)
//   inputDevice, inputDevices[]     where the guitar comes in
//   outputDevice, outputDevices[]   where you hear it
//   inputs[]                        the input device's channel names
//   input                           which of those the guitar is on (-1 if none)
//   listeningToAll                  true while every input is open (setup's "play a note" step)
//   sampleRate, sampleRates[]
//   bufferSize, bufferSizes[]
//   latencyMs                       round trip: input + output latency as the device reports it
//   builtInInput                    true if the input looks like the computer's own mic
//   error                           why the device couldn't be opened, or ""
//
// apply() takes any subset of { driver, inputDevice, outputDevice, input,
// listenToAllInputs, sampleRate, bufferSize } and returns "" or an error.
namespace AudioSetup
{
    // listeningToAll: whether the last change asked for every input (the app
    // tracks it; it can't be told apart from a 2-input device's default).
    juce::var describe (juce::AudioDeviceManager&, bool listeningToAll = false);

    // Round-trip latency in ms: input + output, as the device reports them.
    double roundTripMs (juce::AudioIODevice&);
    juce::String apply (juce::AudioDeviceManager&, const juce::var& changes);

    // Heuristic: does this device name look like a computer's built-in mic?
    // (Used to warn about feedback through speakers.)
    bool looksBuiltIn (const juce::String& deviceName);

    // Inputs the setup step listens to at once (meters are sent for these).
    static constexpr int maxInputs = 16;
}
