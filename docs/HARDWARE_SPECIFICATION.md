# Kuro — Phase 7.3: Final Physical Robot Hardware Design Review & Specification

**Document Version:** 1.1.0 (Phase 7.3 Final Design Review)  
**Status:** Provisional Pre-Purchasing Review & Engineering Plan  
**Notice:** Physical hardware assembly has NOT commenced. No physical tests have passed. All pinouts, electrical hookups, and component specifications must be physically confirmed against merchant listings and component datasheets prior to applying power.

---

## 1. Approved Product Requirements & Design Scope

The Kuro physical companion is governed by the following approved constraints:
- **Form Factor:** Compact desktop box-shaped enclosure (approx. 85 mm × 65 mm × 50 mm).
- **Display Visor:** 2.4-inch TFT LCD panel (target resolution 320 × 240 pixels, landscape orientation).
- **Microcontroller:** ESP32-family dual-core microcontroller with 2.4 GHz Wi-Fi and Bluetooth LE.
- **Power & Data Interface:** Single rear-panel USB-C connector for 5V DC power and serial flashing.
- **Actuation & Audio Limits:** **Strictly screen-only**. **Zero speakers, buzzers, servos, stepper motors, or moving physical mechanisms**.
- **Display Features:** Digital animated eyes (10 distinct moods, 3 eye shapes, 4 glow colorways), visual OLED-style mouth with speaking phonemes, and text speech ribbon.
- **Control Interface:** Kuro responsive web control center (local Wi-Fi / WebSockets).
- **Target Budget:** **₹1,500 – ₹3,000 INR** total bill of materials.

---

## 2. Microcontroller Evaluation & Board Recommendation

### 2.1 Comparative Analysis: ESP32-S3 vs. Classic ESP32 DevKit V1

| Evaluation Criteria | Proposed Primary: ESP32-S3-WROOM-1-N8R8 | Budget Alternative: Classic ESP32 DevKit V1 | Architectural Impact |
| :--- | :--- | :--- | :--- |
| **Processor Architecture** | Dual-core Xtensa LX7 @ 240 MHz with vector instructions | Dual-core Xtensa LX6 @ 240 MHz | S3 offers 15–20% faster math and geometry transformations for vector face rendering. |
| **Internal SRAM** | 512 KB SRAM | 520 KB SRAM (~328 KB usable) | On classic ESP32, after FreeRTOS, Wi-Fi stack, and lwIP buffers, largest contiguous free block is typically **~140–180 KB**. Allocating a single 153.6 KB frame buffer risks heap exhaustion and Wi-Fi crashes. |
| **External PSRAM** | **8 MB Octal PSRAM (OPI)** | **None** (Standard DevKit V1) | S3 PSRAM effortlessly accommodates full frame buffers, double-buffered off-screen sprites, font bitmaps, and WebSocket message queues simultaneously. |
| **USB-C Interface** | **Native USB-OTG / CDC** (Direct D+/D- on GPIO 19/20) + secondary UART | **External bridge only** (CH340 or CP2102 wired to USB-C port) | S3 native USB-CDC eliminates driver issues and enables future direct USB web-serial communication through the rear chassis port. |
| **SPI Performance** | FSPI / GDMA up to 80 MHz | VSPI / HSPI with DMA up to 40 MHz | S3 GDMA provides efficient asynchronous sprite transfers with minimal CPU overhead. |
| **Pin Constraints** | Octal PSRAM occupies GPIOs 33–37 | GPIOs 6–11 occupied by internal SPI flash | S3 requires avoiding GPIO 33–37. Classic ESP32 requires avoiding GPIO 6–11. |
| **Indian Market Price** | **₹680 – ₹850 INR** (Robu.in / ElectronicsComp) | **₹380 – ₹480 INR** (Robu.in / ElectronicsComp) | Price difference is ~₹300 INR, well within the ₹1,500–₹3,000 product budget. |

### 2.2 Recommendation Decision
**Recommended Board: ESP32-S3-DevKitC-1 with ESP32-S3-WROOM-1-N8R8 module (Dual USB-C).**

**Rationale:** The ₹300 price delta is fully justified by the **8 MB PSRAM**. On a 320 × 240 display with 16-bit color, a single frame requires 153.6 KB. Running the FreeRTOS Wi-Fi stack, mDNS responder, and WebSocket server on a classic ESP32 with only ~160 KB available heap leaves zero margin for frame buffers, forcing fragile scanline rendering. The ESP32-S3 provides rock-solid memory headroom, native USB-C, and dedicated hardware DMA.

---

## 3. Display Module Evaluation & Selection

### 3.1 2.4-inch Display Module Comparison

| Module Category | Controller | Interface | Compatibility Assessment | Recommendation Status |
| :--- | :--- | :--- | :--- | :--- |
| **2.4" SPI TFT (Red PCB)** | **ILI9341** (or ILI9341V) | 4-Wire SPI (CS, DC, MOSI, SCK, RST) | **Excellent.** Most widely documented 2.4" module. Supported by `LovyanGFX` and `TFT_eSPI`. Single-row header. Onboard 3.3V LDO on most boards. | **PRIMARY RECOMMENDATION** |
| **2.4" SPI TFT (IPS Variant)** | **ST7789V** | 4-Wire SPI | **Good alternative.** Wider viewing angles, slightly higher color saturation. Native support in `LovyanGFX`. | **VIABLE FALLBACK** |
| **2.4" Arduino Uno Shield** | ILI9341 / ST7781 | 8-bit / 16-bit Parallel | **INCOMPATIBLE.** 28-pin dual-row header designed for Arduino Uno. Consumes 12–18 GPIOs; lacks SPI lines. | **DO NOT PURCHASE** |
| **2.4" Nextion / DWIN HMI** | Proprietary USART | Serial UART | **OUT OF BUDGET.** Costs ₹1,800–₹2,500 for display alone; uses closed-source graphical editor. | **REJECTED** |

### 3.2 Display Specification Classification

| Parameter | Specification | Classification | Verification Method |
| :--- | :--- | :---: | :--- |
| **Active Screen Diagonal** | 2.4 inches (~48.96 mm × 36.72 mm) | **VERIFIED** | Matches mechanical chassis faceplate CAD aperture. |
| **Native Resolution** | 320 × 240 pixels (QVGA) | **VERIFIED** | Mathematical requirement: 76,800 RGB pixels. |
| **Color Depth** | 16-bit RGB565 (65,536 colors) | **VERIFIED** | Standard SPI TFT byte ordering (High Byte: `RRRRRGGG`, Low Byte: `GGGBBBBB`). |
| **Display Controller** | ILI9341 (or ST7789V) | **PROVISIONAL** | **Must confirm with seller.** Listing photo must confirm controller markings. Read controller ID register (`0x04`) over SPI during Stage 3 testing. |
| **Header Pinout** | Single-row 2.54mm header | **PROVISIONAL** | **Must confirm with seller.** Must have single-row header (avoid dual-row 28-pin parallel boards). |
| **Logic Signal Voltage** | **Strictly 3.3V Logic** | **VERIFIED** | **ESP32 GPIOs are NOT 5V tolerant.** Data pins (`CS`, `DC`, `MOSI`, `SCK`, `RST`) must never receive 5V. |
| **Power Supply (VCC)** | 5V (if LDO present) OR 3.3V | **REQUIRING SELLER CONFIRMATION** | Inspect PCB reverse side for AMS1117-3.3 regulator. If present, connect to 5V; if absent, connect to 3.3V. |
| **Backlight Circuit** | LED anode/cathode pin | **REQUIRING SELLER CONFIRMATION** | Inspect PCB for series resistor and switching transistor. Direct GPIO connection without a resistor is hazardous. |

---

## 4. Memory Calculations & Realistic Rendering Strategy

### 4.1 Exact Memory Requirements
- **Resolution:** 320 columns × 240 rows = 76,800 pixels.
- **Bytes per pixel:** 2 bytes (RGB565).
- **Single full-frame buffer:** $76,800 \times 2 = \mathbf{153,600\text{ bytes}}\;(150.0\text{ KB})$.
- **Full double-buffer:** $153,600 \times 2 = \mathbf{307,200\text{ bytes}}\;(300.0\text{ KB})$.

### 4.2 SPI Bandwidth & Frame Rate Reality
- Standard 1-bit SPI transfer at 40 MHz clock ($40 \times 10^6\text{ bits/sec}$):
  - Raw bits per full frame: $153,600\text{ bytes} \times 8 = 1,228,800\text{ bits}$.
  - SPI transfer time per full frame: $\frac{1,228,800}{40,000,000} = 0.03072\text{ s} \approx \mathbf{30.72\text{ ms}}$.
  - **Theoretical physical ceiling for full-screen refresh over 40 MHz SPI:** $\frac{1}{0.03072} \approx \mathbf{32.55\text{ FPS}}$.
  - At conservative 27 MHz SPI (recommended for prototyping jumper wires): $\frac{1,228,800}{27,000,000} \approx 45.5\text{ ms} \approx \mathbf{21.9\text{ FPS}}$.
- **Correction of Unverified Claims:** Prior assumptions of "60 FPS full-screen refresh" over 1-bit SPI are mathematically impossible without multi-bit quad-SPI. **The realistic target frame rate for Kuro is 30 FPS.**

### 4.3 Recommended Rendering Architecture: Localized Off-Screen Sprites
To avoid transmitting 153.6 KB on every frame, the background is kept static black (`#070a0f` / `0x0842`) and only dynamic regions are updated:
1. **Left Eye Sprite:** 64 × 52 px $\times 2\text{ bytes} = \mathbf{6,656\text{ bytes}}$ (~53.2 kbits).
2. **Right Eye Sprite:** 64 × 52 px $\times 2\text{ bytes} = \mathbf{6,656\text{ bytes}}$ (~53.2 kbits).
3. **OLED Mouth Sprite:** 48 × 22 px $\times 2\text{ bytes} = \mathbf{2,112\text{ bytes}}$ (~16.9 kbits).
4. **Speech Ribbon Sprite:** 296 × 36 px $\times 2\text{ bytes} = \mathbf{21,312\text{ bytes}}$ (~170.5 kbits, updated only when text changes).

**Performance Impact:**
- Routine facial animation (eyes blinking + mouth speaking) updates only $6,656 + 6,656 + 2,112 = \mathbf{15,424\text{ bytes}}$ (123.4 kbits).
- Transfer time at 40 MHz: $\frac{123,392}{40,000,000} \approx \mathbf{3.08\text{ ms}}$.
- **Bus utilization is reduced by ~90%**, allowing tear-free 30 FPS animation while leaving ample CPU time for Wi-Fi and WebSocket processing.

---

## 5. Electrical Safety, Power & Backlight Design

### 5.1 Power Supply Rails & Decoupling
- **Input Power:** Rear USB-C port provides 5V DC (500 mA – 1500 mA from standard host or USB charger).
- **Transient Suppression:** ESP32 Wi-Fi bursts draw up to 450 mA in sub-millisecond pulses. A **100 µF 16V electrolytic capacitor** in parallel with a **100 nF ceramic capacitor** must be placed directly between the ESP32 `3.3V` and `GND` pins.
- **Common Ground:** All GND returns (USB breakout, ESP32, display) must tie together into a common star ground to prevent signal ringing and SPI corruption.

### 5.2 Conditional Display Power (VCC) Design
Do not apply 5V or 3.3V blindly:
- **Condition A (Onboard LDO Present):** If the display PCB has a 3-pin IC labeled `AMS1117-3.3` or `662K`, connect display `VCC` to the **5V VBUS rail**. The onboard regulator produces clean 3.3V display power without drawing from the ESP32's internal 3.3V rail.
- **Condition B (No Onboard LDO):** If the display has no regulator and is marked `VCC 3.3V Only`, connect display `VCC` strictly to the **ESP32 3.3V output rail**. Applying 5V will permanently destroy the display controller.

### 5.3 Safe Backlight (LED / BLK) Circuit
- Backlight LEDs draw 40–60 mA. ESP32 GPIOs have an absolute maximum rating of 40 mA (recommended safe limit ≤20 mA).
- **Safe Circuit Design:**
  - **Option 1 (Module has internal transistor):** If display PCB includes a transistor (labeled `Q1`), GPIO 14 can directly drive the `LED` pin via a 1 kΩ base resistor.
  - **Option 2 (Module has raw LED pin):** An external **2N2222 NPN transistor** (or 2N7002 MOSFET) must be used:
    - Collector connected to display `LED` pin (with a 47Ω–68Ω current-limiting resistor if anode is tied to 5V/3.3V).
    - Base connected to ESP32 `GPIO 14` via a 1 kΩ resistor.
    - Emitter connected to common `GND`.
  - **Option 3 (Static On):** Connect `LED` pin to `3.3V` through a confirmed 68Ω–100Ω current-limiting resistor.

---

## 6. Provisional Pinout & Wiring Plan

> **CRITICAL WARNING:** This pin assignment is **PROVISIONAL**. Do not solder or power this circuit until the physical board and display pin labels have been confirmed.

```
 [Rear Panel-Mount USB-C Port]
        │
      5V VBUS ───► ESP32-S3 5V (VBUS Pin) ───► Display VCC (ONLY IF onboard 3.3V LDO confirmed!)
      GND    ───► ESP32-S3 GND            ───► Display GND + 100µF/100nF Cap
      D+/D-  ───► ESP32-S3 USB Port (for serial flashing and power)

 [ESP32-S3 Dev Board Pins]                 [2.4" SPI TFT LCD Module]
  GPIO 10 (FSPI CS)   ──────────────────►  CS (Chip Select, Active Low)
  GPIO 9  (Output)    ──────────────────►  RESET (Hardware Reset)
  GPIO 11 (Output)    ──────────────────►  DC / RS (Data=1 / Command=0)
  GPIO 12 (FSPI MOSI) ──────────────────►  MOSI / SDI (SPI Data In)
  GPIO 13 (FSPI SCK)  ──────────────────►  SCK / CLK (SPI Clock)
  GPIO 14 (LEDC PWM)  ──[Transistor/100Ω]► LED / BLK (Backlight Control)
  (Disconnected)                          MISO / SDO (Unused for write-only graphics)
  (Disconnected)                          T_CLK, T_CS, T_DIN, T_DO, T_IRQ (Touch: Unconnected)

 [RESTRICTED PINS — DO NOT CONNECT]
  GPIOs 33, 34, 35, 36, 37 : Internally bonded to Octal PSRAM on ESP32-S3-WROOM-1-N8R8!
  GPIO 0, GPIO 45, GPIO 46 : Strapping pins affecting boot mode.
```

---

## 7. Recalculated Bill of Materials (Estimated Market Range)

> **Pricing Disclaimer:** Prices are current estimated ranges from Indian hobbyist distributors (Robu.in, ElectronicsComp, Robocraze, Amazon.in) as of Q4 2026. These are estimates requiring current seller verification prior to placing orders.

| # | Component | Specifications | Qty | Est. Unit Price (INR) | Sourcing / Verification Requirements |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **1** | **ESP32-S3 Dev Board** | ESP32-S3-WROOM-1-N8R8 (8MB Flash, 8MB PSRAM, Dual USB-C) | 1 | ₹720 – ₹880 | Verify N8R8 label on RF shield. |
| **2** | **2.4" SPI TFT LCD** | 320×240, ILI9341 Driver, 4-wire SPI header | 1 | ₹550 – ₹700 | Confirm single-row SPI header (avoid parallel). |
| **3** | **USB-C Panel-Mount Cable** | 15 cm or 30 cm, Female-to-Male (4-wire data + power) | 1 | ₹160 – ₹220 | Confirm D+/D- continuity (not charge-only). |
| **4** | **USB-C Connection Cable** | 1 m – 1.5 m USB-A to USB-C or USB-C to USB-C | 1 | ₹120 – ₹180 | Common desktop accessory. |
| **5** | **Decoupling Capacitors** | 100 µF 16V Electrolytic + 100 nF 50V Ceramic | 1 set | ₹15 – ₹25 | Local electronics shop. |
| **6** | **Backlight Driver Circuit** | 2N2222 NPN Transistor + 1 kΩ & 68Ω Resistors | 1 set | ₹15 – ₹25 | Prevents GPIO overcurrent. |
| **7** | **Dupont Jumper Wires** | 10 cm–15 cm Female-to-Female, 20 pcs | 1 set | ₹50 – ₹80 | For initial breadboard testing. |
| **8** | **Prototype FR4 Perfboard** | 40 mm × 60 mm double-sided plated through-hole | 1 | ₹40 – ₹70 | For final soldered assembly. |
| **9** | **Box Enclosure** | Desktop box housing (ABS project box or 3D-printed PLA) | 1 | ₹350 – ₹550 | Internal dimensions ≥ 85 × 65 × 50 mm. |
| **10**| **M2 / M2.5 Standoffs & Screws** | Brass standoffs + screws (4x M2 for LCD, 4x M2.5 for ESP32) | 1 set | ₹70 – ₹110 | Rigid chassis mounting. |
| | **TOTAL ESTIMATED HARDWARE BUDGET** | | | **₹2,090 – ₹2,840** | **Fully within target budget of ₹1,500–₹3,000** |

---

## 8. Staged Hardware Test Plan

Execute each stage sequentially upon component delivery. **Do not advance to the next stage until the current stage criteria are met:**

```
 [Stage 1: Power Rail Dry Run] ──► [Stage 2: Serial Boot Check] ──► [Stage 3: Display SPI Init]
                                                                              │
 [Stage 6: 30 FPS Animation]   ◄── [Stage 5: Static Face & Color] ◄── [Stage 4: Color Bars]
        │
        ▼
 [Stage 7: Speech & Mouth]     ──► [Stage 8: Local Wi-Fi Sync]   ──► [Stage 9: 12h Thermal Burn-In]
```

- [ ] **Stage 1 — Power & Ground Safety Check (Dry Run, No Display Connected)**
  - Measure voltage between rear USB-C `5V` and `GND`: strictly 4.90 V – 5.25 V.
  - Measure voltage between ESP32 `3.3V` and `GND`: strictly 3.28 V – 3.32 V.
  - Continuity test: verify 0 ohms between ESP32 ground and USB-C shield ground. Ensure no short between 5V, 3.3V, and GND.

- [ ] **Stage 2 — Board Detection & Serial Flashing**
  - Connect ESP32-S3 to PC via rear USB-C cable. Verify COM port enumeration.
  - Flash basic serial output sketch (115200 baud).
  - Verify clean boot logs without brownout resets (`ESP_RST_BROWNOUT`).

- [ ] **Stage 3 — Display Visual Inspection & SPI Initialization**
  - Inspect display PCB for AMS1117 regulator and backlight circuit.
  - Wire provisional SPI connections. Flash minimal display init test using `LovyanGFX` at 20 MHz SPI.
  - Read display ID register (`0x04`) or confirm display exits sleep mode (`0x11`).

- [ ] **Stage 4 — Color Wash & Geometry Orientation**
  - Cycle full-screen primary colors: Red (`0xF800`), Green (`0x07E0`), Blue (`0x001F`), Black (`0x0000`).
  - Verify zero dead pixels and correct 320 × 240 landscape orientation (origin `(0,0)` at top-left).

- [ ] **Stage 5 — Static Kuro Face & Palette Accuracy**
  - Render static `attentive` face (curved digital eyes, resting mouth line).
  - Test all 4 glow palettes: `cyan` (`#06b6d4`), `emerald` (`#10b981`), `amber` (`#f59e0b`), `violet` (`#8b5cf6`).
  - Verify visual symmetry and correct spacing.

- [ ] **Stage 6 — Localized Sprite Animation (30 FPS Target)**
  - Render eye blink and breathing cycles using off-screen sprites (64×52 px eyes, 48×22 px mouth).
  - Measure rendering time per frame on hardware: must execute in under 33 ms (>30 FPS) with zero screen tearing.

- [ ] **Stage 7 — Visual Speech Ribbon & Mouth Phonemes**
  - Send simulated command: `"Hi! Work session started."`.
  - Confirm mouth cycles phoneme frames (closed ➔ mid ➔ wide) while speech ribbon renders wrapped text.
  - Verify clean return to `attentive` upon duration timeout.

- [ ] **Stage 8 — Local Wi-Fi Pairing & WebSocket Synchronization**
  - Connect ESP32 to local 2.4 GHz Wi-Fi. Verify ping to `kuro-robot.local`.
  - Connect Kuro web dashboard to `ws://kuro-robot.local:81/ws`.
  - Click mood buttons (`happy`, `curious`, `thinking`, `sleepy`, `error`). Verify hardware updates in <100 ms.

- [ ] **Stage 9 — Disconnect Resilience & 12-Hour Thermal Burn-In**
  - Power off Wi-Fi router. Verify robot displays disconnected icon, continues local animations, and reconnects automatically upon signal restoration.
  - Assemble in box enclosure. Run 12-hour continuous test. Monitor internal temperature (<55°C) and ensure free heap remains constant (zero memory leaks).

---

## 9. Remaining Decisions Requiring Product Links, Photos or Datasheets

Before purchasing or soldering:
1. **Merchant Display Listing Link / Photos:** Need photograph of the rear of the display module to confirm:
   - Presence of AMS1117-3.3 regulator.
   - Exact pin markings on single-row header.
   - Presence of backlight switching transistor.
2. **ESP32-S3 Product Listing:** Need confirmation that the board features an `ESP32-S3-WROOM-1-N8R8` module (8MB Flash, 8MB PSRAM) rather than an `N4` (0 PSRAM) variant.
3. **USB-C Panel-Mount Cable Listing:** Need confirmation of 4-wire pass-through (`VBUS`, `GND`, `D+`, `D-`).
