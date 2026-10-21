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
import '../../services/service_commandes.dart';
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
  final _commandes = ServiceCommandes.instance;
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
    // Écoute des commandes à distance dès que cet appareil est connu
    // (faire sonner, verrouiller...), même sans avoir démarré le suivi.
    if (id != null) {
      _commandes.demarrerEcoute(uid: widget.uid, deviceId: id);
    }
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
                                const Icon(Icons.volume_up, color: Colors.red),
                                const SizedBox(width: 12),
                                const Expanded(child: Text('Alarme en cours !')),
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
                _ligne(Icons.volume_up, 'Faire sonner à distance', 'Actif ✓'),
                if (!estIos) ...[
                  _ligne(Icons.restart_alt, 'Démarrage au boot', 'Étape 2bis'),
                  _ligne(Icons.battery_alert, 'Exclusion batterie', 'Étape 2bis'),
                  _ligne(Icons.sms, 'Mode SMS (code secret)', 'Étape 5'),
                  _ligne(Icons.sim_card, 'Alerte changement de SIM', 'Étape 5'),
                  _ligne(Icons.lock, 'Verrouillage OS (Device Admin)',
                      'Étape 4bis'),
                ],

                const SizedBox(height: 24),
                if (kDebugMode)
                  Text('UID : ${widget.uid}',
                      style: const TextStyle(fontSize: 11, color: Colors.grey)),
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

  /// Overlay plein écran affiché quand la console envoie « Verrouiller ».
  /// MVP : verrou applicatif (message visible). Le verrouillage au niveau du
  /// système (impossible à contourner) viendra avec Device Admin (étape 4bis).
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
            child: const Text('Fermer', style: TextStyle(color: Colors.white70)),
          ),
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
