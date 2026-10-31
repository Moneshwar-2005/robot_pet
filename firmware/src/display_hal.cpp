/**
 * Kuro Robot Companion — Display Hardware Abstraction Layer Implementation
 */

#include "display_hal.h"
#include <string.h>

#ifdef ARDUINO
#include <Arduino.h>
#define LGFX_USE_V1
#include <LovyanGFX.hpp>

#if defined(KURO_DISPLAY_SSD1306_OLED)
// Hardware-configured LovyanGFX device for ESP32-WROOM-32 and 0.96" SSD1306 I2C OLED (128x64)
class LGFX_Kuro_OLED : public lgfx::LGFX_Device {
  lgfx::Panel_SSD1306 _panel_ssd;
  lgfx::Bus_I2C       _bus_instance;

public:
  LGFX_Kuro_OLED() {
    // 1. I2C Bus Configuration (I2C_NUM_0 on ESP32)
    {
      auto cfg = _bus_instance.config();
      cfg.i2c_port = 0;
      cfg.freq_write = OLED_I2C_FREQ;
      cfg.freq_read  = OLED_I2C_FREQ;
      cfg.pin_sda = KURO_PIN_OLED_SDA;
      cfg.pin_scl = KURO_PIN_OLED_SCL;
      cfg.i2c_addr = KURO_OLED_I2C_ADDR;
      _bus_instance.config(cfg);
    }

    // 2. Panel Configuration
    {
      auto cfg = _panel_ssd.config();
      cfg.panel_width  = SCREEN_WIDTH;
      cfg.panel_height = SCREEN_HEIGHT;
      cfg.offset_x     = 0;
      cfg.offset_y     = 0;
      _panel_ssd.config(cfg);
      _panel_ssd.setBus(&_bus_instance);
      setPanel(&_panel_ssd);
    }
  }
};

static lgfx::LGFX_Device* pLgfx = nullptr;

#else
// Hardware-configured LovyanGFX device for ESP32-S3 and 2.4" SPI TFT LCD
class LGFX_Kuro : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 _panel_ili;
  lgfx::Panel_ST7789  _panel_st;
  lgfx::Bus_SPI       _bus_instance;
  lgfx::Light_PWM     _light_instance;

public:
  LGFX_Kuro(uint8_t controllerType) {
    // 1. SPI Bus Configuration (FSPI / SPI2 on ESP32-S3)
    {
      auto cfg = _bus_instance.config();
      cfg.spi_host = SPI2_HOST;
      cfg.spi_mode = 0;
      cfg.freq_write = TFT_SPI_FREQ_WRITE;
      cfg.freq_read = TFT_SPI_FREQ_READ;
      cfg.pin_sclk = KURO_PIN_TFT_SCK;
      cfg.pin_mosi = KURO_PIN_TFT_MOSI;
      cfg.pin_miso = KURO_PIN_TFT_MISO;
      cfg.pin_dc   = KURO_PIN_TFT_DC;
      _bus_instance.config(cfg);
    }

    // 2. Panel Configuration
    if (controllerType == DISPLAY_CONTROLLER_ST7789) {
      _panel_st.setBus(&_bus_instance);
      auto cfg = _panel_st.config();
      cfg.pin_cs = KURO_PIN_TFT_CS;
      cfg.pin_rst = KURO_PIN_TFT_RST;
      cfg.panel_width = TFT_SCREEN_HEIGHT; // 240
      cfg.panel_height = TFT_SCREEN_WIDTH; // 320
      cfg.readable = false;
      cfg.invert = false;
      cfg.rgb_order = false;
      _panel_st.config(cfg);

      // Backlight Configuration
      if (KURO_PIN_TFT_BLK >= 0) {
        auto lightCfg = _light_instance.config();
        lightCfg.pin_bl = KURO_PIN_TFT_BLK;
        lightCfg.freq = 44100;
        lightCfg.pwm_channel = 7;
        _light_instance.config(lightCfg);
        _panel_st.setLight(&_light_instance);
      }
      setPanel(&_panel_st);
    } else {
      // Primary: ILI9341
      _panel_ili.setBus(&_bus_instance);
      auto cfg = _panel_ili.config();
      cfg.pin_cs = KURO_PIN_TFT_CS;
      cfg.pin_rst = KURO_PIN_TFT_RST;
      cfg.panel_width = TFT_SCREEN_HEIGHT; // 240
      cfg.panel_height = TFT_SCREEN_WIDTH; // 320
      cfg.readable = false;
      cfg.invert = false;
      cfg.rgb_order = false;
      _panel_ili.config(cfg);

      // Backlight Configuration
      if (KURO_PIN_TFT_BLK >= 0) {
        auto lightCfg = _light_instance.config();
        lightCfg.pin_bl = KURO_PIN_TFT_BLK;
        lightCfg.freq = 44100;
        lightCfg.pwm_channel = 7;
        _light_instance.config(lightCfg);
        _panel_ili.setLight(&_light_instance);
      }
      setPanel(&_panel_ili);
    }
  }
};

static lgfx::LGFX_Device* pLgfx = nullptr;
#endif

#endif

DisplayHAL display;

DisplayHAL::DisplayHAL()
  : _initialized(false),
    _brightness(100),
    _controllerType(ACTIVE_DISPLAY_CONTROLLER) {}

bool DisplayHAL::init() {
#ifdef ARDUINO
  if (!pLgfx) {
#if defined(KURO_DISPLAY_SSD1306_OLED)
    pLgfx = new LGFX_Kuro_OLED();
#else
    pLgfx = new LGFX_Kuro(_controllerType);
#endif
  }
  pLgfx->init();
  pLgfx->setRotation(DISPLAY_ROTATION);
  pLgfx->setBrightness((uint8_t)(_brightness * 255 / 100));
#endif

  _initialized = true;
  clear(COLOR_BG_DARK);
  return true;
}

void DisplayHAL::setBrightness(uint8_t percent) {
  if (percent > 100) percent = 100;
  _brightness = percent;

#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->setBrightness((uint8_t)(percent * 255 / 100));
  }
#endif
}

const char* DisplayHAL::getDriverName() const {
#if defined(KURO_DISPLAY_SSD1306_OLED)
  return "SSD1306 I2C OLED (128x64)";
#else
  switch (_controllerType) {
    case DISPLAY_CONTROLLER_ST7789:
      return "ST7789V (320x240)";
    case DISPLAY_CONTROLLER_ILI9341:
    default:
      return "ILI9341 (320x240)";
  }
#endif
}

void DisplayHAL::clear(uint16_t color) {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->fillScreen(color);
    return;
  }
#endif
  fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, color);
}

void DisplayHAL::startWrite() {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->startWrite();
  }
#endif
}

void DisplayHAL::endWrite() {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->endWrite();
    pLgfx->display(); // Flushes frame buffer on buffered displays like SSD1306
  }
#endif
}

void DisplayHAL::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) return;
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->drawPixel(x, y, color);
  }
#endif
}

void DisplayHAL::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->drawLine(x0, y0, x1, y1, color);
    return;
  }
#endif
  // Standard Bresenham line algorithm for host simulation
  int16_t dx = (x1 >= x0) ? (x1 - x0) : (x0 - x1);
  int16_t sx = (x0 < x1) ? 1 : -1;
  int16_t dy = (y1 >= y0) ? (y0 - y1) : (y1 - y0);
  int16_t sy = (y0 < y1) ? 1 : -1;
  int16_t err = dx + dy;

  while (true) {
    drawPixel(x0, y0, color);
    if (x0 == x1 && y0 == y1) break;
    int16_t e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

void DisplayHAL::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  if (w <= 0 || h <= 0) return;
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->drawRect(x, y, w, h, color);
    return;
  }
#endif
  drawLine(x, y, x + w - 1, y, color);
  drawLine(x, y + h - 1, x + w - 1, y + h - 1, color);
  drawLine(x, y, x, y + h - 1, color);
  drawLine(x + w - 1, y, x + w - 1, y + h - 1, color);
}

void DisplayHAL::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  if (w <= 0 || h <= 0) return;
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->fillRect(x, y, w, h, color);
    return;
  }
#endif
  for (int16_t j = y; j < y + h; j++) {
    for (int16_t i = x; i < x + w; i++) {
      drawPixel(i, j, color);
    }
  }
}

void DisplayHAL::drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;

#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->drawRoundRect(x, y, w, h, r, color);
    return;
  }
#endif
  drawLine(x + r, y, x + w - r - 1, y, color);
  drawLine(x + r, y + h - 1, x + w - r - 1, y + h - 1, color);
  drawLine(x, y + r, x, y + h - r - 1, color);
  drawLine(x + w - 1, y + r, x + w - 1, y + h - r - 1, color);
}

void DisplayHAL::fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
  if (w <= 0 || h <= 0) return;
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;

#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->fillRoundRect(x, y, w, h, r, color);
    return;
  }
#endif
  fillRect(x + r, y, w - 2 * r, h, color);
  fillRect(x, y + r, r, h - 2 * r, color);
  fillRect(x + w - r, y + r, r, h - 2 * r, color);
}

void DisplayHAL::drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->drawCircle(x0, y0, r, color);
    return;
  }
#endif
  int16_t f = 1 - r;
  int16_t ddF_x = 1;
  int16_t ddF_y = -2 * r;
  int16_t x = 0;
  int16_t y = r;

  drawPixel(x0, y0 + r, color);
  drawPixel(x0, y0 - r, color);
  drawPixel(x0 + r, y0, color);
  drawPixel(x0 - r, y0, color);

  while (x < y) {
    if (f >= 0) {
      y--;
      ddF_y += 2;
      f += ddF_y;
    }
    x++;
    ddF_x += 2;
    f += ddF_x;

    drawPixel(x0 + x, y0 + y, color);
    drawPixel(x0 - x, y0 + y, color);
    drawPixel(x0 + x, y0 - y, color);
    drawPixel(x0 - x, y0 - y, color);
    drawPixel(x0 + y, y0 + x, color);
    drawPixel(x0 - y, y0 + x, color);
    drawPixel(x0 + y, y0 - x, color);
    drawPixel(x0 - y, y0 - x, color);
  }
}

void DisplayHAL::fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->fillCircle(x0, y0, r, color);
    return;
  }
#endif
  for (int16_t y = -r; y <= r; y++) {
    for (int16_t x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) {
        drawPixel(x0 + x, y0 + y, color);
      }
    }
  }
}

void DisplayHAL::drawText(int16_t x, int16_t y, const char* text, uint16_t color, uint8_t size) {
  if (!text) return;
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->setTextSize(size);
    pLgfx->setTextColor(color, COLOR_BG_DARK);
    pLgfx->drawString(text, x, y);
    return;
  }
#endif
  int16_t cursorX = x;
  int16_t cursorY = y;
  size_t len = strlen(text);

  for (size_t i = 0; i < len; i++) {
    char c = text[i];
    if (c == '\n') {
      cursorX = x;
      cursorY += (8 * size);
      continue;
    }
    if (cursorX + (6 * size) > SCREEN_WIDTH) {
      cursorX = x;
      cursorY += (8 * size);
    }
    if (cursorY + (8 * size) > SCREEN_HEIGHT) break;
    cursorX += (6 * size);
  }
}

void DisplayHAL::drawTextCentered(int16_t y, const char* text, uint16_t color, uint8_t size) {
  if (!text) return;
#ifdef ARDUINO
  if (pLgfx && _initialized) {
    pLgfx->setTextSize(size);
    pLgfx->setTextColor(color, COLOR_BG_DARK);
    pLgfx->drawCenterString(text, SCREEN_WIDTH / 2, y);
    return;
  }
#endif
  int16_t len = (int16_t)strlen(text);
  int16_t w = len * 6 * size;
  int16_t x = (SCREEN_WIDTH - w) / 2;
  if (x < 2) x = 2;
  drawText(x, y, text, color, size);
}
