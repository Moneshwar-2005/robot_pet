#pragma once

/**
 * Kuro Robot Companion — Wi-Fi Configuration Template
 *
 * SAFETY INSTRUCTIONS:
 * 1. Copy this file to `firmware/include/wifi_credentials.h`.
 * 2. Set your 2.4 GHz Wi-Fi SSID and Password in the new file.
 * 3. Never commit `wifi_credentials.h` to git (it is included in .gitignore).
 * 4. Never store or pass Supabase service role keys, user passwords, or AI API keys to firmware.
 */

#define KURO_WIFI_SSID             "YOUR_2.4GHZ_WIFI_SSID"
#define KURO_WIFI_PASSWORD         "YOUR_WIFI_PASSWORD"

// Kuro Server Gateway host and port (set to your computer's LAN IP, e.g. 192.168.1.100)
// DO NOT use "localhost" or "127.0.0.1"; on the ESP32 that refers to the chip itself.
#define KURO_GATEWAY_HOST          "192.168.1.100"
#define KURO_GATEWAY_PORT          3000
#define KURO_GATEWAY_USE_TLS       false

