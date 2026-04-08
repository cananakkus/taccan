import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers/providers.dart';
import 'screens/game_screen.dart';
import 'screens/join_screen.dart';
import 'theme/taccan_theme.dart';

class TaccanApp extends ConsumerWidget {
  const TaccanApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(preferencesProvider);
    final snapshot = ref.watch(snapshotProvider);

    return MaterialApp(
      title: 'TACCAN',
      debugShowCheckedModeBanner: false,
      themeMode: prefs.themeMode,
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeAnimationDuration: const Duration(milliseconds: 200),
      themeAnimationCurve: Curves.easeInOut,
      home: snapshot != null ? const GameScreen() : const JoinScreen(),
    );
  }
}
