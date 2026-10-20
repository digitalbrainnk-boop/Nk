# Guide 3 — Builder & tester

## Prérequis

- **Flutter** ≥ 3.19 (`flutter --version`, `flutter doctor`).
- Firebase configuré (voir `01-configurer-firebase.md`), donc
  `lib/firebase_options.dart` généré par `flutterfire configure`.

## Initialiser les dossiers de plateforme (une fois)

Ce dépôt contient le code `lib/`, les fichiers de référence
(`AndroidManifest.xml`, `web/index.html`), `firestore.rules` et les guides —
mais PAS les dossiers de plateforme générés (Gradle Android, Runner iOS, etc.).
Générez-les avec :

```bash
# Depuis db_localisation/ : crée android/, ios/, web/, etc. sans écraser lib/
flutter create . --org com.dblocalisation --project-name db_localisation
```

Puis **fusionnez** les fichiers de référence fournis dans les dossiers générés :

- recopiez les **permissions et les receivers** de notre
  `android/app/src/main/AndroidManifest.xml` (ce fichier) dans le manifeste
  généré par `flutter create` ;
- remplacez le `web/index.html` généré par le nôtre (emplacement clé Maps) ;
- la clé Maps Android/iOS se renseigne comme indiqué dans
  `02-cle-google-maps.md`.

Ensuite, à chaque fois :

```bash
flutter pub get
```

## Web (le plus rapide pour tester la console)

```bash
flutter run -d chrome
```

Testez : inscription (e-mail ou téléphone) → connexion → « Enregistrer cet
appareil » → l'appareil apparaît dans la liste (et dans Firestore).

## Android (agent complet)

```bash
# Appareil réel conseillé (la localisation en arrière-plan et les SMS ne
# fonctionnent pas sur un émulateur sans SIM).
flutter devices
flutter run -d <id_appareil>

# APK de test
flutter build apk --debug
```

Points de vérification Android :
- l'icône de l'app est **visible** (pas masquée) ;
- l'écran de **consentement + CGU** s'affiche avant d'activer le rôle Agent ;
- aux étapes suivantes : notification permanente du service, demandes de
  permission (localisation « toujours », notifications, exclusion batterie).

## iOS (console complète, agent limité)

```bash
cd ios && pod install && cd ..
flutter run -d <id_iphone>   # nécessite un Mac + Xcode
```

Rappel honnête : sur iOS, l'agent est **limité** (localisation en arrière-plan
autorisée, mode perdu, alarme via notifications). Pas de SMS, pas de boot, pas
de service caché — c'est annoncé dans l'app.

## Desktop (console)

```bash
flutter config --enable-windows-desktop   # ou --enable-macos-desktop / linux
flutter run -d windows
```

## Déployer les règles Firestore

```bash
firebase deploy --only firestore:rules
```

## Dépannage

- **Écran blanc au lancement** : `firebase_options.dart` contient encore les
  valeurs d'exemple → relancez `flutterfire configure`.
- **`MissingPluginException`** : arrêtez et relancez complètement `flutter run`
  après `flutter pub get` (un hot-reload ne suffit pas pour un nouveau plugin).
- **Google Sign-In échoue sur Android** : ajoutez l'empreinte SHA-1 de debug
  dans la console Firebase (Paramètres du projet → vos apps).
