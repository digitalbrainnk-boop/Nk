# DB Localisation — Cahier des charges & prompt de création (SaaS multi-plateforme)

> Antivol et localisation d'appareil. Chaque utilisateur crée un compte, enregistre
> ses appareils, puis les localise / verrouille / fait sonner à distance depuis
> n'importe quel appareil (téléphone, tablette, ordinateur, web).

---

## 1. Plateformes — ce qui est possible, honnêtement

L'application a **deux rôles** (le même compte, la même base de données) :

| Rôle | Rôle concret | Plateformes | État |
|------|--------------|-------------|------|
| **Console** | Celui qui *cherche* : voit la carte, l'historique, envoie les commandes | Android, iPhone, iPad, tablette, Windows, macOS, Linux, **Web** | ✅ Partout |
| **Agent** | L'appareil *protégé* : remonte sa position, obéit aux commandes | **Android** (toutes fonctions) | ✅ Complet |
| | | **iPhone / iPad** | ⚠️ Limité (voir ci-dessous) |
| | | Ordinateur (PC/Mac) | ⚠️ Optionnel, localisation réseau peu précise |

**Pourquoi l'agent complet est Android seulement :** Apple interdit à une appli grand
public de lire/envoyer des SMS, de démarrer automatiquement au boot, de tourner comme
service caché ou de se protéger contre la désinstallation. Sur iPhone, l'appareil
protégé n'a donc que : localisation quand l'app tourne ou en arrière-plan autorisé,
« mode perdu » et alarme via notifications. **À annoncer clairement à l'utilisateur.**

---

## 2. Règles non-négociables (éthique + légal)

Ce sont des antivols, **pas des logiciels espions**. Le code doit respecter :

- **Appli visible et consentie** sur l'appareil protégé : icône visible, **notification
  permanente** du service de suivi, l'utilisateur de l'appareil sait qu'il est suivi.
- **Aucune surveillance cachée** : pas de capture photo/micro silencieuse, pas d'appli
  masquée, pas d'interception furtive conçue pour qu'une personne ignore qu'on la suit.
- **Écran de consentement + CGU** au premier lancement de l'agent.
- **Cloisonnement strict** : chaque utilisateur ne voit QUE ses propres appareils
  (règles de sécurité Firestore).
- Localisation d'un **téléphone éteint impossible** (ne pas le promettre).

---

## 3. Stack technique

- **Front multi-plateforme : Flutter** (un seul code → Android, iOS, Web, desktop).
- **Backend : Firebase**
  - **Auth** : e-mail + mot de passe, et connexion Google.
  - **Firestore** : appareils, positions, commandes, état.
  - **Cloud Messaging (FCM)** : pousser les commandes en temps réel vers l'agent.
  - **Cloud Functions** : logique serveur (distribution des commandes, nettoyage, alertes).
  - **Storage** : avatars/logos.
- **Carte : Google Maps** (`google_maps_flutter` sur mobile + Maps JS sur web).
  Alternative gratuite : `flutter_map` + OpenStreetMap.
- **SaaS / abonnement** (plus tard) : Stripe via Cloud Functions. MVP = gratuit.

---

## 4. Compte & identifiant

- **Inscription** : nom, mot de passe, + un **identifiant au choix** (e-mail OU numéro
  de téléphone utilisé comme identifiant).
- **Connexion** depuis n'importe quel appareil avec ce même identifiant → accès à tous
  ses appareils enregistrés.
- Un compte peut gérer **plusieurs appareils**.
- À l'enregistrement d'un appareil : nom donné par l'utilisateur + **UUID d'installation**
  généré (pas d'IMEI/MAC, inaccessibles depuis Android 10).

---

## 5. Fonctions

### Agent (Android — complet)
- Enregistrement de l'appareil (nom + UUID) sous le compte.
- **Service de premier plan** avec notification permanente ; localisation périodique
  (intervalle réglable) envoyée à Firestore dès qu'il y a data/WiFi.
- **Démarrage au boot** (BroadcastReceiver sur `BOOT_COMPLETED`).
- **Exclusion de l'optimisation batterie** (demande explicite).
- **Mode SMS sans data** : si un SMS entrant contient le **code secret** défini par
  l'utilisateur (ex. `DBLOC#1234`), l'app lit la position et renvoie coordonnées +
  lien Google Maps au numéro expéditeur. Commande **journalisée dans l'app** (pas
  masquée à l'utilisateur de l'appareil).
- **Commandes à distance** : `LOCALISER_MAINTENANT`, `ALARME` (son max même en
  silencieux), `VERROUILLER` (+ message à l'écran type « Téléphone perdu, appelez le… »),
  `EFFACER` (optionnel, avec confirmation).
- **Alerte changement de SIM** : si la carte SIM change, l'app envoie le nouveau numéro
  au compte (fonction antivol légitime sur son propre appareil).
- **Device Admin** : verrouillage à distance + résistance à la désinstallation,
  **appli restant visible**.

### Console (toutes plateformes)
- **Carte** : dernière position connue + historique des positions.
- **État** : date/heure de la dernière mise à jour, niveau de batterie, en ligne/hors ligne.
- **Boutons de commande** : localiser, faire sonner, verrouiller.
- **Gestion multi-appareils** : liste, renommer, retirer.

---

## 6. Modèle de données (Firestore)

```
users/{uid}
  profile: { name, idType: "email"|"phone", createdAt }

users/{uid}/devices/{deviceId}
  name, installUuid, platform, appVersion, createdAt

users/{uid}/devices/{deviceId}/state
  lastSeen, online, battery, isCharging, lastSimSerialHash

users/{uid}/devices/{deviceId}/locations/{autoId}
  lat, lng, accuracy, battery, source: "gps"|"network"|"sms", ts

users/{uid}/devices/{deviceId}/commands/{autoId}
  type: "LOCALISER_MAINTENANT"|"ALARME"|"VERROUILLER"|"EFFACER",
  payload, status: "pending"|"sent"|"done"|"failed", createdAt, resolvedAt
```

**Règle de sécurité** : lecture/écriture autorisée seulement si `request.auth.uid == uid`.

---

## 7. Permissions Android

`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `RECEIVE_SMS`, `SEND_SMS`,
`RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`,
`INTERNET`, `POST_NOTIFICATIONS`, `READ_PHONE_STATE` (détection SIM), + **Device Admin**.
*(Pas de CAMERA : la capture photo à distance silencieuse n'est pas implémentée.)*

---

## 8. Livrables attendus

1. Structure complète du projet Flutter (agent + console) + Cloud Functions.
2. Code **commenté en français**.
3. `AndroidManifest.xml` avec toutes les permissions et receivers.
4. Règles Firestore (`firestore.rules`).
5. Guides : **configurer Firebase**, **clé Google Maps**, **builder & tester** (Android,
   web, iOS).

---

## 9. Ordre de construction

1. **Socle + Auth** : projet Flutter + Firebase, inscription/connexion (identifiant +
   mot de passe), enregistrement de l'appareil (UUID), écran de consentement.
2. **Suivi GPS** : service premier plan + notification, position périodique → Firestore,
   boot receiver, exclusion batterie.
3. **Console web** : carte + dernière position + historique + état.
4. **Commandes à distance** : localiser / alarme / verrouiller (FCM + Device Admin).
5. **Mode SMS** sans data + **alerte SIM**.
6. **Portage console** iOS / desktop ; version agent iOS limitée.

---

## 10. ⭐ PROMPT prêt à copier-coller

> À donner à un générateur d'app / assistant de code pour lancer la création.

```
Crée un SaaS multi-plateforme nommé « DB Localisation » : une application antivol et de
localisation d'appareil. Objectif : un utilisateur localise, verrouille et fait sonner
SON PROPRE appareil à distance en cas de perte ou de vol.

STACK : Flutter (Android, iOS, Web, desktop) + Firebase (Auth e-mail/mot de passe +
Google, Firestore, Cloud Messaging, Cloud Functions, Storage) + Google Maps
(google_maps_flutter + Maps JS web). Code commenté en FRANÇAIS.

DEUX RÔLES, même compte :
- CONSOLE (celui qui cherche) : fonctionne sur TOUTES les plateformes (iPhone, Android,
  tablette, PC, Mac, Web). Affiche une carte avec la dernière position et l'historique,
  l'état (dernière connexion, batterie, en ligne/hors ligne), et des boutons de commande
  (localiser, alarme, verrouiller). Gestion multi-appareils.
- AGENT (l'appareil protégé) : complet sur ANDROID (service de premier plan avec
  notification permanente, localisation périodique vers Firestore, démarrage au boot,
  exclusion batterie, mode SMS sans data avec code secret qui renvoie coordonnées + lien
  Maps, commandes à distance, Device Admin pour verrouillage + résistance désinstallation,
  alerte changement de SIM). Sur iOS : version limitée (localisation en arrière-plan
  autorisé + mode perdu + alarme via notifications), car Apple interdit SMS/boot/service
  caché — l'indiquer clairement à l'utilisateur.

COMPTE : inscription avec nom, mot de passe et un identifiant au choix (e-mail ou numéro
de téléphone). Connexion depuis n'importe quel appareil. Un compte gère plusieurs
appareils, chacun identifié par un UUID d'installation (PAS d'IMEI/MAC).

RÈGLES NON-NÉGOCIABLES (antivol, PAS logiciel espion) :
- Appli VISIBLE et CONSENTIE sur l'appareil protégé : icône visible, notification
  permanente du service, écran de consentement + CGU au premier lancement.
- AUCUNE surveillance cachée : pas de capture photo/micro silencieuse, pas d'appli
  masquée, pas d'interception furtive. Pas de permission CAMERA.
- Chaque utilisateur ne voit QUE ses propres appareils (règles Firestore strictes
  basées sur request.auth.uid).
- Ne pas tenter de localiser un téléphone éteint.

LIVRABLES : structure complète du projet, AndroidManifest.xml avec toutes les permissions
et receivers, firestore.rules, et des guides pour configurer Firebase, la clé Google Maps,
et builder/tester (Android, Web, iOS).

Commence par l'étape 1 : socle Flutter + Firebase, authentification (identifiant +
mot de passe), enregistrement de l'appareil et écran de consentement. Puis enchaîne :
suivi GPS → console web → commandes à distance → mode SMS + alerte SIM → portage iOS/desktop.
```
