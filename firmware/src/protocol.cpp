/**
 * Kuro Robot Companion — Web Integration Protocol Implementation (Protocol v1.0)
 */

#include "protocol.h"
#include "face_engine.h"
#include "net_manager.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef ARDUINO
#include <Arduino.h>
#endif

const char* const KuroProtocol::ALLOWED_MOODS[17] = {
  "idle", "attentive", "focused", "curious", "thinking", "happy", "excited",
  "sleepy", "playful", "caring", "surprised", "confused", "worried", "proud",
  "listening", "speaking", "error"
};

KuroProtocol::KuroProtocol() {}

bool KuroProtocol::isValidMood(const char* mood) {
  if (!mood) return false;
  for (size_t i = 0; i < 17; i++) {
    if (strcmp(mood, ALLOWED_MOODS[i]) == 0) return true;
  }
  return false;
}

bool KuroProtocol::isValidPalette(const char* palette) {
  if (!palette) return false;
  return (strcmp(palette, "cyan") == 0 ||
          strcmp(palette, "emerald") == 0 ||
          strcmp(palette, "amber") == 0 ||
          strcmp(palette, "violet") == 0);
}

bool KuroProtocol::isValidEyeShape(const char* shape) {
  if (!shape) return false;
  return (strcmp(shape, "curved") == 0 ||
          strcmp(shape, "round") == 0 ||
          strcmp(shape, "pixel") == 0);
}

// Simple key-value string extractor for robust embedded JSON parsing
static bool extractJsonString(const char* json, const char* key, char* outVal, size_t maxLen) {
  char searchKey[48];
  snprintf(searchKey, sizeof(searchKey), "\"%s\"", key);
  const char* keyPos = strstr(json, searchKey);
  if (!keyPos) return false;

  const char* colon = strchr(keyPos + strlen(searchKey), ':');
  if (!colon) return false;

  const char* startQuote = strchr(colon, '\"');
  if (!startQuote) return false;

  startQuote++;
  const char* endQuote = strchr(startQuote, '\"');
  if (!endQuote) return false;

  size_t len = endQuote - startQuote;
  if (len >= maxLen) len = maxLen - 1;

  strncpy(outVal, startQuote, len);
  outVal[len] = '\0';
  return true;
}

static bool extractJsonUint32(const char* json, const char* key, uint32_t* outVal) {
  char searchKey[48];
  snprintf(searchKey, sizeof(searchKey), "\"%s\"", key);
  const char* keyPos = strstr(json, searchKey);
  if (!keyPos) return false;

  const char* colon = strchr(keyPos + strlen(searchKey), ':');
  if (!colon) return false;

  // Skip whitespace
  colon++;
  while (*colon == ' ' || *colon == '\t') colon++;

  *outVal = (uint32_t)strtoul(colon, nullptr, 10);
  return true;
}

static void appendReqIdField(char* outBuffer, size_t maxLen, const char* reqId) {
  if (reqId && strlen(reqId) > 0) {
    char fragment[64];
    snprintf(fragment, sizeof(fragment), ",\"reqId\":\"%s\"", reqId);
    strncat(outBuffer, fragment, maxLen - strlen(outBuffer) - 1);
  }
}

CommandResult KuroProtocol::parseAndExecute(const char* jsonStr, FaceEngine& faceEngine, NetManager& net) {
  CommandResult result;
  result.success = false;
  result.errorMsg = nullptr;
  result.responseJson[0] = '\0';

  // 1. Validate payload size bound
  if (!jsonStr || strlen(jsonStr) == 0) {
    result.errorMsg = "Empty JSON payload";
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"EMPTY_PAYLOAD\",\"msg\":\"Empty JSON payload\"}",
             KURO_PROTOCOL_VERSION);
    return result;
  }

  if (strlen(jsonStr) > KURO_MAX_PAYLOAD_SIZE) {
    result.errorMsg = "Oversized payload";
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"OVERSIZED_PAYLOAD\",\"msg\":\"Payload exceeds %d bytes\"}",
             KURO_PROTOCOL_VERSION, KURO_MAX_PAYLOAD_SIZE);
    return result;
  }

  // 2. Extract correlation request ID if provided
  char reqId[40] = {0};
  extractJsonString(jsonStr, "reqId", reqId, sizeof(reqId));

  // 3. Protocol Version check (if specified, must match "1.0")
  char proto[16] = {0};
  if (extractJsonString(jsonStr, "proto", proto, sizeof(proto))) {
    if (strcmp(proto, KURO_PROTOCOL_VERSION) != 0) {
      result.errorMsg = "Unsupported protocol version";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"UNSUPPORTED_PROTO\",\"msg\":\"Protocol version '%s' not supported\"",
               KURO_PROTOCOL_VERSION, proto);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }
  }

  // 4. Command extraction
  char cmd[32] = {0};
  if (!extractJsonString(jsonStr, "cmd", cmd, sizeof(cmd))) {
    result.errorMsg = "Missing required 'cmd' field";
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"MISSING_CMD\",\"msg\":\"Missing required 'cmd' field\"",
             KURO_PROTOCOL_VERSION);
    appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
    strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
    return result;
  }

  // Record incoming activity to reset heartbeat loss timer
#ifdef ARDUINO
  net.recordActivity(millis());
#else
  net.recordActivity(1000);
#endif

  // Command 1: set_mood
  if (strcmp(cmd, "set_mood") == 0) {
    char mood[24] = {0};
    if (!extractJsonString(jsonStr, "mood", mood, sizeof(mood))) {
      result.errorMsg = "Missing 'mood' parameter";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"MISSING_PARAM\",\"msg\":\"Missing 'mood' parameter\"",
               KURO_PROTOCOL_VERSION);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }

    if (!isValidMood(mood)) {
      result.errorMsg = "Invalid mood value";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"INVALID_MOOD\",\"msg\":\"Mood '%s' not recognized\"",
               KURO_PROTOCOL_VERSION, mood);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }

    faceEngine.setMood(mood);

    // Optional palette update in same command
    char palette[20] = {0};
    if (extractJsonString(jsonStr, "palette", palette, sizeof(palette)) && isValidPalette(palette)) {
      if (strcmp(palette, "cyan") == 0) faceEngine.setGlowPalette(GLOW_CYAN);
      else if (strcmp(palette, "emerald") == 0) faceEngine.setGlowPalette(GLOW_EMERALD);
      else if (strcmp(palette, "amber") == 0) faceEngine.setGlowPalette(GLOW_AMBER);
      else if (strcmp(palette, "violet") == 0) faceEngine.setGlowPalette(GLOW_VIOLET);
    }

    result.success = true;
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"ack\",\"proto\":\"%s\",\"cmd\":\"set_mood\",\"mood\":\"%s\",\"status\":\"ok\"",
             KURO_PROTOCOL_VERSION, mood);
    appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
    strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
    return result;
  }

  // Command 2: speak (Visual Speech Text & Phonemes)
  if (strcmp(cmd, "speak") == 0) {
    char speech[224] = {0};
    if (!extractJsonString(jsonStr, "speech", speech, sizeof(speech))) {
      result.errorMsg = "Missing 'speech' text parameter";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"MISSING_PARAM\",\"msg\":\"Missing 'speech' text parameter\"",
               KURO_PROTOCOL_VERSION);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }

    uint32_t duration = 0;
    extractJsonUint32(jsonStr, "durationMs", &duration);

    faceEngine.speak(speech, duration);

    result.success = true;
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"ack\",\"proto\":\"%s\",\"cmd\":\"speak\",\"status\":\"ok\"",
             KURO_PROTOCOL_VERSION);
    appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
    strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
    return result;
  }

  // Command 3: set_palette
  if (strcmp(cmd, "set_palette") == 0) {
    char palette[20] = {0};
    if (!extractJsonString(jsonStr, "palette", palette, sizeof(palette)) || !isValidPalette(palette)) {
      result.errorMsg = "Invalid or missing 'palette' parameter";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"INVALID_PALETTE\",\"msg\":\"Palette must be cyan, emerald, amber, or violet\"",
               KURO_PROTOCOL_VERSION);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }

    if (strcmp(palette, "cyan") == 0) faceEngine.setGlowPalette(GLOW_CYAN);
    else if (strcmp(palette, "emerald") == 0) faceEngine.setGlowPalette(GLOW_EMERALD);
    else if (strcmp(palette, "amber") == 0) faceEngine.setGlowPalette(GLOW_AMBER);
    else if (strcmp(palette, "violet") == 0) faceEngine.setGlowPalette(GLOW_VIOLET);

    result.success = true;
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"ack\",\"proto\":\"%s\",\"cmd\":\"set_palette\",\"palette\":\"%s\",\"status\":\"ok\"",
             KURO_PROTOCOL_VERSION, palette);
    appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
    strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
    return result;
  }

  // Command 4: set_eye_shape
  if (strcmp(cmd, "set_eye_shape") == 0) {
    char shape[20] = {0};
    if (!extractJsonString(jsonStr, "shape", shape, sizeof(shape)) || !isValidEyeShape(shape)) {
      result.errorMsg = "Invalid or missing 'shape' parameter";
      snprintf(result.responseJson, sizeof(result.responseJson),
               "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"INVALID_SHAPE\",\"msg\":\"Shape must be curved, round, or pixel\"",
               KURO_PROTOCOL_VERSION);
      appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
      strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
      return result;
    }

    if (strcmp(shape, "curved") == 0) faceEngine.setEyeShape(EYE_SHAPE_CURVED);
    else if (strcmp(shape, "round") == 0) faceEngine.setEyeShape(EYE_SHAPE_ROUND);
    else if (strcmp(shape, "pixel") == 0) faceEngine.setEyeShape(EYE_SHAPE_PIXEL);

    result.success = true;
    snprintf(result.responseJson, sizeof(result.responseJson),
             "{\"type\":\"ack\",\"proto\":\"%s\",\"cmd\":\"set_eye_shape\",\"shape\":\"%s\",\"status\":\"ok\"",
             KURO_PROTOCOL_VERSION, shape);
    appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
    strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
    return result;
  }

  // Command 5: ping
  if (strcmp(cmd, "ping") == 0) {
    uint32_t ts = 0;
    extractJsonUint32(jsonStr, "ts", &ts);
    result.success = true;
    buildPongJson(result.responseJson, sizeof(result.responseJson), ts, reqId);
    return result;
  }

  // Command 6: get_status
  if (strcmp(cmd, "get_status") == 0) {
    DeviceHealth health;
    net.getHealth(health, faceEngine.getMood(), faceEngine.isSpeaking(), true);
    health.reqId = reqId;
    result.success = true;
    buildTelemetryJson(result.responseJson, sizeof(result.responseJson), health);
    return result;
  }

  // Unknown command
  result.errorMsg = "Unknown command";
  snprintf(result.responseJson, sizeof(result.responseJson),
           "{\"type\":\"error\",\"proto\":\"%s\",\"code\":\"UNKNOWN_CMD\",\"msg\":\"Command '%s' not supported\"",
           KURO_PROTOCOL_VERSION, cmd);
  appendReqIdField(result.responseJson, sizeof(result.responseJson), reqId);
  strncat(result.responseJson, "}", sizeof(result.responseJson) - strlen(result.responseJson) - 1);
  return result;
}

void KuroProtocol::buildTelemetryJson(char* outBuffer, size_t maxLen, const DeviceHealth& health) {
  const char* wifiStateStr = "disconnected";
  if (health.wifiState == WIFI_STATE_CONNECTED) wifiStateStr = "connected";
  else if (health.wifiState == WIFI_STATE_CONNECTING) wifiStateStr = "connecting";
  else if (health.wifiState == WIFI_STATE_FAILED) wifiStateStr = "failed";

  snprintf(outBuffer, maxLen,
    "{\"type\":\"telemetry\",\"proto\":\"%s\",\"version\":\"%s\",\"uptime\":%u,\"wifiState\":\"%s\","
    "\"ip\":\"%s\",\"rssi\":%d,\"freeHeap\":%u,\"freePsram\":%u,\"mood\":\"%s\","
    "\"isSpeaking\":%s,\"displayOk\":%s",
    KURO_PROTOCOL_VERSION,
    health.firmwareVersion ? health.firmwareVersion : KURO_FIRMWARE_VERSION,
    health.uptimeSeconds,
    wifiStateStr,
    health.ipAddress,
    health.rssi,
    health.freeHeapBytes,
    health.freePsramBytes,
    health.activeMood,
    health.isSpeaking ? "true" : "false",
    health.displayOk ? "true" : "false"
  );

  appendReqIdField(outBuffer, maxLen, health.reqId);
  strncat(outBuffer, "}", maxLen - strlen(outBuffer) - 1);
}

void KuroProtocol::buildSpeechEndedJson(char* outBuffer, size_t maxLen, const char* reqId) {
  snprintf(outBuffer, maxLen, "{\"type\":\"event\",\"proto\":\"%s\",\"event\":\"speech_ended\"", KURO_PROTOCOL_VERSION);
  appendReqIdField(outBuffer, maxLen, reqId);
  strncat(outBuffer, "}", maxLen - strlen(outBuffer) - 1);
}

void KuroProtocol::buildPongJson(char* outBuffer, size_t maxLen, uint32_t timestamp, const char* reqId) {
  snprintf(outBuffer, maxLen, "{\"type\":\"pong\",\"proto\":\"%s\",\"ts\":%u,\"version\":\"%s\"",
           KURO_PROTOCOL_VERSION, timestamp, KURO_FIRMWARE_VERSION);
  appendReqIdField(outBuffer, maxLen, reqId);
  strncat(outBuffer, "}", maxLen - strlen(outBuffer) - 1);
}
