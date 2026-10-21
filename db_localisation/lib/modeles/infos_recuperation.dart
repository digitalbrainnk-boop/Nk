// Modèle : informations de récupération d'un appareil, utiles EN CAS DE VOL.
// Firestore : users/{uid}/devices/{deviceId}/meta/recovery
//   { imei, serial, emergencyContact, note, updatedAt }
//
// Ces champs sont SAISIS par l'utilisateur. Depuis Android 10, une application
// ne peut plus lire l'IMEI automatiquement : c'est à l'utilisateur de le noter
// (composez *#06# sur le téléphone pour l'afficher). On le stocke pour pouvoir
// le communiquer à la police et à l'opérateur (blocage réseau) en cas de vol.

import 'package:cloud_firestore/cloud_firestore.dart';

class InfosRecuperation {
  final String imei; // IMEI (composer *#06#). Peut contenir 2 IMEI (double SIM).
  final String numeroSerie; // Numéro de série de l'appareil.
  final String contactUrgence; // Numéro/e-mail à afficher si trouvé.
  final String note; // Remarque libre (preuve d'achat, description...).
  final DateTime? majLe;

  const InfosRecuperation({
    this.imei = '',
    this.numeroSerie = '',
    this.contactUrgence = '',
    this.note = '',
    this.majLe,
  });

  Map<String, dynamic> versFirestore() => {
        'imei': imei,
        'serial': numeroSerie,
        'emergencyContact': contactUrgence,
        'note': note,
        'updatedAt': FieldValue.serverTimestamp(),
      };

  factory InfosRecuperation.depuisDoc(
      DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return InfosRecuperation(
      imei: (d['imei'] as String?) ?? '',
      numeroSerie: (d['serial'] as String?) ?? '',
      contactUrgence: (d['emergencyContact'] as String?) ?? '',
      note: (d['note'] as String?) ?? '',
      majLe: (d['updatedAt'] as Timestamp?)?.toDate(),
    );
  }
}
