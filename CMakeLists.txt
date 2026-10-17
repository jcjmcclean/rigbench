cmake_minimum_required(VERSION 3.22)

project(Rigbench VERSION 0.2.0 LANGUAGES C CXX) # x-release-please-version

set(CMAKE_CXX_STANDARD 20)        # NAM core requires C++20
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Architecture: arm64 for fast dev builds. Turn on RIGBENCH_UNIVERSAL for a
# distributable Universal 2 binary (arm64 + x86_64) so Intel Macs can run it too
# (roughly doubles build time). Pin a deployment target so a build on a newer
# macOS doesn't accidentally require that same OS on the recipient's machine.
option(RIGBENCH_UNIVERSAL "Build a Universal 2 (arm64;x86_64) binary for distribution" OFF)
if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    if(RIGBENCH_UNIVERSAL)
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

juce_add_gui_app(Rigbench
    PRODUCT_NAME "Rigbench"
    BUNDLE_ID    com.rigbench.app
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "Rigbench uses this to hear your guitar through your audio interface."
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE          # Windows: WebView2 backs the UI bridge (ignored off-Windows)
)

# Build the React UI and pack it into assets/webui.zip, driven by the build so
# the embedded UI can never go stale (it used to be hand-built + git-committed,
# which is why the WebView needed a per-launch cache-bust hack). The work lives in
# cmake/pack_ui.cmake, run as a single `cmake -P` step so exit codes are checked
# and it behaves identically on macOS/Linux/Windows.
set(RIGBENCH_WEBUI_ZIP ${CMAKE_CURRENT_SOURCE_DIR}/assets/webui.zip)
set(RIGBENCH_UI_DIR     ${CMAKE_CURRENT_SOURCE_DIR}/ui)
find_program(NPM_EXECUTABLE NAMES npm.cmd npm)
if(NPM_EXECUTABLE)
    file(GLOB_RECURSE RIGBENCH_UI_SOURCES CONFIGURE_DEPENDS
        ${RIGBENCH_UI_DIR}/src/*
        ${RIGBENCH_UI_DIR}/public/*
        ${RIGBENCH_UI_DIR}/vendor/*
        ${RIGBENCH_UI_DIR}/index.html
        ${RIGBENCH_UI_DIR}/package.json
        ${RIGBENCH_UI_DIR}/package-lock.json
        ${RIGBENCH_UI_DIR}/vite.config.ts
        ${RIGBENCH_UI_DIR}/tsconfig*.json)
    add_custom_command(
        OUTPUT  ${RIGBENCH_WEBUI_ZIP}
        COMMAND ${CMAKE_COMMAND}
                -D NPM=${NPM_EXECUTABLE}
                -D UI_DIR=${RIGBENCH_UI_DIR}
                -D ZIP=${RIGBENCH_WEBUI_ZIP}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/pack_ui.cmake
        DEPENDS ${RIGBENCH_UI_SOURCES}
        COMMENT "Building React UI -> assets/webui.zip"
        VERBATIM)
    add_custom_target(rigbench_ui DEPENDS ${RIGBENCH_WEBUI_ZIP})
else()
    message(WARNING "npm not found: embedding the existing assets/webui.zip. "
                    "Install Node.js to rebuild the UI from source.")
    add_custom_target(rigbench_ui)
endif()

# Embed the built React UI (ui/dist zipped) as binary data served by the WebView.
juce_add_binary_data(RigbenchWebUI
    SOURCES ${RIGBENCH_WEBUI_ZIP})
add_dependencies(RigbenchWebUI rigbench_ui)

# Shared audio-engine sources (used by both the app and the offline self-test).
set(RIGBENCH_ENGINE_SOURCES
    src/engine/AudioEngine.cpp
    src/engine/IRNode.cpp
    src/engine/NamNode.cpp
    src/engine/Vst3Node.cpp
    src/engine/Preset.cpp
)

# App logic that doesn't need the GUI (bridge operations, audio path, presets).
# Shared by the app and the tests.
set(RIGBENCH_APP_SOURCES
    src/app/AppSettings.cpp
    src/app/AudioPath.cpp
    src/app/AudioSetup.cpp
    src/app/PluginScanner.cpp
    src/app/PresetNames.cpp
    src/app/RigController.cpp
    src/app/Tuner.cpp
)

target_sources(Rigbench PRIVATE
    src/Main.cpp
    src/ui/WebUIComponent.cpp
    ${RIGBENCH_ENGINE_SOURCES}
    ${RIGBENCH_APP_SOURCES}
)

target_include_directories(Rigbench PRIVATE src)

target_compile_definitions(Rigbench PRIVATE
    JUCE_WEB_BROWSER=1          # React UI in a WebView
    JUCE_USE_WIN_WEBVIEW2=1     # Windows: use the WebView2 backend so the resource
                                # provider + native integration API exist (no-op elsewhere)
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1      # host VST3 plugins (T4)
    $<$<PLATFORM_ID:Linux>:JUCE_JACK=1>   # Linux: JACK (and PipeWire's JACK), alongside ALSA
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:Rigbench,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:Rigbench,JUCE_VERSION>"
)

target_link_libraries(Rigbench PRIVATE
    # WHOLE_ARCHIVE: NAM registers its architectures (WaveNet, LSTM, ...) via static
    # initializers; without force-load the linker strips those TUs from the static lib.
    "$<LINK_LIBRARY:WHOLE_ARCHIVE,namcore>"
    RigbenchWebUI
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
set_target_properties(Rigbench PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    C_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)

# Sign with a stable self-signed identity so macOS TCC remembers the microphone
# grant across rebuilds (ad-hoc signing changes the identity every build and
# re-prompts). Prefers "Rigbench Dev"; falls back to the legacy "ToneStack Dev"
# cert so an existing keychain identity keeps working after the rename. Best-effort.
if(APPLE)
    add_custom_command(TARGET Rigbench POST_BUILD
        COMMAND /bin/sh -c "APP='$<TARGET_BUNDLE_DIR:Rigbench>'; \
            for ID in 'Rigbench Dev' 'Tonebench Dev' 'ToneStack Dev'; do \
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
juce_add_console_app(rigbench_cli
    PRODUCT_NAME "rigbench_cli"
)

target_sources(rigbench_cli PRIVATE
    src/Bench.cpp
    ${RIGBENCH_ENGINE_SOURCES}
)

target_include_directories(rigbench_cli PRIVATE src)

target_compile_definitions(rigbench_cli PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_STANDALONE_APPLICATION=1
    JUCE_MODAL_LOOPS_PERMITTED=1   # lets the headless bench pump the message loop
    # Hermetic test fixtures (committed .nam etc.) so the self-test's NAM + preset
    # suites are deterministic and never silently skip, incl. on CI.
    RIGBENCH_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets/test-fixtures"
)

target_link_libraries(rigbench_cli PRIVATE
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
add_test(NAME selftest        COMMAND rigbench_cli selftest)
add_test(NAME selftest_strict COMMAND rigbench_cli selftest --strict)

#==============================================================================
# Unit tests (Catch2): the engine, nodes, presets, and the GUI-free app logic
# (RigController, AudioPath, PresetNames). Each TEST_CASE is registered with
# CTest by catch_discover_tests, so `ctest` runs them alongside the self-test.
option(RIGBENCH_BUILD_TESTS "Build the Catch2 unit tests" ON)
if(RIGBENCH_BUILD_TESTS)
    FetchContent_Declare(
        Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG        v3.8.1
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(Catch2)
    list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
    include(Catch)

    juce_add_console_app(rigbench_tests PRODUCT_NAME "rigbench_tests")

    file(GLOB RIGBENCH_TEST_SOURCES CONFIGURE_DEPENDS tests/*.cpp)
    target_sources(rigbench_tests PRIVATE
        ${RIGBENCH_TEST_SOURCES}
        ${RIGBENCH_ENGINE_SOURCES}
        ${RIGBENCH_APP_SOURCES}
    )
    target_include_directories(rigbench_tests PRIVATE src tests)
    target_compile_definitions(rigbench_tests PRIVATE
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_PLUGINHOST_VST3=1
        JUCE_STANDALONE_APPLICATION=1
        RIGBENCH_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets/test-fixtures"
        RIGBENCH_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    )
    target_link_libraries(rigbench_tests PRIVATE
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
    add_library(rigbench_test_warnings INTERFACE)
    if(NOT MSVC)
        target_compile_options(rigbench_test_warnings INTERFACE -Wno-float-equal)
    endif()
    target_link_libraries(rigbench_tests PRIVATE rigbench_test_warnings)
    # A hung test fails after two minutes, with its name, instead of stalling CI.
    catch_discover_tests(rigbench_tests DISCOVERY_MODE PRE_TEST PROPERTIES TIMEOUT 120)
endif()
