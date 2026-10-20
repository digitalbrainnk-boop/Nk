// Écran de démarrage : décide où envoyer l'utilisateur.
//
// Logique de routage :
//   1. Pas connecté            -> écran de connexion/inscription.
//   2. Connecté                -> écran d'accueil (choix du rôle + appareils).
// Le consentement (pour le rôle AGENT) est demandé au moment où l'utilisateur
// active le rôle agent sur cet appareil (voir ecran_accueil / ecran_agent).

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/service_auth.dart';
import 'accueil/ecran_accueil.dart';
import 'auth/ecran_connexion.dart';

class EcranDemarrage extends StatelessWidget {
  const EcranDemarrage({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = ServiceAuth();
    return StreamBuilder<User?>(
      stream: auth.fluxUtilisateur,
      builder: (context, snapshot) {
        // Chargement initial de l'état d'authentification.
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final utilisateur = snapshot.data;
        if (utilisateur == null) {
          return const EcranConnexion();
        }
        return EcranAccueil(uid: utilisateur.uid);
      },
    );
  }
}
