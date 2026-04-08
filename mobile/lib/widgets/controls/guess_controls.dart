import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../l10n/translations.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../utils/game_helpers.dart';

class GuessControls extends ConsumerWidget {
  const GuessControls({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(snapshotProvider);
    final game = ref.watch(gameProvider);
    final ui = ref.watch(uiProvider);
    final colors = Theme.of(context).colorScheme;
    final tr = ref.watch(trProvider);
    final playerCanGuess = canGuess(snapshot);
    final lang = ref.watch(preferencesProvider).language;

    if (game == null) return const SizedBox.shrink();

    final hint = game.hint;
    final selectedCard = ui.selectedGuessIndex != null && ui.selectedGuessIndex! < game.board.length
        ? game.board[ui.selectedGuessIndex!]
        : null;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.outline.withValues(alpha: 0.3))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (hint != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: colors.surface,
                border: Border.all(color: colors.outline.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  Text(
                    '${tr('hint_label')}  ',
                    style: GoogleFonts.specialElite(fontSize: 12, color: colors.onSurface.withValues(alpha: 0.5)),
                  ),
                  Flexible(
                    child: Text(
                      hint.word.toUpperCase(),
                      style: GoogleFonts.specialElite(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: colors.onSurface,
                        letterSpacing: 1,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    ' ${hint.count}',
                    style: GoogleFonts.specialElite(fontSize: 14, color: colors.primary),
                  ),
                  const Spacer(),
                  if (game.guessesRemaining != null)
                    Text(
                      '${game.guessesRemaining} ${tr('left')}',
                      style: GoogleFonts.specialElite(fontSize: 11, color: colors.onSurface.withValues(alpha: 0.5)),
                    ),
                ],
              ),
            )
          else
            Text(
              tr('awaiting_hint'),
              style: GoogleFonts.specialElite(fontSize: 13, color: colors.onSurface.withValues(alpha: 0.4)),
            ),
          if (playerCanGuess && hint != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    selectedCard != null
                        ? '${tr('selected')} ${translateWord(selectedCard.word, lang: lang)}'
                        : tr('tap_card'),
                    style: GoogleFonts.specialElite(fontSize: 13, color: colors.onSurface.withValues(alpha: 0.6)),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: selectedCard != null && !selectedCard.revealed
                      ? () => _submitGuess(ref, selectedCard.index)
                      : null,
                  child: Text(tr('guess'), style: GoogleFonts.specialElite()),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () => _endTurn(ref, context, tr),
                  child: Text(tr('end_turn'), style: GoogleFonts.specialElite()),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _submitGuess(WidgetRef ref, int index) async {
    try {
      await ref.read(socketServiceProvider).submitGuess(index);
      ref.read(uiProvider.notifier).clearGuessSelection();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }

  Future<void> _endTurn(WidgetRef ref, BuildContext context, Function tr) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr('end_turn') as String, style: GoogleFonts.playfairDisplaySc(fontSize: 16)),
        content: Text(tr('end_turn_confirm') as String, style: GoogleFonts.specialElite()),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(tr('cancel') as String, style: GoogleFonts.specialElite())),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(tr('confirm') as String, style: GoogleFonts.specialElite())),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(socketServiceProvider).endTurn();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }
}
