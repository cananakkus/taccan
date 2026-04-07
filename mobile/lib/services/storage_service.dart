import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/session_record.dart';

class StorageService {
  static const _sessionKey = 'taccan.session';
  static const _themeKey = 'taccan.theme.v1';
  static const _languageKey = 'taccan.language';
  static const _soundMutedKey = 'taccan.soundMuted';
  static const _colorblindKey = 'taccan.colorblind';

  late final SharedPreferences _prefs;

  Future<void> initialize() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // Session

  SessionRecord? getSession() {
    final raw = _prefs.getString(_sessionKey);
    if (raw == null) return null;
    try {
      return SessionRecord.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<void> saveSession(SessionRecord session) async {
    await _prefs.setString(_sessionKey, jsonEncode(session.toJson()));
  }

  Future<void> clearSession() async {
    await _prefs.remove(_sessionKey);
  }

  // Preferences

  String getTheme() => _prefs.getString(_themeKey) ?? 'auto';

  Future<void> setTheme(String value) async {
    await _prefs.setString(_themeKey, value);
  }

  String getLanguage() => _prefs.getString(_languageKey) ?? 'en';

  Future<void> setLanguage(String value) async {
    await _prefs.setString(_languageKey, value);
  }

  bool getSoundMuted() => _prefs.getBool(_soundMutedKey) ?? false;

  Future<void> setSoundMuted(bool value) async {
    await _prefs.setBool(_soundMutedKey, value);
  }

  bool getColorblind() => _prefs.getBool(_colorblindKey) ?? true;

  Future<void> setColorblind(bool value) async {
    await _prefs.setBool(_colorblindKey, value);
  }
}
