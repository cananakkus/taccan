import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../l10n/translations.dart';
import '../../models/board_card.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../services/sound_service.dart';
import '../../utils/game_helpers.dart';
import 'card_tile.dart';

class GameBoard extends ConsumerWidget {
  const GameBoard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(snapshotProvider);
    final game = ref.watch(gameProvider);
    final ui = ref.watch(uiProvider);
    final tr = ref.watch(trProvider);
    final board = game?.board ?? [];
    final showKey = game?.showKeycard ?? false;
    final playerCanGuess = canGuess(snapshot);
    final playerCanMark = canMark(snapshot);
    final playerIsSpymaster = isSpymaster(snapshot);
    final colorblind = ref.watch(preferencesProvider).colorblindMode;
    final lang = ref.watch(preferencesProvider).language;

    if (board.isEmpty) {
      return Center(
        child: Text(
          tr('waiting_host'),
          style: GoogleFonts.specialElite(
            fontSize: 13,
            color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.4),
          ),
        ),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        // Fill 100% width, calculate card size from available width
        final spacing = 4.0;
        final hPad = 2.0;
        final totalWidth = constraints.maxWidth - hPad * 2;
        final cardWidth = (totalWidth - spacing * (boardColumns - 1)) / boardColumns;
        final cardHeight = cardWidth / 1.15;
        final totalHeight = cardHeight * 5 + spacing * 4 + 8; // 5 rows + spacing + vPad

        return SizedBox(
          width: constraints.maxWidth,
          height: totalHeight.clamp(0, constraints.maxHeight),
          child: GridView.builder(
            physics: const NeverScrollableScrollPhysics(),
            padding: EdgeInsets.symmetric(horizontal: hPad, vertical: 4),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: boardColumns,
              crossAxisSpacing: spacing,
              mainAxisSpacing: spacing,
              childAspectRatio: 1.15,
            ),
            itemCount: board.length,
            itemBuilder: (context, index) {
              final card = board[index];
              return CardTile(
                card: card,
                displayWord: translateWord(card.word, lang: lang),
                showKeycard: showKey,
                isSelected: ui.selectedGuessIndex == index,
                isSpymasterSelected: ui.spymasterSelected.contains(index),
                canInteract: (playerCanGuess || playerCanMark) && !card.revealed,
                isSpymaster: playerIsSpymaster,
                colorblindMode: colorblind,
                onTap: () => _handleTap(ref, card, playerCanGuess, playerCanMark, playerIsSpymaster),
                onDoubleTap: playerCanGuess && !card.revealed
                    ? () => _submitGuess(ref, card.index)
                    : null,
                onLongPress: playerIsSpymaster
                    ? () => ref.read(uiProvider.notifier).toggleSpymasterCard(index)
                    : null,
              );
            },
          ),
        );
      },
    );
  }

  void _handleTap(WidgetRef ref, BoardCard card, bool canGuessNow, bool canMarkNow, bool isSpy) {
    if (card.revealed) return;
    HapticFeedback.selectionClick();

    if (isSpy && !canGuessNow) {
      ref.read(uiProvider.notifier).toggleSpymasterCard(card.index);
      return;
    }

    if (canGuessNow) {
      soundService.play('mark');
      ref.read(uiProvider.notifier).selectGuess(card.index);
      return;
    }

    if (canMarkNow) {
      soundService.play('mark');
      ref.read(socketServiceProvider).toggleMark(card.index).catchError((e) {
        debugPrint('Mark error: $e');
      });
    }
  }

  Future<void> _submitGuess(WidgetRef ref, int index) async {
    try {
      await ref.read(socketServiceProvider).submitGuess(index);
      ref.read(uiProvider.notifier).clearGuessSelection();
    } catch (e) {
      ref.read(toastProvider.notifier).show(e.toString(), ToastStyle.error);
    }
  }
}
