// Écran CONSOLE — squelette d'étape 1.
// La carte Google Maps, l'historique et l'état arrivent à l'étape 3 ;
// les boutons de commande (localiser/alarme/verrouiller) à l'étape 4.
import 'package:flutter/material.dart';

import '../../modeles/appareil.dart';
import '../../services/service_firestore.dart';

class EcranConsole extends StatelessWidget {
  final String uid;
  EcranConsole({super.key, required this.uid});

  final _firestore = ServiceFirestore();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Console — mes appareils')),
      body: StreamBuilder<List<Appareil>>(
        stream: _firestore.fluxAppareils(uid),
        builder: (context, snap) {
          final appareils = snap.data ?? [];
          if (appareils.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Aucun appareil à suivre.\n'
                  'Enregistrez un appareil, puis activez-y le rôle « Agent ».',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return ListView(
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'À venir (étape 3-4) : carte avec dernière position et '
                  'historique, état (dernière connexion, batterie, en/hors '
                  'ligne), et boutons localiser / alarme / verrouiller.',
                ),
              ),
              for (final a in appareils)
                ListTile(
                  leading: const Icon(Icons.location_searching),
                  title: Text(a.nom),
                  subtitle: Text('${a.plateforme} • v${a.versionApp}'),
                ),
            ],
          );
        },
      ),
    );
  }
}
