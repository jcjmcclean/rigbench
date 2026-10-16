# Roadmap

What's next for Tonebench, roughly in order. The rule for all of it: the main window stays a
plugin, an amp, and a cab. New things go where they don't get in the way of playing (setup,
settings, the empty-slot states), or they don't go in.

Research behind this (competitor apps, beginner pain points, where people get tones) is summarised
at the end.

## Now: get anyone from download to playing

*Done on the `overnight` branch: first-run setup, the new Settings screen, any input, and the
download links on empty slots. Still to do in this section: clearer errors for every failure.*

Most people who try an amp sim and give up do so before they hear anything: wrong input, no
permission, feedback, or no idea where to get a model. These fix that.

- **First-run setup.** Three short steps the first time you open the app, and again from Settings:
  1. *What's your guitar plugged into?* Pick the interface. If it's the computer's built-in mic,
     say to use headphones.
  2. *Play a few notes.* A live meter per input; Tonebench picks the one that lights up and says
     whether the level's too low, good, or clipping.
  3. *Where do you want to hear it?* Pick the output, with a short test sound.
  Monitoring stays off until this is done, so a laptop's mic and speakers can't howl on first launch.
- **A proper Settings screen** in the app's own style instead of the stock JUCE dialog. Plain
  words ("Guitar comes in from", "Responsiveness") with the numbers alongside, and the rest
  (driver type, exact sample rate and buffer) under Advanced.
- **Any input, not just input 1.** Many interfaces put the guitar on input 2.
- **"Where do I get a model?"** Empty slots link to free sources: TONE3000 for NAM models and IRs,
  free open-source VST3s (ChowDSP, Airwindows, Dragonfly). The website gets a page listing them.
- **Error messages people can act on.** Every failed load or preset says what went wrong and what
  to try.

## Next: the things every guitarist reaches for

- **Tuner.** There's no good free cross-platform tuner plugin, and you shouldn't need one. A
  button in the top bar; mutes the output while it's open.
- **Noise gate** on the input, one knob, off by default. High-gain NAM models hiss without one.
- **Input level that can boost**, in dB like the amp's level knob, so quiet pickups can drive a
  model properly. Meters in dB with a peak hold, so you can see clipping.
- **Starter sounds in the box.** One NAM model and one cab IR bundled so the app makes a sound
  before you've downloaded anything. Candidates with licences that allow it: the MIT-licensed
  model from the official NAM plugin repo, and a CC0 cab from Jester Dyne's Emerald pack.
- **Drag and drop** a `.nam`, IR, or `.vst3` onto a slot, plus a short "recent" list per slot.
- **Smooth knobs.** Ramp gain changes so dragging a knob doesn't crackle.

## Later

- **Browse TONE3000 from inside the app** (they have a free API for open-source apps; needs
  sign-in and attribution, no caching).
- **Plugin picker**: scan the standard VST3 folders and list what's installed, instead of a file
  dialog.
- **Record what you play**, dry and wet, to a WAV file (dry is handy for re-amping later).
- **Preset sharing** that brings the files with it, or tells you exactly what's missing.
- **Rename and delete presets**, and ask before overwriting one.
- **Stereo plugins** summed to mono properly (today only the left channel is kept).
- **Signed and notarised Mac builds**, so there's no right-click-Open step.

## Not planned

Things other amp-sim apps do that would make Tonebench into the fiddly kind of app it was built
to avoid: a pedalboard with unlimited slots, a looper, backing tracks, a DAW-style recorder, MIDI
mapping. If one of these turns out to matter to a lot of people, it can be revisited.

## Platform work

- **Windows:** ASIO (needs Steinberg's SDK licence; WASAPI works meanwhile).
- **Linux:** JACK and PipeWire-JACK support, and an AppImage that bundles WebKitGTK.
- **All:** CI builds and boots the real app on every OS (`Tonebench --smoke`) on every pull request.

## Background

- **No competitor has a setup wizard.** The closest are AmpliTube opening its audio window on first
  launch and Tonocracy showing a "Show Audio Settings" button until audio works. Neural DSP's
  standalones use the same stock dialog Tonebench has, and their help pages keep repeating "pick
  ASIO, enable one input, match the sample rate".
- **Most common beginner problems** (from support pages and forums): guitar on the wrong input;
  microphone permission denied; Windows driver confusion; buffer size and latency; hearing the dry
  guitar because the interface's direct monitor is on; crackles from sample-rate mismatches; input
  too quiet or clipping; feedback from a laptop's mic and speakers.
- **Where people get tones:** TONE3000 (formerly ToneHunt) is the hub for NAM models and has IRs
  too; free downloads, account needed. Many classic free IR sites (God's Cab, Kalthallen, Seacow,
  York Audio) are gone. There's no maintained "awesome list" for NAM/IR content; for open-source
  plugins, webprofusion/openaudio is the best list.
