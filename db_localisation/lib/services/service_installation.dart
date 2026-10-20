// Service : identité d'installation de CET appareil.
//
// IMPORTANT (règle non-négociable) : on identifie chaque appareil par un
// UUID généré au premier lancement, PAS par l'IMEI ni l'adresse MAC
// (inaccessibles et interdits depuis Android 10). L'UUID est stocké
// localement et ne révèle aucune information personnelle.

import 'dart:io' show Platform;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../core/constantes.dart';

class ServiceInstallation {
  /// Récupère l'UUID d'installation, en le générant au premier appel.
  static Future<String> obtenirOuCreerUuid() async {
    final prefs = await SharedPreferences.getInstance();
    var uuid = prefs.getString(ClesStockage.uuidInstallation);
    if (uuid == null || uuid.isEmpty) {
      uuid = const Uuid().v4(); // UUID aléatoire v4.
      await prefs.setString(ClesStockage.uuidInstallation, uuid);
    }
    return uuid;
  }

  /// Nom de la plateforme courante ("android", "ios", "web", "windows"...).
  static String plateformeCourante() {
    if (kIsWeb) return 'web';
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    if (Platform.isWindows) return 'windows';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isLinux) return 'linux';
    return 'inconnu';
  }

  /// Nom lisible par défaut pour l'appareil (modifiable par l'utilisateur).
  /// Ex. "Pixel 8" ou "iPhone de ...". Ne lit aucun identifiant matériel.
  static Future<String> nomParDefaut() async {
    try {
      final info = DeviceInfoPlugin();
      if (kIsWeb) {
        final web = await info.webBrowserInfo;
        return 'Navigateur ${web.browserName.name}';
      }
      if (Platform.isAndroid) {
        final a = await info.androidInfo;
        return '${a.manufacturer} ${a.model}';
      }
      if (Platform.isIOS) {
        final i = await info.iosInfo;
        return i.name; // Nom donné par l'utilisateur à l'iPhone.
      }
    } catch (_) {
      // En cas d'erreur, on retombe sur un nom générique.
    }
    return 'Mon appareil';
  }

  /// Version de l'application installée.
  static Future<String> versionApp() async {
    try {
      final p = await PackageInfo.fromPlatform();
      return '${p.version}+${p.buildNumber}';
    } catch (_) {
      return '0.0.0';
    }
  }
}
