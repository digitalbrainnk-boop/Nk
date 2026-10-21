# 🚀 Démarrage rapide — premier test

Ce guide te mène de zéro à l'application qui tourne. **Le plus rapide pour voir
quelque chose = le test Web** (aucun SDK Android nécessaire).

> ⚠️ Sans Firebase, l'app affiche un écran « configuration requise » (elle ne
> plante plus). Il FAUT donc faire l'étape 2 ci-dessous pour tester pour de vrai.

---

## 1. Installer Flutter (une fois)

- Installe Flutter : https://docs.flutter.dev/get-started/install
- Vérifie : `flutter --version` puis `flutter doctor`

## 2. Configurer Firebase (OBLIGATOIRE)

Crée un projet sur https://console.firebase.google.com puis, dans le dossier
`db_localisation/` :

```bash
dart pub global activate flutterfire_cli
npm install -g firebase-tools
firebase login
flutterfire configure
```

Dans la console Firebase, active **Authentication → E-mail/Mot de passe** (et
**Google** si tu veux), et crée la **Firestore Database** (mode production).
Détails complets : `docs/01-configurer-firebase.md`.

## 3. Générer les dossiers de plateforme + dépendances

```bash
# Depuis db_localisation/ — crée android/, ios/, web/ sans toucher à lib/
flutter create . --org com.dblocalisation --project-name db_localisation
flutter pub get
```

> Après `flutter create`, recopie les permissions/receivers de notre
> `android/app/src/main/AndroidManifest.xml` dans le manifeste généré, et
> remplace le `web/index.html` généré par le nôtre (voir
> `docs/03-builder-et-tester.md`).

## 4. Lancer

### Test Web (le plus simple)
```bash
flutter run -d chrome
```
→ Inscris-toi, connecte-toi, enregistre un appareil, ouvre « Renforcer la
protection ». (Le suivi GPS réel est surtout fait pour le téléphone.)

### Test Android (pour le suivi GPS)
```bash
flutter devices
flutter run -d <id_de_ton_téléphone>
# ou un APK à installer :
flutter build apk --debug
```
→ Ouvre **Agent**, appuie sur **Démarrer le suivi**, accepte les permissions
de localisation (« Toujours » pour l'arrière-plan). Une notification
« Localisation active » apparaît, et la dernière position s'affiche avec son
rayon « ±X m ».

## 5. Déployer les règles de sécurité Firestore
```bash
firebase deploy --only firestore:rules
```

---

## Dépannage express
- **Écran « configuration requise »** → tu n'as pas (ou mal) fait l'étape 2 :
  relance `flutterfire configure`.
- **Google Sign-In échoue sur Android** → ajoute l'empreinte SHA-1 de debug
  dans la console Firebase (Paramètres du projet → tes apps).
- **La position ne bouge pas** → teste dehors (le GPS est mauvais en intérieur)
  et accorde la localisation « Toujours ».
