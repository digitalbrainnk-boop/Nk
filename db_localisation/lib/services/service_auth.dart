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
    // Téléphone : on ne garde que les chiffres (espaces, +, tirets retirés),
    // puis on canonise le préfixe international : « + » et « 00 » désignent la
    // même chose, donc +33… et 0033… donnent le MÊME identifiant. La même
    // normalisation est appliquée à l'inscription ET à la connexion, donc
    // l'identifiant reste stable quelle que soit la mise en forme saisie.
    // Limite assumée : un numéro en format national (ex. 06…) et son format
    // international (+33 6…) ne sont PAS fusionnés (cela exigerait de connaître
    // le pays) — l'utilisateur doit saisir son numéro de façon cohérente.
    var chiffres = nettoye.replaceAll(RegExp(r'[^0-9]'), '');
    if (chiffres.startsWith('00')) {
      chiffres = chiffres.substring(2); // 00 (préfixe international) == +
    }
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

  /// Envoie un e-mail de réinitialisation de mot de passe.
  /// Disponible uniquement pour les comptes identifiés par E-MAIL : un compte
  /// « téléphone » utilise une adresse technique interne qui ne reçoit pas de
  /// courriel (une réinitialisation par SMS serait une évolution ultérieure).
  Future<ResultatAuth> reinitialiserMotDePasse({
    required String identifiant,
    required TypeIdentifiant type,
  }) async {
    if (type == TypeIdentifiant.telephone) {
      return const ResultatAuth(
        succes: false,
        messageErreur:
            'Réinitialisation par e-mail indisponible pour un identifiant '
            'téléphone. Utilisez un identifiant e-mail.',
      );
    }
    try {
      final email = identifiantVersEmail(identifiant, type);
      await _auth.sendPasswordResetEmail(email: email);
      return const ResultatAuth(succes: true);
    } on FirebaseAuthException catch (e) {
      return ResultatAuth(succes: false, messageErreur: _messageFr(e));
    } catch (e) {
      return ResultatAuth(succes: false, messageErreur: 'Erreur : $e');
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
