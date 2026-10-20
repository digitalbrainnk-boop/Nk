# DB Localisation

**Antivol et localisation de VOS propres appareils.** Un utilisateur crée un
compte, enregistre ses appareils, puis les **localise / verrouille / fait
sonner** à distance depuis n'importe quel appareil (téléphone, tablette,
ordinateur, web).

> Ce logiciel est un **antivol**, PAS un logiciel espion. Voir le cadre
> éthique ci-dessous — il est non-négociable.

---

## Deux rôles, un seul compte

| Rôle | Description | Plateformes | État |
|------|-------------|-------------|------|
| **Console** | Celui qui *cherche* : carte, historique, commandes | Android, iOS, tablette, Windows, macOS, Linux, **Web** | ✅ Partout |
| **Agent** | L'appareil *protégé* : remonte sa position, obéit | **Android** | ✅ Complet (par étapes) |
| | | **iPhone / iPad** | ⚠️ Limité (contraintes Apple) |

**Pourquoi l'agent complet est Android seulement :** Apple interdit à une appli
grand public de lire/envoyer des SMS, de démarrer au boot, de tourner comme
service caché ou de résister à la désinstallation. Sur iOS, l'agent se limite à
la localisation en arrière-plan autorisée, au « mode perdu » et à l'alarme via
notifications. **C'est annoncé clairement dans l'application.**

---

## Cadre éthique (non-négociable)

- **Appli visible et consentie** : icône visible, **notification permanente**
  du service, écran de **consentement + CGU** avant d'activer le rôle agent.
- **Aucune surveillance cachée** : pas de capture photo/micro silencieuse, pas
  d'appli masquée. **Pas de permission CAMERA.**
- **Cloisonnement strict** : chaque utilisateur ne voit QUE ses appareils
  (règles `firestore.rules` basées sur `request.auth.uid`).
- **Pas de localisation d'un téléphone éteint** (techniquement impossible —
  non promis).

---

## Stack

- **Flutter** (Android, iOS, Web, desktop) — un seul code.
- **Firebase** : Auth (e-mail/mot de passe + Google), Firestore, Cloud
  Messaging, Cloud Functions (étape 4), Storage.
- **Google Maps** (`google_maps_flutter` + Maps JS web) — étape 3.

---

## Structure du projet

```
db_localisation/
├─ lib/
│  ├─ main.dart                 # Point d'entrée + init Firebase
│  ├─ app.dart                  # App racine (thème + routage)
│  ├─ firebase_options.dart     # Config Firebase (EXEMPLE → à régénérer)
│  ├─ core/                     # constantes, thème
│  ├─ modeles/                  # utilisateur, appareil, position, commande, état
│  ├─ services/                 # auth, firestore, installation (UUID), consentement
│  ├─ widgets/                  # composants réutilisables
│  └─ ecrans/
│     ├─ ecran_demarrage.dart   # routage selon l'état de connexion
│     ├─ auth/                  # connexion, inscription
│     ├─ consentement/          # écran + texte CGU
│     ├─ accueil/               # liste appareils + choix rôle
│     ├─ console/               # (étape 3-4) carte, commandes
│     └─ agent/                 # (étape 2,4,5) suivi, SMS, Device Admin
├─ android/app/src/main/AndroidManifest.xml  # permissions + receivers
├─ web/index.html               # emplacement clé Maps JS
├─ firestore.rules              # cloisonnement par utilisateur
└─ docs/                        # guides Firebase / Maps / build
```

## Modèle de données (Firestore)

```
users/{uid}
  profile: { name, idType: "email"|"phone", createdAt }
users/{uid}/devices/{deviceId}
  { name, installUuid, platform, appVersion, createdAt }
users/{uid}/devices/{deviceId}/meta/state
  { lastSeen, online, battery, isCharging, lastSimSerialHash }
users/{uid}/devices/{deviceId}/locations/{autoId}
  { lat, lng, accuracy, battery, source: "gps"|"network"|"sms", ts }
users/{uid}/devices/{deviceId}/commands/{autoId}
  { type, payload, status: "pending"|"sent"|"done"|"failed", createdAt, resolvedAt }
```

Chaque appareil est identifié par un **UUID d'installation** généré au premier
lancement (PAS d'IMEI/MAC, inaccessibles depuis Android 10).

---

## Démarrage rapide

1. `cd db_localisation && flutter create . --org com.dblocalisation --project-name db_localisation`
   (génère `android/`, `ios/`, `web/`… sans toucher à `lib/`), puis fusionnez
   les permissions/receivers du `AndroidManifest.xml` fourni et notre
   `web/index.html` — détails dans `docs/03-builder-et-tester.md`.
2. `docs/01-configurer-firebase.md` → créer le projet + `flutterfire configure`.
3. `flutter pub get`
4. `flutter run -d chrome` (console web) puis `flutter run` sur un Android réel.
5. `firebase deploy --only firestore:rules`

Voir `docs/02-cle-google-maps.md` et `docs/03-builder-et-tester.md`.

---

## Ordre de construction

1. ✅ **Socle + Auth + enregistrement appareil + consentement** (CETTE ÉTAPE).
2. ⏳ **Suivi GPS** : service premier plan + notification, position périodique →
   Firestore, boot receiver, exclusion batterie.
3. ⏳ **Console** : carte Google Maps + dernière position + historique + état.
4. ⏳ **Commandes à distance** : localiser / alarme / verrouiller (FCM + Cloud
   Functions + Device Admin).
5. ⏳ **Mode SMS** sans data (code secret) + **alerte changement de SIM**.
6. ⏳ **Portage** console iOS/desktop ; agent iOS limité.

### Étape 1 — ce qui est livré

- Authentification identifiant (e-mail **ou** téléphone) + mot de passe, +
  connexion Google.
- Création du profil utilisateur dans Firestore.
- Génération et stockage de l'**UUID d'installation**.
- Enregistrement de l'appareil sous le compte (nom + UUID + plateforme + version).
- Liste temps réel des appareils (renommer / retirer).
- Écran de **consentement + CGU** exigé avant d'activer le rôle agent.
- Écrans console et agent en squelette, avec l'avertissement iOS honnête.
- `AndroidManifest.xml` complet, `firestore.rules`, et les 3 guides.
