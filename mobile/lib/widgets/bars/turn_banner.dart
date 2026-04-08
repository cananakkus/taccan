import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../providers/providers.dart';
import '../../theme/card_theme.dart';

class TurnBanner extends ConsumerWidget {
  const TurnBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final game = ref.watch(gameProvider);
    if (game == null) return const SizedBox.shrink();

    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final colors = Theme.of(context).colorScheme;
    final tr = ref.watch(trProvider);
    final teamClr = game.currentTeam == Team.red ? ct.red : ct.blue;
    final borderClr = game.phase == GamePhase.finished
        ? colors.outline
        : teamClr.withValues(alpha: 0.4);

    final phaseText = switch (game.phase) {
      GamePhase.hint => '${tr(game.currentTeam == Team.red ? 'red' : 'blue')} — ${tr('phase_hint')}',
      GamePhase.guess => '${tr(game.currentTeam == Team.red ? 'red' : 'blue')} — ${tr('phase_guess')}',
      GamePhase.finished => tr('game_over'),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: borderClr, width: 1.5)),
        color: colors.surface.withValues(alpha: 0.9),
      ),
      child: Row(
        children: [
          if (game.phase != GamePhase.finished)
            Container(
              width: 8,
              height: 8,
              margin: const EdgeInsets.only(right: 8),
              decoration: BoxDecoration(shape: BoxShape.circle, color: teamClr),
            ),
          Expanded(
            child: Text(
              phaseText,
              style: GoogleFonts.specialElite(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: game.phase == GamePhase.finished ? colors.onSurface : teamClr,
                letterSpacing: 0.5,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text('${game.remaining.red}', style: GoogleFonts.specialElite(fontSize: 13, fontWeight: FontWeight.bold, color: ct.red)),
          Text(' / ', style: GoogleFonts.specialElite(fontSize: 11, color: colors.onSurface.withValues(alpha: 0.4))),
          Text('${game.remaining.blue}', style: GoogleFonts.specialElite(fontSize: 13, fontWeight: FontWeight.bold, color: ct.blue)),
        ],
      ),
    );
  }
}
