#pragma once

/**
 * Kuro Robot Companion — Non-Blocking Network & Telemetry Manager
 *
 * Implements safe, non-blocking Wi-Fi management for the ESP32-S3:
 * - Never blocks the loop() or face animation
 * - Bounded connection attempts with exponential backoff
 * - Clean mDNS registration (kuro-robot.local)
 * - Safe telemetry reporting (uptime, RSSI, heap, PSRAM)
 * - Zero hardcoded credentials committed
 */

#include <stdint.h>
#include <stdbool.h>
#include "../include/config.h"

// Check if user wifi_credentials.h exists
#if __has_include("../include/wifi_credentials.h")
#include "../include/wifi_credentials.h"
#else
#include "../include/wifi_credentials.example.h"
#endif

class NetManager {
public:
  NetManager();

  void begin(const char* ssid = KURO_WIFI_SSID, const char* pass = KURO_WIFI_PASSWORD);

  // Non-blocking update called in loop()
  void update(uint32_t nowMs);

  // State queries
  uint8_t getState() const { return _state; }
  bool isConnected() const { return _state == WIFI_STATE_CONNECTED; }
  const char* getIpAddress() const { return _ipAddress; }
  int8_t getRssi() const { return _rssi; }

  // Telemetry Snapshot
  void getHealth(DeviceHealth& outHealth, const char* currentMood, bool isSpeaking, bool displayOk);

  // Heartbeat & Activity tracking
  void recordActivity(uint32_t nowMs) { _lastActivityMs = nowMs; }
  bool isHeartbeatTimedOut(uint32_t nowMs) const {
    return (_lastActivityMs > 0 && (nowMs - _lastActivityMs > HEARTBEAT_TIMEOUT_MS));
  }
  uint32_t getLastActivityMs() const { return _lastActivityMs; }

  // Pairing & Session Token Management
  bool isPaired() const { return _sessionToken[0] != '\0'; }
  const char* getSessionToken() const { return _sessionToken; }
  void setSessionToken(const char* token);

  // Gateway Polling & Command Synchronization
  void syncWithGateway(uint32_t nowMs, class FaceEngine& faceEngine);

  // Callbacks
  typedef void (*NetStatusCallback)(uint8_t state, const char* ip);
  void onStatusChange(NetStatusCallback cb) { _statusCallback = cb; }

private:
  uint8_t _state;
  char _ssid[33];
  char _password[65];
  char _ipAddress[16];
  int8_t _rssi;

  // Bounded timer registers
  uint32_t _connectStartMs;
  uint32_t _nextRetryMs;
  uint32_t _retryIntervalMs;
  uint32_t _lastPollMs;
  uint32_t _lastActivityMs;
  uint32_t _lastGatewaySyncMs;
  char _sessionToken[64];

  NetStatusCallback _statusCallback;

  void setState(uint8_t newState);
  void triggerConnectionAttempt(uint32_t nowMs);
};

extern NetManager netManager;

