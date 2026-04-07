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
    if (game == null) return const SizedBox.shrink();

    final isHost = me?.isHost ?? false;
    final resultText = _buildResultText(game);

    return Container(
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
            style: GoogleFonts.playfairDisplaySc(
              fontSize: 14,
              color: colors.onSurface,
            ),
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
                  child: const Text('REMATCH'),
                ),
              if (isHost)
                OutlinedButton(
                  onPressed: () => _rematch(ref, 'swap_teams'),
                  child: const Text('SWAP + REMATCH'),
                ),
              OutlinedButton(
                onPressed: () => _sendGG(ref),
                child: const Text('GG'),
              ),
              OutlinedButton(
                onPressed: () => ref.read(uiProvider.notifier).toggleSheet(SheetPanel.debrief),
                child: const Text('DEBRIEF'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _buildResultText(dynamic game) {
    final winner = formatTeam(game.winner);
    return switch (game.reason) {
      'assassin' => 'Assassin revealed! ${formatTeam(game.loser)} loses.',
      'all_agents_revealed' => '$winner found all agents!',
      'opponent_agents_revealed' => '$winner wins — opponent found all their agents!',
      _ => '$winner wins!',
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
