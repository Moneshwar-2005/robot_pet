# Kuro — Phase 8.3: Hardware Readiness & Release Preparation Report

**Document Version:** 1.0.0  
**Phase:** 8.3 (Hardware Readiness & Release Preparation)  
**Date:** 2026-10-29  
**Status:** Software Verified & Bench-Ready (Awaiting Physical Hardware Arrival)  
**Strict Safety Notice:** No physical silicon has been flashed. No physical wires have been connected. Automated tests validate software, protocol, and simulated adapters only. All physical tests are explicitly marked pending real-world execution.

---

## 1. Executive Summary

Phase 8.3 validates the complete hardware preparation layer for Kuro, the Smart Robot Pet + Personal Assistant. This includes:
1. **Firmware Build Environment Audit:** Inspected host environment for PlatformIO Core, Python 3, and compiler toolchains. Detailed Windows setup steps provided; zero unauthorized toolchain downloads performed.
2. **PlatformIO Multi-Board Environments:** Audited and validated 4 mutually compatible board targets (`esp32s3_n8r8`, `esp32s3_n16r8`, `esp32s3_n8r2`, and `esp32s3_no_psram`).
3. **Hardware Compatibility & Wiring Checklist:** Synthesized hardware requirements from `docs/HARDWARE_SPECIFICATION.md` and `firmware/include/config.h`. Formulated a conditional electrical connection matrix with explicit voltage, pin, and signal guards.
4. **Device Gateway Truthfulness & Integrity:** Hardened `src/server/deviceGateway.mjs` and `HardwareDeviceCard.tsx` so physical devices start in `awaiting_device` (`connected: false`), web command dispatches do not falsely fake heartbeats, and simulated responses never pretend physical hardware is online.
5. **Office Bench-Test Procedure:** Formulated a sequential 9-stage testing protocol for the office bench engineer with zero claims of pre-execution success.
6. **Full QA & Regression Pass:** All **10 test suites passed** with **248 automated tests passing and 0 failures**. Zero linter errors across 102 files, zero TypeScript errors, and clean Vite production build.

---

## 2. Firmware Build Environment Audit

### 2.1 Toolchain Availability on Host Machine

An inspection of the current Windows environment was conducted:

| Tool | Status | Binary Location / Version | Notes |
| :--- | :---: | :--- | :--- |
| **Git** | **Available** | `C:\Program Files\Git\cmd\git.exe` | Git v2.x |
| **Node.js** | **Available** | `C:\Program Files\nodejs\node.exe` | Node v22.x (npm v10.x) |
| **Python** | **Not Found on PATH** | N/A | Neither `python`, `python3`, nor `py` launcher found in standard PATH or user AppData. |
| **PlatformIO Core (CLI)** | **Not Found on PATH** | N/A | `pio` / `platformio` CLI not installed. |
| **PlatformIO Home (`~/.platformio`)** | **Not Present** | `C:\Users\ADMIN\.platformio` does not exist | No cached toolchains or Espressif packages. |

> [!IMPORTANT]
> In accordance with safety instructions, the agent **did not silently install packages or download large toolchains** (e.g. ESP-IDF, Xtensa GCC toolchain, or Python wheels).

### 2.2 Concise Setup Guide for the Windows Workstation

To compile and flash the firmware when the physical ESP32-S3 hardware arrives, complete the following one-time setup on the Windows host:

#### Method A: VS Code with PlatformIO IDE Extension (Recommended for Visual Monitoring)
1. Open Visual Studio Code.
2. Go to the Extensions panel (`Ctrl+Shift+X`) and search for **PlatformIO IDE** (`platformio.platformio-ide`).
3. Click **Install**. PlatformIO automatically installs an isolated Python runtime and Core CLI into `%USERPROFILE%\.platformio`.
4. Open the `firmware/` folder in VS Code (`File > Open Folder > F:\smart-pet-assistant-web\firmware`).
5. PlatformIO will automatically recognize `platformio.ini` and provide one-click **Build**, **Upload**, and **Serial Monitor** buttons on the bottom status bar.

#### Method B: Standalone PlatformIO Core via Python CLI
1. Download and install **Python 3.11 or 3.12** from [python.org](https://www.python.org/downloads/).
   - **Crucial Checkbox:** Select *"Add python.exe to PATH"* during installation.
2. Open a new PowerShell terminal and install PlatformIO Core:
   ```powershell
   pip install -U platformio
   ```
3. Verify installation:
   ```powershell
   pio --version
   ```
4. Build the firmware from the repository root:
   ```powershell
   cd F:\smart-pet-assistant-web\firmware
   pio run -e esp32s3_n8r8
   ```

---

## 3. PlatformIO Environments & Dependency Audit

The `firmware/platformio.ini` configuration defines 4 distinct board environments to guarantee compatibility regardless of which specific ESP32-S3 board variant is received:

```ini
[platformio]
default_envs = esp32s3_n8r8, esp32s3_no_psram
src_dir = src
include_dir = include
```

### 3.1 Environment Analysis Matrix

| Environment ID | Flash Configuration | PSRAM Configuration | Arduino Memory Type | Intended Board Silicon | Memory Usage Characteristics |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **`esp32s3_n8r8`** *(Default)* | 8MB QIO | 8MB Octal OPI (`-DBOARD_HAS_PSRAM`) | `qio_opi` | ESP32-S3-DevKitC-1 with `ESP32-S3-WROOM-1-N8R8` | Ample heap for full double-buffers, JSON payloads, and network buffers. **GPIOs 33–37 internally reserved.** |
| **`esp32s3_n16r8`** | 16MB QIO | 8MB Octal OPI (`-DBOARD_HAS_PSRAM`) | `qio_opi` | ESP32-S3-DevKitC-1 with `ESP32-S3-WROOM-1-N16R8` | Extended flash variant for massive OTA partitions. **GPIOs 33–37 internally reserved.** |
| **`esp32s3_n8r2`** | 8MB QIO | 2MB Quad QSPI (`-DBOARD_HAS_PSRAM`) | `qio_qspi` | ESP32-S3-DevKitC-1 with `ESP32-S3-WROOM-1-N8R2` | Quad PSRAM variant. GPIOs 33–37 remain unbonded; standard FSPI pins preserved. |
| **`esp32s3_no_psram`** | 4MB QIO | None (`-DNO_PSRAM_FALLBACK`) | `qio_qio` | Generic ESP32-S3 DevKit without external PSRAM | Runs 100% within 512KB internal SRAM (~380KB user heap). Uses ~12.8 KB localized dirty-region sprites. |

### 3.2 Library Dependencies & Version Compatibility

```ini
lib_deps =
    bblanchon/ArduinoJson @ ^7.0.4
    links2004/WebSockets @ ^2.4.1
    lovyan03/LovyanGFX @ ^1.1.12
```

1. **`bblanchon/ArduinoJson` (@ ^7.0.4):**
   - Modern v7 API featuring zero-allocation deserialization, automatic memory scaling, and stream parsing.
   - Replaces deprecated `StaticJsonDocument` / `DynamicJsonDocument` APIs from v6 with `JsonDocument`.
   - Verified in `firmware/src/protocol.cpp` and unit tests.
2. **`lovyan03/LovyanGFX` (@ ^1.1.12):**
   - High-performance, hardware-accelerated graphics library specifically optimized for ESP32 and ESP32-S3 DMA.
   - Provides unified driver support for both **ILI9341** and **ST7789** controllers with zero code changes.
   - Built-in software clipping, off-screen sprites (`LGFX_Sprite`), and hardware SPI frequency control up to 40 MHz.
3. **`links2004/WebSockets` (@ ^2.4.1):**
   - Standard RFC6455-compliant WebSocket client and server library.
   - Used for real-time bi-directional streaming between the microcontroller and web control center.

---

## 4. Hardware Compatibility & Wiring Safety Checklist

### 4.1 Fixed Product Constraints & Scope
- **Device Class:** Screen-Only Desktop Companion & Personal Assistant.
- **Actuation & Sound:** **Strictly zero motors, zero servos, zero speakers, zero buzzers**.
- **Display Visor:** 2.4-inch SPI TFT LCD (320×240 native resolution, landscape orientation).
- **Power & Serial:** Single rear-panel USB-C connector (5V DC power, USB-CDC serial flashing).
- **Target Budget:** ₹1,500 – ₹3,000 INR total bill of materials.

### 4.2 Explicit Verification of Assumptions

> [!CAUTION]
> **DO NOT CONNECT WIRES OR APPLY POWER UNTIL THE PHYSICAL LABELS ARE CONFIRMED WITH A MULTIMETER AND VISUAL INSPECTION.**

| Parameter | Specification | Verification Status | Verification Action Required on Bench |
| :--- | :--- | :---: | :--- |
| **Microcontroller Module** | ESP32-S3-WROOM-1-N8R8 | **UNVERIFIED (Pending Delivery)** | Inspect metal RF shield on ESP32-S3 dev board. Must read `ESP32-S3-WROOM-1-N8R8`. If marked `N4` (no PSRAM), switch PlatformIO target to `esp32s3_no_psram`. |
| **Display Panel Size** | 2.4-inch Diagonal (320×240) | **UNVERIFIED (Pending Delivery)** | Measure visible active display area (~49 mm × 37 mm). Confirm 320×240 landscape orientation. |
| **Display Controller IC** | ILI9341 or ST7789V | **PROVISIONAL (Assumed ILI9341)** | Inspect rear silkscreen or read controller ID register `0x04` over SPI during Stage 3. |
| **Display Header Type** | Single-row 2.54mm SPI header | **PROVISIONAL** | Ensure board has single-row 8-pin or 14-pin SPI header. **DO NOT USE 28-pin dual-row Arduino Uno parallel shields!** |
| **Display Logic Voltage** | Strictly 3.3V Logic | **VERIFIED HARDWARE RULE** | ESP32-S3 GPIOs are **NOT 5V tolerant**. Data pins (`CS`, `RST`, `DC`, `MOSI`, `SCK`) must never receive 5V. |
| **Display VCC Rail** | 5V (if LDO present) OR 3.3V | **CONDITIONALLY UNVERIFIED** | Inspect PCB back for AMS1117-3.3 or 662K 3-pin regulator. See Section 4.3 below. |
| **Backlight (LED/BLK)** | PWM / Current Limited | **CONDITIONALLY UNVERIFIED** | Inspect PCB for series resistor and transistor (`Q1`). Never connect raw LED pin directly to GPIO without transistor or 100Ω resistor. |

### 4.3 Conditional Power (VCC) & Backlight Circuit Rules

1. **Display VCC Connection:**
   - **Condition A (Onboard LDO Present):** If the display PCB has a 3-pin IC labeled `AMS1117-3.3` or `662K`, connect display `VCC` to the **ESP32 5V (VBUS) pin**. The onboard regulator drops 5V to clean 3.3V without loading the ESP32's internal 3.3V regulator.
   - **Condition B (No Onboard LDO):** If marked `VCC 3.3V Only` without a regulator, connect display `VCC` strictly to the **ESP32 3.3V output pin**. Connecting 5V in this condition will permanently destroy the display controller.
2. **Backlight (LED / BLK) Connection:**
   - **Condition A (Onboard Transistor Present):** Connect display `LED` pin to ESP32 `GPIO 14`.
   - **Condition B (Raw LED Pin):** Connect display `LED` to ESP32 `3.3V` through a 68Ω–100Ω current-limiting resistor, or use a 2N2222 NPN transistor driven by GPIO 14 via a 1 kΩ base resistor.

### 4.4 Master Wiring Verification Checklist

```
  [ESP32-S3 DevKitC-1 Pin]       [Signal Name]        [2.4" SPI TFT LCD Pin]   [Voltage Level]    [Verification Status]
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  5V (VBUS) or 3.3V  ──────────► Power VCC     ──────► VCC                     5V or 3.3V (Note 1) [PENDING LDO CHECK]
  GND                ──────────► System Ground ──────► GND                     0V Reference       [PENDING MULTIMETER]
  GPIO 10            ──────────► SPI CS (FSPI) ──────► CS                      3.3V Logic         [PROVISIONAL PIN]
  GPIO 9             ──────────► Hardware RST  ──────► RESET / RST             3.3V Logic         [PROVISIONAL PIN]
  GPIO 11            ──────────► Data/Command  ──────► DC / RS                 3.3V Logic         [PROVISIONAL PIN]
  GPIO 12            ──────────► SPI MOSI      ──────► MOSI / SDI              3.3V Logic         [PROVISIONAL PIN]
  GPIO 13            ──────────► SPI Clock     ──────► SCK / CLK               3.3V Logic         [PROVISIONAL PIN]
  GPIO 14 (or 3.3V)  ──────────► Backlight PWM ──────► LED / BLK               3.3V (Note 2)      [PENDING CIRCUIT CHECK]
  (Not Connected)    ──────────► SPI MISO      ──────► MISO / SDO              Unused (Write-Only)[VERIFIED EXCLUDED]
  (Not Connected)    ──────────► Touch Signals ──────► T_CLK, T_CS, T_DIN, etc Unused             [VERIFIED EXCLUDED]
```

*Note 1: Connect to 5V ONLY if onboard AMS1117-3.3 LDO is confirmed. Otherwise connect to 3.3V.*  
*Note 2: Requires current-limiting resistor or transistor driver.*

> [!WARNING]
> **RESTRICTED PINS (ESP32-S3-WROOM-1-N8R8):**
> - **GPIO 33, 34, 35, 36, 37:** Internally wired to 8MB Octal PSRAM. **DO NOT CONNECT UNDER ANY CIRCUMSTANCES.**
> - **GPIO 0, 45, 46:** Strapping pins that dictate boot mode. Must not be pulled high/low during power-up.

---

## 5. Device Integration & Truthful Status Verification

### 5.1 Protocol v1.0 Alignment

The firmware (`firmware/src/protocol.cpp`), server gateway (`src/server/deviceGateway.mjs`), and web UI (`src/components/pet/HardwareDeviceCard.tsx`) enforce identical protocol invariants:

| Parameter | Specification | Verification Result |
| :--- | :--- | :---: |
| **Protocol Version** | `1.0` | **VERIFIED** |
| **Max Payload Size** | 512 bytes (firmware) / 64 KB (HTTP server gate) | **VERIFIED** |
| **Request Correlation** | `reqId` passed through inbound commands and echoed in all responses | **VERIFIED** |
| **Heartbeat Inactivity** | 15,000 ms (`HEARTBEAT_TIMEOUT_MS`) before connection flagged lost | **VERIFIED** |
| **Pairing Lifecycle** | 6-digit PIN, 5-minute expiry, cryptographically random 24h session token | **VERIFIED** |
| **Command Delivery** | Direct LAN HTTP push (`/api/command`) with fallback to bounded queue (`/api/device/poll`) | **VERIFIED** |
| **Command Execution ACK** | Device reports execution success via `POST /api/device/command/ack` | **VERIFIED** |

### 5.2 Hardened Truthful Online State Engine

Prior to Phase 8.3, dispatching a web command into the server-side queue would reset `lastHeartbeatTimestamp = Date.now()`, which could temporarily trick the UI into showing an offline physical robot as connected.

**Hardening Implemented in Phase 8.3:**
1. **Initial Pairing State for Physical Devices:**
   - In `confirmPairing()`, if `isSimulated: false` (physical hardware), `lastHeartbeatTimestamp` is initialized to `0` and `currentDeviceTelemetry` is set to `null`.
   - `getDeviceStatus()` returns `connectionState: 'awaiting_device'` with `connected: false`.
2. **Heartbeat Reset Restriction:**
   - In `dispatchDeviceCommand()`, `lastHeartbeatTimestamp` is **only updated if `session.isSimulated === true` or `deliveredDirectly === true`**.
   - If a command is simply enqueued because a physical robot is offline or polling, `lastHeartbeatTimestamp` is **not updated**.
3. **UI Badge Representation:**
   - Virtual Simulation: Shows `🔵 Simulated Robot` (`badge-planned`).
   - Awaiting Physical Hardware: Shows `⏳ Awaiting Robot Connection` (`badge-warning`).
   - Physical Hardware Online: Shows `🟢 Visor Online` (`badge-active`) **only when the physical board has actually polled within 15 seconds**.
   - Heartbeat Stale / Timeout: Shows `🔴 Offline` (`badge-destructive`).
4. **Command Execution Feedback:**
   - Simulated: Displays *"processed by virtual adapter (simulation)"*.
   - Direct: Displays *"delivered directly to physical robot!"*.
   - Queued: Displays *"queued for physical robot (awaiting next poll)"*.

---

## 6. Sequential Office Bench-Test Procedure

Follow this sequential checklist on the office bench when the physical hardware arrives. **Do not advance to the next step until the current step is verified:**

```
 [Step 1: Visual Inspection] ──► [Step 2: Electrical Dry Run] ──► [Step 3: Secure Wi-Fi Config]
                                                                                │
 [Step 6: Serial Diagnostics] ◄── [Step 5: Board Flashing]    ◄── [Step 4: PlatformIO Compilation]
        │
        ▼
 [Step 7: Display & Face QA] ──► [Step 8: Web Pairing & Sync] ──► [Step 9: Thermal & Burn-In]
```

### Step 1: Visual Inspection & Silicon Identification
- [ ] Inspect ESP32-S3 development board RF shield. Confirm exact module marking: `ESP32-S3-WROOM-1-N8R8`.
- [ ] Inspect 2.4" TFT display silkscreen. Record controller IC markings (`ILI9341` or `ST7789`).
- [ ] Inspect display PCB for presence of `AMS1117-3.3` regulator and `Q1` backlight transistor.
- [ ] Verify display header is a single-row 2.54mm SPI header.

### Step 2: Electrical Dry Run & Wiring Verification (No Display Connected)
- [ ] Connect ESP32-S3 to PC via USB-C cable (use the `USB` or `UART` port).
- [ ] Using a digital multimeter (DC Volts):
  - Measure voltage between ESP32 `5V` (VBUS) and `GND`: strictly 4.90 V – 5.25 V.
  - Measure voltage between ESP32 `3.3V` and `GND`: strictly 3.28 V – 3.32 V.
- [ ] Unplug USB cable. Wire the connections in accordance with Section 4.4.
- [ ] Double-check: ensure GPIOs 33–37 have zero wires connected.

### Step 3: Secure Local Wi-Fi Configuration
- [ ] Copy `firmware/include/wifi_credentials.example.h` to `firmware/include/wifi_credentials.h`.
- [ ] Edit `firmware/include/wifi_credentials.h`:
  - Set `KURO_WIFI_SSID` to the office 2.4 GHz Wi-Fi SSID.
  - Set `KURO_WIFI_PASSWORD` to the Wi-Fi password.
  - Set `KURO_GATEWAY_HOST` to the office workstation's LAN IP (e.g. `192.168.1.100`, **not localhost**).
  - Set `KURO_GATEWAY_PORT` to `3000`.
- [ ] Verify that `firmware/include/wifi_credentials.h` is ignored by Git (`git status` must show it untracked/ignored).

### Step 4: Compile PlatformIO Firmware
- [ ] Open terminal in `firmware/`.
- [ ] If N8R8 board: run `pio run -e esp32s3_n8r8`.
- [ ] If generic board without PSRAM: run `pio run -e esp32s3_no_psram`.
- [ ] Verify clean compilation without warnings or linker errors.

### Step 5: Flash Microcontroller
- [ ] Put ESP32-S3 into download mode if needed (hold `BOOT`, press and release `RST`, release `BOOT`).
- [ ] Upload firmware: `pio run -e esp32s3_n8r8 --target upload`.
- [ ] Confirm flash progress reaches 100% and resets cleanly.

### Step 6: Serial Diagnostics Inspection
- [ ] Launch serial monitor: `pio device monitor -b 115200`.
- [ ] Verify startup banner:
  ```
  [KURO] === Kuro Robot Companion Firmware v0.1.0 ===
  [KURO] Protocol: 1.0 | Platform: ESP32-S3
  [KURO] Heap: xxx KB free | PSRAM: xxx KB free
  [KURO] Display initialized successfully (320x240, Landscape)
  ```
- [ ] Verify zero brownout resets (`ESP_RST_BROWNOUT`).

### Step 7: Display, Backlight & Expression Verification
- [ ] Verify backlight turns on cleanly without flickering.
- [ ] Verify deep black background (`#070a0f`) with zero dead pixels.
- [ ] Verify attentive digital eyes and subtle resting mouth line.
- [ ] Observe idle breathing vertical oscillation (subtle ±2px sinusoidal pulse).
- [ ] Observe natural eye blinking (smooth lid closure every 3.2–6.0 seconds).

### Step 8: Web Control Center Pairing & Hardware Synchronization
- [ ] Start production web server: `npm start`.
- [ ] Open Pet Studio in browser: `http://localhost:3000/pet-studio`.
- [ ] In the **Physical Robot Companion** card:
  - Click **Pair Robot Companion**.
  - Note the generated 6-digit numeric PIN.
  - Enter the ESP32's assigned LAN IP (shown in serial monitor).
  - Uncheck "Use Virtual Robot Adapter" to bind physical hardware.
  - Click **Confirm & Bind Robot**.
- [ ] Observe card status transition to `⏳ Awaiting Robot Connection`.
- [ ] When the ESP32 performs its first poll, observe badge transition to `🟢 Visor Online`.
- [ ] Test **Push Active Mood**: cycle through `happy`, `focused`, `sleepy`, `curious`. Confirm display updates in <100ms.
- [ ] Test **Push Palette**: cycle through `cyan`, `emerald`, `amber`, `violet`. Confirm glow color shifts instantly.
- [ ] Test **Transmit Subtitle Speech**: send *"Focus session active. Stay hydrated!"*. Observe text ribbon render and mouth cycle phoneme animation.
- [ ] Test **Ping Robot**: verify roundtrip ping latency is reported in milliseconds.

### Step 9: Disconnect Resilience & Burn-In Test
- [ ] Temporarily disable office Wi-Fi or disconnect gateway server.
- [ ] Confirm robot continues local face animations (blinking, breathing) without freezing or stuttering.
- [ ] Restore Wi-Fi/gateway. Confirm robot reconnects automatically within 15 seconds.
- [ ] Run continuous 4-hour desk burn-in test. Verify board temperature remains normal (<50°C) and free heap remains constant (zero memory leaks).

---

## 7. Quality Assurance & Full Regression Audit

### 7.1 Automated Regression Test Suite Breakdown

All 10 test suites were executed sequentially via `npm test`. **248 tests passed, 0 failures**:

| # | Test Suite | File | Tests | Failures | Status |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | Daily Summary Engine | `test/daily_summary.test.mjs` | 11 | 0 | **PASS** |
| 2 | Notifications, Automation & Integrations | `test/notifications_automation.test.mjs` | 27 | 0 | **PASS** |
| 3 | Desktop Companion Service | `companion/test_companion.mjs` | 21 | 0 | **PASS** |
| 4 | Pet Face Animation Engine | `test/pet_face_animation.test.mjs` | 23 | 0 | **PASS** |
| 5 | Autonomous Pet Lifecycle Engine | `test/autonomous_pet.test.mjs` | 29 | 0 | **PASS** |
| 6 | Full QA Regression Suite | `test/full_qa_regression.test.mjs` | 26 | 0 | **PASS** |
| 7 | Personal Assistant Reliability | `test/personal_assistant_reliability.test.mjs` | 37 | 0 | **PASS** |
| 8 | Activities & Acceptance Suite | `test/activities_and_acceptance.test.mjs` | 13 | 0 | **PASS** |
| 9 | Production Readiness & Security Gateways | `test/production_readiness_security.test.mjs` | 16 | 0 | **PASS** |
| 10 | ESP32-S3 Firmware Logic & Device Gateway | `test/esp32_firmware_logic.test.mjs` | 45 | 0 | **PASS** |
| | **TOTAL AUTOMATED VERIFICATIONS** | | **248** | **0** | **100% PASS** |

### 7.2 Static Code Analysis & Type Safety
- **Linter (`oxlint`):** Executed across 102 source files with 116 rules enabled. **0 warnings, 0 errors**.
- **TypeScript Compiler (`tsc -b`):** Full project typecheck completed. **0 type errors**.
- **Vite Production Bundler (`vite build`):** Clean compile in 1.63 seconds. All client chunks minified and bundled into `dist/`.

---

## 8. Remaining Blockers & Next Actionable Steps

1. **Hardware Arrival & Silkscreen Verification:**
   - Unbox ESP32-S3 DevKit and 2.4" SPI TFT panel upon courier delivery.
   - Cross-check controller markings against Section 4.2.
2. **PlatformIO Setup on Office Workstation:**
   - Install VS Code PlatformIO IDE extension or standalone Python `pip install platformio`.
3. **Wi-Fi Credentials Provisioning:**
   - Populate `firmware/include/wifi_credentials.h` with office network details.
4. **Bench Flashing & Execution:**
   - Execute the 9-stage bench test protocol documented in Section 6.
5. **Git Commit & Tag:**
   - Commit all Phase 8.0, 8.1, 8.2, and 8.3 improvements with clean tags.

