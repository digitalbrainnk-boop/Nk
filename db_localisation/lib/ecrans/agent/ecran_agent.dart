// Écran AGENT — appareil protégé (étape 2 : suivi GPS).
//
// Capacités par plateforme (rappel honnête) :
//  - Android : suivi via service de premier plan + notification VISIBLE mais
//    discrète ; boot, exclusion batterie, SMS, Device Admin aux étapes 2bis/4/5.
//  - iOS : suivi en arrière-plan autorisé (indicateur système visible), mode
//    perdu, alarme via notifications. Pas de SMS/boot/service caché (Apple).
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../modeles/position.dart';
import '../../services/service_consentement.dart';
import '../../services/service_installation.dart';
import '../../services/service_suivi.dart';
import '../legal/textes_legaux.dart';

class EcranAgent extends StatefulWidget {
  final String uid;
  const EcranAgent({super.key, required this.uid});

  @override
  State<EcranAgent> createState() => _EcranAgentState();
}

class _EcranAgentState extends State<EcranAgent> {
  final _consentement = ServiceConsentement();
  final _suivi = ServiceSuivi.instance;
  String? _deviceId;
  bool _chargement = true;

  @override
  void initState() {
    super.initState();
    _chargerDeviceId();
  }

  Future<void> _chargerDeviceId() async {
    final id = await _consentement.deviceIdEnregistre();
    if (!mounted) return;
    setState(() {
      _deviceId = id;
      _chargement = false;
    });
  }

  Future<void> _basculerSuivi() async {
    final deviceId = _deviceId;
    if (deviceId == null) return;
    if (_suivi.actif.value) {
      await _suivi.arreter(uid: widget.uid, deviceId: deviceId);
    } else {
      // Avertissement de localisation (divulgation visible exigée par Google
      // Play) : montré UNE FOIS, juste avant la première demande de permission.
      if (!await _consentement.divulgationLocalisationAcceptee()) {
        if (!mounted) return;
        final accepte = await _afficherDivulgation();
        if (accepte != true) return; // Refus : on ne démarre pas le suivi.
        await _consentement.enregistrerDivulgationLocalisation(true);
      }
      await _suivi.demarrer(uid: widget.uid, deviceId: deviceId);
    }
    if (mounted) setState(() {});
  }

  /// Boîte de dialogue d'avertissement de localisation, avec option de refus.
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
    final plateforme = ServiceInstallation.plateformeCourante();
    final estIos = plateforme == 'ios';

    return Scaffold(
      appBar: AppBar(title: const Text('Agent — appareil protégé')),
      body: _chargement
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
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
                            'Suivi VISIBLE : quand il est actif, une notification '
                            'permanente « Localisation active » l\'indique. Rien '
                            'n\'est caché.',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Avertissement iOS honnête.
                if (estIos)
                  Card(
                    color: Colors.orange.shade50,
                    child: const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Sur iPhone / iPad : suivi en arrière-plan autorisé '
                        '(indicateur système visible), mode perdu et alarme via '
                        'notifications. Pas de SMS, boot ni service caché (Apple).',
                      ),
                    ),
                  ),

                if (_deviceId == null)
                  Card(
                    color: Colors.red.shade50,
                    child: const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'Cet appareil n\'est pas encore enregistré. Revenez à '
                        'l\'accueil et appuyez sur « Enregistrer cet appareil » '
                        'avant de démarrer le suivi.',
                      ),
                    ),
                  )
                else
                  _blocSuivi(),

                const SizedBox(height: 24),
                const Text('Prochaines fonctions :',
                    style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                if (!estIos) ...[
                  _ligne(Icons.restart_alt, 'Démarrage au boot', 'Étape 2bis'),
                  _ligne(Icons.battery_alert, 'Exclusion batterie', 'Étape 2bis'),
                  _ligne(Icons.sms, 'Mode SMS (code secret)', 'Étape 5'),
                  _ligne(Icons.sim_card, 'Alerte changement de SIM', 'Étape 5'),
                  _ligne(Icons.lock, 'Device Admin (verrouillage)', 'Étape 4'),
                ],
                _ligne(Icons.volume_up, 'Alarme à distance', 'Étape 4'),

                const SizedBox(height: 24),
                if (kDebugMode)
                  Text('UID : ${widget.uid}',
                      style: const TextStyle(fontSize: 11, color: Colors.grey)),
              ],
            ),
    );
  }

  /// Bloc de pilotage du suivi + affichage de la dernière position.
  Widget _blocSuivi() {
    return Column(
      children: [
        // Bouton démarrer / arrêter (réagit à l'état du service).
        ValueListenableBuilder<bool>(
          valueListenable: _suivi.actif,
          builder: (context, actif, _) {
            return FilledButton.icon(
              onPressed: _basculerSuivi,
              icon: Icon(actif ? Icons.stop : Icons.play_arrow),
              label: Text(actif ? 'Arrêter le suivi' : 'Démarrer le suivi'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                backgroundColor: actif ? Colors.red : null,
              ),
            );
          },
        ),
        const SizedBox(height: 12),

        // Message d'erreur éventuel (permission, hors ligne...).
        ValueListenableBuilder<String?>(
          valueListenable: _suivi.erreur,
          builder: (context, err, _) => err == null
              ? const SizedBox.shrink()
              : Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(err, style: const TextStyle(color: Colors.red)),
                ),
        ),

        // Dernière position connue + rayon de précision RÉEL.
        ValueListenableBuilder<Position?>(
          valueListenable: _suivi.dernierePosition,
          builder: (context, pos, _) {
            if (pos == null) {
              return const Card(
                child: ListTile(
                  leading: Icon(Icons.location_searching),
                  title: Text('Aucune position encore'),
                  subtitle: Text('Démarrez le suivi pour envoyer la position.'),
                ),
              );
            }
            final precision = pos.precision == null
                ? 'précision inconnue'
                : 'précis à ±${pos.precision!.toStringAsFixed(0)} m';
            final heure = DateFormat('HH:mm:ss').format(DateTime.now());
            return Card(
              child: ListTile(
                leading: const Icon(Icons.my_location, color: Colors.green),
                title: Text(
                    '${pos.lat.toStringAsFixed(6)}, ${pos.lng.toStringAsFixed(6)}'),
                subtitle: Text(
                    '$precision • batterie ${pos.batterie ?? '?'}% • $heure'),
              ),
            );
          },
        ),
      ],
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
