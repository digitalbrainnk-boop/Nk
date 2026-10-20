// Modèle : un appareil enregistré sous le compte.
// Firestore : users/{uid}/devices/{deviceId}
//   { name, installUuid, platform, appVersion, createdAt }

import 'package:cloud_firestore/cloud_firestore.dart';

class Appareil {
  final String deviceId; // ID du document Firestore.
  final String nom; // Nom donné par l'utilisateur (ex. "Téléphone de Léa").
  final String installUuid; // UUID d'installation (PAS d'IMEI/MAC).
  final String plateforme; // "android" | "ios" | "web" | "windows" | ...
  final String versionApp; // Version de l'appli installée.
  final DateTime? creeLe;

  const Appareil({
    required this.deviceId,
    required this.nom,
    required this.installUuid,
    required this.plateforme,
    required this.versionApp,
    this.creeLe,
  });

  Map<String, dynamic> versFirestore() => {
        'name': nom,
        'installUuid': installUuid,
        'platform': plateforme,
        'appVersion': versionApp,
        'createdAt': FieldValue.serverTimestamp(),
      };

  factory Appareil.depuisDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return Appareil(
      deviceId: doc.id,
      nom: (d['name'] as String?) ?? 'Appareil',
      installUuid: (d['installUuid'] as String?) ?? '',
      plateforme: (d['platform'] as String?) ?? 'inconnu',
      versionApp: (d['appVersion'] as String?) ?? '',
      creeLe: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }
}
