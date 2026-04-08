import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants.dart';
import '../../models/board_card.dart';
import '../../theme/card_theme.dart';

class CardTile extends StatelessWidget {
  final BoardCard card;
  final bool showKeycard;
  final bool isSelected;
  final bool isSpymasterSelected;
  final bool canInteract;
  final bool isSpymaster;
  final bool colorblindMode;
  final String? displayWord;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onDoubleTap;

  const CardTile({
    super.key,
    required this.card,
    this.showKeycard = false,
    this.isSelected = false,
    this.isSpymasterSelected = false,
    this.canInteract = false,
    this.isSpymaster = false,
    this.colorblindMode = false,
    this.displayWord,
    this.onTap,
    this.onLongPress,
    this.onDoubleTap,
  });

  @override
  Widget build(BuildContext context) {
    final ct = Theme.of(context).extension<TaccanCardTheme>()!;
    final colors = Theme.of(context).colorScheme;

    Color bg = ct.cardBg;
    Color textColor = ct.cardText;
    Color borderColor = ct.cardBorder;

    if (card.revealed) {
      final c = _revealedColor(card.color, ct);
      bg = c;
      textColor = card.color == CardColor.assassin
          ? Colors.white
          : ct.revealedText;
      borderColor = card.color == CardColor.assassin
          ? const Color(0xFFB03030)
          : c;
    } else if (showKeycard && card.color != null) {
      bg = _keycardBg(card.color!, ct);
      borderColor = _keycardBorder(card.color!, ct);
    }

    if (isSelected && !card.revealed) {
      borderColor = colors.primary;
      bg = ct.cardSelected;
    }

    if (isSpymasterSelected && !card.revealed) {
      borderColor = colors.primary.withValues(alpha: 0.6);
    }

    return GestureDetector(
      onTap: canInteract || isSpymaster ? onTap : null,
      onLongPress: isSpymaster ? onLongPress : null,
      onDoubleTap: canInteract ? onDoubleTap : null,
      child: AnimatedScale(
        scale: isSelected ? 1.06 : 1.0,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final cardWidth = constraints.maxWidth;
            final wordSize = (cardWidth * 0.15).clamp(8.0, 14.0);
            final markerSize = (cardWidth * 0.09).clamp(6.0, 10.0);

            // Use short duration for selection changes; theme color changes
            // are handled by MaterialApp's themeAnimationDuration (200ms).
            // Using 0ms for the container avoids double-animation on theme switch.
            return AnimatedContainer(
              duration: isSelected
                  ? const Duration(milliseconds: 200)
                  : Duration.zero,
              curve: Curves.easeInOut,
              decoration: BoxDecoration(
                color: bg,
                border: Border.all(
                  color: borderColor,
                  width: isSelected ? 2 : (card.revealed && card.color == CardColor.assassin ? 2 : 1),
                ),
                borderRadius: BorderRadius.circular(4),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: isSelected ? 0.2 : 0.1),
                    blurRadius: isSelected ? 6 : 3,
                    offset: const Offset(1, 2),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  // Word
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
                      child: Text(
                        displayWord ?? card.word,
                        textAlign: TextAlign.center,
                        style: GoogleFonts.specialElite(
                          fontSize: wordSize,
                          color: textColor,
                          letterSpacing: 0.3,
                          height: 1.2,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),

                  // Colorblind pattern indicator (on revealed AND keycard cards)
                  if (colorblindMode && card.color != null && (card.revealed || showKeycard))
                    Positioned(
                      top: 2,
                      left: 2,
                      child: Icon(
                        _colorblindIcon(card.color!),
                        size: (cardWidth * 0.18).clamp(12.0, 18.0),
                        color: card.revealed
                            ? textColor.withValues(alpha: 0.8)
                            : _keycardBorder(card.color!, Theme.of(context).extension<TaccanCardTheme>()!),
                      ),
                    ),

                  // Markers
                  if (card.marks.isNotEmpty)
                    Positioned(
                      bottom: 1,
                      left: 1,
                      right: 1,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: card.marks.take(4).map((mark) {
                          final markColor = mark.team == Team.red
                              ? ct.red
                              : mark.team == Team.blue
                                  ? ct.blue
                                  : ct.neutral;
                          return Container(
                            margin: const EdgeInsets.symmetric(horizontal: 0.5),
                            padding: const EdgeInsets.symmetric(horizontal: 2),
                            decoration: BoxDecoration(
                              color: mark.confidence == Confidence.tentative
                                  ? Colors.transparent
                                  : markColor,
                              border: mark.confidence == Confidence.tentative
                                  ? Border.all(color: markColor, width: 1)
                                  : null,
                              borderRadius: BorderRadius.circular(2),
                            ),
                            child: Text(
                              mark.name.isNotEmpty ? mark.name[0] : '?',
                              style: GoogleFonts.specialElite(
                                fontSize: markerSize,
                                color: ct.markerText,
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ),

                  // Revealed stamp
                  if (card.revealed && card.color != null && !colorblindMode)
                    Positioned(
                      top: 2,
                      right: 2,
                      child: Icon(
                        _stampIcon(card.color!),
                        size: (cardWidth * 0.16).clamp(10.0, 14.0),
                        color: textColor.withValues(alpha: 0.5),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Color _revealedColor(CardColor? color, TaccanCardTheme ct) => switch (color) {
        CardColor.red => ct.red,
        CardColor.blue => ct.blue,
        CardColor.neutral => ct.neutral,
        CardColor.assassin => ct.assassin,
        _ => ct.neutral,
      };

  Color _keycardBg(CardColor color, TaccanCardTheme ct) => switch (color) {
        CardColor.red => ct.redLight,
        CardColor.blue => ct.blueLight,
        CardColor.assassin => ct.assassin.withValues(alpha: 0.2),
        _ => ct.cardBg,
      };

  Color _keycardBorder(CardColor color, TaccanCardTheme ct) => switch (color) {
        CardColor.red => ct.red.withValues(alpha: 0.5),
        CardColor.blue => ct.blue.withValues(alpha: 0.5),
        CardColor.assassin => ct.assassin.withValues(alpha: 0.5),
        _ => ct.cardBorder,
      };

  IconData _stampIcon(CardColor color) => switch (color) {
        CardColor.red => Icons.shield,
        CardColor.blue => Icons.shield,
        CardColor.assassin => Icons.dangerous,
        _ => Icons.close,
      };

  IconData _colorblindIcon(CardColor color) => switch (color) {
        CardColor.red => Icons.signal_cellular_4_bar,
        CardColor.blue => Icons.blur_on,
        CardColor.assassin => Icons.close,
        _ => Icons.remove,
      };
}
