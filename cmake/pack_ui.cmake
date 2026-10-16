# Build the React UI and pack ui/dist into a zip for embedding.
#
# Run via `cmake -D NPM=... -D UI_DIR=... -D ZIP=... -P cmake/pack_ui.cmake`.
# Done as a script (not a chain of add_custom_command COMMANDs) so exit codes are
# actually checked and it behaves the same on every platform. On Windows, chaining
# npm.cmd with later commands in one custom-build batch silently skips the zip step.
if(NOT NPM OR NOT UI_DIR OR NOT ZIP)
    message(FATAL_ERROR "pack_ui.cmake needs -D NPM= -D UI_DIR= -D ZIP=")
endif()

execute_process(
    COMMAND "${NPM}" run build
    WORKING_DIRECTORY "${UI_DIR}"
    RESULT_VARIABLE build_result)
if(NOT build_result EQUAL 0)
    message(FATAL_ERROR "npm run build failed (exit ${build_result})")
endif()

file(REMOVE "${ZIP}")
execute_process(
    COMMAND "${CMAKE_COMMAND}" -E tar cf "${ZIP}" --format=zip .
    WORKING_DIRECTORY "${UI_DIR}/dist"
    RESULT_VARIABLE tar_result)
if(NOT tar_result EQUAL 0)
    message(FATAL_ERROR "packing webui.zip failed (exit ${tar_result})")
endif()

if(NOT EXISTS "${ZIP}")
    message(FATAL_ERROR "webui.zip was not created at ${ZIP}")
endif()
message(STATUS "Packed UI -> ${ZIP}")
