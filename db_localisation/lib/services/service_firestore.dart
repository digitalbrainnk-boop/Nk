// Service : accès Firestore (cloisonné par utilisateur).
//
// Toutes les données vivent sous users/{uid}/... Les règles de sécurité
// (firestore.rules) garantissent qu'un utilisateur ne lit/écrit QUE ses
// propres documents (request.auth.uid == uid).

import 'package:cloud_firestore/cloud_firestore.dart';

import '../modeles/appareil.dart';
import '../modeles/commande.dart';
import '../modeles/etat_appareil.dart';
import '../modeles/position.dart';
import '../modeles/utilisateur.dart';

class ServiceFirestore {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // --- Références de base ---
  DocumentReference<Map<String, dynamic>> _refUser(String uid) =>
      _db.collection('users').doc(uid);

  CollectionReference<Map<String, dynamic>> _refAppareils(String uid) =>
      _refUser(uid).collection('devices');

  // ----------------------------------------------------------------
  // PROFIL
  // ----------------------------------------------------------------

  /// Crée (ou met à jour) le profil utilisateur. Appelé juste après l'inscription.
  Future<void> creerProfil(ProfilUtilisateur profil) async {
    await _refUser(profil.uid).set({
      'profile': {
        ...profil.versFirestore(),
        'createdAt': FieldValue.serverTimestamp(),
      },
    }, SetOptions(merge: true));
  }

  Future<ProfilUtilisateur?> lireProfil(String uid) async {
    final doc = await _refUser(uid).get();
    if (!doc.exists) return null;
    return ProfilUtilisateur.depuisFirestore(uid, doc.data()!);
  }

  /// S'assure qu'un profil existe, sans écraser un profil déjà présent.
  /// Utile après une connexion Google : aucun formulaire d'inscription n'a été
  /// rempli, donc on crée un profil minimal (nom = nom Google / e-mail).
  Future<void> assurerProfil({
    required String uid,
    required String nomParDefaut,
  }) async {
    final doc = await _refUser(uid).get();
    final profilExistant = doc.data()?['profile'];
    if (profilExistant != null) return; // On ne touche pas à l'existant.
    await _refUser(uid).set({
      'profile': {
        'name': nomParDefaut,
        'idType': 'email',
        'createdAt': FieldValue.serverTimestamp(),
      },
    }, SetOptions(merge: true));
  }

  // ----------------------------------------------------------------
  // APPAREILS
  // ----------------------------------------------------------------

  /// Enregistre un appareil sous le compte. Si un appareil avec le même
  /// installUuid existe déjà, on le réutilise (évite les doublons).
  /// Renvoie l'identifiant du document appareil.
  Future<String> enregistrerAppareil({
    required String uid,
    required Appareil appareil,
  }) async {
    // Recherche d'un appareil existant avec le même UUID d'installation.
    final existant = await _refAppareils(uid)
        .where('installUuid', isEqualTo: appareil.installUuid)
        .limit(1)
        .get();

    if (existant.docs.isNotEmpty) {
      final ref = existant.docs.first.reference;
      // On met à jour les champs volatils (nom, version, plateforme).
      await ref.set({
        'name': appareil.nom,
        'platform': appareil.plateforme,
        'appVersion': appareil.versionApp,
      }, SetOptions(merge: true));
      return ref.id;
    }

    final ref = await _refAppareils(uid).add(appareil.versFirestore());
    return ref.id;
  }

  /// Flux temps réel de la liste des appareils de l'utilisateur.
  Stream<List<Appareil>> fluxAppareils(String uid) {
    return _refAppareils(uid)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snap) => snap.docs.map(Appareil.depuisDoc).toList());
  }

  Future<void> renommerAppareil({
    required String uid,
    required String deviceId,
    required String nouveauNom,
  }) async {
    await _refAppareils(uid).doc(deviceId).set(
      {'name': nouveauNom},
      SetOptions(merge: true),
    );
  }

  Future<void> retirerAppareil({
    required String uid,
    required String deviceId,
  }) async {
    await _refAppareils(uid).doc(deviceId).delete();
  }

  // ----------------------------------------------------------------
  // ÉTAT (document unique "meta/state" sous l'appareil)
  // ----------------------------------------------------------------

  DocumentReference<Map<String, dynamic>> _refEtat(String uid, String deviceId) =>
      _refAppareils(uid).doc(deviceId).collection('meta').doc('state');

  Future<void> majEtat({
    required String uid,
    required String deviceId,
    required EtatAppareil etat,
  }) async {
    await _refEtat(uid, deviceId).set(etat.versFirestore(), SetOptions(merge: true));
  }

  Stream<EtatAppareil?> fluxEtat(String uid, String deviceId) {
    return _refEtat(uid, deviceId).snapshots().map(
          (doc) => doc.exists ? EtatAppareil.depuisDoc(doc) : null,
        );
  }

  // ----------------------------------------------------------------
  // POSITIONS
  // ----------------------------------------------------------------

  Future<void> ajouterPosition({
    required String uid,
    required String deviceId,
    required Position position,
  }) async {
    await _refAppareils(uid)
        .doc(deviceId)
        .collection('locations')
        .add(position.versFirestore());
  }

  /// Dernières positions (historique), les plus récentes d'abord.
  Stream<List<Position>> fluxPositions(String uid, String deviceId, {int limite = 50}) {
    return _refAppareils(uid)
        .doc(deviceId)
        .collection('locations')
        .orderBy('ts', descending: true)
        .limit(limite)
        .snapshots()
        .map((snap) => snap.docs.map(Position.depuisDoc).toList());
  }

  // ----------------------------------------------------------------
  // COMMANDES
  // ----------------------------------------------------------------

  /// La console crée une commande "pending" ; l'agent la traitera (étape 4).
  Future<void> envoyerCommande({
    required String uid,
    required String deviceId,
    required Commande commande,
  }) async {
    await _refAppareils(uid)
        .doc(deviceId)
        .collection('commands')
        .add(commande.versFirestore());
  }

  Stream<List<Commande>> fluxCommandes(String uid, String deviceId) {
    return _refAppareils(uid)
        .doc(deviceId)
        .collection('commands')
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map((snap) => snap.docs.map(Commande.depuisDoc).toList());
  }
}
