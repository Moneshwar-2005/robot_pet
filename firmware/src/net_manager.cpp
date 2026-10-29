/**
 * Kuro Robot Companion — Non-Blocking Network & Telemetry Manager Implementation
 */

#include "net_manager.h"
#include "protocol.h"
#include "face_engine.h"
#include <string.h>
#include <stdio.h>

#ifdef ARDUINO
#include <WiFi.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#endif

NetManager netManager;

NetManager::NetManager()
  : _state(WIFI_STATE_DISCONNECTED),
    _rssi(-100),
    _connectStartMs(0),
    _nextRetryMs(0),
    _retryIntervalMs(WIFI_RETRY_INTERVAL_MIN_MS),
    _lastPollMs(0),
    _lastActivityMs(0),
    _lastGatewaySyncMs(0),
    _statusCallback(nullptr) {
  _ssid[0] = '\0';
  _password[0] = '\0';
  _sessionToken[0] = '\0';
  strncpy(_ipAddress, "0.0.0.0", sizeof(_ipAddress) - 1);
}

void NetManager::begin(const char* ssid, const char* pass) {
  if (ssid) {
    strncpy(_ssid, ssid, sizeof(_ssid) - 1);
    _ssid[sizeof(_ssid) - 1] = '\0';
  }
  if (pass) {
    strncpy(_password, pass, sizeof(_password) - 1);
    _password[sizeof(_password) - 1] = '\0';
  }

#ifdef ARDUINO
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false); // Managed explicitly by our non-blocking state machine
#endif

  // If SSID is placeholder or empty, stay disconnected
  if (strcmp(_ssid, "YOUR_2.4GHZ_WIFI_SSID") == 0 || strlen(_ssid) == 0) {
    setState(WIFI_STATE_DISCONNECTED);
    return;
  }

  triggerConnectionAttempt(0);
}

void NetManager::setState(uint8_t newState) {
  if (_state == newState) return;
  _state = newState;
  if (_statusCallback) {
    _statusCallback(_state, _ipAddress);
  }
}

void NetManager::triggerConnectionAttempt(uint32_t nowMs) {
  setState(WIFI_STATE_CONNECTING);
  _connectStartMs = nowMs;

#ifdef ARDUINO
  if (strlen(_ssid) > 0) {
    WiFi.begin(_ssid, _password);
  }
#endif
}

void NetManager::update(uint32_t nowMs) {
  // Poll state every 250ms to keep CPU free for 30 FPS rendering
  if (nowMs - _lastPollMs < 250) {
    return;
  }
  _lastPollMs = nowMs;

  switch (_state) {
    case WIFI_STATE_CONNECTING: {
#ifdef ARDUINO
      if (WiFi.status() == WL_CONNECTED) {
        String ipStr = WiFi.localIP().toString();
        strncpy(_ipAddress, ipStr.c_str(), sizeof(_ipAddress) - 1);
        _ipAddress[sizeof(_ipAddress) - 1] = '\0';
        _rssi = WiFi.RSSI();

        // Register mDNS (kuro-robot.local)
        MDNS.begin(MDNS_HOSTNAME);
        MDNS.addService("http", "tcp", 80);
        MDNS.addService("ws", "tcp", WEBSOCKET_PORT);

        _retryIntervalMs = WIFI_RETRY_INTERVAL_MIN_MS;
        setState(WIFI_STATE_CONNECTED);
        return;
      }
#endif
      // Bounded connection attempt timeout (12 seconds)
      if (nowMs - _connectStartMs >= WIFI_CONNECT_TIMEOUT_MS) {
#ifdef ARDUINO
        WiFi.disconnect(true);
#endif
        setState(WIFI_STATE_FAILED);
        _nextRetryMs = nowMs + _retryIntervalMs;
        // Exponential backoff up to 60 seconds
        _retryIntervalMs = (_retryIntervalMs * 2 > WIFI_RETRY_INTERVAL_MAX_MS)
          ? WIFI_RETRY_INTERVAL_MAX_MS
          : (_retryIntervalMs * 2);
      }
      break;
    }

    case WIFI_STATE_CONNECTED: {
#ifdef ARDUINO
      if (WiFi.status() != WL_CONNECTED) {
        setState(WIFI_STATE_DISCONNECTED);
        _nextRetryMs = nowMs + WIFI_RETRY_INTERVAL_MIN_MS;
        _retryIntervalMs = WIFI_RETRY_INTERVAL_MIN_MS;
        return;
      }
      _rssi = WiFi.RSSI();
#endif
      break;
    }

    case WIFI_STATE_FAILED:
    case WIFI_STATE_DISCONNECTED: {
      // Reconnection backoff timer check
      if (strlen(_ssid) > 0 && strcmp(_ssid, "YOUR_2.4GHZ_WIFI_SSID") != 0 && nowMs >= _nextRetryMs) {
        triggerConnectionAttempt(nowMs);
      }
      break;
    }
  }
}

void NetManager::getHealth(DeviceHealth& outHealth, const char* currentMood, bool isSpeaking, bool displayOk) {
  outHealth.protocolVersion = KURO_PROTOCOL_VERSION;
  outHealth.firmwareVersion = KURO_FIRMWARE_VERSION;
  outHealth.reqId = nullptr;
#ifdef ARDUINO
  outHealth.uptimeSeconds = (uint32_t)(millis() / 1000);
  outHealth.freeHeapBytes = esp_get_free_heap_size();
  outHealth.freePsramBytes = psramFound() ? heap_caps_get_free_size(MALLOC_CAP_SPIRAM) : 0;
#else
  outHealth.uptimeSeconds = 0;
  outHealth.freeHeapBytes = 256000;
  outHealth.freePsramBytes = 8000000;
#endif

  outHealth.wifiState = _state;
  outHealth.rssi = _rssi;
  strncpy(outHealth.ipAddress, _ipAddress, sizeof(outHealth.ipAddress) - 1);
  outHealth.ipAddress[sizeof(outHealth.ipAddress) - 1] = '\0';

  if (currentMood) {
    strncpy(outHealth.activeMood, currentMood, sizeof(outHealth.activeMood) - 1);
    outHealth.activeMood[sizeof(outHealth.activeMood) - 1] = '\0';
  } else {
    outHealth.activeMood[0] = '\0';
  }

  outHealth.isSpeaking = isSpeaking;
  outHealth.displayOk = displayOk;
}

void NetManager::setSessionToken(const char* token) {
  if (token) {
    strncpy(_sessionToken, token, sizeof(_sessionToken) - 1);
    _sessionToken[sizeof(_sessionToken) - 1] = '\0';
  } else {
    _sessionToken[0] = '\0';
  }
}

void NetManager::syncWithGateway(uint32_t nowMs, FaceEngine& faceEngine) {
  if (nowMs - _lastGatewaySyncMs < TELEMETRY_INTERVAL_MS) {
    return;
  }
  _lastGatewaySyncMs = nowMs;

  if (_state != WIFI_STATE_CONNECTED || !isPaired()) {
    return;
  }

#ifdef ARDUINO
  HTTPClient http;
  char gatewayUrl[128];
  snprintf(gatewayUrl, sizeof(gatewayUrl), "http://%s:%d/api/device/poll", KURO_GATEWAY_HOST, KURO_GATEWAY_PORT);

  http.begin(gatewayUrl);
  http.setTimeout(KURO_GATEWAY_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  char authHeader[96];
  snprintf(authHeader, sizeof(authHeader), "Bearer %s", _sessionToken);
  http.addHeader("Authorization", authHeader);

  DeviceHealth health;
  getHealth(health, faceEngine.getMood(), faceEngine.isSpeaking(), true);

  char telemetryJson[KURO_MAX_PAYLOAD_SIZE];
  KuroProtocol::buildTelemetryJson(telemetryJson, sizeof(telemetryJson), health);

  char postBody[KURO_MAX_PAYLOAD_SIZE + 64];
  snprintf(postBody, sizeof(postBody), "{\"telemetry\":%s}", telemetryJson);

  int httpCode = http.POST(postBody);

  if (httpCode == 200) {
    recordActivity(millis());
    String payload = http.getString();
    // Parse commands array if present
    int cmdIdx = payload.indexOf("{\"cmd\":");
    if (cmdIdx < 0) cmdIdx = payload.indexOf("{\"proto\":");
    if (cmdIdx >= 0) {
      int endIdx = payload.indexOf("}", cmdIdx);
      if (endIdx > cmdIdx) {
        String cmdObj = payload.substring(cmdIdx, endIdx + 1);
        KuroProtocol::parseAndExecute(cmdObj.c_str(), faceEngine, *this);
      }
    }
  } else if (httpCode == 401) {
    // Session token expired or revoked on server
    _sessionToken[0] = '\0';
  }
  http.end();
#else
  recordActivity(nowMs);
#endif
}

