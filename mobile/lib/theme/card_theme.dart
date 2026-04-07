import 'package:flutter/material.dart';

import 'colors.dart';

class TaccanCardTheme extends ThemeExtension<TaccanCardTheme> {
  final Color cardBg;
  final Color cardBorder;
  final Color cardText;
  final Color cardSelected;
  final Color red;
  final Color blue;
  final Color neutral;
  final Color assassin;
  final Color redLight;
  final Color blueLight;
  final Color revealedText;
  final Color markerText;

  const TaccanCardTheme({
    required this.cardBg,
    required this.cardBorder,
    required this.cardText,
    required this.cardSelected,
    required this.red,
    required this.blue,
    required this.neutral,
    required this.assassin,
    required this.redLight,
    required this.blueLight,
    required this.revealedText,
    required this.markerText,
  });

  factory TaccanCardTheme.dark() => const TaccanCardTheme(
        cardBg: TaccanColors.darkCardBg,
        cardBorder: TaccanColors.darkCardBorder,
        cardText: TaccanColors.darkCardText,
        cardSelected: Color(0xFF5A4E3E),
        red: TaccanColors.darkRed,
        blue: TaccanColors.darkBlue,
        neutral: Color(0xFF8A7E6A),
        assassin: Color(0xFF2A1A1A),
        redLight: Color(0x38B83838),
        blueLight: Color(0x383868A0),
        revealedText: Color(0xFFF0E8D8),
        markerText: Color(0xFFF0E8D8),
      );

  factory TaccanCardTheme.light() => const TaccanCardTheme(
        cardBg: TaccanColors.lightCardBg,
        cardBorder: TaccanColors.lightCardBorder,
        cardText: TaccanColors.lightCardText,
        cardSelected: Color(0xFFE8DCC8),
        red: TaccanColors.lightRed,
        blue: TaccanColors.lightBlue,
        neutral: Color(0xFF9A8E7C),
        assassin: Color(0xFF1A1A1A),
        redLight: Color(0x1A9A3030),
        blueLight: Color(0x1A284A70),
        revealedText: Color(0xFFF0E8D8),
        markerText: Color(0xFFF0E8D8),
      );

  @override
  TaccanCardTheme copyWith({
    Color? cardBg,
    Color? cardBorder,
    Color? cardText,
    Color? cardSelected,
    Color? red,
    Color? blue,
    Color? neutral,
    Color? assassin,
    Color? redLight,
    Color? blueLight,
    Color? revealedText,
    Color? markerText,
  }) =>
      TaccanCardTheme(
        cardBg: cardBg ?? this.cardBg,
        cardBorder: cardBorder ?? this.cardBorder,
        cardText: cardText ?? this.cardText,
        cardSelected: cardSelected ?? this.cardSelected,
        red: red ?? this.red,
        blue: blue ?? this.blue,
        neutral: neutral ?? this.neutral,
        assassin: assassin ?? this.assassin,
        redLight: redLight ?? this.redLight,
        blueLight: blueLight ?? this.blueLight,
        revealedText: revealedText ?? this.revealedText,
        markerText: markerText ?? this.markerText,
      );

  @override
  TaccanCardTheme lerp(covariant TaccanCardTheme? other, double t) {
    if (other == null) return this;
    return TaccanCardTheme(
      cardBg: Color.lerp(cardBg, other.cardBg, t)!,
      cardBorder: Color.lerp(cardBorder, other.cardBorder, t)!,
      cardText: Color.lerp(cardText, other.cardText, t)!,
      cardSelected: Color.lerp(cardSelected, other.cardSelected, t)!,
      red: Color.lerp(red, other.red, t)!,
      blue: Color.lerp(blue, other.blue, t)!,
      neutral: Color.lerp(neutral, other.neutral, t)!,
      assassin: Color.lerp(assassin, other.assassin, t)!,
      redLight: Color.lerp(redLight, other.redLight, t)!,
      blueLight: Color.lerp(blueLight, other.blueLight, t)!,
      revealedText: Color.lerp(revealedText, other.revealedText, t)!,
      markerText: Color.lerp(markerText, other.markerText, t)!,
    );
  }
}
