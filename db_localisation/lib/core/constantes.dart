// Constantes partagées de l'application DB Localisation.

/// Nom affiché de l'application.
const String kNomApp = 'DB Localisation';

/// Clés de stockage local (shared_preferences).
class ClesStockage {
  /// UUID d'installation unique de CET appareil (généré une seule fois).
  static const String uuidInstallation = 'db_uuid_installation';

  /// Indique si l'utilisateur a accepté le consentement + CGU sur cet appareil.
  static const String consentementAccepte = 'db_consentement_accepte';

  /// Rôle choisi sur cet appareil : "console" ou "agent".
  static const String roleAppareil = 'db_role_appareil';

  /// Identifiant du document "appareil" enregistré pour cet appareil.
  static const String deviceIdEnregistre = 'db_device_id';

  /// L'utilisateur a vu et accepté l'avertissement de localisation (exigé
  /// par Google Play avant de demander la permission de localisation).
  static const String divulgationLocalisation = 'db_divulgation_localisation';
}

/// Rôles possibles d'un appareil dans l'application.
/// - console : celui qui CHERCHE (carte, commandes). Toutes plateformes.
/// - agent   : l'appareil PROTÉGÉ (remonte sa position, obéit aux commandes).
class RolesAppareil {
  static const String console = 'console';
  static const String agent = 'agent';
}

/// Types de commandes à distance (voir modèle Firestore).
class TypesCommande {
  static const String localiserMaintenant = 'LOCALISER_MAINTENANT';
  static const String alarme = 'ALARME';
  static const String verrouiller = 'VERROUILLER';
  static const String effacer = 'EFFACER'; // Optionnel, avec confirmation.
}

/// Statuts d'une commande.
class StatutsCommande {
  static const String enAttente = 'pending';
  static const String envoyee = 'sent';
  static const String terminee = 'done';
  static const String echouee = 'failed';
}

/// Sources possibles d'une position.
class SourcesPosition {
  static const String gps = 'gps';
  static const String reseau = 'network';
  static const String sms = 'sms';
}
