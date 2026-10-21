// Contenu (textes + liens) de l'écran « Renforcer la protection ».
// Séparé de l'UI pour rester lisible et facile à traduire/mettre à jour.

/// Une action recommandée pour activer une protection native.
class ActionProtection {
  final String titre;
  final String description;
  final String? lien; // URL ouverte par un bouton (null = pas de bouton).
  final String? libelleBouton;

  const ActionProtection({
    required this.titre,
    required this.description,
    this.lien,
    this.libelleBouton,
  });
}

/// Protections natives pour Android (survivent au reset, pas notre app).
const List<ActionProtection> kActionsAndroid = [
  ActionProtection(
    titre: 'Activer « Localiser mon appareil » (Find My Device)',
    description:
        'Intégré à Android. Permet de localiser, faire sonner et effacer même '
        'après une réinitialisation, tant que votre compte Google reste exigé '
        'au redémarrage.',
    lien: 'https://www.google.com/android/find',
    libelleBouton: 'Ouvrir Find My Device',
  ),
  ActionProtection(
    titre: 'Garder un compte Google + verrou (protection anti-reset / FRP)',
    description:
        'La « Factory Reset Protection » exige VOTRE compte Google après une '
        'réinitialisation : un voleur ne peut pas reconfigurer le téléphone. '
        'Vérifiez que votre compte est bien connecté et sécurisé.',
    lien: 'https://myaccount.google.com/security',
    libelleBouton: 'Sécurité du compte Google',
  ),
  ActionProtection(
    titre: 'Mettre un verrou d\'écran solide',
    description:
        'Réglages > Sécurité > Verrouillage de l\'écran (code, schéma ou '
        'biométrie). Indispensable pour que le FRP et le chiffrement protègent '
        'vos données.',
  ),
];

/// Protections natives pour iPhone / iPad.
const List<ActionProtection> kActionsIos = [
  ActionProtection(
    titre: 'Activer « Localiser » + Verrouillage d\'activation',
    description:
        'Réglages > [votre nom] > Localiser > Localiser mon iPhone (activez '
        'aussi « Réseau Localiser » et « Dernière position »). Le Verrouillage '
        'd\'activation lie l\'appareil à votre identifiant Apple : il reste '
        'verrouillé ET localisable même après effacement ou restauration DFU.',
    lien: 'https://www.icloud.com/find',
    libelleBouton: 'Ouvrir Localiser (iCloud)',
  ),
  ActionProtection(
    titre: 'Mettre un code + Face/Touch ID',
    description:
        'Réglages > Face ID et code. Un code fort protège vos données et '
        'renforce le Verrouillage d\'activation.',
  ),
];

/// Message affiché sur les plateformes « console » (web/desktop) : ces
/// protections concernent le téléphone à retrouver, pas l'ordinateur.
const String kNoteConsole =
    'Vous êtes sur une console (web/ordinateur). Les protections anti-reset '
    'ci-dessous s\'activent SUR le téléphone à protéger (Android ou iPhone). '
    'Ouvrez cet écran depuis le téléphone, ou suivez les étapes manuellement.';

/// Rappel honnête, affiché en haut de l'écran.
const String kRappelHonnete =
    'Important : notre application NE survit PAS à une réinitialisation d\'usine '
    'ni à un flash (c\'est la sécurité d\'Android/iOS, pas un défaut). La vraie '
    'protection anti-reset vient des outils intégrés ci-dessous, liés à votre '
    'compte, et du blocage de l\'IMEI côté opérateur.';

/// Étapes de la check-list « en cas de vol ». La clé sert au stockage local.
class EtapeVol {
  final String cle;
  final String libelle;
  const EtapeVol(this.cle, this.libelle);
}

const List<EtapeVol> kEtapesVol = [
  EtapeVol('verrouiller',
      'Verrouiller / effacer à distance (Localiser ou Find My Device)'),
  EtapeVol('imei_operateur',
      'Signaler l\'IMEI à l\'opérateur pour bloquer l\'appareil sur le réseau'),
  EtapeVol('plainte',
      'Porter plainte (donnez l\'IMEI et le numéro de série)'),
  EtapeVol('mots_de_passe',
      'Changer les mots de passe (compte Google/Apple, e-mail, banque)'),
];
