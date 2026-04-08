import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../core/constants.dart';
import '../providers/providers.dart';
import '../providers/ui_provider.dart';
import '../services/socket_service.dart';
import '../services/sound_service.dart';
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
import '../widgets/sheets/voice_sheet.dart';

class GameScreen extends ConsumerStatefulWidget {
  const GameScreen({super.key});

  @override
  ConsumerState<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends ConsumerState<GameScreen> with SingleTickerProviderStateMixin {
  StreamSubscription<ToastEvent>? _toastSub;
  StreamSubscription<SocketEvent>? _eventSub;
  late final AnimationController _sheetController;
  late final Animation<Offset> _sheetSlide;
  late final Animation<double> _backdropOpacity;
  SheetPanel? _animatingPanel;

  @override
  void initState() {
    super.initState();
    _sheetController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
    _sheetSlide = Tween<Offset>(
      begin: const Offset(0, 1),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _sheetController, curve: Curves.easeOutCubic));
    _backdropOpacity = Tween<double>(begin: 0, end: 1).animate(_sheetController);

    _sheetController.addStatusListener((status) {
      if (status == AnimationStatus.dismissed) {
        setState(() => _animatingPanel = null);
      }
    });

    // Sync sound mute with preferences
    soundService.setMuted(ref.read(preferencesProvider).soundMuted);

    final socket = ref.read(socketServiceProvider);
    _toastSub = socket.toasts.listen((event) {
      ref.read(toastProvider.notifier).show(
            event.message,
            event.type == ToastType.error ? ToastStyle.error : ToastStyle.info,
          );
    });

    _eventSub = socket.events.listen((event) {
      final tr = ref.read(trProvider);
      switch (event.name) {
        case 'turn:guess_resolved':
          final color = event.data['color'] as String? ?? '';
          if (color == 'assassin') {
            soundService.play('assassin');
          } else if (color == (event.data['team'] ?? '')) {
            soundService.play('correct');
          } else {
            soundService.play('reveal');
          }
        case 'game:gg_received':
          final name = event.data['name'] as String? ?? 'Someone';
          soundService.play('gg');
          ref.read(toastProvider.notifier).show(
                tr('says_gg', vars: {'name': name}),
                ToastStyle.success,
              );
        case 'turn:timer_started':
          final phase = event.data['phase'] as String? ?? '';
          ref.read(toastProvider.notifier).show(tr('timer_started', vars: {'phase': phase}));
        case 'turn:timer_expired':
          final phase = event.data['phase'] as String? ?? '';
          ref.read(toastProvider.notifier).show(tr('timer_expired', vars: {'phase': phase}));
      }
    });
  }

  @override
  void dispose() {
    _toastSub?.cancel();
    _eventSub?.cancel();
    _sheetController.dispose();
    super.dispose();
  }

  void _openSheet(SheetPanel panel) {
    _animatingPanel = panel;
    ref.read(uiProvider.notifier).openSheet(panel);
    _sheetController.forward(from: 0);
  }

  void _closeSheet() {
    _sheetController.reverse().then((_) {
      ref.read(uiProvider.notifier).closeSheet();
    });
  }

  void _toggleSheet(SheetPanel panel) {
    final current = ref.read(uiProvider).openPanel;
    if (current == panel) {
      _closeSheet();
    } else if (current != null) {
      // Switch panels without animation
      ref.read(uiProvider.notifier).openSheet(panel);
      _animatingPanel = panel;
    } else {
      _openSheet(panel);
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = ref.watch(snapshotProvider);
    final game = ref.watch(gameProvider);
    final ui = ref.watch(uiProvider);
    final tr = ref.watch(trProvider);
    final playerCanHint = canHint(snapshot);
    final playerCanGuess = canGuess(snapshot);
    final showPanel = ui.openPanel ?? _animatingPanel;

    final isLandscape = MediaQuery.of(context).orientation == Orientation.landscape;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            isLandscape && game != null
                ? _buildLandscapeLayout(game, playerCanHint, playerCanGuess, tr)
                : _buildPortraitLayout(game, playerCanHint, playerCanGuess, tr),
            // Animated sheet overlay
            if (showPanel != null) ...[
              FadeTransition(
                opacity: _backdropOpacity,
                child: GestureDetector(
                  onTap: _closeSheet,
                  child: Container(color: Colors.black.withValues(alpha: 0.3)),
                ),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: SlideTransition(
                  position: _sheetSlide,
                  child: _buildSheetContainer(showPanel, context),
                ),
              ),
            ],
            const ToastOverlay(),
          ],
        ),
      ),
    );
  }

  Widget _buildPortraitLayout(dynamic game, bool playerCanHint, bool playerCanGuess, dynamic tr) {
    return Column(
      children: [
        const ScoreBar(),
        Expanded(
          child: game != null ? const GameBoard() : _buildLobby(context, tr),
        ),
        if (game != null) ...[
          const TurnBanner(),
          const PhaseTimerBar(),
        ],
        if (game != null) _buildControls(game, playerCanHint, playerCanGuess),
        BottomBar(onToggleSheet: _toggleSheet),
      ],
    );
  }

  Widget _buildLandscapeLayout(dynamic game, bool playerCanHint, bool playerCanGuess, dynamic tr) {
    return Column(
      children: [
        Expanded(
          child: Row(
            children: [
              // Board takes left side
              Expanded(
                flex: 6,
                child: Column(
                  children: [
                    const ScoreBar(),
                    Expanded(child: const GameBoard()),
                  ],
                ),
              ),
              // Controls take right side
              Expanded(
                flex: 4,
                child: Column(
                  children: [
                    const TurnBanner(),
                    const PhaseTimerBar(),
                    Expanded(
                      child: SingleChildScrollView(
                        child: _buildControls(game, playerCanHint, playerCanGuess),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        BottomBar(onToggleSheet: _toggleSheet),
      ],
    );
  }

  Widget _buildLobby(BuildContext context, String Function(String, {Map<String, String>? vars}) tr) {
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
              tr('lobby'),
              style: GoogleFonts.playfairDisplaySc(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: colors.onSurface,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              tr('agents_in_room', vars: {'count': '${players.length}'}),
              style: TextStyle(color: colors.onSurface.withValues(alpha: 0.6)),
            ),
            const SizedBox(height: 8),
            Text(
              tr('assign_teams'),
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
                  tr('start_game'),
                  style: GoogleFonts.playfairDisplaySc(letterSpacing: 1),
                ),
              )
            else
              Text(
                tr('waiting_host'),
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

  Widget _buildSheetContainer(SheetPanel panel, BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
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
            Container(
              width: 32,
              height: 4,
              margin: const EdgeInsets.only(top: 8),
              decoration: BoxDecoration(
                color: colors.outline.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Flexible(
              child: switch (panel) {
                SheetPanel.teams => const TeamsSheet(),
                SheetPanel.feed => const FeedSheet(),
                SheetPanel.settings => const SettingsSheet(),
                SheetPanel.debrief => const DebriefSheet(),
                SheetPanel.voice => const VoiceSheet(),
              },
            ),
          ],
        ),
      ),
    );
  }
}
