// Service de SUIVI EN ARRIÈRE-PLAN (étape 2bis).
//
// Objectif : le suivi tourne en continu dans un service de premier plan ET
// REPART TOUT SEUL après un redémarrage du téléphone (autoStartOnBoot), tant
// que l'utilisateur l'a activé. Tout se passe dans un isolat séparé (donc en
// Dart, pas de code natif à maintenir).
//
// Limites honnêtes : Android ne relance RIEN tant que le téléphone n'a pas été
// rallumé puis déverrouillé une fois ; et beaucoup de fabricants (Xiaomi, etc.)
// exigent que l'utilisateur autorise le « démarrage automatique » et désactive
// l'optimisation batterie pour l'app. Un téléphone ÉTEINT ou RÉINITIALISÉ ne
// peut pas être suivi (impossible par nature).

import 'dart:async';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart' as geo;
import 'package:shared_preferences/shared_preferences.dart';

import '../core/constantes.dart';
import '../firebase_options.dart';
import '../modeles/etat_appareil.dart';
import '../modeles/position.dart';
import 'service_firestore.dart';

const String _canalNotif = 'db_suivi_canal';
const int _idNotif = 888;

/// Configure le service d'arrière-plan. À appeler une fois au démarrage (mobile).
Future<void> initialiserServiceArrierePlan() async {
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: onStart,
      autoStart: false, // démarre quand l'utilisateur active le suivi
      isForegroundMode: true, // service de premier plan (notification visible)
      autoStartOnBoot: true, // repart après un redémarrage du téléphone
      notificationChannelId: _canalNotif,
      initialNotificationTitle: 'DB Localisation',
      initialNotificationContent: 'Localisation active',
      foregroundServiceNotificationId: _idNotif,
    ),
    iosConfiguration: IosConfiguration(
      autoStart: false,
      onForeground: onStart,
      onBackground: onIosBackground,
    ),
  );
}

/// Active le suivi : mémorise le compte + l'état, puis démarre le service.
Future<void> demarrerSuivi({
  required String uid,
  required String deviceId,
}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(ClesStockage.uidCompte, uid);
  await prefs.setString(ClesStockage.deviceIdEnregistre, deviceId);
  await prefs.setBool(ClesStockage.suiviActif, true);
  final service = FlutterBackgroundService();
  if (!await service.isRunning()) {
    await service.startService();
  }
}

/// Désactive le suivi : retient l'état et arrête le service.
Future<void> arreterSuivi() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(ClesStockage.suiviActif, false);
  FlutterBackgroundService().invoke('stopService');
}

/// Le service de suivi tourne-t-il actuellement ?
Future<bool> suiviEnCours() => FlutterBackgroundService().isRunning();

// iOS : exécution courte en arrière-plan (Apple limite fortement).
@pragma('vm:entry-point')
Future<bool> onIosBackground(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  return true;
}

/// Point d'entrée du service (isolat séparé). Relève la position périodiquement
/// et l'envoie à Firestore. Appelé au démarrage du suivi ET après un boot.
@pragma('vm:entry-point')
Future<void> onStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Arrêt propre quand l'app demande l'arrêt du suivi.
  service.on('stopService').listen((event) {
    service.stopSelf();
  });

  final prefs = await SharedPreferences.getInstance();
  final actif = prefs.getBool(ClesStockage.suiviActif) ?? false;
  final uid = prefs.getString(ClesStockage.uidCompte);
  final deviceId = prefs.getString(ClesStockage.deviceIdEnregistre);

  // Au redémarrage : ne rien suivre si l'utilisateur avait coupé le suivi,
  // ou si le compte/l'appareil ne sont pas connus.
  if (!actif || uid == null || deviceId == null) {
    service.stopSelf();
    return;
  }

  final firestore = ServiceFirestore();
  final battery = Battery();

  Future<void> releve() async {
    try {
      final p = await geo.Geolocator.getCurrentPosition(
        locationSettings:
            const geo.LocationSettings(accuracy: geo.LocationAccuracy.best),
      );
      int? niveau;
      var enCharge = false;
      try {
        niveau = await battery.batteryLevel;
        final s = await battery.batteryState;
        enCharge = s == BatteryState.charging || s == BatteryState.full;
      } catch (_) {}

      final pos = Position(
        lat: p.latitude,
        lng: p.longitude,
        precision: p.accuracy,
        batterie: niveau,
        source: SourcesPosition.gps,
      );
      await firestore.ajouterPosition(
          uid: uid, deviceId: deviceId, position: pos);
      await firestore.majEtat(
        uid: uid,
        deviceId: deviceId,
        etat:
            EtatAppareil(enLigne: true, batterie: niveau, enCharge: enCharge),
      );

      // Notification discrète à jour + info vers l'écran agent (s'il est ouvert).
      if (service is AndroidServiceInstance) {
        service.setForegroundNotificationInfo(
          title: 'DB Localisation',
          content: 'Localisation active (±${p.accuracy.toStringAsFixed(0)} m)',
        );
      }
      service.invoke('position', {
        'lat': pos.lat,
        'lng': pos.lng,
        'precision': pos.precision,
        'batterie': niveau,
      });
    } catch (_) {
      // Hors-ligne / permission manquante : Firestore met en file d'attente et
      // réessaiera automatiquement à la prochaine relève.
    }
  }

  await releve(); // premier relevé immédiat
  Timer.periodic(const Duration(seconds: 30), (_) => releve());
}
