# Guide 1 — Configurer Firebase

DB Localisation utilise Firebase pour l'authentification, la base de données
(Firestore), les notifications (FCM) et plus tard les Cloud Functions.

## 1. Créer le projet

1. Allez sur https://console.firebase.google.com → **Ajouter un projet**.
2. Nommez-le (ex. `db-localisation`), désactivez Analytics si vous voulez.

## 2. Activer les services

Dans la console Firebase :

- **Authentication** → *Commencer* → activez :
  - **E-mail/Mot de passe**.
  - **Google** (renseignez l'e-mail d'assistance).
  > Note : les comptes « identifiant téléphone » sont stockés en interne sous
  > la forme `<numéro>@phone.dblocalisation` via le backend e-mail/mot de passe
  > (voir `service_auth.dart`). Vous n'avez donc PAS besoin d'activer la
  > connexion par SMS/OTP.
- **Firestore Database** → *Créer une base* → mode **production**.
- **Cloud Messaging** : activé par défaut (utilisé à l'étape 4).
- **Storage** (optionnel, avatars) : activez-le si besoin.

## 3. Lier l'app Flutter avec FlutterFire

Installez les outils puis générez la config :

```bash
# Outils (une fois)
dart pub global activate flutterfire_cli
npm install -g firebase-tools
firebase login

# Depuis le dossier db_localisation/
flutterfire configure
```

`flutterfire configure` :
- crée/choisit le projet Firebase,
- enregistre les apps Android/iOS/Web,
- **génère `lib/firebase_options.dart`** (remplace le fichier d'exemple fourni),
- place `android/app/google-services.json` et le plist iOS.

## 4. Déployer les règles Firestore

Le fichier `firestore.rules` à la racine applique le cloisonnement strict par
utilisateur. Déployez-le :

```bash
firebase deploy --only firestore:rules
```

> Vérifiez dans la console Firebase → Firestore → **Règles** que le contenu
> correspond bien à `firestore.rules`.

## 5. Vérifier

Lancez l'app (voir `03-builder-et-tester.md`), créez un compte, enregistrez un
appareil : un document `users/{uid}/devices/{deviceId}` doit apparaître dans
Firestore, visible uniquement par ce compte.
