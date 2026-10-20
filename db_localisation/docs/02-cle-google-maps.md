# Guide 2 — Clé Google Maps

La carte de la **console** (étape 3) utilise Google Maps : `google_maps_flutter`
sur mobile et l'API Maps JavaScript sur le web.

## 1. Créer la clé

1. https://console.cloud.google.com → sélectionnez le **même projet** que
   Firebase (ou liez-le).
2. **APIs & Services → Library**, activez :
   - *Maps SDK for Android*
   - *Maps SDK for iOS*
   - *Maps JavaScript API* (pour le web)
3. **APIs & Services → Credentials → Create credentials → API key**.

## 2. Restreindre la clé (recommandé)

Créez de préférence **une clé par plateforme**, chacune restreinte :

- **Android** : restriction par nom de package + empreinte SHA-1 de signature.
- **iOS** : restriction par Bundle ID (`com.dblocalisation.app`).
- **Web** : restriction par *référents HTTP* (votre domaine) + limitée à
  *Maps JavaScript API*.

## 3. Renseigner la clé dans l'app

- **Android** — dans `android/app/src/main/AndroidManifest.xml`, à l'intérieur
  de `<application>` :

  ```xml
  <meta-data
      android:name="com.google.android.geo.API_KEY"
      android:value="VOTRE_CLE_MAPS_ANDROID" />
  ```

- **iOS** — dans `ios/Runner/AppDelegate.swift` :

  ```swift
  GMSServices.provideAPIKey("VOTRE_CLE_MAPS_IOS")
  ```

- **Web** — dans `web/index.html`, décommentez et complétez :

  ```html
  <script src="https://maps.googleapis.com/maps/api/js?key=VOTRE_CLE_MAPS_WEB"></script>
  ```

## Alternative gratuite

Si vous préférez éviter Google Maps, remplacez `google_maps_flutter` par
`flutter_map` + tuiles OpenStreetMap (pas de clé requise). La structure des
positions dans Firestore reste identique.
