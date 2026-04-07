import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'card_theme.dart';
import 'colors.dart';

ThemeData buildDarkTheme() => _build(
      brightness: Brightness.dark,
      scaffold: TaccanColors.darkDesk,
      surface: TaccanColors.darkPaper,
      onSurface: TaccanColors.darkInk,
      primary: TaccanColors.darkAccent,
      border: TaccanColors.darkBorder,
      card: TaccanColors.darkCardBg,
      cardText: TaccanColors.darkCardText,
      error: TaccanColors.darkDanger,
    );

ThemeData buildLightTheme() => _build(
      brightness: Brightness.light,
      scaffold: TaccanColors.lightDesk,
      surface: TaccanColors.lightPaper,
      onSurface: TaccanColors.lightInk,
      primary: TaccanColors.lightAccent,
      border: TaccanColors.lightBorder,
      card: TaccanColors.lightCardBg,
      cardText: TaccanColors.lightCardText,
      error: TaccanColors.lightDanger,
    );

ThemeData _build({
  required Brightness brightness,
  required Color scaffold,
  required Color surface,
  required Color onSurface,
  required Color primary,
  required Color border,
  required Color card,
  required Color cardText,
  required Color error,
}) {
  final textTheme = GoogleFonts.crimsonProTextTheme(
    ThemeData(brightness: brightness).textTheme,
  ).apply(
    bodyColor: onSurface,
    displayColor: onSurface,
  );

  return ThemeData(
    brightness: brightness,
    scaffoldBackgroundColor: scaffold,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: Colors.white,
      secondary: primary,
      onSecondary: Colors.white,
      error: error,
      onError: Colors.white,
      surface: surface,
      onSurface: onSurface,
      outline: border,
    ),
    cardColor: card,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: surface,
      foregroundColor: onSurface,
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      border: UnderlineInputBorder(
        borderSide: BorderSide(color: border),
      ),
      enabledBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: primary, width: 2),
      ),
      labelStyle: TextStyle(color: onSurface.withValues(alpha: 0.6)),
      hintStyle: TextStyle(color: onSurface.withValues(alpha: 0.4)),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        textStyle: GoogleFonts.playfairDisplaySc(
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: onSurface,
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
    ),
    dividerColor: border,
    useMaterial3: true,
    extensions: [
      brightness == Brightness.dark
          ? TaccanCardTheme.dark()
          : TaccanCardTheme.light(),
    ],
  );
}
