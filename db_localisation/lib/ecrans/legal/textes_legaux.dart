// Textes légaux de l'application : politique de confidentialité et avertissement
// de localisation. Centralisés ici pour être faciles à relire / traduire.
//
// À COMPLÉTER avant publication : remplace [ÉDITEUR] et [CONTACT] par tes infos,
// et héberge la politique à une URL publique (exigée par les stores).

/// Avertissement « visible » montré JUSTE AVANT de demander la localisation.
/// Exigé par Google Play (divulgation bien visible, avec option de refus).
const String kDivulgationLocalisation =
    'DB Localisation collecte la position de cet appareil — y compris en '
    'arrière-plan, même quand l\'application est fermée — afin que VOUS '
    'puissiez le localiser à distance depuis votre compte.\n\n'
    'Une notification permanente « Localisation active » s\'affiche tant que le '
    'suivi est en marche : rien n\'est caché. Vous pouvez refuser, et arrêter le '
    'suivi à tout moment.';

/// Politique de confidentialité (version intégrée à l'application).
const String kPolitiqueConfidentialite = '''
POLITIQUE DE CONFIDENTIALITÉ — DB Localisation

Dernière mise à jour : 2026.

1. QUI ?
Cette application est éditée par [ÉDITEUR]. Pour toute question :
[CONTACT].

2. CE QUE NOUS COLLECTONS
• Compte : votre nom et votre identifiant (e-mail OU numéro de téléphone).
• Appareils : le nom que vous donnez, un identifiant d'installation (UUID
  généré au hasard — PAS l'IMEI ni l'adresse MAC), la plateforme et la version.
• Position : latitude, longitude, précision, niveau de batterie et horodatage,
  UNIQUEMENT quand VOUS avez activé le suivi sur l'appareil concerné.
• Infos de récupération (facultatif, saisies par vous) : IMEI, numéro de série,
  contact à afficher.
• Adresses de récupération (facultatif) : jusqu'à 3 e-mails de confiance.

3. POURQUOI ?
Uniquement pour vous permettre de localiser, protéger et retrouver VOS propres
appareils en cas de perte ou de vol. Base légale : votre consentement et la
protection légitime de vos biens.

4. CE QUE NOUS NE FAISONS PAS
• Aucune capture photo ou micro. Aucun accès à la caméra.
• Aucune surveillance cachée : l'appli est visible et signale le suivi.
• Aucune revente, aucune publicité, aucun partage à des tiers.

5. OÙ SONT STOCKÉES LES DONNÉES
Dans votre espace Firebase (Google Cloud) : authentification et base Firestore.
Elles sont cloisonnées : vous êtes le SEUL à pouvoir lire vos données
(règles de sécurité basées sur votre identifiant de compte).

6. COMBIEN DE TEMPS
Tant que votre compte existe. Retirer un appareil supprime ses données ; vous
pouvez demander la suppression de votre compte à tout moment.

7. VOS DROITS (RGPD)
Accès, rectification, suppression, portabilité et retrait du consentement.
Écrivez à [CONTACT].

8. LOCALISATION EN ARRIÈRE-PLAN
Elle ne fonctionne que si vous l'activez, et une notification permanente
l'indique. Vous pouvez la couper quand vous voulez.

9. ENFANTS
Application destinée à un adulte protégeant ses propres appareils (ou sous la
responsabilité d'un parent pour un appareil familial, avec information claire).
''';
