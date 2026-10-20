// Application racine : thème + écran de démarrage (routage).
import 'package:flutter/material.dart';

import 'core/constantes.dart';
import 'core/theme.dart';
import 'ecrans/ecran_demarrage.dart';

class AppDbLocalisation extends StatelessWidget {
  const AppDbLocalisation({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: kNomApp,
      debugShowCheckedModeBanner: false,
      theme: themeDbLocalisation(),
      home: const EcranDemarrage(),
    );
  }
}
