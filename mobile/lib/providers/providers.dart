import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session_record.dart';
import '../models/snapshot.dart';
import '../services/socket_service.dart';
import '../services/storage_service.dart';

// ── Services ──

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService();
  ref.onDispose(() => service.dispose());
  return service;
});

// ── Connection ──

final connectionProvider = StateNotifierProvider<ConnectionNotifier, bool>((ref) {
  final socket = ref.watch(socketServiceProvider);
  return ConnectionNotifier(socket);
});

class ConnectionNotifier extends StateNotifier<bool> {
  final SocketService _socket;
  StreamSubscription<bool>? _sub;

  ConnectionNotifier(this._socket) : super(false) {
    _sub = _socket.connectionState.listen((connected) {
      state = connected;
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// ── Snapshot ──

final snapshotProvider = StateNotifierProvider<SnapshotNotifier, Snapshot?>((ref) {
  final socket = ref.watch(socketServiceProvider);
  return SnapshotNotifier(socket);
});

class SnapshotNotifier extends StateNotifier<Snapshot?> {
  final SocketService _socket;
  StreamSubscription<Snapshot>? _sub;

  SnapshotNotifier(this._socket) : super(null) {
    _sub = _socket.snapshots.listen((snapshot) {
      state = snapshot;
    });
  }

  void clear() => state = null;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// ── Session ──

final sessionProvider = StateNotifierProvider<SessionNotifier, SessionRecord?>((ref) {
  final storage = ref.watch(storageServiceProvider);
  return SessionNotifier(storage);
});

class SessionNotifier extends StateNotifier<SessionRecord?> {
  final StorageService _storage;

  SessionNotifier(this._storage) : super(null);

  void load() {
    state = _storage.getSession();
  }

  Future<void> save(SessionRecord session) async {
    state = session;
    await _storage.saveSession(session);
  }

  Future<void> clear() async {
    state = null;
    await _storage.clearSession();
  }
}

// ── Preferences ──

final preferencesProvider =
    StateNotifierProvider<PreferencesNotifier, PreferencesState>((ref) {
  final storage = ref.watch(storageServiceProvider);
  return PreferencesNotifier(storage);
});

class PreferencesState {
  final ThemeMode themeMode;
  final String language;
  final bool soundMuted;
  final bool colorblindMode;

  const PreferencesState({
    this.themeMode = ThemeMode.system,
    this.language = 'en',
    this.soundMuted = false,
    this.colorblindMode = true,
  });

  PreferencesState copyWith({
    ThemeMode? themeMode,
    String? language,
    bool? soundMuted,
    bool? colorblindMode,
  }) =>
      PreferencesState(
        themeMode: themeMode ?? this.themeMode,
        language: language ?? this.language,
        soundMuted: soundMuted ?? this.soundMuted,
        colorblindMode: colorblindMode ?? this.colorblindMode,
      );
}

class PreferencesNotifier extends StateNotifier<PreferencesState> {
  final StorageService _storage;

  PreferencesNotifier(this._storage) : super(const PreferencesState());

  void load() {
    final theme = _storage.getTheme();
    state = PreferencesState(
      themeMode: switch (theme) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      },
      language: _storage.getLanguage(),
      soundMuted: _storage.getSoundMuted(),
      colorblindMode: _storage.getColorblind(),
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    await _storage.setTheme(switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      _ => 'auto',
    });
  }

  Future<void> toggleTheme(Brightness current) async {
    final next = current == Brightness.dark ? ThemeMode.light : ThemeMode.dark;
    await setThemeMode(next);
  }

  Future<void> setLanguage(String lang) async {
    state = state.copyWith(language: lang);
    await _storage.setLanguage(lang);
  }

  Future<void> toggleSound() async {
    final next = !state.soundMuted;
    state = state.copyWith(soundMuted: next);
    await _storage.setSoundMuted(next);
  }

  Future<void> toggleColorblind() async {
    final next = !state.colorblindMode;
    state = state.copyWith(colorblindMode: next);
    await _storage.setColorblind(next);
  }
}

// ── Derived ──

final gameProvider = Provider<GameView?>((ref) {
  return ref.watch(snapshotProvider)?.game;
});

final meProvider = Provider<MeView?>((ref) {
  return ref.watch(snapshotProvider)?.me;
});

final roomProvider = Provider<RoomView?>((ref) {
  return ref.watch(snapshotProvider)?.room;
});

final playersProvider = Provider<List<PlayerView>>((ref) {
  return ref.watch(snapshotProvider)?.players ?? const [];
});
