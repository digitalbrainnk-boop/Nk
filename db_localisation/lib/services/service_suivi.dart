// Service de SUIVI GPS (rôle agent, étape 2).
//
// Rôle : obtenir la position en HAUTE PRÉCISION et l'envoyer périodiquement à
// Firestore, avec l'état (batterie, en ligne). Sur Android, le suivi tourne via
// un SERVICE DE PREMIER PLAN avec une NOTIFICATION DISCRÈTE mais VISIBLE
// (imposée par Android pour la localisation en arrière-plan — et conforme à
// notre règle : rien n'est caché).
//
// Précision : on demande le maximum (LocationAccuracy.best). La valeur réelle
// dépend du matériel (3-10 m en général, parfois 1-3 m en bi-fréquence plein
// ciel) ; on remonte TOUJOURS le rayon réel (champ accuracy) pour rester honnête.

import 'dart:async';
import 'dart:io' show Platform;

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart' as geo;
import 'package:geolocator_android/geolocator_android.dart' as geo_android;
import 'package:geolocator_apple/geolocator_apple.dart' as geo_apple;

import '../core/constantes.dart';
import '../modeles/etat_appareil.dart';
import '../modeles/position.dart';
import 'service_firestore.dart';

class ServiceSuivi {
  ServiceSuivi._();
  /// Singleton : un seul suivi actif par application.
  static final ServiceSuivi instance = ServiceSuivi._();

  final ServiceFirestore _firestore = ServiceFirestore();
  final Battery _battery = Battery();
  StreamSubscription<geo.Position>? _sub;

  // États observables par l'interface (écran agent).
  final ValueNotifier<bool> actif = ValueNotifier(false);
  final ValueNotifier<Position?> dernierePosition = ValueNotifier(null);
  final ValueNotifier<String?> erreur = ValueNotifier(null);

  /// Vérifie le service de localisation et demande la permission si besoin.
  Future<bool> _assurerPermissions() async {
    if (!await geo.Geolocator.isLocationServiceEnabled()) {
      erreur.value = 'Activez la localisation dans les réglages du téléphone.';
      return false;
    }
    var perm = await geo.Geolocator.checkPermission();
    if (perm == geo.LocationPermission.denied) {
      perm = await geo.Geolocator.requestPermission();
    }
    if (perm == geo.LocationPermission.denied ||
        perm == geo.LocationPermission.deniedForever) {
      erreur.value = 'Permission de localisation refusée.';
      return false;
    }
    // Astuce : pour le suivi en arrière-plan, l'utilisateur doit accorder
    // « Toujours » (et non « Pendant l'utilisation ») dans les réglages.
    return true;
  }

  /// Réglages de localisation adaptés à la plateforme.
  geo.LocationSettings _reglages() {
    const distance = 0; // 0 m = chaque mise à jour, sans filtre de distance.
    const intervalle = Duration(seconds: 15); // Rythme d'échantillonnage.

    if (!kIsWeb && Platform.isAndroid) {
      return geo_android.AndroidSettings(
        accuracy: geo.LocationAccuracy.best,
        distanceFilter: distance,
        intervalDuration: intervalle,
        // Notification DISCRÈTE et HONNÊTE du service de premier plan.
        foregroundNotificationConfig: const geo_android.ForegroundNotificationConfig(
          notificationTitle: 'DB Localisation',
          notificationText: 'Localisation active',
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    if (!kIsWeb && Platform.isIOS) {
      return geo_apple.AppleSettings(
        accuracy: geo.LocationAccuracy.best,
        distanceFilter: distance,
        allowBackgroundLocationUpdates: true,
        pauseLocationUpdatesAutomatically: false,
        // iOS affiche l'indicateur de localisation en arrière-plan (transparence).
        showBackgroundLocationIndicator: true,
      );
    }
    // Web / desktop : réglages standards (localisation du navigateur/OS).
    return const geo.LocationSettings(
      accuracy: geo.LocationAccuracy.best,
      distanceFilter: distance,
    );
  }

  /// Démarre le suivi pour l'appareil donné.
  Future<void> demarrer({required String uid, required String deviceId}) async {
    if (actif.value) return;
    erreur.value = null;
    if (!await _assurerPermissions()) return;

    _sub = geo.Geolocator.getPositionStream(locationSettings: _reglages())
        .listen((p) => _traiterPosition(uid, deviceId, p),
            onError: (e) => erreur.value = 'Erreur de localisation : $e');
    actif.value = true;
  }

  /// Traite une position reçue : met à jour l'UI, envoie à Firestore + état.
  Future<void> _traiterPosition(
      String uid, String deviceId, geo.Position p) async {
    final niveau = await _niveauBatterie();
    final enCharge = await _enCharge();
    final pos = Position(
      lat: p.latitude,
      lng: p.longitude,
      precision: p.accuracy, // rayon réel en mètres (honnête).
      batterie: niveau,
      source: SourcesPosition.gps,
    );
    dernierePosition.value = pos;
    try {
      await _firestore.ajouterPosition(
          uid: uid, deviceId: deviceId, position: pos);
      await _firestore.majEtat(
        uid: uid,
        deviceId: deviceId,
        etat: EtatAppareil(enLigne: true, batterie: niveau, enCharge: enCharge),
      );
    } catch (e) {
      // Pas de data/WiFi : on garde la dernière position localement et on
      // réessaiera à la prochaine mise à jour (Firestore met aussi en file).
      erreur.value = 'Envoi différé (hors ligne ?) : $e';
    }
  }

  /// Arrête le suivi et marque l'appareil hors ligne.
  Future<void> arreter({String? uid, String? deviceId}) async {
    await _sub?.cancel();
    _sub = null;
    actif.value = false;
    if (uid != null && deviceId != null) {
      try {
        await _firestore.majEtat(
          uid: uid,
          deviceId: deviceId,
          etat: const EtatAppareil(enLigne: false),
        );
      } catch (_) {}
    }
  }

  Future<int?> _niveauBatterie() async {
    try {
      return await _battery.batteryLevel;
    } catch (_) {
      return null;
    }
  }

  Future<bool> _enCharge() async {
    try {
      final s = await _battery.batteryState;
      return s == BatteryState.charging || s == BatteryState.full;
    } catch (_) {
      return false;
    }
  }
}
