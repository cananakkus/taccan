import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../utils/game_helpers.dart';

class ResultControls extends ConsumerWidget {
  const ResultControls({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final game = ref.watch(gameProvider);
    final me = ref.watch(meProvider);
    final colors = Theme.of(context).colorScheme;
    final tr = ref.watch(trProvider);
    if (game == null) return const SizedBox.shrink();

    final isHost = me?.isHost ?? false;
    final resultText = _buildResultText(game, tr);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.3))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            resultText,
            style: GoogleFonts.specialElite(fontSize: 14, color: colors.onSurface),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              if (isHost)
                ElevatedButton(
                  onPressed: () => _rematch(ref, 'same_teams'),
                  child: Text(tr('rematch'), style: GoogleFonts.specialElite()),
                ),
              if (isHost)
                OutlinedButton(
                  onPressed: () => _rematch(ref, 'swap_teams'),
                  child: Text(tr('swap_rematch'), style: GoogleFonts.specialElite()),
                ),
              OutlinedButton(onPressed: () => _sendGG(ref), child: Text(tr('gg'), style: GoogleFonts.specialElite())),
              OutlinedButton(
                onPressed: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.debrief),
                child: Text(tr('debrief'), style: GoogleFonts.specialElite()),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _buildResultText(dynamic game, Function tr) {
    final winner = formatTeam(game.winner);
    final loser = formatTeam(game.loser);
    return switch (game.reason) {
      'assassin' => tr('result_assassin', vars: {'loser': loser}) as String,
      'all_agents_revealed' => tr('result_all_agents', vars: {'winner': winner}) as String,
      _ => tr('result_generic', vars: {'winner': winner}) as String,
    };
  }

  Future<void> _rematch(WidgetRef ref, String mode) async {
    try {
      await ref.read(socketServiceProvider).rematch(mode);
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }

  Future<void> _sendGG(WidgetRef ref) async {
    try {
      await ref.read(socketServiceProvider).sendGG();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }
}
