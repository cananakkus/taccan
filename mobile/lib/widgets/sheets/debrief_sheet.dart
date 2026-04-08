import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../l10n/translations.dart';
import '../../providers/providers.dart';
import '../../theme/card_theme.dart';

class DebriefSheet extends ConsumerWidget {
  const DebriefSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final game = ref.watch(gameProvider);
    final players = ref.watch(playersProvider);
    final colors = Theme.of(context).colorScheme;
    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final tr = ref.watch(trProvider);

    if (game == null) return const SizedBox.shrink();

    final lang = ref.watch(preferencesProvider).language;
    final entries = _buildNarrative(game, players, ct, tr, lang);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Text(
              tr('intelligence_debrief'),
              style: GoogleFonts.playfairDisplaySc(
                fontSize: 14, letterSpacing: 2, color: colors.onSurface,
              ),
            ),
          ),
          const SizedBox(height: 4),
          Center(
            child: Text(
              tr('classification'),
              style: GoogleFonts.specialElite(
                fontSize: 9, letterSpacing: 2, color: colors.onSurface.withValues(alpha: 0.4),
              ),
            ),
          ),
          const SizedBox(height: 16),
          ...entries,
        ],
      ),
    );
  }

  List<Widget> _buildNarrative(dynamic game, List players, TaccanCardTheme ct, Function tr, String lang) {
    final widgets = <Widget>[];
    int transmissionNum = 0;

    for (final entry in game.history) {
      final type = entry['type'] as String?;

      if (type == 'hint') {
        transmissionNum++;
        final byId = entry['by'] as String? ?? '';
        final name = _playerName(players, byId);
        final team = entry['team'] as String? ?? '';
        final word = entry['word'] as String? ?? '';
        final count = entry['count'] ?? 0;
        final color = team == 'red' ? ct.red : ct.blue;

        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Text(
            '${tr('transmission')}$transmissionNum',
            style: GoogleFonts.specialElite(
              fontSize: 10, letterSpacing: 1, color: color.withValues(alpha: 0.6),
            ),
          ),
        ));
        widgets.add(Text(
          'Handler $name to ${team.toUpperCase()} operatives — ${word.toUpperCase()} $count',
          style: GoogleFonts.specialElite(fontSize: 13),
        ));
      } else if (type == 'guess') {
        final byId = entry['by'] as String? ?? '';
        final name = _playerName(players, byId);
        final cardColor = entry['color'] as String? ?? '';
        final index = entry['index'] as int? ?? 0;
        final board = game.board;
        final rawWord = index < board.length ? board[index].word : '???';
        final word = translateWord(rawWord, lang: lang);
        final outcome = cardColor == (entry['team'] ?? '') ? 'correct' : 'wrong';

        widgets.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 1),
          child: Text(
            '  ${outcome == 'correct' ? '✓' : '✗'} Agent $name investigated $word ($cardColor)',
            style: GoogleFonts.specialElite(
              fontSize: 12,
              color: outcome == 'correct' ? const Color(0xFF50A040) : const Color(0xFFC04040),
            ),
          ),
        ));
      } else if (type == 'turn_end') {
        final reason = entry['reason'] as String? ?? '';
        widgets.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(
            '— Turn ended: $reason',
            style: GoogleFonts.specialElite(fontSize: 10, color: const Color(0xFF888888)),
          ),
        ));
      } else if (type == 'game_end') {
        final winner = entry['winner'] as String? ?? '';
        final reason = entry['reason'] as String? ?? '';
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            '${tr('mission_conclusion')}: ${winner.toUpperCase()} TEAM WINS — $reason',
            style: GoogleFonts.playfairDisplaySc(fontSize: 12, letterSpacing: 0.5),
          ),
        ));
      }
    }

    return widgets;
  }

  String _playerName(List players, String sessionId) {
    final match = players.where((p) => p.sessionId == sessionId);
    return match.isNotEmpty ? match.first.name : 'Unknown';
  }
}
