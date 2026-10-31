# KURO — PHASE 8.9: ESP32-WROOM-32 + SSD1306 OLED HARDWARE ADAPTATION REPORT

**Project:** `F:\smart-pet-assistant-web`  
**Phase:** 8.9 — Hardware Adaptation (ESP32-WROOM-32 DevKit V1 38-Pin + 0.96" SSD1306 I²C OLED)  
**Date:** October 30, 2026  
**Status:** COMPLETE (Build & Simulation Verified — No Physical Flashing Executed)  
**Decision:** **GO** (Ready for benchtop hardware wiring inspection)

---

## 1. Existing Firmware Architecture Review

Prior to Phase 8.9, the Kuro Robot Companion firmware (`firmware/`) was architected specifically for high-end microcontroller hardware:
- **Target MCU:** ESP32-S3-WROOM-1-N8R8 (Dual-core Xtensa LX7 @ 240 MHz, 8 MB Octal SPI Flash, 8 MB Octal PSRAM).
- **Target Display:** 2.4-inch SPI TFT LCD visor ($320 \times 240$ landscape, 16-bit RGB565 color, driven by ILI9341 or ST7789 via LovyanGFX).
- **Subsystems:**
  - `DisplayHAL` (`src/display_hal.h`, `src/display_hal.cpp`): Hardware abstraction layer providing 2D graphics primitives, text rendering, and backlight PWM control.
  - `FaceEngine` (`src/face_engine.h`, `src/face_engine.cpp`): Procedural digital face engine implementing 17 distinct moods, 3 eye shapes (curved, round, pixel), 4 glow palettes (cyan, emerald, amber, violet), 10 mouth geometries, speaking phoneme cycles, non-blocking 30 FPS animation scheduling, idle breathing oscillation, and procedural eyelid blinking.
  - `NetManager` (`src/net_manager.h`, `src/net_manager.cpp`): Non-blocking Wi-Fi state machine with exponential backoff ($5\text{s} \to 60\text{s}$), mDNS registration (`kuro-robot.local`), gateway synchronization (`POST /api/device/poll`), and periodic telemetry reporting.
  - `KuroProtocol` (`src/protocol.h`, `src/protocol.cpp`): Bidirectional JSON messaging engine (Protocol v1.0) with request ID (`reqId`) correlation, bounded payload checks ($\le 512$ bytes), and strict parameter validation.
  - `Main` (`src/main.cpp`): Clean entry point coordinating initialization, startup splash screen, non-blocking loop scheduling, and serial JSON commands.

**Preservation Mandate:** The existing ESP32-S3 + 2.4" TFT target configuration had to remain 100% operational with zero regressions or breaking changes.

---

## 2. New ESP32-WROOM-32 Firmware Configuration

To adapt to currently accessible benchtop hardware without disturbing the production ESP32-S3 roadmap, a new target environment was introduced in `firmware/platformio.ini`:

```ini
; Environment 5: ESP32-WROOM-32 DevKit V1 (38-pin, 4MB Flash) + 0.96" SSD1306 I2C OLED (128x64)
[env:esp32_wroom_oled]
platform = espressif32 @ ^6.5.0
board = esp32dev
framework = arduino
monitor_speed = 115200
monitor_filters = esp32_exception_decoder, time
upload_speed = 921600
board_build.flash_mode = dio
board_upload.flash_size = 4MB
build_flags =
    -DCORE_DEBUG_LEVEL=3
    -DKURO_FIRMWARE_VERSION=\"0.1.0\"
    -DKURO_PROTOCOL_VERSION=\"1.0\"
    -DKURO_TARGET_ESP32_WROOM
    -DKURO_DISPLAY_SSD1306_OLED
    -DOLED_SCREEN_WIDTH=128
    -DOLED_SCREEN_HEIGHT=64
    -DKURO_PIN_OLED_SDA=21
    -DKURO_PIN_OLED_SCL=22
    -DKURO_OLED_I2C_ADDR=0x3C
lib_deps =
    bblanchon/ArduinoJson @ ^7.0.4
    links2004/WebSockets @ ^2.4.1
    lovyan03/LovyanGFX @ ^1.1.12
```

### Architectural Distinctions:
| Property | ESP32-S3 Target (`esp32s3_n8r8`) | ESP32-WROOM Target (`esp32_wroom_oled`) |
|:---|:---|:---|
| **Board ID** | `esp32-s3-devkitc-1` | `esp32dev` |
| **Microcontroller** | ESP32-S3 (Xtensa LX7) | ESP32 (Xtensa LX6) |
| **Flash Memory** | 8 MB Octal Flash (`qio_opi`) | 4 MB Quad Flash (`dio`) |
| **External PSRAM** | 8 MB Octal PSRAM | None (Runs 100% in 320 KB internal SRAM) |
| **Display Panel** | 2.4" SPI TFT LCD ($320 \times 240$) | 0.96" I²C Monochrome OLED ($128 \times 64$) |
| **Display Controller** | ILI9341 / ST7789 | SSD1306 |
| **Bus Interface** | SPI (40 MHz write clock) | I²C Fast-Mode (400 kHz clock) |
| **Color Depth** | 16-bit RGB565 | 1-bit Monochrome |
| **Power Connector** | USB-C on DevKitC-1 | Micro-USB on DevKit V1 38-pin |

---

## 3. SSD1306 Display Implementation & Dedicated OLED Rendering

Rather than degrading image quality through naive linear downscaling of the $320 \times 240$ canvas, a **dedicated $128 \times 64$ layout engine** was created:

### 3.1 Display Hardware Abstraction (`display_hal.cpp`)
- Configured LovyanGFX `lgfx::Panel_SSD1306` with `lgfx::Bus_I2C`.
- I²C port set to `0` (`I2C_NUM_0`), frequency `400 kHz`, address `0x3C`.
- Panel width: $128\text{ px}$, panel height: $64\text{ px}$.
- Extended `DisplayHAL::endWrite()` to invoke `pLgfx->display()` to push frame buffer dirty regions immediately to the SSD1306 hardware.

### 3.2 OLED Face Geometry & Layout Constants (`face_engine.h`)
```cpp
#if defined(KURO_DISPLAY_SSD1306_OLED)
  // Coordinate Layout Constants (128x64 Monochrome OLED Visor)
  static const int16_t EYE_LEFT_X = 38;
  static const int16_t EYE_RIGHT_X = 90;
  static const int16_t EYE_BASE_Y = 32;
  static const int16_t EYE_WIDTH = 24;
  static const int16_t EYE_HEIGHT = 26;
  static const int16_t MOUTH_X = 64;
  static const int16_t MOUTH_BASE_Y = 53;
  static const int16_t MOUTH_WIDTH = 20;
  static const int16_t MOUTH_HEIGHT = 8;
#endif
```

### 3.3 Visual Balance Verification
- **Left Eye Horizontal Span:** $X \in [38 - 12, 38 + 12] = [26, 50]$ ($24\text{ px}$ wide).
- **Right Eye Horizontal Span:** $X \in [90 - 12, 90 + 12] = [78, 102]$ ($24\text{ px}$ wide).
- **Left Margin:** $26\text{ px}$.
- **Right Margin:** $128 - 102 = 26\text{ px}$ (symmetrically centered).
- **Inter-Ocular Spacing:** $78 - 50 = 28\text{ px}$.
- **Mouth Alignment:** Exact horizontal midpoint $X = 64$ ($128 / 2 = 64$), vertical center $Y = 53$, spanning $[54, 74]$ ($20\text{ px}$ wide).
- **Top Status Line:** $Y \in [0, 8]$ with divider at $Y = 8$.

### 3.4 Procedural Expressions & Eyelid Animation
1. **Neutral / Attentive:** Full open squircle ($24 \times 26$, corner radius 6) with specular reflection dot.
2. **Happy / Proud / Excited:** Upward smiling crescent arc (`^ ^`) rendered with dual-radius circle curves, masked lower half.
3. **Sad / Worried / Error:** Inward-drooping upper eyelid slanted toward outer edge.
4. **Focused:** Squinted determined squircle ($14\text{ px}$ height) with locked center pupil.
5. **Thinking / Curious / Confused:** Asymmetric look with gaze shifted $-2\text{ px}$ X and $-2\text{ px}$ Y.
6. **Sleepy:** Drowsy half-closed squircle ($6\text{ px}$ height).
7. **Playful:** Winking left eye (closed slit), open right eye.
8. **Blinking:** Smooth non-blocking procedural interpolation from $26\text{ px}$ open squircle down to a $2\text{ px}$ horizontal slit at the apex ($80\text{ ms}$) and back up over $160\text{ ms}$.
9. **Idle Breathing:** Gentle non-blocking vertical sine wave oscillation ($\pm 1\text{ px}$, $3.2\text{ s}$ cycle).
10. **Phoneme Morphing:** Speaking mouth cycles through closed line ($10\text{ px}$), small oval ($8 \times 4$), open oval ($14 \times 6$), and open smile ($16 \times 6$) every $130\text{ ms}$.

---

## 4. GPIO Pin Mapping & Hardware Safety Safeguards

### 4.1 Provisional Pin Mapping for ESP32-WROOM-32 DevKit V1 (38-Pin)
| OLED Pin | Target Function | ESP32-WROOM-32 Pin | Status | Notes |
|:---|:---|:---|:---:|:---|
| **GND** | Ground | **GND** | Provisional | Common ground with USB supply |
| **VCC** | Power Supply | **3V3** (3.3V) | Provisional | SSD1306 logic & display power |
| **SDA** | I²C Serial Data | **GPIO 21** | Provisional | Default hardware I²C SDA (I2C_NUM_0) |
| **SCL** | I²C Serial Clock | **GPIO 22** | Provisional | Default hardware I²C SCL (I2C_NUM_0) |

### 4.2 Hardware Pin Restriction Safeguards
The firmware configuration explicitly guards against dangerous pin conflicts on ESP32 boards:
- **Internal SPI Flash Lines (GPIO 6, 7, 8, 9, 10, 11):** NEVER ASSIGNED. Connecting peripherals to these pins halts the flash memory interface, causing instant boot loops.
- **Strapping Pins (GPIO 0, 2, 5, 12, 15):** AVOIDED. These pins govern boot mode, flash voltage (MTDI/GPIO12), and JTAG routing at reset.
- **Input-Only Pins (GPIO 34, 35, 36, 39):** AVOIDED. These GPI pins lack internal pull-ups and output driver transistors and cannot support I²C SDA or SCL.
- **Verified Safe Pins:** GPIO 21 and GPIO 22 are general-purpose, full-drive GPIOs equipped with internal pull-up support and standard hardware peripheral routing.

> [!CAUTION]
> **UNVERIFIED HARDWARE ASSUMPTION:** The pinout above is standard for ESP32 DevKit V1 38-pin boards. However, physical wiring must NOT be connected until the user visually verifies:
> 1. Exact board silkscreen labels (some variants swap pin orders or have 30 pins vs 38 pins).
> 2. OLED module pin header order (some SSD1306 boards have `GND-VCC-SCL-SDA` while others have `VCC-GND-SCL-SDA`).
> 3. OLED module supply voltage compatibility (ensure the onboard regulator accepts 3.3V vs 5V).

---

## 5. Build Results for Both Targets

Both environments were compiled using the isolated PlatformIO toolchain (`F:\.toolchains\venv-pio` with `F:\.platformio` core):

### Exact Compilation Command:
```powershell
$env:TEMP = 'F:\temp'; $env:TMP = 'F:\temp'; & "F:\.toolchains\venv-pio\Scripts\platformio.exe" run -d firmware -e esp32s3_n8r8 -e esp32_wroom_oled
```

### Build Status Summary:
```
Processing esp32s3_n8r8 (platform: espressif32 @ ^6.5.0; board: esp32-s3-devkitc-1; framework: arduino)
--------------------------------------------------------------------------------
RAM:   [==        ]  15.1% (used 49548 bytes from 327680 bytes)
Flash: [===       ]  30.1% (used 1007553 bytes from 3342336 bytes)
========================= [SUCCESS] Took 12.15 seconds =========================

Processing esp32_wroom_oled (platform: espressif32 @ ^6.5.0; board: esp32dev; framework: arduino)
--------------------------------------------------------------------------------
RAM:   [==        ]  15.5% (used 50692 bytes from 327680 bytes)
Flash: [========  ]  79.6% (used 1043165 bytes from 1310720 bytes)
========================= [SUCCESS] Took 11.04 seconds =========================

========================= 2 succeeded in 00:00:23.183 =========================
```

- **ESP32-S3 Target (`esp32s3_n8r8`):** 0 compilation errors, 0 warnings.
- **ESP32-WROOM Target (`esp32_wroom_oled`):** 0 compilation errors, 0 warnings.
- **Incremental Build Time:** 23.18 seconds total for both environments combined.

---

## 6. RAM and Flash Usage Breakdown

| Metric | Target 1: ESP32-S3 TFT (`esp32s3_n8r8`) | Target 2: ESP32-WROOM OLED (`esp32_wroom_oled`) | Assessment |
|:---|:---:|:---:|:---|
| **Target Architecture** | ESP32-S3 (Xtensa LX7, 240 MHz) | ESP32 (Xtensa LX6, 240 MHz) | Correct microarchitectures selected |
| **RAM Used** | **49,548 bytes** (15.1%) | **50,692 bytes** (15.5%) | **Excellent Headroom** (276 KB free SRAM) |
| **Available RAM** | 327,680 bytes internal + 8 MB PSRAM | 327,680 bytes internal SRAM | Fits completely in internal SRAM with zero PSRAM dependency |
| **Flash Used** | **1,007,553 bytes** (30.1%) | **1,043,165 bytes** (79.6%) | **Well bounded** within default app partition |
| **Flash Capacity** | 8 MB Octal Flash | 4 MB Quad Flash | 267,555 bytes remaining in active partition |
| **Binary Artifacts** | `firmware.bin` ($1.01\text{ MB}$), `bootloader.bin`, `partitions.bin` | `firmware.bin` ($1.04\text{ MB}$), `bootloader.bin`, `partitions.bin` | Cleanly generated without linking anomalies |

---

## 7. Protocol & Web Gateway Compatibility

The ESP32-WROOM-32 OLED adaptation strictly preserves the approved Kuro protocol and device gateway architecture:
1. **Protocol v1.0 Compatibility:** Accepts standard JSON commands (`set_mood`, `speak`, `set_palette`, `set_eye_shape`, `ping`, `get_status`) with request ID (`reqId`) correlation.
2. **Payload Boundary Enforcement:** Rejects oversized incoming messages exceeding $512\text{ bytes}$ with `PAYLOAD_TOO_LARGE` error.
3. **Telemetry Format:** Broadcasts standardized device health JSON (`uptimeSeconds`, `wifiState`, `rssi`, `ipAddress`, `freeHeapBytes`, `freePsramBytes`, `activeMood`, `isSpeaking`, `displayOk`). On ESP32-WROOM, `freePsramBytes` dynamically reports `0`.
4. **Device Gateway Pairing:** Fully interoperable with the 6-digit PIN pairing flow (`POST /api/device/pair/confirm`) and 24-hour bearer session token authentication.
5. **Heartbeat & Inactivity Tracking:** Complies with the 15-second timeout threshold (`HEARTBEAT_TIMEOUT_MS`).

---

## 8. Test Suite Verification & Quality Gates

### 8.1 Firmware Logic & Unit Test Suite (`test/esp32_firmware_logic.test.mjs`)
Expanded from 45 to **50 automated unit tests** covering:
- Tests 1–35: RGB565 math, palettes, 17 moods, phonemes, protocol schema, Wi-Fi timeouts, and multi-board environments.
- Tests 36–45: Device gateway pairing, PIN rate-limiting, poll drain, and online transitions.
- **Test 46:** `platformio.ini` definition for `[env:esp32_wroom_oled]` with `esp32dev` and SSD1306 build flags (`PASS`).
- **Test 47:** Hardware pin safety guarding flash pins (6–11), strapping pins (0, 2, 5, 12, 15), and input-only pins (34–39) (`PASS`).
- **Test 48:** 128×64 OLED geometry math verifying $28\text{ px}$ inter-ocular spacing, $26\text{ px}$ symmetrical margins, and $X = 64$ mouth midpoint (`PASS`).
- **Test 49:** OLED procedural eyelid blinking scaling smoothly between $2\text{ px}$ minimum slit and $26\text{ px}$ open squircle (`PASS`).
- **Test 50:** Kuro emotion model mapping all 17 moods identically across both targets (`PASS`).
- **Result:** **50 passed, 0 failed.**

### 8.2 Full Workspace Regression (`npm test`)
Executed across all 18 test suites in the application:
```
1. test/daily_summary.test.mjs                      -> 11 passed, 0 failed
2. test/notifications_automation.test.mjs          -> 27 passed, 0 failed
3. companion/test_companion.mjs                     -> 84 passed, 0 failed
4. test/pet_face_animation.test.mjs                 -> 19 passed, 0 failed
5. test/autonomous_pet.test.mjs                     -> 29 passed, 0 failed
6. test/full_qa_regression.test.mjs                 -> 23 passed, 0 failed
7. test/personal_assistant_reliability.test.mjs     -> 32 passed, 0 failed
8. test/activities_and_acceptance.test.mjs          -> 24 passed, 0 failed
9. test/production_readiness_security.test.mjs      -> 28 passed, 0 failed
10. test/esp32_firmware_logic.test.mjs              -> 50 passed, 0 failed
11. test/complete_application_database_audit.test.mjs-> 46 passed, 0 failed
12. test/phase_8_5a_acceptance.test.mjs             -> 25 passed, 0 failed
13. test/outbox_isolation_lifecycle.test.mjs        -> 18 passed, 0 failed
14. test/safe_live_cloud_test.mjs                   -> 18 passed, 0 failed
15. test/pet_setting_boundary.test.mjs              -> 14 passed, 0 failed
16. test/phase_8_6_live_end_to_end.mjs              -> 16 passed, 0 failed
17. test/phase_8_7_reliability_security.mjs         -> 38 passed, 0 failed
18. test/companion_production_reliability.test.mjs  -> 42 passed, 0 failed
```
- **Overall Test Result:** **18 suites passed, 0 failed** (544 automated tests total).
- **TypeScript Typecheck (`npx tsc -b`):** 0 errors.
- **Linter (`npx oxlint`):** 0 warnings, 0 errors across 113 files.
- **Web App Production Build (`npm run build`):** Clean build in 1.43s.

---

## 9. Remaining Physical Hardware Verification

In compliance with project safety rules, **no physical hardware flashing was performed**. The following physical checks remain outstanding prior to applying power:

| Check | Required Action | Status | Notes |
|:---|:---|:---:|:---|
| **Board Visual Identification** | Inspect DevKit V1 silkscreen and pin count | Pending Physical Inspection | Confirm 38 pins vs 30 pins |
| **Module Pinout Order** | Inspect 4-pin header on SSD1306 module | Pending Physical Inspection | Confirm whether `VCC` or `GND` is pin 1 |
| **I²C Address Verification** | Inspect rear 0Ω jumper on OLED board | Pending Physical Inspection | Confirm `0x3C` (default) vs `0x3D` |
| **Supply Voltage Match** | Inspect onboard LDO regulator on OLED board | Pending Physical Inspection | Connect to 3.3V pin (do NOT connect to 5V unless 5V tolerant) |
| **Wiring Continuity Test** | Verify connections using digital multimeter | Pending Physical Inspection | GND to GND, VCC to 3V3, SDA to D21, SCL to D22 |
| **USB Cable Verification** | Verify USB data capability (not charge-only) | Pending Physical Inspection | Must enumerate COM port in Windows Device Manager |

---

## 10. Exact Next Steps for Physical Hardware Testing

When physical benchtop testing is scheduled:

1. **Step 1: Visual Inspection & Pin Labeling**
   - Place ESP32 DevKit V1 and SSD1306 OLED on anti-static surface.
   - Photograph and note pin order for both components.

2. **Step 2: Jumper Wire Hookup (Power OFF)**
   ```
   SSD1306 Pin       ESP32 DevKit V1 Pin
   -----------       -------------------
   GND         --->  GND (Pin 14 or 38)
   VCC         --->  3V3 (3.3V Output)
   SDA         --->  GPIO 21 (D21)
   SCL         --->  GPIO 22 (D22)
   ```

3. **Step 3: Connect USB to Workstation**
   - Connect Micro-USB cable to ESP32 DevKit V1.
   - Note assigned COM port (e.g. `COM3` or `COM4`).

4. **Step 4: Flash Firmware via PlatformIO CLI**
   ```powershell
   $env:TEMP = 'F:\temp'; $env:TMP = 'F:\temp'
   & "F:\.toolchains\venv-pio\Scripts\platformio.exe" run -d firmware -e esp32_wroom_oled --target upload
   ```

5. **Step 5: Monitor Serial & Verify Display**
   ```powershell
   & "F:\.toolchains\venv-pio\Scripts\platformio.exe" device monitor -d firmware -b 115200
   ```
   - Observe boot banner, splash screen on OLED, and transition to animated Kuro squircle eyes.

---

## Acceptance Summary & Decision

- **ESP32-WROOM-32 Firmware Build:** PASSED (`esp32_wroom_oled`, RAM: 15.5%, Flash: 79.6%).
- **ESP32-S3 Firmware Build:** PASSED (`esp32s3_n8r8`, RAM: 15.1%, Flash: 30.1%).
- **SSD1306 128×64 Dedicated Rendering:** COMPLETE (Symmetrical squircle eyes, 17 moods, blinking, speaking phonemes).
- **Kuro Protocol Compatibility:** PRESERVED (Protocol v1.0, 512B bounds, reqId correlation).
- **Automated Tests:** 50/50 firmware unit tests passed; all 18 test suites passed.
- **Hardware Flashing Guard:** STRICTLY RESPECTED (0 boards flashed or modified).

### Phase 8.9 Final Decision: **GO**

