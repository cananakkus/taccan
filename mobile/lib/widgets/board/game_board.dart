import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constants.dart';
import '../../models/board_card.dart';
import '../../providers/providers.dart';
import '../../providers/ui_provider.dart';
import '../../utils/game_helpers.dart';
import 'card_tile.dart';

class GameBoard extends ConsumerWidget {
  const GameBoard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshot = ref.watch(snapshotProvider);
    final game = ref.watch(gameProvider);
    final ui = ref.watch(uiProvider);
    final board = game?.board ?? [];
    final showKey = game?.showKeycard ?? false;
    final playerCanGuess = canGuess(snapshot);
    final playerCanMark = canMark(snapshot);
    final playerIsSpymaster = isSpymaster(snapshot);

    if (board.isEmpty) {
      return const Center(child: Text('Waiting for game...'));
    }

    return AspectRatio(
      aspectRatio: 5 / 5.2,
      child: GridView.builder(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(4),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: boardColumns,
          crossAxisSpacing: 4,
          mainAxisSpacing: 4,
          childAspectRatio: 1.15,
        ),
        itemCount: board.length,
        itemBuilder: (context, index) {
          final card = board[index];
          return CardTile(
            card: card,
            showKeycard: showKey,
            isSelected: ui.selectedGuessIndex == index,
            isSpymasterSelected: ui.spymasterSelected.contains(index),
            canInteract: (playerCanGuess || playerCanMark) && !card.revealed,
            isSpymaster: playerIsSpymaster,
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
  }

  void _handleTap(WidgetRef ref, BoardCard card, bool canGuessNow, bool canMarkNow, bool isSpy) {
    if (card.revealed) return;

    if (isSpy && !canGuessNow) {
      ref.read(uiProvider.notifier).toggleSpymasterCard(card.index);
      return;
    }

    if (canGuessNow) {
      ref.read(uiProvider.notifier).selectGuess(card.index);
      return;
    }

    if (canMarkNow) {
      ref.read(socketServiceProvider).toggleMark(card.index).catchError((_) {});
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
