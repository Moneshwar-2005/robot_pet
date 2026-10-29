#pragma once

/**
 * Kuro Robot Companion — Hardware Configuration & Constants
 *
 * Board Target: ESP32-S3-DevKitC-1 with ESP32-S3-WROOM-1-N8R8
 * Display Visor: 2.4" SPI TFT LCD (320x240, Landscape)
 *
 * CRITICAL HARDWARE SAFETY NOTICE:
 * All pin assignments below are PROVISIONAL based on pre-purchasing review (docs/HARDWARE_SPECIFICATION.md).
 * They must be physically verified against the received development board and display pinout
 * before applying power.
 */

#include <stdint.h>

#ifndef KURO_FIRMWARE_VERSION
#define KURO_FIRMWARE_VERSION "0.1.0"
#endif

#ifndef KURO_PROTOCOL_VERSION
#define KURO_PROTOCOL_VERSION "1.0"
#endif

#define KURO_MAX_PAYLOAD_SIZE       512   // Maximum safe inbound JSON message size (bytes)
#define HEARTBEAT_TIMEOUT_MS        15000 // Inactivity threshold before flagging lost web connection

// =============================================================================
// 1. PROVISIONAL PIN ASSIGNMENTS (ESP32-S3 to 2.4" SPI TFT LCD)
// =============================================================================

// SPI Bus Interface (FSPI / SPI2 on ESP32-S3)
#define KURO_PIN_TFT_CS       10    // Chip Select (Active Low) - PROVISIONAL
#define KURO_PIN_TFT_RST      9     // Hardware Reset (Active Low) - PROVISIONAL
#define KURO_PIN_TFT_DC       11    // Data/Command Control (1=Data, 0=Cmd) - PROVISIONAL
#define KURO_PIN_TFT_MOSI     12    // SPI MOSI / SDI Data - PROVISIONAL
#define KURO_PIN_TFT_SCK      13    // SPI Clock - PROVISIONAL
#define KURO_PIN_TFT_BLK      14    // Backlight PWM Control Pin - PROVISIONAL
#define KURO_PIN_TFT_MISO     -1    // Unused for write-only graphics

// RESTRICTED PINS ON ESP32-S3-WROOM-1-N8R8 (DO NOT ASSIGN):
// - GPIO 33, 34, 35, 36, 37: Internally wired to 8MB Octal PSRAM!
// - GPIO 0, 45, 46: Strapping pins affecting boot mode.

// =============================================================================
// 2. DISPLAY DIMENSIONS & BUS SETTINGS
// =============================================================================

#define TFT_SCREEN_WIDTH      320
#define TFT_SCREEN_HEIGHT     240
#define TFT_ROTATION          1     // Landscape mode (USB connector to left or right as mounted)
#define TFT_SPI_FREQ_READ     16000000
#define TFT_SPI_FREQ_WRITE    40000000  // 40 MHz SPI clock for fluid 30 FPS updates
#define TFT_SPI_FREQ_INIT     20000000  // 20 MHz safe initialization frequency

// Driver Controller Selection: 1 for ILI9341 (Primary), 2 for ST7789V (Fallback)
#define DISPLAY_CONTROLLER_ILI9341  1
#define DISPLAY_CONTROLLER_ST7789   2
#define ACTIVE_DISPLAY_CONTROLLER   DISPLAY_CONTROLLER_ILI9341

// =============================================================================
// 3. ANIMATION & SCHEDULING PARAMETERS
// =============================================================================

#define TARGET_FPS            30
#define FRAME_INTERVAL_MS     33    // ~30 FPS non-blocking render interval (1000/30 = 33.3ms)
#define BLINK_INTERVAL_MIN_MS 3200  // Min duration between random blinks
#define BLINK_INTERVAL_MAX_MS 6000  // Max duration between random blinks
#define BLINK_DURATION_MS     160   // Eye lid close/open duration
#define BREATHING_CYCLE_MS    3200  // Idle subtle breathing vertical pulse
#define SPEECH_PHONEME_INTERVAL_MS 130 // Mouth phoneme morph cadence

// =============================================================================
// 4. NETWORK, GATEWAY & TRANSPORT PARAMETERS
// =============================================================================

#define WIFI_CONNECT_TIMEOUT_MS     12000 // Bounded Wi-Fi connection attempt
#define WIFI_RETRY_INTERVAL_MIN_MS  5000  // Minimum retry backoff
#define WIFI_RETRY_INTERVAL_MAX_MS  60000 // Maximum exponential retry backoff
#define TELEMETRY_INTERVAL_MS       5000  // Device health & gateway poll cadence
#define WEBSOCKET_PORT              81    // Local WebSocket control port
#define MDNS_HOSTNAME               "kuro-robot" // kuro-robot.local

// Kuro Gateway Connection (Configure to your workstation/server IP on the LAN)
// IMPORTANT: Do NOT use "localhost" or "127.0.0.1" here; on the ESP32, localhost refers
// to the microcontroller itself. Use your workstation's LAN IP (e.g. 192.168.1.100).
#ifndef KURO_GATEWAY_HOST
#define KURO_GATEWAY_HOST           "192.168.1.100"
#endif

#ifndef KURO_GATEWAY_PORT
#define KURO_GATEWAY_PORT           3000
#endif

#ifndef KURO_GATEWAY_USE_TLS
#define KURO_GATEWAY_USE_TLS        false
#endif

#define KURO_GATEWAY_TIMEOUT_MS     1500  // Bounded 1.5s network timeout to avoid blocking 30 FPS face

// =============================================================================
// 5. COLOR PALETTES (16-bit RGB565: 5-bit Red, 6-bit Green, 5-bit Blue)
// =============================================================================

// Helper macro to convert 8-bit RGB to 16-bit RGB565
#define RGB565(r, g, b) (((((uint16_t)(r)) & 0xF8) << 8) | ((((uint16_t)(g)) & 0xFC) << 3) | (((uint16_t)(b)) >> 3))

// Core UI colors
#define COLOR_BLACK          0x0000
#define COLOR_WHITE          0xFFFF
#define COLOR_BG_DARK        RGB565(7, 10, 15)     // #070a0f Visor background
#define COLOR_BG_CARD        RGB565(17, 24, 39)    // #111827 Dark card
#define COLOR_MUTED          RGB565(100, 116, 139) // #64748b Secondary text
#define COLOR_STATUS_RED     RGB565(239, 68, 68)   // #ef4444 Hazard / Alert
#define COLOR_STATUS_YELLOW  RGB565(245, 158, 11)  // #f59e0b Warning
#define COLOR_STATUS_GREEN   RGB565(16, 185, 129)  // #10b981 Online / Success

// Kuro 4 Approved Glow Palettes (matching web app)
#define COLOR_PALETTE_CYAN    RGB565(6, 182, 212)   // #06b6d4 (0x05ba)
#define COLOR_PALETTE_EMERALD RGB565(16, 185, 129)  // #10b981 (0x15d0)
#define COLOR_PALETTE_AMBER   RGB565(245, 158, 11)  // #f59e0b (0xf4e1)
#define COLOR_PALETTE_VIOLET  RGB565(168, 85, 247)  // #a855f7 (0xaabe)

// =============================================================================
// 6. HEALTH & TELEMETRY STRUCTURES
// =============================================================================

enum WifiStatus {
  WIFI_STATE_DISCONNECTED = 0,
  WIFI_STATE_CONNECTING = 1,
  WIFI_STATE_CONNECTED = 2,
  WIFI_STATE_FAILED = 3,
};

struct DeviceHealth {
  const char* protocolVersion;
  const char* firmwareVersion;
  const char* reqId;
  uint32_t uptimeSeconds;
  uint8_t wifiState;
  int8_t rssi;
  char ipAddress[16];
  uint32_t freeHeapBytes;
  uint32_t freePsramBytes;
  char activeMood[16];
  bool isSpeaking;
  bool displayOk;
};
