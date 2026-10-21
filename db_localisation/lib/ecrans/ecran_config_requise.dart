// Écran affiché quand Firebase n'est PAS encore configuré.
//
// But : éviter un « écran blanc » incompréhensible au premier lancement. Si
// firebase_options.dart contient encore les valeurs d'EXEMPLE (ou si
// l'initialisation Firebase échoue), on explique calmement quoi faire.
import 'package:flutter/material.dart';

import '../core/constantes.dart';

class AppConfigurationRequise extends StatelessWidget {
  final String? detail;
  const AppConfigurationRequise({super.key, this.detail});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: kNomApp,
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        appBar: AppBar(title: const Text('$kNomApp — configuration')),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.settings_suggest, size: 56),
                  const SizedBox(height: 16),
                  const Text(
                    'Firebase n\'est pas encore configuré',
                    style:
                        TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'L\'application a besoin de VOTRE projet Firebase pour '
                    'fonctionner. Lancez ces commandes dans le dossier '
                    'db_localisation/ :',
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    color: const Color(0xFF1E1E1E),
                    child: const Text(
                      'dart pub global activate flutterfire_cli\n'
                      'flutterfire configure',
                      style: TextStyle(
                          color: Color(0xFF00E676),
                          fontFamily: 'monospace'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Cela régénère lib/firebase_options.dart avec vos vraies '
                    'clés, puis relancez l\'application. Détails dans '
                    'docs/01-configurer-firebase.md.',
                  ),
                  if (detail != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Détail technique : $detail',
                      style:
                          const TextStyle(fontSize: 11, color: Colors.grey),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
