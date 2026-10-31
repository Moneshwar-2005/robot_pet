#pragma once

/**
 * Kuro Robot Companion — Hardware Configuration & Constants
 *
 * Supported Hardware Targets:
 * 1. ESP32-S3-DevKitC-1 with ESP32-S3-WROOM-1-N8R8 (8MB Flash, 8MB Octal PSRAM)
 *    Display: 2.4" SPI TFT LCD (320x240, ILI9341 or ST7789)
 *
 * 2. ESP32-WROOM-32 DevKit V1 (38-pin, 4MB Flash, Internal SRAM)
 *    Display: 0.96" I2C SSD1306 OLED (128x64, Monochrome, Address 0x3C)
 *
 * CRITICAL HARDWARE SAFETY NOTICE:
 * All pin assignments below are PROVISIONAL based on pre-purchasing reviews and standard pinouts.
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
// 1. PIN ASSIGNMENTS & HARDWARE TARGET CONFIGURATION
// =============================================================================

// Target 1: ESP32-S3 to 2.4" SPI TFT LCD (PROVISIONAL)
#define KURO_PIN_TFT_CS       10    // Chip Select (Active Low) - PROVISIONAL
#define KURO_PIN_TFT_RST      9     // Hardware Reset (Active Low) - PROVISIONAL
#define KURO_PIN_TFT_DC       11    // Data/Command Control (1=Data, 0=Cmd) - PROVISIONAL
#define KURO_PIN_TFT_MOSI     12    // SPI MOSI / SDI Data - PROVISIONAL
#define KURO_PIN_TFT_SCK      13    // SPI Clock - PROVISIONAL
#define KURO_PIN_TFT_BLK      14    // Backlight PWM Control Pin - PROVISIONAL
#define KURO_PIN_TFT_MISO     -1    // Unused for write-only graphics

// Target 2: ESP32-WROOM-32 DevKit V1 (38-pin) to 0.96" SSD1306 I2C OLED (PROVISIONAL)
#ifndef KURO_PIN_OLED_SDA
#define KURO_PIN_OLED_SDA     21    // Default ESP32 Hardware I2C SDA
#endif
#ifndef KURO_PIN_OLED_SCL
#define KURO_PIN_OLED_SCL     22    // Default ESP32 Hardware I2C SCL
#endif
#ifndef KURO_OLED_I2C_ADDR
#define KURO_OLED_I2C_ADDR    0x3C  // Default I2C address for 0.96" SSD1306 OLED (Alternative: 0x3D)
#endif

// HARDWARE PIN RESTRICTION SAFEGUARDS:
//
// Restricted Pins on ESP32-S3-WROOM-1-N8R8 (DO NOT ASSIGN):
// - GPIO 33, 34, 35, 36, 37: Internally wired to 8MB Octal PSRAM!
// - GPIO 0, 45, 46: Strapping pins affecting boot mode.
//
// Restricted Pins on ESP32-WROOM-32 DevKit V1 (38-pin) (DO NOT ASSIGN):
// - GPIO 6, 7, 8, 9, 10, 11: Internally wired to internal SPI flash! (Boot loop if touched).
// - GPIO 0, 2, 5, 12, 15: Strapping pins (must remain in default states at power-on).
// - GPIO 34, 35, 36, 39: Input-only GPI pins (cannot be used for I2C SDA/SCL outputs).
// - Verified safe pins: GPIO 21 (SDA) and GPIO 22 (SCL) are dedicated hardware I2C pins.

// =============================================================================
// 2. DISPLAY DIMENSIONS & CONTROLLER CONFIGURATION
// =============================================================================

#define TFT_SCREEN_WIDTH      320
#define TFT_SCREEN_HEIGHT     240
#define TFT_ROTATION          1     // Landscape mode
#define TFT_SPI_FREQ_READ     16000000
#define TFT_SPI_FREQ_WRITE    40000000  // 40 MHz SPI clock for fluid 30 FPS updates
#define TFT_SPI_FREQ_INIT     20000000  // 20 MHz safe initialization frequency

#define OLED_SCREEN_WIDTH     128
#define OLED_SCREEN_HEIGHT    64
#define OLED_ROTATION         0     // Standard landscape mode for 128x64 visor
#define OLED_I2C_FREQ         400000 // 400 kHz Fast-mode I2C clock

// Driver Controller Selection
#define DISPLAY_CONTROLLER_ILI9341      1
#define DISPLAY_CONTROLLER_ST7789       2
#define DISPLAY_CONTROLLER_SSD1306_I2C  3

#if defined(KURO_DISPLAY_SSD1306_OLED)
#define SCREEN_WIDTH          OLED_SCREEN_WIDTH
#define SCREEN_HEIGHT         OLED_SCREEN_HEIGHT
#define DISPLAY_ROTATION      OLED_ROTATION
#define ACTIVE_DISPLAY_CONTROLLER DISPLAY_CONTROLLER_SSD1306_I2C
#else
#define SCREEN_WIDTH          TFT_SCREEN_WIDTH
#define SCREEN_HEIGHT         TFT_SCREEN_HEIGHT
#define DISPLAY_ROTATION      TFT_ROTATION
#define ACTIVE_DISPLAY_CONTROLLER DISPLAY_CONTROLLER_ILI9341
#endif

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
