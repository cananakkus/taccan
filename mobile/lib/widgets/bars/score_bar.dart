import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';
import '../../theme/card_theme.dart';

class ScoreBar extends ConsumerWidget {
  const ScoreBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final game = ref.watch(gameProvider);
    if (game == null) return const SizedBox.shrink();

    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final redTotal = game.startingTeam == Team.red ? 9 : 8;
    final blueTotal = game.startingTeam == Team.blue ? 9 : 8;
    final total = redTotal + blueTotal;
    final redFound = redTotal - game.remaining.red;
    final blueFound = blueTotal - game.remaining.blue;

    return Container(
      height: 6,
      margin: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Row(
        children: [
          // Red progress
          AnimatedContainer(
            duration: const Duration(milliseconds: 400),
            width: total > 0
                ? (redFound / total) *
                    (MediaQuery.of(context).size.width - 16)
                : 0,
            decoration: BoxDecoration(
              color: ct.red,
              borderRadius: const BorderRadius.horizontal(left: Radius.circular(3)),
            ),
          ),
          const Spacer(),
          // Blue progress (right-aligned)
          AnimatedContainer(
            duration: const Duration(milliseconds: 400),
            width: total > 0
                ? (blueFound / total) *
                    (MediaQuery.of(context).size.width - 16)
                : 0,
            decoration: BoxDecoration(
              color: ct.blue,
              borderRadius: const BorderRadius.horizontal(right: Radius.circular(3)),
            ),
          ),
        ],
      ),
    );
  }
}
