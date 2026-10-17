#include "TestHelpers.h"
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <atomic>
#include <thread>

using namespace testing;
using Catch::Matchers::WithinAbs;

TEST_CASE ("An empty chain passes audio through untouched", "[engine]")
{
    AudioEngine engine;
    engine.prepare (48000.0, 256);

    const auto in = sine (48000.0, 1024);
    const auto out = render (engine, in, 256);

    for (int i = 0; i < in.getNumSamples(); ++i)
        REQUIRE (out.getSample (0, i) == in.getSample (0, i));
}

TEST_CASE ("The chain runs plugin, then amp, then cab", "[engine]")
{
    // (x + 1) * 2 + 3 = 5 for x = 0. Any other order gives a different number.
    AudioEngine engine;
    engine.prepare (48000.0, 64);
    engine.setNode (AudioEngine::vst3Slot, adds (1.0f));
    engine.setNode (AudioEngine::namSlot, multiplies (2.0f));
    engine.setNode (AudioEngine::irSlot, adds (3.0f));

    const auto out = render (engine, constant (64, 0.0f), 64);
    REQUIRE (out.getSample (0, 0) == 5.0f);
    REQUIRE (out.getSample (0, 63) == 5.0f);
}

TEST_CASE ("A bypassed slot is skipped exactly", "[engine]")
{
    AudioEngine engine;
    engine.prepare (48000.0, 64);
    engine.setNode (AudioEngine::vst3Slot, adds (1.0f));
    engine.setNode (AudioEngine::namSlot, multiplies (2.0f));
    engine.setNode (AudioEngine::irSlot, adds (3.0f));

    engine.getNode (AudioEngine::namSlot)->setBypassed (true);
    REQUIRE (render (engine, constant (64, 0.0f), 64).getSample (0, 0) == 4.0f);   // (0 + 1) + 3

    engine.getNode (AudioEngine::namSlot)->setBypassed (false);
    REQUIRE (render (engine, constant (64, 0.0f), 64).getSample (0, 0) == 5.0f);
}

TEST_CASE ("Clearing a slot removes it from the chain", "[engine]")
{
    AudioEngine engine;
    engine.prepare (48000.0, 64);
    engine.setNode (AudioEngine::irSlot, adds (3.0f));
    engine.setNode (AudioEngine::irSlot, nullptr);

    REQUIRE (engine.getNode (AudioEngine::irSlot) == nullptr);
    REQUIRE (render (engine, constant (64, 0.5f), 64).getSample (0, 0) == 0.5f);
}

TEST_CASE ("Nodes are prepared with the engine's format", "[engine]")
{
    SECTION ("a node added after prepare() is prepared before it goes live")
    {
        AudioEngine engine;
        engine.prepare (44100.0, 512);
        auto node = adds (0.0f);
        auto* raw = node.get();
        engine.setNode (AudioEngine::namSlot, std::move (node));

        REQUIRE (raw->prepareCount == 1);
        REQUIRE (raw->preparedRate == 44100.0);
        REQUIRE (raw->preparedBlock == 512);
    }

    SECTION ("a node added before prepare() is prepared when the engine is")
    {
        AudioEngine engine;
        auto node = adds (0.0f);
        auto* raw = node.get();
        engine.setNode (AudioEngine::namSlot, std::move (node));
        REQUIRE (raw->prepareCount == 0);

        engine.prepare (96000.0, 128);
        REQUIRE (raw->prepareCount == 1);
        REQUIRE (raw->preparedRate == 96000.0);
    }

    SECTION ("a device change re-prepares every node")
    {
        AudioEngine engine;
        engine.prepare (48000.0, 256);
        auto node = adds (0.0f);
        auto* raw = node.get();
        engine.setNode (AudioEngine::irSlot, std::move (node));
        engine.prepare (44100.0, 1024);
        REQUIRE (raw->prepareCount == 2);
        REQUIRE (raw->preparedBlock == 1024);
    }
}

TEST_CASE ("releaseResources resets nodes and marks the engine unprepared", "[engine]")
{
    AudioEngine engine;
    engine.prepare (48000.0, 256);
    auto node = adds (0.0f);
    auto* raw = node.get();
    engine.setNode (AudioEngine::irSlot, std::move (node));

    engine.releaseResources();
    REQUIRE_FALSE (engine.isPrepared());
    REQUIRE (raw->resetCount == 1);
}

TEST_CASE ("getNode rejects out-of-range slots", "[engine]")
{
    AudioEngine engine;
    REQUIRE (engine.getNode (-1) == nullptr);
    REQUIRE (engine.getNode (AudioEngine::numSlots) == nullptr);
}

TEST_CASE ("Swapping nodes while audio runs never tears a block", "[engine][threads]")
{
    // The audio thread processes continuously while the message thread swaps the
    // cab slot in and out. Every block must come out either fully dry (0) or fully
    // processed (1): never a crash, never a half-swapped block.
    AudioEngine engine;
    engine.prepare (48000.0, 64);

    std::atomic<bool> stop { false };
    std::atomic<int> blocks { 0 }, torn { 0 };

    std::thread audio ([&]
    {
        juce::AudioBuffer<float> buf (1, 64);
        while (! stop.load())
        {
            buf.clear();
            engine.processBlock (buf);
            const float first = buf.getSample (0, 0);
            for (int i = 1; i < 64; ++i)
                if (buf.getSample (0, i) != first) { ++torn; break; }
            if (first != 0.0f && first != 1.0f) ++torn;
            ++blocks;
        }
    });

    for (int i = 0; i < 2000; ++i)
        engine.setNode (AudioEngine::irSlot, (i % 2 == 0) ? adds (1.0f) : nullptr);

    while (blocks.load() < 1000)
        std::this_thread::yield();
    stop = true;
    audio.join();

    REQUIRE (torn.load() == 0);
}
