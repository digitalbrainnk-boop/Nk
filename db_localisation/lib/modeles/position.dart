// Modèle : une position remontée par l'agent.
// Firestore : users/{uid}/devices/{deviceId}/locations/{autoId}
//   { lat, lng, accuracy, battery, source, ts }

import 'package:cloud_firestore/cloud_firestore.dart';

class Position {
  final double lat;
  final double lng;
  final double? precision; // Précision en mètres.
  final int? batterie; // Niveau de batterie 0-100 au moment du relevé.
  final String source; // "gps" | "network" | "sms"
  final DateTime? horodatage;

  const Position({
    required this.lat,
    required this.lng,
    this.precision,
    this.batterie,
    required this.source,
    this.horodatage,
  });

  Map<String, dynamic> versFirestore() => {
        'lat': lat,
        'lng': lng,
        'accuracy': precision,
        'battery': batterie,
        'source': source,
        'ts': FieldValue.serverTimestamp(),
      };

  factory Position.depuisDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? <String, dynamic>{};
    return Position(
      lat: (d['lat'] as num?)?.toDouble() ?? 0,
      lng: (d['lng'] as num?)?.toDouble() ?? 0,
      precision: (d['accuracy'] as num?)?.toDouble(),
      batterie: (d['battery'] as num?)?.toInt(),
      source: (d['source'] as String?) ?? 'gps',
      horodatage: (d['ts'] as Timestamp?)?.toDate(),
    );
  }

  /// Lien Google Maps vers cette position (utile pour le mode SMS).
  String get lienGoogleMaps =>
      'https://maps.google.com/?q=$lat,$lng';
}
