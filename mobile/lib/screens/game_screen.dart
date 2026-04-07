import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../core/constants.dart';
import '../providers/providers.dart';
import '../providers/ui_provider.dart';
import '../services/socket_service.dart';
import '../utils/game_helpers.dart';
import '../widgets/bars/bottom_bar.dart';
import '../widgets/bars/phase_timer_bar.dart';
import '../widgets/bars/score_bar.dart';
import '../widgets/bars/turn_banner.dart';
import '../widgets/board/game_board.dart';
import '../widgets/common/toast_overlay.dart';
import '../widgets/controls/guess_controls.dart';
import '../widgets/controls/hint_controls.dart';
import '../widgets/controls/result_controls.dart';
import '../widgets/sheets/debrief_sheet.dart';
import '../widgets/sheets/feed_sheet.dart';
import '../widgets/sheets/settings_sheet.dart';
import '../widgets/sheets/teams_sheet.dart';

class GameScreen extends ConsumerStatefulWidget {
  const GameScreen({super.key});

  @override
  ConsumerState<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends ConsumerState<GameScreen> {
  StreamSubscription<ToastEvent>? _toastSub;
  StreamSubscription<SocketEvent>? _eventSub;

  @override
  void initState() {
    super.initState();
    final socket = ref.read(socketServiceProvider);

    _toastSub = socket.toasts.listen((event) {
      ref.read(toastProvider.notifier).show(
            event.message,
            event.type == ToastType.error ? ToastStyle.error : ToastStyle.info,
          );
    });

    _eventSub = socket.events.listen((event) {
      switch (event.name) {
        case 'game:gg_received':
          final name = event.data['name'] as String? ?? 'Someone';
          ref.read(toastProvider.notifier).show('$name says GG!', ToastStyle.success);
        case 'turn:timer_started':
          final phase = event.data['phase'] as String? ?? '';
          ref.read(toastProvider.notifier).show('$phase timer started');
        case 'turn:timer_expired':
          final phase = event.data['phase'] as String? ?? '';
          ref.read(toastProvider.notifier).show('$phase timer expired');
        case 'turn:mark_update':
          // Update board marks in snapshot
          // Marks are handled via state:full
          break;
      }
    });
  }

  @override
  void dispose() {
    _toastSub?.cancel();
    _eventSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = ref.watch(snapshotProvider);
    final game = ref.watch(gameProvider);
    final ui = ref.watch(uiProvider);
    final playerCanHint = canHint(snapshot);
    final playerCanGuess = canGuess(snapshot);

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            // Main content
            Column(
              children: [
                // Score bar
                const ScoreBar(),

                // Board
                Expanded(
                  child: game != null
                      ? const GameBoard()
                      : _buildLobby(context),
                ),

                // Turn banner + timer
                if (game != null) ...[
                  const TurnBanner(),
                  const PhaseTimerBar(),
                ],

                // Controls strip
                if (game != null) _buildControls(game, playerCanHint, playerCanGuess),

                // Bottom bar
                const BottomBar(),
              ],
            ),

            // Sheet overlay
            if (ui.openPanel != null) _buildSheet(ui.openPanel!, context),

            // Toast
            const ToastOverlay(),
          ],
        ),
      ),
    );
  }

  Widget _buildLobby(BuildContext context) {
    final me = ref.watch(meProvider);
    final players = ref.watch(playersProvider);
    final colors = Theme.of(context).colorScheme;
    final isHost = me?.isHost ?? false;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'LOBBY',
              style: GoogleFonts.playfairDisplaySc(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              '${players.length} agents in room',
              style: TextStyle(color: colors.onSurface.withValues(alpha: 0.6)),
            ),
            const SizedBox(height: 8),
            Text(
              'Assign teams, then host starts the game.',
              style: GoogleFonts.specialElite(
                fontSize: 12,
                color: colors.onSurface.withValues(alpha: 0.4),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            if (isHost)
              ElevatedButton(
                onPressed: () async {
                  try {
                    await ref.read(socketServiceProvider).startGame();
                  } catch (e) {
                    ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
                  }
                },
                child: Text(
                  'START GAME',
                  style: GoogleFonts.playfairDisplaySc(letterSpacing: 1),
                ),
              )
            else
              Text(
                'Waiting for host...',
                style: GoogleFonts.specialElite(
                  color: colors.onSurface.withValues(alpha: 0.4),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildControls(dynamic game, bool playerCanHint, bool playerCanGuess) {
    if (game.phase == GamePhase.finished) return const ResultControls();
    if (playerCanHint) return const HintControls();
    if (game.phase == GamePhase.guess || game.phase == GamePhase.hint) {
      return const GuessControls();
    }
    return const SizedBox.shrink();
  }

  Widget _buildSheet(SheetPanel panel, BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Stack(
      children: [
        // Backdrop
        GestureDetector(
          onTap: () => ref.read(uiProvider.notifier).closeSheet(),
          child: Container(color: Colors.black.withValues(alpha: 0.3)),
        ),
        // Sheet
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: Container(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.65,
            ),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.2),
                  blurRadius: 16,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Handle
                  Container(
                    width: 32,
                    height: 4,
                    margin: const EdgeInsets.only(top: 8),
                    decoration: BoxDecoration(
                      color: colors.outline.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  // Content
                  Flexible(
                    child: switch (panel) {
                      SheetPanel.teams => const TeamsSheet(),
                      SheetPanel.feed => const FeedSheet(),
                      SheetPanel.settings => const SettingsSheet(),
                      SheetPanel.debrief => const DebriefSheet(),
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
