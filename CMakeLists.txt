cmake_minimum_required(VERSION 3.22)

project(ToneStack VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)        # NAM core requires C++20
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Apple Silicon first; universal later if we want it.
if(NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64")
endif()

include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.15
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

#==============================================================================
# NeuralAmpModelerCore (NAM) — the C++ amp-model inference engine.
# Its own CMake only builds tool executables and exposes no library target, so
# we populate the sources (SOURCE_SUBDIR points at a dir with no CMakeLists) and
# compile them into our own static lib. Eigen comes from a submodule; the JSON
# header is vendored in-tree.
FetchContent_Declare(
    namcore
    GIT_REPOSITORY https://github.com/sdatkinson/NeuralAmpModelerCore.git
    GIT_TAG        v0.6.0
    GIT_SUBMODULES "Dependencies/eigen"
    GIT_SHALLOW    TRUE
    SOURCE_SUBDIR  NAM
)
FetchContent_MakeAvailable(namcore)

file(GLOB NAMCORE_SOURCES
    "${namcore_SOURCE_DIR}/NAM/*.cpp"
    "${namcore_SOURCE_DIR}/NAM/*/*.cpp")

add_library(namcore STATIC ${NAMCORE_SOURCES})
target_compile_features(namcore PUBLIC cxx_std_20)
target_include_directories(namcore SYSTEM PUBLIC
    "${namcore_SOURCE_DIR}"
    "${namcore_SOURCE_DIR}/Dependencies/eigen"
    "${namcore_SOURCE_DIR}/Dependencies/nlohmann")
# NAM_SAMPLE == float, matching JUCE's float buffers. PUBLIC so every TU agrees.
target_compile_definitions(namcore PUBLIC NAM_SAMPLE_FLOAT)
target_compile_definitions(namcore PRIVATE NAM_ENABLE_A2_FAST)

juce_add_gui_app(ToneStack
    PRODUCT_NAME "ToneStack"
    BUNDLE_ID    com.tonestack.app
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "ToneStack needs audio input to process your guitar."
    NEEDS_WEB_BROWSER TRUE
)

# Embed the built React UI (ui/dist zipped) as binary data served by the WebView.
juce_add_binary_data(ToneStackWebUI
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/assets/webui.zip)

# Shared audio-engine sources (used by both the app and the offline self-test).
set(TONESTACK_ENGINE_SOURCES
    src/engine/AudioEngine.cpp
    src/engine/IRNode.cpp
    src/engine/NamNode.cpp
    src/engine/Vst3Node.cpp
    src/engine/Preset.cpp
)

target_sources(ToneStack PRIVATE
    src/Main.cpp
    src/ui/MainComponent.cpp
    src/ui/WebUIComponent.cpp
    ${TONESTACK_ENGINE_SOURCES}
)

target_include_directories(ToneStack PRIVATE src)

target_compile_definitions(ToneStack PRIVATE
    JUCE_WEB_BROWSER=1          # React UI in a WebView
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1      # host VST3 plugins (T4)
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:ToneStack,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:ToneStack,JUCE_VERSION>"
)

target_link_libraries(ToneStack PRIVATE
    # WHOLE_ARCHIVE: NAM registers its architectures (WaveNet, LSTM, ...) via static
    # initializers; without force-load the linker strips those TUs from the static lib.
    "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
    ToneStackWebUI
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_dsp
    juce::juce_gui_extra
    PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)

# Hidden symbol visibility so the host's statically-linked JUCE symbols don't
# interpose a hosted JUCE plugin's own JUCE (the "two JUCEs in one process"
# crash). Required for a JUCE host that loads JUCE-based VST3s.
set_target_properties(ToneStack PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    C_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)

# Sign with a stable self-signed identity ("ToneStack Dev") if it exists, so macOS
# TCC remembers the microphone grant across rebuilds (ad-hoc signing changes the
# identity every build and re-prompts). Best-effort: skipped if the cert isn't set up.
add_custom_command(TARGET ToneStack POST_BUILD
    COMMAND /bin/sh -c "if security find-identity -v -p codesigning 2>/dev/null | grep -q 'ToneStack Dev'; then \
        codesign --force --sign 'ToneStack Dev' '$<TARGET_BUNDLE_DIR:ToneStack>' && echo '[sign] ToneStack Dev'; \
    else echo '[sign] ToneStack Dev cert not found - ad-hoc (mic will re-prompt). See README.'; fi"
    VERBATIM)

#==============================================================================
# Offline bench (console app) — simulated audio interface for deterministic
# testing + rendering. Runs the real engine without a device or GUI.
juce_add_console_app(tonestack_bench
    PRODUCT_NAME "tonestack_bench"
)

target_sources(tonestack_bench PRIVATE
    src/Bench.cpp
    ${TONESTACK_ENGINE_SOURCES}
)

target_include_directories(tonestack_bench PRIVATE src)

target_compile_definitions(tonestack_bench PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_STANDALONE_APPLICATION=1
    JUCE_MODAL_LOOPS_PERMITTED=1   # lets the headless bench pump the message loop
)

target_link_libraries(tonestack_bench PRIVATE
    "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_dsp
    juce::juce_audio_basics
    PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
