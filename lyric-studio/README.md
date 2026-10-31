# 🎤 Africa Lyrics — vidéos lyriques et karaoké synchronisées mot par mot

Une application web **commercialisable** (comptes clients, formules payantes, espace administrateur) pour créer des
**vidéos lyriques** (voix gardée) et des **vidéos karaoké** (voix retirée) : le client importe une chanson, le studio
récupère les paroles, les **synchronise mot par mot**, laisse **tout personnaliser**, puis exporte une vidéo **MP4
720p, 1080p ou 4K**. Elle s'installe sur Android comme une application.

- **Tester tout de suite** : `cd lyric-studio && npm install && npm start`, puis http://localhost:3500
  (le premier compte créé devient administrateur).
- **Mettre en ligne avec ton nom de domaine, publier l'application Android** : voir [DEPLOIEMENT.md](DEPLOIEMENT.md).
  Chez **o2switch**, une seule commande dans le Terminal de cPanel installe tout (le paquet est préparé
  automatiquement par GitHub).

Il faut **Node.js 22.13 ou plus récent**. Facultatif : **ffmpeg** (vidéos MKV/MOV, finition des exports) et
**Demucs** (`pip install demucs`, séparation de la voix par IA).

## Pour les clients

- **Inscription / connexion** par e-mail, chacun ne voit que ses projets.
- **Import** : audio (MP3, WAV, FLAC, AAC, M4A, OGG) ou vidéo (MP4, MOV, MKV, WEBM : la vidéo devient le fond).
- **Synchronisation automatique** (bouton ✨) :
  - **IA** (ElevenLabs Scribe ou Whisper Groq/OpenAI) : les paroles collées sont calées mot par mot (alignement
    tolérant aux mots mal entendus, en trop ou manquants ; les mots incertains sont encadrés en orange) ; sans
    paroles, l'IA les écrit ;
  - **sans IA** : répartition sur les passages où la voix est détectée ;
  - **à la main** : Espace (ou le bouton TAP) au début de chaque ligne, ou maintenu pendant chaque mot.
- **Frise** : forme d'onde, mots et lignes déplaçables à la souris ou au doigt, zoom.
- **Paroles** : correction d'un mot, découpe / fusion des lignes, découpe automatique des lignes trop longues,
  décalage global, duo (`A:`, `B:`, `AB:`).
- **Contrôle total du style** (chaque section se remet par défaut d'un clic) :
  - police (70 Google Fonts classées, polices de l'appareil, ou police envoyée TTF/OTF/WOFF), épaisseur, italique,
    taille, casse (MAJUSCULES, minuscules, Initiales), espacement des lettres et des mots, interligne ;
  - couleurs du texte à chanter et chanté, opacités, dégradé sur le texte chanté, lignes passées et à venir ;
  - effet de chant : remplissage progressif, mot par mot, mot qui saute, mot qui grossit, mot qui brille,
    soulignement, ligne entière, aucun ; lueur réglable ;
  - contour (et contour du texte chanté), ombre (flou, force, décalages) ;
  - bandeau derrière le texte (ou pleine largeur), couleur, opacité, marges, arrondi ;
  - mise en page : une ligne, alterné (karaoké), par page, défilement ; nombre de lignes, position, décalage,
    alignement, marges, largeur maximale, espace entre les lignes ;
  - animation d'apparition (fondu, glissements, zoom, chute avec rebond, flou, machine à écrire), durées des
    fondus, avance et maintien des lignes ;
  - fond : couleur, dégradé 2 ou 3 couleurs (linéaire, circulaire, qui tourne), image (zoom lent), vidéo ; flou,
    luminosité, saturation, assombrissement, teinte, vignette ;
  - effets : particules (bokeh, neige, étoiles, paillettes, cœurs, braises), visualiseur de musique (barres,
    miroir, onde, cercle autour de la pochette), fond qui pulse avec les basses, barre de progression ;
  - image ou vidéo en haut (taille, position, forme, bordure, ombre, rotation vinyle, pulsation) ;
  - logo du client dans un coin ; duo (couleurs, côtés, noms affichés) ; titre de début ; message de fin ;
  - 9 préréglages et **« Mes styles »** : enregistrer ses réglages et les réappliquer à d'autres vidéos.
- **Export** MP4 720p / 1080p / 4K, 24 à 60 images/s, chanson entière ou extrait (TikTok, Reels, Statut).
- **Mon compte** : formule, consommation du mois, demande d'abonnement avec référence de paiement Mobile Money,
  profil, mot de passe, suppression du compte et de toutes ses données.

## Pour toi (administrateur)

- **Tableau de bord** : clients, abonnés payants, demandes à vérifier, projets, exports et minutes d'IA du mois.
- **Demandes** : le client paie, envoie la référence ; tu cliques « ✓ Paiement reçu » et sa formule est activée.
- **Clients** : formule et date de fin, prolongation en un clic, suspension, mot de passe provisoire, suppression.
- **Formules et prix** : nom, prix, période, projets, durée des chansons, minutes d'IA, exports, stockage, qualité
  maximale, filigrane, voix séparée, import Suno ; ajout de formules.
- **Site et IA** : nom de l'application, slogan, WhatsApp et e-mail du support, texte de paiement, inscriptions
  ouvertes ou non, clés des services d'IA (partagées par tous les clients, limitées par les quotas), conditions
  d'utilisation et politique de confidentialité, application Android.

Formules par défaut (modifiables) : **Gratuit** (3 projets, 10 min d'IA par mois, 720p avec filigrane),
**Pro** (sans filigrane, 1080p, voix séparée par IA), **Studio** (4K, import Suno, gros volumes).

## Application Android

L'application est une **PWA** : depuis le site, « 📲 Installer l'application » l'ajoute aux applications du
téléphone (plein écran, mise à jour automatique). Pour un fichier **APK** ou le **Play Store**, voir
[DEPLOIEMENT.md](DEPLOIEMENT.md) (PWABuilder ou Bubblewrap, puis nom du paquet et empreinte dans l'administration).

## Export : comment la vidéo est fabriquée

L'aperçu et l'export utilisent **le même moteur de rendu** : ce que tu vois est ce que tu obtiens. L'export est
calculé image par image dans l'appareil du client (WebCodecs), plus vite que le temps réel, puis assemblé en MP4 :

1. Chrome (Android, Windows, Mac), Edge, Safari récents : **H.264 + AAC** directement dans le navigateur ;
2. son AAC non disponible (Chrome sur Linux) : le serveur ajoute le son avec **ffmpeg** ;
3. H.264 non disponible : vidéo VP9/AV1, convertie en H.264 par ffmpeg ;
4. sans WebCodecs : enregistrement en temps réel, converti par ffmpeg.

Les longs exports 4K sont écrits par morceaux (pas tout en mémoire). Un fond vidéo rallonge l'export (chaque image
est recherchée exactement) ; une image ou un dégradé est le plus rapide.

## Sécurité

Mots de passe chiffrés (scrypt), sessions par cookie `HttpOnly` / `SameSite`, limitation des essais de connexion,
chaque projet et chaque fichier vérifiés au nom de son propriétaire, clés d'IA jamais envoyées au navigateur,
en-têtes de sécurité (CSP…). Les limites des formules sont contrôlées par le serveur (projets, stockage, durée,
minutes d'IA, séparation de voix, nombre et qualité des exports). Le filigrane est ajouté par l'appareil du client
au moment du rendu.

## Tests

```bash
npm test
```

Paroles, alignement mot par mot, affichage, son (FFT, détection de voix), rendu de tous les effets, comptes et
sessions, isolement des clients, quotas des formules, demandes d'abonnement, administration, styles enregistrés,
transcription (services simulés), import Suno, export avec ffmpeg, application installable.

## Organisation du code

```
src/                 serveur (Express)
  app.js             API : comptes, projets, médias, IA, séparation, exports, administration, PWA
  accounts.js        comptes, sessions, formules et quotas, styles enregistrés, demandes d'abonnement
  db.js              base SQLite (comptes, consommation, index des projets…)
  settings.js        réglages du site et clés d'IA
  store.js           projets sur le disque (data/projects/<id>/project.json + fichiers)
  transcribe.js      Whisper (Groq/OpenAI) et ElevenLabs Scribe : mots minutés
  suno.js            Kie.ai : morceau, paroles horodatées, séparation de la voix
  stems.js           Demucs (avec file d'attente)
  ffmpeg.js          extraction du son, assemblage et conversion des exports
public/js/core/      code partagé navigateur + tests (paroles, synchro, affichage, rendu, son, styles)
public/js/           interface : accueil, compte, administration, studio, frise, paroles, style, export
public/sw.js         service worker (application installable)
Dockerfile, docker-compose.yml, Caddyfile, render.yaml   mise en ligne (voir DEPLOIEMENT.md)
```
