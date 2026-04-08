import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

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
    final colors = Theme.of(context).colorScheme;
    final redTotal = game.startingTeam == Team.red ? 9 : 8;
    final blueTotal = game.startingTeam == Team.blue ? 9 : 8;
    final total = redTotal + blueTotal;
    final redFound = redTotal - game.remaining.red;
    final blueFound = blueTotal - game.remaining.blue;

    return LayoutBuilder(
      builder: (context, constraints) {
        final barWidth = constraints.maxWidth - 16; // account for horizontal margin
        return Container(
          height: 16,
          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: colors.outline.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Stack(
            children: [
              // Red from left
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 400),
                  width: total > 0 ? (redFound / total) * barWidth : 0,
                  decoration: BoxDecoration(
                    color: ct.red,
                    borderRadius: const BorderRadius.horizontal(left: Radius.circular(8)),
                  ),
                  alignment: Alignment.center,
                  child: redFound > 0
                      ? Text(
                          '$redFound',
                          style: GoogleFonts.specialElite(fontSize: 9, color: Colors.white, fontWeight: FontWeight.bold),
                        )
                      : null,
                ),
              ),
              // Blue from right
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 400),
                  width: total > 0 ? (blueFound / total) * barWidth : 0,
                  decoration: BoxDecoration(
                    color: ct.blue,
                    borderRadius: const BorderRadius.horizontal(right: Radius.circular(8)),
                  ),
                  alignment: Alignment.center,
                  child: blueFound > 0
                      ? Text(
                          '$blueFound',
                          style: GoogleFonts.specialElite(fontSize: 9, color: Colors.white, fontWeight: FontWeight.bold),
                        )
                      : null,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
