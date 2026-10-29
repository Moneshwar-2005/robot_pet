/**
 * Kuro Robot Companion — Face Animation & Visual Speech Engine Implementation
 */

#include "face_engine.h"
#include <string.h>
#include <stdio.h>
#include <math.h>

FaceEngine::FaceEngine(DisplayHAL& disp)
  : _disp(disp),
    _eyeShape(EYE_SHAPE_CURVED),
    _palette(GLOW_CYAN),
    _mouthStyle(MOUTH_CLOSED_SMILE),
    _lastFrameMs(0),
    _nextBlinkMs(4000),
    _blinkStartMs(0),
    _isBlinking(false),
    _blinkPhase(0),
    _currentBlinkHeight(EYE_HEIGHT),
    _isSpeaking(false),
    _speechEndMs(0),
    _lastPhonemeMs(0),
    _phonemeStep(0),
    _wifiState(WIFI_STATE_DISCONNECTED) {
  strncpy(_currentMood, "attentive", sizeof(_currentMood) - 1);
  _speechText[0] = '\0';
  _currentIp[0] = '\0';
}

void FaceEngine::init() {
  _disp.clear(COLOR_BG_DARK);
  renderStatusBar();
  _lastFrameMs = 0;
  _nextBlinkMs = 3500;
  _currentBlinkHeight = EYE_HEIGHT;
}

uint16_t FaceEngine::getPrimaryColor() const {
  switch (_palette) {
    case GLOW_EMERALD: return COLOR_PALETTE_EMERALD;
    case GLOW_AMBER:   return COLOR_PALETTE_AMBER;
    case GLOW_VIOLET:  return COLOR_PALETTE_VIOLET;
    case GLOW_CYAN:
    default:           return COLOR_PALETTE_CYAN;
  }
}

void FaceEngine::setMood(const char* moodName) {
  if (!moodName) return;
  strncpy(_currentMood, moodName, sizeof(_currentMood) - 1);

  // Set default mouth style corresponding to mood if not actively speaking
  if (strcmp(moodName, "happy") == 0 || strcmp(moodName, "proud") == 0 || strcmp(moodName, "playful") == 0) {
    _mouthStyle = MOUTH_OPEN_SMILE;
  } else if (strcmp(moodName, "excited") == 0) {
    _mouthStyle = MOUTH_LAUGH;
  } else if (strcmp(moodName, "focused") == 0) {
    _mouthStyle = MOUTH_FOCUSED_LINE;
  } else if (strcmp(moodName, "surprised") == 0) {
    _mouthStyle = MOUTH_SURPRISED_O;
  } else if (strcmp(moodName, "worried") == 0 || strcmp(moodName, "error") == 0) {
    _mouthStyle = MOUTH_WORRIED_CURVE;
  } else if (strcmp(moodName, "curious") == 0 || strcmp(moodName, "confused") == 0) {
    _mouthStyle = MOUTH_CONFUSED_CROOKED;
  } else if (strcmp(moodName, "sleepy") == 0) {
    _mouthStyle = MOUTH_SLEEPY;
  } else if (strcmp(moodName, "idle") == 0 || strcmp(moodName, "thinking") == 0) {
    _mouthStyle = MOUTH_TINY;
  } else {
    _mouthStyle = MOUTH_CLOSED_SMILE;
  }
}

void FaceEngine::setEyeShape(EyeShapeType shape) {
  _eyeShape = shape;
}

void FaceEngine::setGlowPalette(GlowPaletteType palette) {
  _palette = palette;
  renderStatusBar();
}

void FaceEngine::setMouthStyle(MouthStyleType style) {
  _mouthStyle = style;
}

void FaceEngine::speak(const char* text, uint32_t durationMs) {
  if (!text || strlen(text) == 0) {
    cancelSpeech();
    return;
  }

  strncpy(_speechText, text, sizeof(_speechText) - 1);
  _speechText[sizeof(_speechText) - 1] = '\0';
  _isSpeaking = true;

  // Auto calculate duration if not specified (base 1.2s + 55ms/char, clamped [2.2s, 10s])
  if (durationMs == 0) {
    uint32_t len = (uint32_t)strlen(_speechText);
    durationMs = 1200 + len * 55;
    if (durationMs < 2200) durationMs = 2200;
    if (durationMs > 10000) durationMs = 10000;
  }

  // Set expiration relative to current elapsed time
  _speechEndMs = durationMs; // Handled in update via delta tracking
  _lastPhonemeMs = 0;
  _phonemeStep = 0;

  renderSpeechRibbon();
}

void FaceEngine::cancelSpeech() {
  _isSpeaking = false;
  _speechText[0] = '\0';
  _speechEndMs = 0;

  // Clear speech ribbon area with background color
  _disp.fillRect(10, 185, 300, 48, COLOR_BG_DARK);
}

void FaceEngine::setWifiStatus(uint8_t state, const char* ip) {
  _wifiState = state;
  if (ip) {
    strncpy(_currentIp, ip, sizeof(_currentIp) - 1);
    _currentIp[sizeof(_currentIp) - 1] = '\0';
  } else {
    _currentIp[0] = '\0';
  }
  renderStatusBar();
}

void FaceEngine::triggerManualBlink() {
  _isBlinking = true;
  _blinkPhase = 1;
}

void FaceEngine::update(uint32_t nowMs) {
  // Non-blocking frame scheduler: Target ~30 FPS (every 33ms)
  if (nowMs - _lastFrameMs < FRAME_INTERVAL_MS) {
    return;
  }
  _lastFrameMs = nowMs;

  // 1. Calculate Idle Breathing Offset (smooth +/- 2px sine wave, period 3.2s)
  int16_t breathingY = 0;
  if (strcmp(_currentMood, "sleepy") == 0) {
    breathingY = (int16_t)(sinf((float)(nowMs % 4000) * (2.0f * 3.14159f / 4000.0f)) * 3.0f);
  } else if (strcmp(_currentMood, "idle") == 0 || strcmp(_currentMood, "attentive") == 0) {
    breathingY = (int16_t)(sinf((float)(nowMs % BREATHING_CYCLE_MS) * (2.0f * 3.14159f / (float)BREATHING_CYCLE_MS)) * 2.0f);
  }

  // 2. Procedural Blinking State Machine
  uint8_t blinkHeight = EYE_HEIGHT;
  if (!_isBlinking && nowMs >= _nextBlinkMs) {
    _isBlinking = true;
    _blinkStartMs = nowMs;
    _blinkPhase = 1;
  }

  if (_isBlinking) {
    uint32_t blinkElapsed = nowMs - _blinkStartMs;
    if (blinkElapsed < BLINK_DURATION_MS / 2) {
      // Closing lids
      float progress = (float)blinkElapsed / ((float)BLINK_DURATION_MS / 2.0f);
      blinkHeight = (uint8_t)(EYE_HEIGHT * (1.0f - progress));
      if (blinkHeight < 4) blinkHeight = 4;
    } else if (blinkElapsed < BLINK_DURATION_MS) {
      // Opening lids
      float progress = (float)(blinkElapsed - BLINK_DURATION_MS / 2) / ((float)BLINK_DURATION_MS / 2.0f);
      blinkHeight = (uint8_t)(EYE_HEIGHT * progress);
      if (blinkHeight > EYE_HEIGHT) blinkHeight = EYE_HEIGHT;
    } else {
      _isBlinking = false;
      blinkHeight = EYE_HEIGHT;
      // Schedule next random blink (between 3.2s and 6.0s)
      uint32_t randomInterval = BLINK_INTERVAL_MIN_MS + (nowMs % (BLINK_INTERVAL_MAX_MS - BLINK_INTERVAL_MIN_MS));
      _nextBlinkMs = nowMs + randomInterval;
    }
  }
  _currentBlinkHeight = blinkHeight;

  // 3. Speech Ribbon & Mouth Phoneme Progression
  if (_isSpeaking) {
    if (_speechEndMs > FRAME_INTERVAL_MS) {
      _speechEndMs -= FRAME_INTERVAL_MS;
      if (nowMs - _lastPhonemeMs >= SPEECH_PHONEME_INTERVAL_MS) {
        _lastPhonemeMs = nowMs;
        _phonemeStep = (_phonemeStep + 1) % 4; // 0=closed, 1=mid, 2=wide, 3=open
      }
    } else {
      cancelSpeech();
    }
  }

  // 4. Render Localized Sprites (Eyes and Mouth Only)
  _disp.startWrite();
  renderLeftEye(breathingY);
  renderRightEye(breathingY);
  renderMouth(breathingY);
  _disp.endWrite();
}

void FaceEngine::renderStatusBar() {
  uint16_t primaryColor = getPrimaryColor();

  // Header Bar background
  _disp.fillRect(0, 0, TFT_SCREEN_WIDTH, 20, COLOR_BG_DARK);
  _disp.drawLine(0, 20, TFT_SCREEN_WIDTH - 1, 20, COLOR_BG_CARD);

  // Brand title on left
  _disp.drawText(8, 6, "KURO", primaryColor, 1);

  // Mood label in middle
  _disp.drawText(56, 6, _currentMood, COLOR_MUTED, 1);

  // Wi-Fi Status on right
  if (_wifiState == WIFI_STATE_CONNECTED) {
    _disp.drawText(220, 6, "WiFi Online", COLOR_STATUS_GREEN, 1);
  } else if (_wifiState == WIFI_STATE_CONNECTING) {
    _disp.drawText(210, 6, "WiFi Joining...", COLOR_STATUS_YELLOW, 1);
  } else {
    _disp.drawText(230, 6, "Offline", COLOR_MUTED, 1);
  }
}

void FaceEngine::drawEyeGeometry(int16_t cx, int16_t cy, bool isLeft, uint8_t blinkHeight) {
  uint16_t color = getPrimaryColor();
  int16_t halfW = EYE_WIDTH / 2;
  int16_t halfH = blinkHeight / 2;

  // Clear eye area
  _disp.fillRect(cx - halfW - 2, cy - (EYE_HEIGHT / 2) - 4, EYE_WIDTH + 4, EYE_HEIGHT + 8, COLOR_BG_DARK);

  // If blinking down to slit
  if (blinkHeight <= 6) {
    _disp.fillRoundRect(cx - halfW, cy - 2, EYE_WIDTH, 4, 2, color);
    return;
  }

  // Sleepy mood eye rendering
  if (strcmp(_currentMood, "sleepy") == 0) {
    _disp.drawRoundRect(cx - halfW, cy + 4, EYE_WIDTH, 8, 3, color);
    return;
  }

  // Happy mood eye rendering (curved inverted U arc)
  if (strcmp(_currentMood, "happy") == 0 || strcmp(_currentMood, "excited") == 0 || strcmp(_currentMood, "proud") == 0) {
    // Upper arc
    for (int8_t t = -2; t <= 2; t++) {
      _disp.drawCircle(cx, cy + 12 + t, halfW - 2, color);
    }
    // Mask bottom half
    _disp.fillRect(cx - halfW - 2, cy + 12, EYE_WIDTH + 4, halfH + 10, COLOR_BG_DARK);
    return;
  }

  // Playful winking mood (left eye winks, right eye open)
  if (strcmp(_currentMood, "playful") == 0 && isLeft) {
    _disp.fillRoundRect(cx - halfW, cy - 2, EYE_WIDTH, 4, 2, color);
    return;
  }

  // Standard eye rendering according to selected EyeShape
  switch (_eyeShape) {
    case EYE_SHAPE_ROUND:
      _disp.fillRoundRect(cx - halfW, cy - halfH, EYE_WIDTH, blinkHeight, halfH, color);
      break;
    case EYE_SHAPE_PIXEL:
      _disp.fillRect(cx - halfW, cy - halfH, EYE_WIDTH, blinkHeight, color);
      // Pixel inner cutout
      if (blinkHeight > 16) {
        _disp.fillRect(cx - 8, cy - 8, 16, 16, COLOR_BG_DARK);
      }
      break;
    case EYE_SHAPE_CURVED:
    default:
      // Rounded pill / capsule visor eye
      _disp.fillRoundRect(cx - halfW, cy - halfH, EYE_WIDTH, blinkHeight, 14, color);
      // Soft internal highlight reflection
      if (blinkHeight >= 24) {
        int16_t reflX = isLeft ? (cx - 8) : (cx + 4);
        _disp.fillCircle(reflX, cy - 8, 4, COLOR_WHITE);
      }
      break;
  }
}

void FaceEngine::renderLeftEye(int16_t yOffset) {
  int16_t cy = EYE_BASE_Y + yOffset;
  drawEyeGeometry(EYE_LEFT_X, cy, true, _currentBlinkHeight);
}

void FaceEngine::renderRightEye(int16_t yOffset) {
  int16_t cy = EYE_BASE_Y + yOffset;
  drawEyeGeometry(EYE_RIGHT_X, cy, false, _currentBlinkHeight);
}

void FaceEngine::drawMouthGeometry(int16_t cx, int16_t cy, MouthStyleType style, uint8_t phoneme) {
  uint16_t color = getPrimaryColor();
  int16_t halfW = MOUTH_WIDTH / 2;

  // Clear mouth bounding box
  _disp.fillRect(cx - halfW - 4, cy - 14, MOUTH_WIDTH + 8, MOUTH_HEIGHT + 14, COLOR_BG_DARK);

  if (_isSpeaking) {
    // Dynamic speaking phoneme cycles
    switch (phoneme) {
      case 0: // Closed resting line
        _disp.fillRoundRect(cx - 14, cy - 2, 28, 4, 2, color);
        break;
      case 1: // Small mid oval
        _disp.fillRoundRect(cx - 10, cy - 6, 20, 12, 5, color);
        break;
      case 2: // Wide open oval
        _disp.fillRoundRect(cx - 18, cy - 8, 36, 16, 6, color);
        break;
      case 3: // Open smile phoneme
        _disp.drawCircle(cx, cy - 6, 16, color);
        _disp.fillRect(cx - 20, cy - 20, 40, 14, COLOR_BG_DARK);
        break;
    }
    return;
  }

  // Static Mood Mouth Geometries
  switch (style) {
    case MOUTH_OPEN_SMILE:
    case MOUTH_LAUGH: {
      // Warm open smile grin
      int16_t r = (style == MOUTH_LAUGH) ? 18 : 14;
      for (int8_t t = -1; t <= 1; t++) {
        _disp.drawCircle(cx, cy - 4 + t, r, color);
      }
      _disp.fillRect(cx - halfW - 2, cy - 20, MOUTH_WIDTH + 4, 16, COLOR_BG_DARK);
      break;
    }
    case MOUTH_SURPRISED_O:
      _disp.drawCircle(cx, cy, 8, color);
      break;
    case MOUTH_WORRIED_CURVE:
      // Inverted downturned curve
      for (int8_t t = -1; t <= 1; t++) {
        _disp.drawCircle(cx, cy + 12 + t, 14, color);
      }
      _disp.fillRect(cx - halfW - 2, cy + 12, MOUTH_WIDTH + 4, 18, COLOR_BG_DARK);
      break;
    case MOUTH_CONFUSED_CROOKED:
      _disp.drawLine(cx - 16, cy - 3, cx - 4, cy + 4, color);
      _disp.drawLine(cx - 4, cy + 4, cx + 8, cy - 2, color);
      _disp.drawLine(cx + 8, cy - 2, cx + 16, cy + 2, color);
      break;
    case MOUTH_FOCUSED_LINE:
      _disp.fillRoundRect(cx - 16, cy - 1, 32, 3, 1, color);
      break;
    case MOUTH_SLEEPY:
    case MOUTH_TINY:
      _disp.fillRoundRect(cx - 6, cy - 1, 12, 3, 1, color);
      break;
    case MOUTH_CLOSED_SMILE:
    default:
      // Subtle friendly smile curve
      for (int8_t t = -1; t <= 1; t++) {
        _disp.drawCircle(cx, cy - 8 + t, 18, color);
      }
      _disp.fillRect(cx - halfW - 2, cy - 22, MOUTH_WIDTH + 4, 22, COLOR_BG_DARK);
      break;
  }
}

void FaceEngine::renderMouth(int16_t yOffset) {
  int16_t cy = MOUTH_BASE_Y + yOffset;
  drawMouthGeometry(MOUTH_X, cy, _mouthStyle, _phonemeStep);
}

void FaceEngine::renderSpeechRibbon() {
  if (!_isSpeaking || strlen(_speechText) == 0) return;

  uint16_t primaryColor = getPrimaryColor();

  // Speech box background card
  _disp.fillRoundRect(10, 186, 300, 46, 6, COLOR_BG_CARD);
  _disp.drawRoundRect(10, 186, 300, 46, 6, primaryColor);

  // Render text inside speech bubble (up to 2 lines, word-wrapped)
  _disp.drawText(18, 194, _speechText, COLOR_WHITE, 1);
}

