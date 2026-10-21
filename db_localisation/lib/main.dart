// Point d'entrée de DB Localisation.
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'ecrans/ecran_config_requise.dart';
import 'firebase_options.dart';

Future<void> main() async {
  // Nécessaire avant tout appel asynchrone utilisant les plugins.
  WidgetsFlutterBinding.ensureInitialized();

  final options = DefaultFirebaseOptions.currentPlatform;

  // Si firebase_options.dart contient encore les valeurs d'EXEMPLE, on affiche
  // un écran d'aide plutôt que de planter au premier lancement.
  if (options.apiKey.contains('VOTRE_')) {
    runApp(const AppConfigurationRequise());
    return;
  }

  try {
    // Initialisation de Firebase pour la plateforme courante.
    await Firebase.initializeApp(options: options);
    runApp(const AppDbLocalisation());
  } catch (e) {
    // Autre problème de configuration : on explique au lieu d'un écran blanc.
    runApp(AppConfigurationRequise(detail: e.toString()));
  }
}
