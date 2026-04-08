import 'package:flutter/services.dart';

/// Lightweight sound service using haptic feedback.
/// Full audio playback can be added later with audioplayers package.
class SoundService {
  bool _muted = false;

  void setMuted(bool value) => _muted = value;

  void play(String sound) {
    if (_muted) return;
    // Use haptic feedback as tactile sound substitute
    switch (sound) {
      case 'mark':
      case 'cardFlip':
        HapticFeedback.lightImpact();
      case 'correct':
      case 'gg':
        HapticFeedback.mediumImpact();
      case 'reveal':
      case 'yourTurn':
        HapticFeedback.selectionClick();
      case 'assassin':
        HapticFeedback.heavyImpact();
      default:
        HapticFeedback.selectionClick();
    }
  }
}

final soundService = SoundService();
