# Politique de confidentialité — DB Localisation

> **À héberger à une URL publique** avant publication sur les stores (Google
> Play et App Store l'exigent). Remplace `[ÉDITEUR]` et `[CONTACT]` par tes
> informations réelles. Cette version reflète le texte intégré à l'application
> (`lib/ecrans/legal/textes_legaux.dart`).

**Dernière mise à jour : 2026.**

## 1. Qui ?
Cette application est éditée par **[ÉDITEUR]**. Contact : **[CONTACT]**.

## 2. Ce que nous collectons
- **Compte** : votre nom et votre identifiant (e-mail **ou** numéro de téléphone).
- **Appareils** : le nom que vous donnez, un **identifiant d'installation** (UUID
  aléatoire — **pas** l'IMEI ni l'adresse MAC), la plateforme et la version.
- **Position** : latitude, longitude, précision, batterie, horodatage —
  **uniquement** quand vous avez activé le suivi sur l'appareil concerné.
- **Infos de récupération** (facultatif) : IMEI, numéro de série, contact.
- **Adresses de récupération** (facultatif) : jusqu'à 3 e-mails de confiance.

## 3. Pourquoi ?
Uniquement pour vous permettre de localiser, protéger et retrouver **vos propres
appareils** en cas de perte ou de vol. Base légale : votre **consentement** et la
protection légitime de vos biens.

## 4. Ce que nous ne faisons pas
- Aucune capture photo ou micro. Aucun accès à la caméra.
- Aucune surveillance cachée : l'application est **visible** et **signale** le suivi.
- Aucune revente, aucune publicité, aucun partage à des tiers.

## 5. Où sont stockées les données
Dans votre espace **Firebase (Google Cloud)** : authentification et base Firestore.
Les données sont **cloisonnées** : vous êtes le seul à pouvoir les lire (règles
de sécurité basées sur votre identifiant de compte `request.auth.uid`).

## 6. Durée de conservation
Tant que votre compte existe. Retirer un appareil supprime ses données ; vous
pouvez demander la suppression de votre compte à tout moment.

## 7. Vos droits (RGPD)
Accès, rectification, suppression, portabilité et retrait du consentement.
Écrivez à **[CONTACT]**.

## 8. Localisation en arrière-plan
Elle ne fonctionne que si vous l'activez, et une **notification permanente**
l'indique. Vous pouvez la couper quand vous voulez.

## 9. Enfants
Application destinée à un adulte protégeant ses propres appareils (ou sous la
responsabilité d'un parent pour un appareil familial, avec information claire).
