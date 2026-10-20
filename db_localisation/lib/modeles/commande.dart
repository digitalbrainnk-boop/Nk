// Modèle : une commande à distance envoyée par la console vers l'agent.
// Firestore : users/{uid}/devices/{deviceId}/commands/{autoId}
//   { type, payload, status, createdAt, resolvedAt }

import 'package:cloud_firestore/cloud_firestore.dart';

class Commande {
  final String id;
  final String type; // Voir TypesCommande.
  final Map<String, dynamic> payload; // Données additionnelles (ex. message).
  final String statut; // pending | sent | done | failed
  final DateTime? creeLe;
  final DateTime? resoluLe;

  const Commande({
    required this.id,
    required this.type,
    this.payload = const {},
    required this.statut,
    this.creeLe,
    this.resoluLe,
  });

  Map<String, dynamic> versFirestore() => {
        'type': type,
        'payload': payload,
        'status': statut,
        'createdAt': FieldValue.serverTimestamp(),
        'resolvedAt': null,
      };

  factory Commande.depuisDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return Commande(
      id: doc.id,
      type: (d['type'] as String?) ?? '',
      payload: (d['payload'] as Map<String, dynamic>?) ?? const {},
      statut: (d['status'] as String?) ?? 'pending',
      creeLe: (d['createdAt'] as Timestamp?)?.toDate(),
      resoluLe: (d['resolvedAt'] as Timestamp?)?.toDate(),
    );
  }
}
