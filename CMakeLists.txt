cmake_minimum_required(VERSION 3.22)

project(Tonebench VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)        # NAM core requires C++20
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Architecture: arm64 for fast dev builds. Turn on TONEBENCH_UNIVERSAL for a
# distributable Universal 2 binary (arm64 + x86_64) so Intel Macs can run it too
# (roughly doubles build time). Pin a deployment target so a build on a newer
# macOS doesn't accidentally require that same OS on the recipient's machine.
option(TONEBENCH_UNIVERSAL "Build a Universal 2 (arm64;x86_64) binary for distribution" OFF)
if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    if(TONEBENCH_UNIVERSAL)
        set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64")
    else()
        set(CMAKE_OSX_ARCHITECTURES "arm64")
    endif()
endif()
if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
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

juce_add_gui_app(Tonebench
    PRODUCT_NAME "Tonebench"
    BUNDLE_ID    com.tonebench.app
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "Tonebench needs audio input to process your guitar."
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE          # Windows: WebView2 backs the UI bridge (ignored off-Windows)
)

# Build the React UI and pack it into assets/webui.zip, driven by the build so
# the embedded UI can never go stale (it used to be hand-built + git-committed,
# which is why the WebView needed a per-launch cache-bust hack). The work lives in
# cmake/pack_ui.cmake, run as a single `cmake -P` step so exit codes are checked
# and it behaves identically on macOS/Linux/Windows.
set(TONEBENCH_WEBUI_ZIP ${CMAKE_CURRENT_SOURCE_DIR}/assets/webui.zip)
set(TONEBENCH_UI_DIR     ${CMAKE_CURRENT_SOURCE_DIR}/ui)
find_program(NPM_EXECUTABLE NAMES npm.cmd npm)
if(NPM_EXECUTABLE)
    file(GLOB_RECURSE TONEBENCH_UI_SOURCES CONFIGURE_DEPENDS
        ${TONEBENCH_UI_DIR}/src/*
        ${TONEBENCH_UI_DIR}/index.html
        ${TONEBENCH_UI_DIR}/package.json)
    add_custom_command(
        OUTPUT  ${TONEBENCH_WEBUI_ZIP}
        COMMAND ${CMAKE_COMMAND}
                -D NPM=${NPM_EXECUTABLE}
                -D UI_DIR=${TONEBENCH_UI_DIR}
                -D ZIP=${TONEBENCH_WEBUI_ZIP}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/pack_ui.cmake
        DEPENDS ${TONEBENCH_UI_SOURCES}
        COMMENT "Building React UI -> assets/webui.zip"
        VERBATIM)
    add_custom_target(tonebench_ui DEPENDS ${TONEBENCH_WEBUI_ZIP})
else()
    message(WARNING "npm not found: embedding the existing assets/webui.zip. "
                    "Install Node.js to rebuild the UI from source.")
    add_custom_target(tonebench_ui)
endif()

# Embed the built React UI (ui/dist zipped) as binary data served by the WebView.
juce_add_binary_data(TonebenchWebUI
    SOURCES ${TONEBENCH_WEBUI_ZIP})
add_dependencies(TonebenchWebUI tonebench_ui)

# Shared audio-engine sources (used by both the app and the offline self-test).
set(TONEBENCH_ENGINE_SOURCES
    src/engine/AudioEngine.cpp
    src/engine/IRNode.cpp
    src/engine/NamNode.cpp
    src/engine/Vst3Node.cpp
    src/engine/Preset.cpp
)

# App logic that doesn't need the GUI (bridge operations, audio path, presets).
# Shared by the app and the tests.
set(TONEBENCH_APP_SOURCES
    src/app/AppSettings.cpp
    src/app/AudioPath.cpp
    src/app/AudioSetup.cpp
    src/app/PresetNames.cpp
    src/app/RigController.cpp
)

target_sources(Tonebench PRIVATE
    src/Main.cpp
    src/ui/WebUIComponent.cpp
    ${TONEBENCH_ENGINE_SOURCES}
    ${TONEBENCH_APP_SOURCES}
)

target_include_directories(Tonebench PRIVATE src)

target_compile_definitions(Tonebench PRIVATE
    JUCE_WEB_BROWSER=1          # React UI in a WebView
    JUCE_USE_WIN_WEBVIEW2=1     # Windows: use the WebView2 backend so the resource
                                # provider + native integration API exist (no-op elsewhere)
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1      # host VST3 plugins (T4)
    $<$<PLATFORM_ID:Linux>:JUCE_JACK=1>   # Linux: JACK (and PipeWire's JACK), alongside ALSA
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:Tonebench,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:Tonebench,JUCE_VERSION>"
)

target_link_libraries(Tonebench PRIVATE
    # WHOLE_ARCHIVE: NAM registers its architectures (WaveNet, LSTM, ...) via static
    # initializers; without force-load the linker strips those TUs from the static lib.
    "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
    TonebenchWebUI
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_dsp
    juce::juce_gui_extra
    PRIVATE
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)

# Hidden symbol visibility so the host's statically-linked JUCE symbols don't
# interpose a hosted JUCE plugin's own JUCE (the "two JUCEs in one process"
# crash). Required for a JUCE host that loads JUCE-based VST3s.
set_target_properties(Tonebench PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    C_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)

# Sign with a stable self-signed identity so macOS TCC remembers the microphone
# grant across rebuilds (ad-hoc signing changes the identity every build and
# re-prompts). Prefers "Tonebench Dev"; falls back to the legacy "ToneStack Dev"
# cert so an existing keychain identity keeps working after the rename. Best-effort.
if(APPLE)
    add_custom_command(TARGET Tonebench POST_BUILD
        COMMAND /bin/sh -c "APP='$<TARGET_BUNDLE_DIR:Tonebench>'; \
            for ID in 'Tonebench Dev' 'ToneStack Dev'; do \
                if security find-identity -v -p codesigning 2>/dev/null | grep -q \"$ID\"; then \
                    codesign --force --sign \"$ID\" \"$APP\" 2>/dev/null && echo \"[sign] signed with $ID\" && exit 0; \
                fi; \
            done; \
            echo '[sign] no stable identity - ad-hoc (mic re-prompts each build). See README.'; \
            true"
        VERBATIM)
endif()

#==============================================================================
# Offline bench (console app) — simulated audio interface for deterministic
# testing + rendering. Runs the real engine without a device or GUI.
juce_add_console_app(tonebench_cli
    PRODUCT_NAME "tonebench_cli"
)

target_sources(tonebench_cli PRIVATE
    src/Bench.cpp
    ${TONEBENCH_ENGINE_SOURCES}
)

target_include_directories(tonebench_cli PRIVATE src)

target_compile_definitions(tonebench_cli PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_STANDALONE_APPLICATION=1
    JUCE_MODAL_LOOPS_PERMITTED=1   # lets the headless bench pump the message loop
    # Hermetic test fixtures (committed .nam etc.) so the self-test's NAM + preset
    # suites are deterministic and never silently skip, incl. on CI.
    TONEBENCH_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets/test-fixtures"
)

target_link_libraries(tonebench_cli PRIVATE
    "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_dsp
    juce::juce_audio_basics
    PRIVATE
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)

#==============================================================================
# CTest: run the offline self-test via `ctest`. Two registrations:
#   selftest        — human-facing run (skips are allowed).
#   selftest_strict — CI gate: --strict makes a skipped CORE suite (preset
#                     round-trip, resampler) a FAILURE, so a green-but-skipped
#                     run can never pass. CI runs this one.
enable_testing()
add_test(NAME selftest        COMMAND tonebench_cli selftest)
add_test(NAME selftest_strict COMMAND tonebench_cli selftest --strict)

#==============================================================================
# Unit tests (Catch2): the engine, nodes, presets, and the GUI-free app logic
# (RigController, AudioPath, PresetNames). Each TEST_CASE is registered with
# CTest by catch_discover_tests, so `ctest` runs them alongside the self-test.
option(TONEBENCH_BUILD_TESTS "Build the Catch2 unit tests" ON)
if(TONEBENCH_BUILD_TESTS)
    FetchContent_Declare(
        Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG        v3.8.1
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(Catch2)
    list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
    include(Catch)

    juce_add_console_app(tonebench_tests PRODUCT_NAME "tonebench_tests")

    file(GLOB TONEBENCH_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
    target_sources(tonebench_tests PRIVATE
        ${TONEBENCH_TEST_SOURCES}
        ${TONEBENCH_ENGINE_SOURCES}
        ${TONEBENCH_APP_SOURCES}
    )
    target_include_directories(tonebench_tests PRIVATE src tests)
    target_compile_definitions(tonebench_tests PRIVATE
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_PLUGINHOST_VST3=1
        JUCE_STANDALONE_APPLICATION=1
        TONEBENCH_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets/test-fixtures"
        TONEBENCH_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    )
    target_link_libraries(tonebench_tests PRIVATE
        "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
        Catch2::Catch2WithMain
        juce::juce_audio_devices
        juce::juce_audio_processors
        juce::juce_audio_formats
        juce::juce_dsp
        juce::juce_audio_basics
        PRIVATE
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
    )
    # Tests compare exact sample values on purpose (bit-exact passthrough etc).
    # Linked after JUCE's warning flags so this comes later on the command line.
    add_library(tonebench_test_warnings INTERFACE)
    if(NOT MSVC)
        target_compile_options(tonebench_test_warnings INTERFACE -Wno-float-equal)
    endif()
    target_link_libraries(tonebench_tests PRIVATE tonebench_test_warnings)
    catch_discover_tests(tonebench_tests DISCOVERY_MODE PRE_TEST)
endif()
