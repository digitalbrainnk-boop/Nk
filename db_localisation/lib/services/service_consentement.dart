// Service : gestion du consentement local.
//
// Règle non-négociable : sur l'appareil PROTÉGÉ (agent), l'utilisateur doit
// voir un écran de consentement + CGU au premier lancement et l'accepter
// explicitement avant tout suivi. On mémorise ce choix localement.

import 'package:shared_preferences/shared_preferences.dart';

import '../core/constantes.dart';

class ServiceConsentement {
  Future<bool> consentementAccepte() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(ClesStockage.consentementAccepte) ?? false;
  }

  Future<void> enregistrerConsentement(bool accepte) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(ClesStockage.consentementAccepte, accepte);
  }

  Future<String?> roleAppareil() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(ClesStockage.roleAppareil);
  }

  Future<void> definirRole(String role) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(ClesStockage.roleAppareil, role);
  }

  /// Avertissement de localisation vu et accepté (divulgation Google Play).
  Future<bool> divulgationLocalisationAcceptee() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(ClesStockage.divulgationLocalisation) ?? false;
  }

  Future<void> enregistrerDivulgationLocalisation(bool accepte) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(ClesStockage.divulgationLocalisation, accepte);
  }

  Future<String?> deviceIdEnregistre() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(ClesStockage.deviceIdEnregistre);
  }

  Future<void> definirDeviceId(String deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(ClesStockage.deviceIdEnregistre, deviceId);
  }
}
