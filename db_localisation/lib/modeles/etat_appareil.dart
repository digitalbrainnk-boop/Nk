// Modèle : état courant d'un appareil (document unique "state").
// Firestore : users/{uid}/devices/{deviceId}/state
//   { lastSeen, online, battery, isCharging, lastSimSerialHash }

import 'package:cloud_firestore/cloud_firestore.dart';

class EtatAppareil {
  final DateTime? derniereConnexion; // lastSeen
  final bool enLigne; // online
  final int? batterie; // battery 0-100
  final bool enCharge; // isCharging
  // Empreinte (hash) du numéro de série SIM, pour détecter un changement de SIM.
  // On ne stocke PAS le numéro brut, seulement un hash pour comparaison.
  final String? hashSimActuelle;

  const EtatAppareil({
    this.derniereConnexion,
    this.enLigne = false,
    this.batterie,
    this.enCharge = false,
    this.hashSimActuelle,
  });

  Map<String, dynamic> versFirestore() => {
        'lastSeen': FieldValue.serverTimestamp(),
        'online': enLigne,
        'battery': batterie,
        'isCharging': enCharge,
        'lastSimSerialHash': hashSimActuelle,
      };

  factory EtatAppareil.depuisDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return EtatAppareil(
      derniereConnexion: (d['lastSeen'] as Timestamp?)?.toDate(),
      enLigne: (d['online'] as bool?) ?? false,
      batterie: (d['battery'] as num?)?.toInt(),
      enCharge: (d['isCharging'] as bool?) ?? false,
      hashSimActuelle: d['lastSimSerialHash'] as String?,
    );
  }
}
