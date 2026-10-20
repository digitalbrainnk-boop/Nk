// Modèle : profil d'un utilisateur.
// Correspond à Firestore : users/{uid} -> profile { name, idType, createdAt }

/// Type d'identifiant choisi à l'inscription.
enum TypeIdentifiant { email, telephone }

extension TypeIdentifiantX on TypeIdentifiant {
  /// Valeur stockée dans Firestore ("email" | "phone").
  String get valeurFirestore =>
      this == TypeIdentifiant.email ? 'email' : 'phone';

  static TypeIdentifiant depuisFirestore(String? v) =>
      v == 'phone' ? TypeIdentifiant.telephone : TypeIdentifiant.email;
}

class ProfilUtilisateur {
  final String uid; // UID Firebase Auth.
  final String nom; // Nom affiché, saisi à l'inscription.
  final TypeIdentifiant typeIdentifiant; // email ou téléphone.
  final DateTime? creeLe;

  const ProfilUtilisateur({
    required this.uid,
    required this.nom,
    required this.typeIdentifiant,
    this.creeLe,
  });

  /// Conversion vers la map Firestore (champ "profile").
  Map<String, dynamic> versFirestore() => {
        'name': nom,
        'idType': typeIdentifiant.valeurFirestore,
        // createdAt est posé par le serveur à la création (voir service).
      };

  factory ProfilUtilisateur.depuisFirestore(
    String uid,
    Map<String, dynamic> data,
  ) {
    final profile = (data['profile'] as Map<String, dynamic>?) ?? data;
    return ProfilUtilisateur(
      uid: uid,
      nom: (profile['name'] as String?) ?? '',
      typeIdentifiant:
          TypeIdentifiantX.depuisFirestore(profile['idType'] as String?),
      creeLe: null,
    );
  }
}
