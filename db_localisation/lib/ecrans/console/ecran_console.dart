// Écran CONSOLE — liste des appareils à suivre (étape 3).
// Chaque appareil ouvre sa CARTE (dernière position + historique + état).
import 'package:flutter/material.dart';

import '../../modeles/appareil.dart';
import '../../services/service_firestore.dart';
import 'ecran_carte_appareil.dart';

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
          return ListView.separated(
            itemCount: appareils.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final a = appareils[i];
              return ListTile(
                leading: const Icon(Icons.location_on),
                title: Text(a.nom),
                subtitle: Text('${a.plateforme} • v${a.versionApp}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => EcranCarteAppareil(
                      uid: uid,
                      deviceId: a.deviceId,
                      nomAppareil: a.nom,
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
