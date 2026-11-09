// Point d'entrée de DB Localisation.
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import 'app.dart';
import 'ecrans/ecran_config_requise.dart';
import 'firebase_options.dart';
import 'services/service_arriere_plan.dart';

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

    // Configure le service de suivi en arrière-plan (Android/iOS seulement).
    // Permet au suivi de repartir tout seul après un redémarrage du téléphone.
    if (!kIsWeb && (Platform.isAndroid || Platform.isIOS)) {
      await initialiserServiceArrierePlan();
    }

    runApp(const AppDbLocalisation());
  } catch (e) {
    // Autre problème de configuration : on explique au lieu d'un écran blanc.
    runApp(AppConfigurationRequise(detail: e.toString()));
  }
}
