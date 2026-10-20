// Thème visuel de l'application.
import 'package:flutter/material.dart';

ThemeData themeDbLocalisation() {
  const couleurPrincipale = Color(0xFF1565C0); // Bleu "localisation".
  return ThemeData(
    useMaterial3: true,
    colorSchemeSeed: couleurPrincipale,
    brightness: Brightness.light,
    inputDecorationTheme: const InputDecorationTheme(
      border: OutlineInputBorder(),
      filled: true,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
      ),
    ),
  );
}
