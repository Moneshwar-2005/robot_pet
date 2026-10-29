#pragma once

/**
 * Kuro Robot Companion — Web Integration Protocol & Command Parser (Protocol v1.0)
 *
 * Implements bidirectional JSON messaging between the Kuro Web Control Center / Gateway
 * and the ESP32-S3 hardware companion:
 * - Versioned protocol enforcement (proto: "1.0")
 * - Inbound command dispatching and schema validation
 * - Request ID (reqId) correlation for all client queries
 * - Bounded payload size verification (max 512 bytes)
 * - Outbound telemetry formatting and event notifications
 * - Strict whitelist enforcement against unauthorized commands
 */

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "../include/config.h"

// Command Execution Result
struct CommandResult {
  bool success;
  const char* errorMsg;
  char responseJson[KURO_MAX_PAYLOAD_SIZE];
};

class KuroProtocol {
public:
  KuroProtocol();

  // Inbound message parser (validates size, proto, reqId, command, and arguments)
  static CommandResult parseAndExecute(const char* jsonStr, class FaceEngine& faceEngine, class NetManager& net);

  // Outbound message builders
  static void buildTelemetryJson(char* outBuffer, size_t maxLen, const DeviceHealth& health);
  static void buildSpeechEndedJson(char* outBuffer, size_t maxLen, const char* reqId = nullptr);
  static void buildPongJson(char* outBuffer, size_t maxLen, uint32_t timestamp, const char* reqId = nullptr);

  // Command validators
  static bool isValidMood(const char* mood);
  static bool isValidPalette(const char* palette);
  static bool isValidEyeShape(const char* shape);

  // Allowed Moods Whitelist (17 moods matching web control center)
  static const char* const ALLOWED_MOODS[17];
};
