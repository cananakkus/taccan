import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../core/env.dart';
import '../models/snapshot.dart';

class SocketService {
  io.Socket? _socket;

  final _snapshotController = StreamController<Snapshot>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();
  final _toastController = StreamController<ToastEvent>.broadcast();
  final _eventController = StreamController<SocketEvent>.broadcast();

  Stream<Snapshot> get snapshots => _snapshotController.stream;
  Stream<bool> get connectionState => _connectionController.stream;
  Stream<ToastEvent> get toasts => _toastController.stream;
  Stream<SocketEvent> get events => _eventController.stream;
  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    _socket = io.io(
      Env.baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .setPath(Env.socketPath)
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionAttempts(100)
          .build(),
    );

    _socket!.onConnect((_) => _connectionController.add(true));
    _socket!.onDisconnect((_) => _connectionController.add(false));
    _socket!.onConnectError((_) => _connectionController.add(false));

    _socket!.on('server:ready', (_) {
      _eventController.add(const SocketEvent('server:ready'));
    });

    _socket!.on('state:full', (data) {
      try {
        final json = Map<String, dynamic>.from(data as Map);
        _snapshotController.add(Snapshot.fromJson(json));
      } catch (e) { debugPrint('Socket parse error: $e'); }
    });

    _socket!.on('error:rule_violation', (data) {
      final json = Map<String, dynamic>.from(data as Map);
      _toastController.add(ToastEvent(
        message: json['message'] as String? ?? 'Action rejected',
        type: ToastType.error,
      ));
    });

    _socket!.on('server:info', (data) {
      final json = Map<String, dynamic>.from(data as Map);
      final message = json['message'] as String?;
      if (message != null) {
        _toastController.add(ToastEvent(message: message));
      }
    });

    for (final event in _forwardedEvents) {
      _socket!.on(event, (data) {
        final json = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
        _eventController.add(SocketEvent(event, data: json));
      });
    }
  }

  static const _forwardedEvents = [
    'turn:timer_started',
    'turn:timer_expired',
    'turn:guess_resolved',
    'turn:hint_accepted',
    'turn:ended',
    'turn:mark_toggled',
    'turn:mark_update',
    'game:started',
    'game:finished',
    'game:gg_received',
    'game:mvp_result',
    'chat:message',
    'voice:peer_joined',
    'voice:peer_left',
    'voice:signal',
    'voice:mute_changed',
  ];

  Future<Map<String, dynamic>> emitWithAck(
    String event,
    Map<String, dynamic> payload,
  ) async {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      throw Exception('Not connected');
    }

    final completer = Completer<Map<String, dynamic>>();

    socket.emitWithAck(event, payload, ack: (response) {
      if (response == null) {
        completer.completeError('No response from server');
        return;
      }
      final json = Map<String, dynamic>.from(response as Map);
      if (json['ok'] == true) {
        completer.complete(json);
      } else {
        completer.completeError(json['error'] ?? 'Request rejected');
      }
    });

    return completer.future.timeout(Env.ackTimeout, onTimeout: () {
      throw TimeoutException('Request timed out');
    });
  }

  // Convenience methods matching the API surface

  Future<Map<String, dynamic>> createRoom(String name) =>
      emitWithAck('room:create', {'name': name});

  Future<Map<String, dynamic>> joinRoom(String code, String name) =>
      emitWithAck('room:join', {'code': code, 'name': name});

  Future<Map<String, dynamic>> rejoinRoom(String code, String sessionId, String name) =>
      emitWithAck('room:rejoin', {'code': code, 'sessionId': sessionId, 'name': name});

  Future<void> leaveRoom() => emitWithAck('room:leave', {});

  Future<void> setTeam(String team) => emitWithAck('team:set', {'team': team});

  Future<void> setRole(String role) => emitWithAck('role:set', {'role': role});

  Future<void> startGame() => emitWithAck('game:start', {});

  Future<void> submitHint(String word, int count) =>
      emitWithAck('turn:hint_submit', {'word': word, 'count': count});

  Future<void> toggleMark(int index) =>
      emitWithAck('turn:mark_toggle', {'index': index});

  Future<Map<String, dynamic>> submitGuess(int index) =>
      emitWithAck('turn:guess', {'index': index});

  Future<void> endTurn() => emitWithAck('turn:end', {});

  Future<void> sendChat(String text) =>
      emitWithAck('chat:send', {'text': text});

  Future<void> sendGG() => emitWithAck('game:gg', {});

  Future<void> rematch(String mode) =>
      emitWithAck('game:rematch', {'mode': mode});

  Future<void> setMode(String mode) =>
      emitWithAck('room:mode_set', {'mode': mode});

  Future<void> pruneDisconnected() =>
      emitWithAck('room:prune_disconnected', {});

  Future<void> mvpVote(String targetSessionId) =>
      emitWithAck('game:mvp_vote', {'targetSessionId': targetSessionId});

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }

  void dispose() {
    disconnect();
    _snapshotController.close();
    _connectionController.close();
    _toastController.close();
    _eventController.close();
  }
}

class ToastEvent {
  final String message;
  final ToastType type;

  const ToastEvent({required this.message, this.type = ToastType.info});
}

enum ToastType { info, success, error }

class SocketEvent {
  final String name;
  final Map<String, dynamic> data;

  const SocketEvent(this.name, {this.data = const {}});
}
