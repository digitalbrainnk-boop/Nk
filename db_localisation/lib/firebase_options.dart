// Configuration Firebase du projet « db-localisation-9cd9c ».
//
// Valeurs ANDROID réelles (issues de google-services.json). Les entrées web et
// iOS reprennent les mêmes identifiants de projet pour que le build soit propre ;
// pour une vraie version web/iOS en production, enregistrez une app web/iOS
// dédiée dans la console Firebase et remplacez leur `appId`.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return web;
    }
  }

  // --- ANDROID : valeurs réelles du projet (APK de test) ---
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyDEnyQGswuRUQc6CRRxV87m2Nc51GEBw5Y',
    appId: '1:460440111201:android:d1acaf32f56125206f0220',
    messagingSenderId: '460440111201',
    projectId: 'db-localisation-9cd9c',
    storageBucket: 'db-localisation-9cd9c.firebasestorage.app',
  );

  // --- WEB : reprend le projet (appId à remplacer par une vraie app web) ---
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyDEnyQGswuRUQc6CRRxV87m2Nc51GEBw5Y',
    appId: '1:460440111201:android:d1acaf32f56125206f0220',
    messagingSenderId: '460440111201',
    projectId: 'db-localisation-9cd9c',
    authDomain: 'db-localisation-9cd9c.firebaseapp.com',
    storageBucket: 'db-localisation-9cd9c.firebasestorage.app',
  );

  // --- iOS : reprend le projet (appId à remplacer par une vraie app iOS) ---
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDEnyQGswuRUQc6CRRxV87m2Nc51GEBw5Y',
    appId: '1:460440111201:android:d1acaf32f56125206f0220',
    messagingSenderId: '460440111201',
    projectId: 'db-localisation-9cd9c',
    storageBucket: 'db-localisation-9cd9c.firebasestorage.app',
    iosBundleId: 'com.dblocalisation.app',
  );
}
