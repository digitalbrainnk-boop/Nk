// Écran CARTE d'un appareil (console, étape 3).
//
// Affiche sur une carte (OpenStreetMap via flutter_map, sans clé API) :
//  - la DERNIÈRE position connue (marqueur) ;
//  - le CERCLE DE PRÉCISION réel (rayon = précision en mètres) : le téléphone
//    est quelque part dans ce cercle (honnête, pas de faux « 1 m ») ;
//  - l'HISTORIQUE récent (tracé) ;
//  - un panneau d'ÉTAT (dernière connexion, batterie, en ligne/hors ligne).
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';

import '../../core/constantes.dart';
import '../../modeles/commande.dart';
import '../../modeles/etat_appareil.dart';
import '../../modeles/position.dart';
import '../../services/service_firestore.dart';

class EcranCarteAppareil extends StatefulWidget {
  final String uid;
  final String deviceId;
  final String nomAppareil;
  const EcranCarteAppareil({
    super.key,
    required this.uid,
    required this.deviceId,
    required this.nomAppareil,
  });

  @override
  State<EcranCarteAppareil> createState() => _EcranCarteAppareilState();
}

class _EcranCarteAppareilState extends State<EcranCarteAppareil> {
  final _firestore = ServiceFirestore();
  final _mapController = MapController();
  LatLng? _dernierCentre; // Dernier point reçu (pour le bouton « recentrer »).

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.nomAppareil)),
      body: StreamBuilder<List<Position>>(
        stream: _firestore.fluxPositions(widget.uid, widget.deviceId, limite: 100),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final positions = snap.data ?? [];
          if (positions.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Aucune position pour le moment.\n'
                  'Sur l\'appareil, ouvrez « Agent » puis « Démarrer le suivi ».',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          final derniere = positions.first; // Les plus récentes d'abord.
          final centre = LatLng(derniere.lat, derniere.lng);
          _dernierCentre = centre;
          // Historique dans l'ordre chronologique pour le tracé.
          final trace =
              positions.reversed.map((p) => LatLng(p.lat, p.lng)).toList();
          // Rayon de précision borné (évite un cercle absurde si donnée bizarre).
          final rayon = (derniere.precision ?? 15).clamp(1.0, 10000.0);

          return Column(
            children: [
              Expanded(
                child: FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(initialCenter: centre, initialZoom: 16),
                  children: [
                    TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.dblocalisation.app',
                    ),
                    if (trace.length > 1)
                      PolylineLayer(
                        polylines: [
                          Polyline(
                            points: trace,
                            strokeWidth: 3,
                            color: Colors.blue.withValues(alpha: 0.7),
                          ),
                        ],
                      ),
                    // Cercle de précision (rayon réel en mètres).
                    CircleLayer(
                      circles: [
                        CircleMarker(
                          point: centre,
                          radius: rayon,
                          useRadiusInMeter: true,
                          color: Colors.blue.withValues(alpha: 0.15),
                          borderColor: Colors.blue,
                          borderStrokeWidth: 1.5,
                        ),
                      ],
                    ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: centre,
                          width: 44,
                          height: 44,
                          child: const Icon(Icons.location_on,
                              color: Colors.red, size: 44),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              _panneauEtat(derniere),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          if (_dernierCentre != null) {
            _mapController.move(_dernierCentre!, 16);
          }
        },
        tooltip: 'Recentrer',
        child: const Icon(Icons.my_location),
      ),
    );
  }

  /// Envoie une commande à distance à l'appareil (via Firestore).
  Future<void> _envoyerCommande(String type,
      {Map<String, dynamic> payload = const {}}) async {
    await _firestore.envoyerCommande(
      uid: widget.uid,
      deviceId: widget.deviceId,
      commande: Commande(
        id: '',
        type: type,
        payload: payload,
        statut: StatutsCommande.enAttente,
      ),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Commande envoyée à l\'appareil.')),
    );
  }

  /// Demande un message puis envoie la commande de verrouillage.
  Future<void> _verrouiller() async {
    final c = TextEditingController(
        text: 'Téléphone perdu. Merci d\'appeler le ...');
    final message = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Verrouiller / message'),
        content: TextField(
          controller: c,
          maxLines: 2,
          decoration: const InputDecoration(labelText: 'Message à afficher'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Annuler')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, c.text.trim()),
              child: const Text('Verrouiller')),
        ],
      ),
    );
    if (message != null && message.isNotEmpty) {
      await _envoyerCommande(TypesCommande.verrouiller,
          payload: {'message': message});
    }
  }

  /// Panneau d'état sous la carte : précision, heure, batterie, en ligne.
  Widget _panneauEtat(Position derniere) {
    final precision = derniere.precision == null
        ? 'précision inconnue'
        : 'précis à ±${derniere.precision!.toStringAsFixed(0)} m';
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.gps_fixed, size: 18),
                const SizedBox(width: 8),
                Text(precision,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 6),
            // État temps réel (dernière connexion, batterie, en ligne).
            StreamBuilder<EtatAppareil?>(
              stream: _firestore.fluxEtat(widget.uid, widget.deviceId),
              builder: (context, snap) {
                final etat = snap.data;
                if (etat == null) return const Text('État : inconnu');
                final maj = etat.derniereConnexion == null
                    ? '—'
                    : DateFormat('dd/MM HH:mm:ss')
                        .format(etat.derniereConnexion!);
                return Wrap(
                  spacing: 16,
                  runSpacing: 4,
                  children: [
                    _puce(
                      etat.enLigne ? Icons.circle : Icons.circle_outlined,
                      etat.enLigne ? 'En ligne' : 'Hors ligne',
                      etat.enLigne ? Colors.green : Colors.grey,
                    ),
                    _puce(Icons.battery_full,
                        'Batterie ${etat.batterie ?? '?'}%${etat.enCharge ? ' (charge)' : ''}',
                        Colors.black87),
                    _puce(Icons.schedule, 'Vu : $maj', Colors.black87),
                  ],
                );
              },
            ),
            const Divider(height: 20),
            // Commandes à distance (l'appareil doit être allumé et en ligne).
            Row(
              children: [
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => _envoyerCommande(TypesCommande.alarme),
                    icon: const Icon(Icons.volume_up),
                    label: const Text('Faire sonner'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: _verrouiller,
                    icon: const Icon(Icons.lock),
                    label: const Text('Verrouiller'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _puce(IconData icone, String texte, Color couleur) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icone, size: 16, color: couleur),
        const SizedBox(width: 4),
        Text(texte),
      ],
    );
  }
}
