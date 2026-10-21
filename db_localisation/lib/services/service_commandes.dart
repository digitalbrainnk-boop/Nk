// Service de COMMANDES à distance (rôle agent, étape 4).
//
// L'agent écoute en TEMPS RÉEL les commandes « pending » dans Firestore et les
// exécute : faire sonner (alarme), verrouiller (message), localiser.
// Pas de serveur requis : quand le suivi est actif (service de premier plan),
// l'écoute Firestore suffit à réagir immédiatement. (La réaction quand l'app
// est complètement fermée nécessitera FCM / Device Admin — étape 4bis.)

import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

import '../core/constantes.dart';
import '../modeles/commande.dart';
import 'service_firestore.dart';

class ServiceCommandes {
  ServiceCommandes._();
  static final ServiceCommandes instance = ServiceCommandes._();

  final ServiceFirestore _firestore = ServiceFirestore();
  final AudioPlayer _lecteur = AudioPlayer();
  StreamSubscription<List<Commande>>? _sub;
  String? _uid;
  String? _deviceId;

  // IDs déjà traités (évite de ré-exécuter deux fois la même commande).
  final Set<String> _traitees = {};

  // États observés par l'écran agent.
  final ValueNotifier<bool> alarmeActive = ValueNotifier(false);
  final ValueNotifier<String?> messageVerrou = ValueNotifier(null);

  /// Démarre l'écoute des commandes de cet appareil (idempotent).
  void demarrerEcoute({required String uid, required String deviceId}) {
    if (_sub != null && _uid == uid && _deviceId == deviceId) return;
    _sub?.cancel();
    _uid = uid;
    _deviceId = deviceId;
    _sub = _firestore
        .fluxCommandesEnAttente(uid, deviceId)
        .listen((commandes) {
      for (final c in commandes) {
        if (_traitees.contains(c.id)) continue;
        _traitees.add(c.id);
        _executer(c);
      }
    });
  }

  Future<void> arreterEcoute() async {
    await _sub?.cancel();
    _sub = null;
  }

  Future<void> _executer(Commande c) async {
    switch (c.type) {
      case TypesCommande.alarme:
        await _jouerAlarme();
        break;
      case TypesCommande.verrouiller:
        messageVerrou.value = (c.payload['message'] as String?) ??
            'Téléphone perdu. Merci de contacter son propriétaire.';
        break;
      case TypesCommande.localiserMaintenant:
        // Le suivi envoie déjà la position en continu : rien de spécial.
        break;
      default:
        // EFFACER : action destructrice volontairement NON implémentée ici.
        break;
    }
    // Marque la commande comme traitée côté base.
    if (_uid != null && _deviceId != null) {
      await _firestore.majStatutCommande(
        uid: _uid!,
        deviceId: _deviceId!,
        commandId: c.id,
        statut: StatutsCommande.terminee,
      );
    }
  }

  Future<void> _jouerAlarme() async {
    try {
      // Canal ALARME d'Android : fort, et sonne même en mode silencieux.
      await _lecteur.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            contentType: AndroidContentType.sonification,
            usageType: AndroidUsageType.alarm,
            audioFocus: AndroidAudioFocus.gain,
          ),
          iOS: AudioContextIOS(
            category: AVAudioSessionCategory.playback,
            options: const {AVAudioSessionOptions.mixWithOthers},
          ),
        ),
      );
      await _lecteur.setReleaseMode(ReleaseMode.loop); // En boucle.
      await _lecteur.setVolume(1.0);
      await _lecteur.play(AssetSource('alarme.wav'));
      alarmeActive.value = true;
    } catch (_) {
      // Plateforme sans audio (ou erreur) : on ignore proprement.
    }
  }

  /// Arrête l'alarme (bouton local sur l'appareil protégé).
  Future<void> arreterAlarme() async {
    try {
      await _lecteur.stop();
    } catch (_) {}
    alarmeActive.value = false;
  }

  /// Ferme le message de verrouillage (MVP : verrou applicatif, pas OS).
  void fermerVerrou() => messageVerrou.value = null;
}
