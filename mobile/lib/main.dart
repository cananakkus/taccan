import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app.dart';
import 'providers/providers.dart';
import 'services/socket_service.dart';
import 'services/storage_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Preload fonts to avoid flash of unstyled text
  await GoogleFonts.pendingFonts([
    GoogleFonts.crimsonPro(),
    GoogleFonts.playfairDisplaySc(),
    GoogleFonts.specialElite(),
  ]);

  // Initialize storage
  final storage = StorageService();
  await storage.initialize();

  runApp(
    ProviderScope(
      overrides: [
        storageServiceProvider.overrideWithValue(storage),
      ],
      child: const _AppBootstrap(),
    ),
  );
}

class _AppBootstrap extends ConsumerStatefulWidget {
  const _AppBootstrap();

  @override
  ConsumerState<_AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends ConsumerState<_AppBootstrap> {
  StreamSubscription<SocketEvent>? _eventSub;
  StreamSubscription<bool>? _connectionSub;

  @override
  void initState() {
    super.initState();

    // Load persisted preferences + session
    ref.read(preferencesProvider.notifier).load();
    ref.read(sessionProvider.notifier).load();

    // Connect socket
    final socket = ref.read(socketServiceProvider);
    socket.connect();

    // Listen for server:ready → auto-rejoin
    _eventSub = socket.events.listen((event) {
      if (event.name == 'server:ready') {
        _tryAutoRejoin();
      }
    });

    // Track connection state for reconnection
    bool wasDisconnected = false;
    _connectionSub = socket.connectionState.listen((connected) {
      if (!connected) {
        wasDisconnected = true;
      } else if (wasDisconnected) {
        wasDisconnected = false;
        _tryAutoRejoin();
      }
    });
  }

  void _tryAutoRejoin() {
    final session = ref.read(sessionProvider);
    if (session == null) return;
    final socket = ref.read(socketServiceProvider);
    socket.rejoinRoom(session.code, session.sessionId, session.name).catchError((_) {
      // Rejoin failed — clear stale session
      ref.read(sessionProvider.notifier).clear();
      return <String, dynamic>{};
    });
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _connectionSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return const TaccanApp();
  }
}
