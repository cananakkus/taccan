import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../providers/providers.dart';
import '../../utils/game_helpers.dart';

final _timerTickProvider = StreamProvider.autoDispose<int>((ref) {
  final game = ref.watch(gameProvider);
  final timer = game?.phaseTimer;
  if (timer == null) return const Stream.empty();

  return Stream.periodic(const Duration(milliseconds: 200), (_) {
    final now = DateTime.now().millisecondsSinceEpoch;
    return (timer.endsAt - now).clamp(0, timer.durationMs);
  });
});

class PhaseTimerBar extends ConsumerStatefulWidget {
  const PhaseTimerBar({super.key});

  @override
  ConsumerState<PhaseTimerBar> createState() => _PhaseTimerBarState();
}

class _PhaseTimerBarState extends ConsumerState<PhaseTimerBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseScale;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _pulseScale = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.08), weight: 50),
      TweenSequenceItem(tween: Tween(begin: 1.08, end: 1.0), weight: 50),
    ]).animate(CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  void _syncPulse(bool isCritical) {
    if (isCritical && !_pulseController.isAnimating) {
      _pulseController.repeat();
    } else if (!isCritical && _pulseController.isAnimating) {
      _pulseController.stop();
      _pulseController.value = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final game = ref.watch(gameProvider);
    if (game?.phaseTimer == null) {
      _syncPulse(false);
      return const SizedBox.shrink();
    }

    final tick = ref.watch(_timerTickProvider);
    final ms = tick.valueOrNull ?? 0;
    final colors = Theme.of(context).colorScheme;
    final isWarning = ms > 0 && ms <= 10000;
    final isCritical = ms > 0 && ms <= 5000;
    _syncPulse(isCritical);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      color: isCritical
          ? colors.error.withValues(alpha: 0.15)
          : isWarning
              ? Colors.orange.withValues(alpha: 0.1)
              : Colors.transparent,
      child: ScaleTransition(
        scale: _pulseScale,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.timer_outlined,
              size: 18,
              color: isCritical ? colors.error : colors.onSurface.withValues(alpha: 0.6),
            ),
            const SizedBox(width: 6),
            Text(
              formatTimer(ms),
              style: GoogleFonts.specialElite(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: isCritical ? colors.error : colors.onSurface,
                letterSpacing: 1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
