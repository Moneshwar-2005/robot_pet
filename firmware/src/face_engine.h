#pragma once

/**
 * Kuro Robot Companion — Face Animation & Visual Speech Engine
 *
 * Implements procedural digital expressions:
 * - Visor 1: 2.4" 320x240 Landscape TFT Visor (ESP32-S3)
 * - Visor 2: 0.96" 128x64 Monochrome OLED Visor (ESP32-WROOM-32)
 *
 * Features:
 * - 17 mood states matching web control center
 * - 3 eye shapes (curved, round, pixel)
 * - 4 glow color palettes (cyan, emerald, amber, violet)
 * - 10 mouth geometries + animated speaking phonemes
 * - Non-blocking elapsed-time scheduling (30 FPS target)
 * - Dynamic blinking, breathing oscillation, and visual speech display
 */

#include <stdint.h>
#include <stdbool.h>
#include "../include/config.h"
#include "display_hal.h"

enum EyeShapeType {
  EYE_SHAPE_CURVED = 0,
  EYE_SHAPE_ROUND = 1,
  EYE_SHAPE_PIXEL = 2,
};

enum GlowPaletteType {
  GLOW_CYAN = 0,
  GLOW_EMERALD = 1,
  GLOW_AMBER = 2,
  GLOW_VIOLET = 3,
};

enum MouthStyleType {
  MOUTH_CLOSED_SMILE = 0,
  MOUTH_OPEN_SMILE = 1,
  MOUTH_LAUGH = 2,
  MOUTH_TINY = 3,
  MOUTH_SURPRISED_O = 4,
  MOUTH_WORRIED_CURVE = 5,
  MOUTH_CONFUSED_CROOKED = 6,
  MOUTH_FOCUSED_LINE = 7,
  MOUTH_SLEEPY = 8,
  MOUTH_SPEAKING = 9,
};

class FaceEngine {
public:
  FaceEngine(DisplayHAL& disp);

  void init();

  // Non-blocking update called in main loop
  void update(uint32_t nowMs);

  // Expression Control
  void setMood(const char* moodName);
  const char* getMood() const { return _currentMood; }

  void setEyeShape(EyeShapeType shape);
  EyeShapeType getEyeShape() const { return _eyeShape; }

  void setGlowPalette(GlowPaletteType palette);
  GlowPaletteType getGlowPalette() const { return _palette; }
  uint16_t getPrimaryColor() const;

  void setMouthStyle(MouthStyleType style);
  MouthStyleType getMouthStyle() const { return _mouthStyle; }

  // Visual Speech Display
  void speak(const char* text, uint32_t durationMs = 0);
  void cancelSpeech();
  bool isSpeaking() const { return _isSpeaking; }

  // Network / Status Display Overlay
  void setWifiStatus(uint8_t state, const char* ip = nullptr);
  void triggerManualBlink();

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
#else
  // Coordinate Layout Constants (320x240 Landscape TFT Visor)
  static const int16_t EYE_LEFT_X = 96;
  static const int16_t EYE_RIGHT_X = 224;
  static const int16_t EYE_BASE_Y = 88;
  static const int16_t EYE_WIDTH = 56;
  static const int16_t EYE_HEIGHT = 48;
  static const int16_t MOUTH_X = 160;
  static const int16_t MOUTH_BASE_Y = 150;
  static const int16_t MOUTH_WIDTH = 48;
  static const int16_t MOUTH_HEIGHT = 20;
#endif

private:
  DisplayHAL& _disp;

  // Configuration state
  char _currentMood[20];
  EyeShapeType _eyeShape;
  GlowPaletteType _palette;
  MouthStyleType _mouthStyle;

  // Animation timing registers
  uint32_t _lastFrameMs;
  uint32_t _nextBlinkMs;
  uint32_t _blinkStartMs;
  bool _isBlinking;
  uint8_t _blinkPhase; // 0=open, 1-4=closing, 5-8=opening
  uint8_t _currentBlinkHeight; // Smooth procedural eyelid height in pixels

  // Speech timing & text
  bool _isSpeaking;
  char _speechText[224];
  uint32_t _speechEndMs;
  uint32_t _lastPhonemeMs;
  uint8_t _phonemeStep;

  // Status & Wi-Fi indicator
  uint8_t _wifiState;
  char _currentIp[18];

  // Render helpers
  void renderLeftEye(int16_t yOffset);
  void renderRightEye(int16_t yOffset);
  void renderMouth(int16_t yOffset);
  void renderSpeechRibbon();
  void renderStatusBar();

  // Procedural eye & mouth drawing
  void drawEyeGeometry(int16_t cx, int16_t cy, bool isLeft, uint8_t blinkHeight);
  void drawMouthGeometry(int16_t cx, int16_t cy, MouthStyleType style, uint8_t phoneme);
};
