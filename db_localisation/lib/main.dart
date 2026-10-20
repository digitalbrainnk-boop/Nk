// Point d'entrée de DB Localisation.
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'firebase_options.dart';

Future<void> main() async {
  // Nécessaire avant tout appel asynchrone utilisant les plugins.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialisation de Firebase pour la plateforme courante.
  // Les options viennent de firebase_options.dart (généré par flutterfire).
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  runApp(const AppDbLocalisation());
}
