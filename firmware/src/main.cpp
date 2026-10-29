/**
 * Kuro Robot Companion — ESP32-S3 Firmware Foundation (v0.1.0)
 *
 * Scope: Phase 8.0 ESP32-S3 Hardware Foundation for 2.4" 320x240 TFT Visor
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Screen-only physical companion: zero motors, zero servos, zero speakers.
 * 2. Non-blocking elapsed-time animation loop (30 FPS target, 33ms intervals).
 * 3. Localized sprite dirty-region updates to conserve SPI bandwidth.
 * 4. Resilient Wi-Fi state machine with exponential backoff (never blocks face render).
 * 5. Bounded memory: leverages ESP32-S3 N8R8 8MB Octal PSRAM.
 * 6. Zero hardcoded secrets committed: safe wifi_credentials.h abstraction.
 */

#include "display_hal.h"
#include "face_engine.h"
#include "net_manager.h"
#include "protocol.h"
#include "../include/config.h"

#ifdef ARDUINO
#include <Arduino.h>
#endif

FaceEngine face(display);

// Non-blocking timer registers
static uint32_t lastTelemetryMs = 0;
static char serialBuffer[KURO_MAX_PAYLOAD_SIZE];
static uint16_t serialBufferIdx = 0;

void handleNetworkStatus(uint8_t state, const char* ip) {
  face.setWifiStatus(state, ip);
}

void setup() {
#ifdef ARDUINO
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("KURO ROBOT COMPANION — ESP32-S3 FIRMWARE FOUNDATION");
  Serial.printf("Version:  %s\n", KURO_FIRMWARE_VERSION);
  Serial.printf("Target:   ESP32-S3 (8MB Flash, 8MB Octal PSRAM)\n");
  Serial.printf("Display:  2.4\" SPI TFT LCD (%dx%d, Landscape)\n", TFT_SCREEN_WIDTH, TFT_SCREEN_HEIGHT);
  Serial.println("==================================================");
#endif

  // 1. Initialize Display Hardware Abstraction Layer
  display.init();
  display.setBrightness(100);

  // 2. Render Startup Splash Screen
  display.clear(COLOR_BG_DARK);
  display.drawRoundRect(8, 8, TFT_SCREEN_WIDTH - 16, TFT_SCREEN_HEIGHT - 16, 8, COLOR_PALETTE_CYAN);
  display.drawTextCentered(60, "KURO ROBOT COMPANION", COLOR_PALETTE_CYAN, 2);
  display.drawTextCentered(100, "ESP32-S3 Firmware Foundation", COLOR_WHITE, 1);
  display.drawTextCentered(120, "Visor: 2.4\" TFT 320x240 (Screen-Only)", COLOR_MUTED, 1);
  display.drawTextCentered(150, "Initializing Face Engine & Wi-Fi...", COLOR_STATUS_YELLOW, 1);

#ifdef ARDUINO
  delay(1500); // Only during boot sequence
#endif

  // 3. Initialize Face Engine
  face.init();
  face.setMood("attentive");
  face.setGlowPalette(GLOW_CYAN);
  face.setEyeShape(EYE_SHAPE_CURVED);

  // 4. Initialize Network Manager
  netManager.onStatusChange(handleNetworkStatus);
  netManager.begin();

#ifdef ARDUINO
  Serial.println("[Kuro Boot] System initialization complete. Entering 30 FPS non-blocking loop.");
#endif
}

void loop() {
#ifdef ARDUINO
  uint32_t now = millis();
#else
  static uint32_t now = 0;
  now += 10;
#endif

  // 1. High-priority Non-blocking Face Animation Loop (Every ~33ms = 30 FPS)
  face.update(now);

  // 2. Non-blocking Network State Machine (Every 250ms)
  netManager.update(now);

  // 3. Non-blocking Gateway Poll & Command Sync (Every 5 seconds)
  netManager.syncWithGateway(now, face);

  // 4. Periodic Local Telemetry Broadcast (Every 5 seconds)
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    DeviceHealth health;
    netManager.getHealth(health, face.getMood(), face.isSpeaking(), display.isInitialized());

    char telemetryMsg[KURO_MAX_PAYLOAD_SIZE];
    KuroProtocol::buildTelemetryJson(telemetryMsg, sizeof(telemetryMsg), health);

#ifdef ARDUINO
    Serial.println(telemetryMsg);
#endif
  }

  // 4. Handle Incoming Serial JSON Commands (USB-C / WebSerial)
#ifdef ARDUINO
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBufferIdx > 0) {
        serialBuffer[serialBufferIdx] = '\0';
        CommandResult result = KuroProtocol::parseAndExecute(serialBuffer, face, netManager);
        Serial.println(result.responseJson);
        serialBufferIdx = 0;
      }
    } else if (serialBufferIdx < sizeof(serialBuffer) - 1) {
      serialBuffer[serialBufferIdx++] = c;
    }
  }
#endif
}

