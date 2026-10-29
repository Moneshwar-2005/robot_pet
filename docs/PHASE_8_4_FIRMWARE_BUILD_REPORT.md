# Kuro — Phase 8.4: PlatformIO Setup & Firmware Build Report

**Document Version:** 1.0.0  
**Phase:** 8.4 (PlatformIO Setup & Real Firmware Build)  
**Date:** 2026-10-29  
**Status:** Firmware Code Verified & Compilation Blocked (Toolchain Pending Explicit Approval)  
**Strict Safety Notice:** No software or toolchains have been installed without explicit user approval. System PATH, execution policy, and system files remain untouched. Real hardware has not been flashed.

---

## 1. Executive Summary

Phase 8.4 attempted the initial genuine ESP32-S3 firmware compilation for the approved `esp32s3_n8r8` environment.

1. **Host Toolchain Inspection:** A comprehensive filesystem and registry audit determined that neither PlatformIO Core (`pio`) nor Python 3 is installed on the system `PATH`. Microsoft VS Code is installed (`C:\Users\ADMIN\AppData\Local\Programs\Microsoft VS Code`), but the PlatformIO IDE extension (`platformio.platformio-ide`) is not yet installed.
2. **Strict Compliance with Download & Installation Policy:** In strict adherence to user guidelines (*"Do not install software or download toolchains without explicit approval"* and *"Do not change system-wide PATH or execution policy without approval"*), the agent **did not silently install packages or download the Espressif32 toolchain**.
3. **Drive C Storage Constraint:** Drive C has only **6.26 GB of free disk space**. Downloading the full Espressif32 platform and Xtensa GCC toolchain requires 2.5–3.8 GB, making silent installation a storage hazard.
4. **Firmware Source Code Audit & Fixes:** Inspected all firmware source files and headers. Added `#include <esp_system.h>` to `firmware/src/net_manager.cpp` to ensure robust compilation of `esp_get_free_heap_size()`. Confirmed SPI DMA, LovyanGFX panel configurations, memory bounds, and protocol v1.0 handlers.
5. **Compilation Status:** **BLOCKED — TOOLCHAIN UNAVAILABLE PENDING APPROVAL**. In compliance with instructions, this is clearly reported as blocked rather than falsely claiming compilation success.
6. **Regression Verification:** All **10 test suites passed** with **248 automated tests passing and 0 failures**. Zero linter errors across 102 files and zero TypeScript errors.

---

## 2. Toolchain Availability Audit

The agent performed deep filesystem and command checks across all connected drives:

| Tool / Component | Expected Location | Actual Status | Details |
| :--- | :--- | :---: | :--- |
| **Microsoft VS Code** | `C:\Users\ADMIN\AppData\Local\Programs\Microsoft VS Code` | **INSTALLED** | `Code.exe` present; version 1.9x |
| **VS Code PlatformIO Extension** | `C:\Users\ADMIN\.vscode\extensions\platformio.*` | **NOT INSTALLED** | 10 other extensions present; PlatformIO extension absent |
| **PlatformIO Core CLI (`pio`)** | System `PATH` | **NOT INSTALLED** | `where.exe pio` returned not found |
| **PlatformIO Cache (`~/.platformio`)** | `C:\Users\ADMIN\.platformio` | **NOT PRESENT** | No cached Xtensa toolchain or Espressif framework packages |
| **Python on System PATH** | System `PATH` | **NOT FOUND** | Neither `python`, `python3`, nor `py` launcher found on PATH |
| **Standalone `uv` Python Tool** | `C:\Users\ADMIN\.local\bin\uv.exe` | **INSTALLED** | Found `uv.exe` with experimental `cpython-3.14.7` isolated under Roaming AppData (incompatible with PlatformIO Core 6.x / SCons 4.x which require Python 3.9–3.12) |
| **Available Disk Space (Drive C:)** | `C:\` | **6.26 GB FREE** | High storage sensitivity; caution required with large toolchains |

---

## 3. Commands Executed During Audit

The following commands were executed to inspect the system environment and test regression stability:

```powershell
# 1. Inspect installed developer programs and VS Code extensions
Get-ChildItem -Path "C:\Users\ADMIN\.vscode\extensions", "C:\Users\ADMIN\AppData\Local\Programs"

# 2. Probe for pio, python, and package managers on PATH
where.exe python; where.exe pio; where.exe platformio; where.exe git

# 3. Check Python runtimes managed by uv
C:\Users\ADMIN\.local\bin\uv.exe python list

# 4. Check disk storage on all active drives
Get-PSDrive -PSProvider FileSystem

# 5. Full automated test suite regression
npm.cmd test  # 10 test suites, 248 tests passed

# 6. Static code analysis and TypeScript typecheck
npx.cmd oxlint    # 0 errors, 0 warnings (102 files)
npx.cmd tsc -b    # 0 type errors
```

---

## 4. Firmware Code Audit & Fixes

Before attempting compilation, the firmware source code was audited against ESP-IDF / Arduino-esp32 APIs:

### 4.1 Fixed Missing Header in `firmware/src/net_manager.cpp`
- **Issue:** `net_manager.cpp` called `esp_get_free_heap_size()` while only including `<esp_heap_caps.h>`. On certain Espressif32 compiler toolchain versions, `esp_get_free_heap_size()` is declared strictly in `<esp_system.h>`.
- **Fix:** Added `#include <esp_system.h>` alongside `<esp_heap_caps.h>`.

### 4.2 Verified LovyanGFX SPI & DMA Configuration
- **File:** `firmware/src/display_hal.cpp`
- **Bus Host:** `SPI2_HOST` (FSPI on ESP32-S3), avoiding internal SPI flash/PSRAM buses (`SPI1_HOST` / `SPI0_HOST`).
- **Clock Frequencies:** `TFT_SPI_FREQ_WRITE = 40000000` (40 MHz for 30 FPS updates), `TFT_SPI_FREQ_READ = 16000000`, `TFT_SPI_FREQ_INIT = 20000000`.
- **Panel Dimensions & Rotation:** Native panel width 240, height 320; rotated to landscape (`TFT_ROTATION = 1`) producing 320×240 coordinates.
- **Dual Driver Support:** Verified ILI9341 primary configuration with seamless ST7789V fallback switch via `ACTIVE_DISPLAY_CONTROLLER`.

### 4.3 Verified Memory Limits & Safety Bounds
- **Payload Bound:** `KURO_MAX_PAYLOAD_SIZE = 512` bytes.
- **Serial Buffer:** `serialBuffer[KURO_MAX_PAYLOAD_SIZE]` indexed via `uint16_t serialBufferIdx` to prevent 8-bit overflow.
- **Dirty-Region Rendering:** Face animation updates only eyes (56×48 px) and mouth (48×20 px), requiring only **~12.8 KB per frame**, fitting well within internal 512KB SRAM and external 8MB Octal PSRAM.

---

## 5. Build Environment Setup: Exact Minimal Steps

Because PlatformIO is not installed on the system, the user can choose one of the two minimal, sanctioned paths below to enable firmware compilation:

### Path A: VS Code PlatformIO IDE Extension (Recommended)
Because Microsoft VS Code is already installed on this machine, this is the cleanest approach:
1. Open VS Code:
   ```powershell
   & "C:\Users\ADMIN\AppData\Local\Programs\Microsoft VS Code\Code.exe" F:\smart-pet-assistant-web
   ```
2. Press `Ctrl+P`, type `ext install platformio.platformio-ide`, and press `Enter`.
3. Wait 2–3 minutes while PlatformIO installs its isolated portable Python runtime into `%USERPROFILE%\.platformio`.
4. Open `firmware/` in VS Code and click the **PlatformIO: Build** checkmark icon on the bottom toolbar.

### Path B: CLI Installation via Python 3.11 / pip
1. Download Python 3.11 or 3.12 installer from [python.org](https://www.python.org/downloads/).
2. Run installer and check *"Add python.exe to PATH"*.
3. In PowerShell, install PlatformIO CLI:
   ```powershell
   pip install -U platformio
   ```
4. Compile the target environment:
   ```powershell
   cd F:\smart-pet-assistant-web\firmware
   pio run -e esp32s3_n8r8
   ```

---

## 6. Target Board Assumptions

The firmware build configuration relies on the following documented hardware assumptions:

| Parameter | Configuration Value | Justification / Verification Status |
| :--- | :--- | :--- |
| **Target Environment** | `esp32s3_n8r8` | Matches recommended `ESP32-S3-WROOM-1-N8R8` (8MB Flash, 8MB Octal PSRAM). |
| **Flash Mode** | `qio` (8MB) | High-speed Quad I/O Flash. |
| **PSRAM Type** | `opi` (8MB Octal SPI) | Uses `board_build.arduino.memory_type = qio_opi` and `-DBOARD_HAS_PSRAM`. |
| **Restricted Pins** | GPIOs 33, 34, 35, 36, 37 | Internally reserved for Octal PSRAM. Completely guarded in pinout. |
| **Provisional SPI Pins** | CS: 10, RST: 9, DC: 11, MOSI: 12, SCK: 13, BLK: 14 | Provisional FSPI pins; to be confirmed with physical board silkscreen. |
| **No-PSRAM Fallback** | `esp32s3_no_psram` | Maintained in `platformio.ini` in case the received board has no PSRAM. |

---

## 7. Quality Assurance & Regression Audit

### 7.1 Verification Summary Across All Layers

| Layer | Tests Executed | Result | Status |
| :--- | :---: | :---: | :---: |
| **Host-Side Automated Unit Tests** | 248 | 248 passed, 0 failed | **100% PASS** |
| **Static Code Linter (`oxlint`)** | 102 files | 0 warnings, 0 errors | **100% PASS** |
| **TypeScript Type Safety (`tsc -b`)** | Project-wide | 0 type errors | **100% PASS** |
| **Vite Production Web Build** | Complete client | Minified chunks built in 1.63s | **100% PASS** |
| **Real PlatformIO Firmware Compilation** | N/A | Blocked (Toolchain uninstalled) | **BLOCKED** |
| **Physical Device Flashing / Bench Tests** | N/A | Unclaimed (Awaiting hardware delivery) | **PENDING** |

---

## 8. Remaining Hardware Blockers & Next Actionable Steps

1. **Toolchain Installation Approval:**
   - The user or administrator must approve or perform the installation of PlatformIO (either via VS Code extension or `pip install platformio`).
2. **Firmware Compilation Execution:**
   - Once PlatformIO is installed, execute: `pio run -e esp32s3_n8r8` (compile-only; zero hardware flashing).
3. **Physical Hardware Delivery:**
   - Await delivery of the physical ESP32-S3 board and 2.4-inch SPI TFT panel to execute the 9-stage bench test protocol documented in Phase 8.3.

