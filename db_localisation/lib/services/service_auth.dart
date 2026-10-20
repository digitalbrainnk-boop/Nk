// Service : authentification.
//
// L'utilisateur choisit à l'inscription un identifiant : e-mail OU numéro de
// téléphone, + un mot de passe. Firebase Auth gère nativement l'e-mail/mot de
// passe. Pour le téléphone-comme-identifiant avec mot de passe (et non par SMS
// OTP), on mappe le numéro vers un e-mail technique interne
// "<numéro_normalisé>@phone.dblocalisation" afin de réutiliser le backend
// e-mail/mot de passe. Le type réel ("phone") est conservé dans le profil.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../modeles/utilisateur.dart';

/// Domaine technique interne pour les comptes identifiés par téléphone.
const String _domaineTelephone = 'phone.dblocalisation';

class ResultatAuth {
  final bool succes;
  final String? messageErreur;
  final User? utilisateur;
  const ResultatAuth({required this.succes, this.messageErreur, this.utilisateur});
}

class ServiceAuth {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Flux de l'utilisateur connecté (null si déconnecté).
  Stream<User?> get fluxUtilisateur => _auth.authStateChanges();

  User? get utilisateurCourant => _auth.currentUser;

  /// Normalise un identifiant saisi en e-mail utilisable par Firebase Auth.
  /// - e-mail : renvoyé tel quel (minuscules, sans espaces).
  /// - téléphone : chiffres uniquement → "<chiffres>@phone.dblocalisation".
  static String identifiantVersEmail(String identifiant, TypeIdentifiant type) {
    final nettoye = identifiant.trim();
    if (type == TypeIdentifiant.email) {
      return nettoye.toLowerCase();
    }
    // Téléphone : on garde uniquement les chiffres (et le + éventuel).
    final chiffres = nettoye.replaceAll(RegExp(r'[^0-9]'), '');
    return '$chiffres@$_domaineTelephone';
  }

  /// Inscription : crée le compte Auth. Le profil Firestore est créé à part
  /// (voir ServiceFirestore.creerProfil) pour garder les responsabilités nettes.
  Future<ResultatAuth> inscrire({
    required String identifiant,
    required TypeIdentifiant type,
    required String motDePasse,
  }) async {
    try {
      final email = identifiantVersEmail(identifiant, type);
      final cred = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: motDePasse,
      );
      return ResultatAuth(succes: true, utilisateur: cred.user);
    } on FirebaseAuthException catch (e) {
      return ResultatAuth(succes: false, messageErreur: _messageFr(e));
    } catch (e) {
      return ResultatAuth(succes: false, messageErreur: 'Erreur inattendue : $e');
    }
  }

  /// Connexion avec identifiant + mot de passe.
  Future<ResultatAuth> connecter({
    required String identifiant,
    required TypeIdentifiant type,
    required String motDePasse,
  }) async {
    try {
      final email = identifiantVersEmail(identifiant, type);
      final cred = await _auth.signInWithEmailAndPassword(
        email: email,
        password: motDePasse,
      );
      return ResultatAuth(succes: true, utilisateur: cred.user);
    } on FirebaseAuthException catch (e) {
      return ResultatAuth(succes: false, messageErreur: _messageFr(e));
    } catch (e) {
      return ResultatAuth(succes: false, messageErreur: 'Erreur inattendue : $e');
    }
  }

  /// Connexion via Google (supportée sur mobile et web).
  Future<ResultatAuth> connecterAvecGoogle() async {
    try {
      final googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) {
        return const ResultatAuth(succes: false, messageErreur: 'Connexion annulée.');
      }
      final googleAuth = await googleUser.authentication;
      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );
      final cred = await _auth.signInWithCredential(credential);
      return ResultatAuth(succes: true, utilisateur: cred.user);
    } on FirebaseAuthException catch (e) {
      return ResultatAuth(succes: false, messageErreur: _messageFr(e));
    } catch (e) {
      return ResultatAuth(succes: false, messageErreur: 'Erreur Google : $e');
    }
  }

  Future<void> deconnecter() async {
    try {
      await GoogleSignIn().signOut();
    } catch (_) {}
    await _auth.signOut();
  }

  /// Traduit les codes d'erreur Firebase en messages lisibles en français.
  String _messageFr(FirebaseAuthException e) {
    switch (e.code) {
      case 'email-already-in-use':
        return 'Cet identifiant est déjà utilisé.';
      case 'invalid-email':
        return 'Identifiant invalide.';
      case 'weak-password':
        return 'Mot de passe trop faible (6 caractères minimum).';
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Identifiant ou mot de passe incorrect.';
      case 'network-request-failed':
        return 'Pas de connexion réseau.';
      default:
        return 'Erreur d\'authentification (${e.code}).';
    }
  }
}
