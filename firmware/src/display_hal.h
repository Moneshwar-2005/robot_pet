#pragma once

/**
 * Kuro Robot Companion — Display Hardware Abstraction Layer (HAL)
 *
 * Implements a configurable display driver abstraction for 2.4-inch 320x240 SPI TFT panels.
 * Supports primary controller ILI9341 and fallback controller ST7789.
 * Provides basic 2D drawing primitives, text rendering, and backlight PWM control.
 */

#include <stdint.h>
#include <stdbool.h>
#include "../include/config.h"

class DisplayHAL {
public:
  DisplayHAL();
  virtual ~DisplayHAL() = default;

  // Lifecycle
  virtual bool init();
  virtual void setBrightness(uint8_t percent);
  virtual uint8_t getBrightness() const { return _brightness; }

  // Screen operations
  virtual void clear(uint16_t color = COLOR_BG_DARK);
  virtual void startWrite();
  virtual void endWrite();

  // Basic 2D Primitives
  virtual void drawPixel(int16_t x, int16_t y, uint16_t color);
  virtual void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  virtual void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  virtual void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  virtual void drawCircle(int16_t x, int16_t y, int16_t r, uint16_t color);
  virtual void fillCircle(int16_t x, int16_t y, int16_t r, uint16_t color);

  // Text & Typography
  virtual void drawText(int16_t x, int16_t y, const char* text, uint16_t color, uint8_t size = 1);
  virtual void drawTextCentered(int16_t y, const char* text, uint16_t color, uint8_t size = 1);

  // Status & Properties
  bool isInitialized() const { return _initialized; }
  uint16_t getWidth() const { return TFT_SCREEN_WIDTH; }
  uint16_t getHeight() const { return TFT_SCREEN_HEIGHT; }
  const char* getDriverName() const;

protected:
  bool _initialized;
  uint8_t _brightness;
  uint8_t _controllerType;
};

extern DisplayHAL display;

