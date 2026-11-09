// Écran AGENT — appareil protégé.
//
// Le suivi tourne via un SERVICE D'ARRIÈRE-PLAN qui repart au redémarrage
// (étape 2bis). Cet écran démarre/arrête ce service et affiche la dernière
// position qu'il remonte. Il gère aussi les commandes à distance (sonner,
// verrouiller) via ServiceCommandes quand il est ouvert.
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart' as geo;
import 'package:intl/intl.dart';

import '../../services/service_arriere_plan.dart';
import '../../services/service_commandes.dart';
import '../../services/service_consentement.dart';
import '../../services/service_installation.dart';
import '../legal/textes_legaux.dart';

class EcranAgent extends StatefulWidget {
  final String uid;
  const EcranAgent({super.key, required this.uid});

  @override
  State<EcranAgent> createState() => _EcranAgentState();
}

class _EcranAgentState extends State<EcranAgent> {
  final _consentement = ServiceConsentement();
  final _commandes = ServiceCommandes.instance;

  String? _deviceId;
  bool _chargement = true;
  bool _actif = false;
  String? _erreur;
  Map<String, dynamic>? _dernierePosition;
  StreamSubscription<Map<String, dynamic>?>? _subPosition;

  @override
  void initState() {
    super.initState();
    _initialiser();
    // Écoute les positions remontées par le service d'arrière-plan.
    _subPosition =
        FlutterBackgroundService().on('position').listen((event) {
      if (event != null && mounted) {
        setState(() => _dernierePosition = event);
      }
    });
  }

  @override
  void dispose() {
    _subPosition?.cancel();
    super.dispose();
  }

  Future<void> _initialiser() async {
    final id = await _consentement.deviceIdEnregistre();
    final actif = await suiviEnCours();
    if (!mounted) return;
    setState(() {
      _deviceId = id;
      _actif = actif;
      _chargement = false;
    });
    if (id != null) {
      // Commandes à distance (sonner / verrouiller) actives tant que l'écran
      // est ouvert.
      _commandes.demarrerEcoute(uid: widget.uid, deviceId: id);
    }
  }

  Future<void> _basculerSuivi() async {
    final deviceId = _deviceId;
    if (deviceId == null) return;

    if (_actif) {
      await arreterSuivi();
      if (mounted) setState(() => _actif = false);
      return;
    }

    // Avertissement de localisation (divulgation visible exigée par Google Play).
    if (!await _consentement.divulgationLocalisationAcceptee()) {
      if (!mounted) return;
      final ok = await _afficherDivulgation();
      if (ok != true) return;
      await _consentement.enregistrerDivulgationLocalisation(true);
    }

    if (!await _demanderPermissions()) return;

    await demarrerSuivi(uid: widget.uid, deviceId: deviceId);
    if (mounted) {
      setState(() {
        _actif = true;
        _erreur = null;
      });
    }
  }

  /// Vérifie le service de localisation et demande la permission si besoin.
  Future<bool> _demanderPermissions() async {
    if (!await geo.Geolocator.isLocationServiceEnabled()) {
      setState(() => _erreur =
          'Activez la localisation dans les réglages du téléphone.');
      return false;
    }
    var perm = await geo.Geolocator.checkPermission();
    if (perm == geo.LocationPermission.denied) {
      perm = await geo.Geolocator.requestPermission();
    }
    if (perm == geo.LocationPermission.denied ||
        perm == geo.LocationPermission.deniedForever) {
      setState(() => _erreur = 'Permission de localisation refusée.');
      return false;
    }
    return true;
  }

  Future<bool?> _afficherDivulgation() {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Suivi de la localisation'),
        content: const SingleChildScrollView(
            child: Text(kDivulgationLocalisation)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Refuser'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('J\'accepte'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final estIos = ServiceInstallation.plateformeCourante() == 'ios';

    return Scaffold(
      appBar: AppBar(title: const Text('Agent — appareil protégé')),
      body: Stack(
        children: [
          _chargement
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    // Bannière d'alarme (quand on fait sonner le téléphone).
                    ValueListenableBuilder<bool>(
                      valueListenable: _commandes.alarmeActive,
                      builder: (context, actif, _) => actif
                          ? Card(
                              color: Colors.red.shade100,
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Row(
                                  children: [
                                    const Icon(Icons.volume_up,
                                        color: Colors.red),
                                    const SizedBox(width: 12),
                                    const Expanded(
                                        child: Text('Alarme en cours !')),
                                    FilledButton(
                                      onPressed: _commandes.arreterAlarme,
                                      child: const Text('Arrêter'),
                                    ),
                                  ],
                                ),
                              ),
                            )
                          : const SizedBox.shrink(),
                    ),

                    // Bandeau "visible et consenti".
                    Card(
                      color: Colors.blue.shade50,
                      child: const Padding(
                        padding: EdgeInsets.all(16),
                        child: Row(
                          children: [
                            Icon(Icons.visibility),
                            SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Suivi VISIBLE : quand il est actif, une '
                                'notification permanente « Localisation active » '
                                's\'affiche. Rien n\'est caché.',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    if (estIos)
                      Card(
                        color: Colors.orange.shade50,
                        child: const Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'Sur iPhone / iPad : suivi en arrière-plan limité '
                            '(Apple). Pas de redémarrage auto ni de service caché.',
                          ),
                        ),
                      ),

                    if (_deviceId == null)
                      Card(
                        color: Colors.red.shade50,
                        child: const Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'Cet appareil n\'est pas encore enregistré. Revenez '
                            'à l\'accueil et appuyez sur « Enregistrer cet '
                            'appareil » avant de démarrer le suivi.',
                          ),
                        ),
                      )
                    else
                      _blocSuivi(),

                    const SizedBox(height: 24),
                    const Text('Fonctions :',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    _ligne(Icons.my_location, 'Suivi de position', 'Actif ✓'),
                    _ligne(Icons.volume_up, 'Faire sonner à distance', 'Actif ✓'),
                    if (!estIos)
                      _ligne(Icons.restart_alt,
                          'Redémarrage auto (après reboot)', 'Actif ✓*'),
                    if (!estIos) ...[
                      _ligne(Icons.sms, 'Mode SMS (code secret)', 'Étape 5'),
                      _ligne(Icons.sim_card, 'Alerte changement de SIM',
                          'Étape 5'),
                      _ligne(Icons.lock, 'Verrouillage OS (Device Admin)',
                          'Étape 4bis'),
                    ],
                    const SizedBox(height: 8),
                    if (!estIos)
                      const Text(
                        '* Le redémarrage auto exige que tu autorises le '
                        '« démarrage automatique » et que tu désactives '
                        'l\'optimisation batterie pour cette app (réglages du '
                        'téléphone). Un téléphone éteint ou réinitialisé ne peut '
                        'pas être suivi.',
                        style: TextStyle(fontSize: 11, color: Colors.grey),
                      ),

                    const SizedBox(height: 24),
                    if (kDebugMode)
                      Text('UID : ${widget.uid}',
                          style: const TextStyle(
                              fontSize: 11, color: Colors.grey)),
                  ],
                ),

          // Overlay de verrouillage plein écran (message « téléphone perdu »).
          ValueListenableBuilder<String?>(
            valueListenable: _commandes.messageVerrou,
            builder: (context, message, _) => message == null
                ? const SizedBox.shrink()
                : _overlayVerrou(message),
          ),
        ],
      ),
    );
  }

  Widget _blocSuivi() {
    return Column(
      children: [
        FilledButton.icon(
          onPressed: _basculerSuivi,
          icon: Icon(_actif ? Icons.stop : Icons.play_arrow),
          label: Text(_actif ? 'Arrêter le suivi' : 'Démarrer le suivi'),
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            backgroundColor: _actif ? Colors.red : null,
          ),
        ),
        const SizedBox(height: 12),

        if (_erreur != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_erreur!, style: const TextStyle(color: Colors.red)),
          ),

        _carteDernierePosition(),
      ],
    );
  }

  Widget _carteDernierePosition() {
    final pos = _dernierePosition;
    if (pos == null) {
      return Card(
        child: ListTile(
          leading: const Icon(Icons.location_searching),
          title: Text(_actif ? 'En attente de position…' : 'Suivi arrêté'),
          subtitle: Text(_actif
              ? 'Le GPS cherche la position (mieux en extérieur).'
              : 'Démarrez le suivi pour envoyer la position.'),
        ),
      );
    }
    final lat = (pos['lat'] as num?)?.toDouble() ?? 0;
    final lng = (pos['lng'] as num?)?.toDouble() ?? 0;
    final prec = (pos['precision'] as num?)?.toDouble();
    final bat = pos['batterie'];
    final precision =
        prec == null ? 'précision inconnue' : 'précis à ±${prec.toStringAsFixed(0)} m';
    final heure = DateFormat('HH:mm:ss').format(DateTime.now());
    return Card(
      child: ListTile(
        leading: const Icon(Icons.my_location, color: Colors.green),
        title: Text('${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)}'),
        subtitle: Text('$precision • batterie ${bat ?? '?'}% • $heure'),
      ),
    );
  }

  Widget _overlayVerrou(String message) {
    return Container(
      color: Colors.black.withValues(alpha: 0.92),
      padding: const EdgeInsets.all(32),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock, color: Colors.white, size: 72),
          const SizedBox(height: 24),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 20),
          ),
          const SizedBox(height: 32),
          TextButton(
            onPressed: _commandes.fermerVerrou,
            child:
                const Text('Fermer', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }

  Widget _ligne(IconData icone, String libelle, String etape) {
    return ListTile(
      dense: true,
      leading: Icon(icone),
      title: Text(libelle),
      trailing: Chip(label: Text(etape)),
    );
  }
}
