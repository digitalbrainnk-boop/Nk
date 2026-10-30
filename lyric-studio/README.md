# 🎤 Lyric Studio — vidéos lyriques et karaoké synchronisés mot par mot

Une application web pour créer des **vidéos lyriques** (voix gardée) et des **vidéos karaoké** (voix retirée) :
tu importes une chanson, le studio récupère les paroles, les **synchronise mot par mot** avec le son, te laisse
tout personnaliser, puis exporte une vidéo **MP4 en 720p, 1080p ou 4K**.

## Démarrer

Il faut **Node.js 22.13 ou plus récent**.

```bash
cd lyric-studio
npm install
npm start
```

Ouvre **http://localhost:3500** (de préférence dans **Chrome** ou **Edge** : ils créent les MP4 eux-mêmes, très vite).

Facultatif mais utile :

| Outil | À quoi il sert | Installation |
| --- | --- | --- |
| **ffmpeg** | lire les vidéos MKV/MOV, terminer l'export quand le navigateur ne sait pas encoder le son ou le H.264 | `sudo apt install ffmpeg`, `brew install ffmpeg`, Termux : `pkg install ffmpeg` |
| **Demucs** | séparer la voix et l'instrumental sur ton ordinateur (gratuit, excellente qualité) | `pip install demucs` |

## Comment ça marche

1. **Import** : fichier audio (MP3, WAV, FLAC, AAC, M4A, OGG) ou vidéo (MP4, MOV, MKV, WEBM). Une vidéo importée
   devient le fond (son coupé), le son sert à la synchro. Ou **chanson Suno** (Kie.ai) : son, pochette, paroles et
   minutage exact récupérés directement.
2. **Paroles** : colle-les (une ligne par ligne à l'écran, ligne vide entre les couplets). Sans paroles, **l'IA les
   écoute et les écrit**.
3. **Synchronisation automatique** (bouton ✨) au choix :
   - **Suno** : paroles horodatées de Suno (gratuit, parfait pour les chansons Suno) ;
   - **IA** : ElevenLabs Scribe ou Whisper (Groq gratuit, OpenAI) écoute la chanson — de préférence la **voix
     séparée** — et donne l'heure de chaque mot ; tes paroles sont ensuite **calées mot par mot** dessus (alignement
     tolérant aux mots mal entendus, en trop ou manquants ; les mots incertains sont encadrés en orange) ;
   - **Sans IA** : les lignes sont réparties sur les passages où la voix est détectée (approximatif, à retoucher) ;
   - **À la main** : tu tapes Espace (ou le gros bouton TAP) au début de chaque ligne, ou tu gardes la touche
     enfoncée pendant chaque mot.
4. **Studio** : tout se règle en direct sur l'aperçu.
5. **Export** MP4 720p / 1080p / 4K, 24 à 60 images/s, chanson entière ou extrait (TikTok, Reels, Statut).

## Le studio

- **Frise** (en bas) : forme d'onde (mixage ou voix seule), lignes et mots. Glisse un mot pour le déplacer, ses bords
  pour changer début et fin, une ligne (bande de couleur) pour la déplacer en entier. Ctrl + molette : zoom.
- **Paroles** (à gauche) : clique un mot pour l'écouter, double-clic pour le corriger ; ✂ coupe la ligne avant le mot
  sélectionné, ⤓ fusionne avec la suivante ; **Découper** coupe toutes les lignes trop longues ; **Décaler** avance ou
  retarde toutes les paroles ; onglet **Texte** pour retoucher le texte brut (le timing des mots inchangés est gardé).
- **Style** (à droite) : préréglages (Karaoké classique, Néon, Minimal, Story 9:16, Romance, Pochette), format
  16:9 / 9:16 / 1:1 / 4:5, **police** (30+ Google Fonts, polices de l'ordinateur ou ta propre police TTF/OTF/WOFF),
  taille, MAJUSCULES, couleurs (texte, chanté, contour, ombre/lueur), effet de chant (remplissage progressif, mot par
  mot, ligne, aucun), affichage (une ligne, alterné, par page, défilement), position et alignement, animation
  d'apparition, **fond** (couleur, dégradé, image avec zoom lent, vidéo ; flou, assombrissement), **image ou vidéo en
  haut** (taille, position, forme carrée / arrondie / ronde, bordure), **mode duo**, titre d'intro et compte à rebours.
- **Mode duo** : `A:`, `B:` ou `AB:` en début de ligne (ou `[Refrain - B]`), ou clic sur la pastille d'une ligne.
  Chaque chanteur a sa couleur et son alignement.
- **Karaoké** : la voix est retirée avec la voix séparée (Demucs, Suno ou tes propres pistes via le menu 🎚 Son) ;
  sans séparation, ce qui est au centre du stéréo est retiré (les basses sont gardées). Réglage **voix guide** pour
  garder un peu de voix.
- Raccourcis : **Espace** lecture/pause · **←/→** déplacer le mot sélectionné de 10 ms (Maj : 100 ms) · **[ et ]**
  début / fin du mot à la position de lecture · **Tab** mot suivant · **Ctrl+Z / Ctrl+Maj+Z** annuler / rétablir.
- Enregistrement automatique ; les exports peuvent être gardés dans le projet pour les retélécharger.

## Clés des services d'IA (⚙ Réglages)

Une seule suffit pour la synchro par IA :

- **Groq** (gratuit) : https://console.groq.com/keys — Whisper large v3, minutage des mots.
- **OpenAI** : adresse `https://api.openai.com/v1/audio/transcriptions`, modèle `whisper-1`.
- **ElevenLabs** : Scribe, le plus précis sur le chant.
- **Kie.ai** : import des chansons Suno (paroles horodatées) et séparation de la voix par Suno.

Les clés restent sur le serveur (fichier `data/settings.json`) et ne sont jamais renvoyées au navigateur.
On peut aussi les mettre dans `.env` (voir `.env.example`).

## Export : comment la vidéo est fabriquée

L'aperçu et l'export utilisent **le même moteur de rendu** (ce que tu vois est ce que tu obtiens). L'export est calculé
image par image dans le navigateur (WebCodecs), donc plus vite que le temps réel, puis assemblé en MP4 :

1. Chrome / Edge / Safari récents : **H.264 + AAC** directement dans le navigateur ;
2. son AAC non disponible (Chromium, certains Linux) : la vidéo est envoyée au serveur, **ffmpeg** ajoute le son ;
3. H.264 non disponible : vidéo VP9/AV1, convertie en H.264 par ffmpeg ;
4. sans WebCodecs (vieux navigateurs) : enregistrement en temps réel, converti par ffmpeg.

Les très longs exports 4K ne restent pas entiers en mémoire : le fichier est écrit par morceaux. Un fond vidéo
rallonge l'export (chaque image de la vidéo est recherchée exactement) ; une image ou un dégradé est le plus rapide.

## Hébergement

Par défaut le studio n'écoute que sur l'ordinateur (`127.0.0.1`), sans mot de passe. Pour l'ouvrir au réseau ou
l'héberger : `HOST=0.0.0.0` et `STUDIO_PASSWORD=…` (un mot de passe est créé et affiché au démarrage si tu n'en mets
pas). Les projets sont dans `data/` (ou `DATA_DIR`).

## Tests

```bash
npm test
```

Paroles, alignement mot par mot, affichage, traitement du son, rendu, API, import Suno, transcription (services
simulés), séparation, export avec ffmpeg et mot de passe.

## Organisation du code

```
src/                 serveur (Express)
  app.js             API : projets, médias (lecture par morceaux), IA, séparation, exports
  store.js           projets sur le disque (data/projects/<id>/project.json + fichiers)
  transcribe.js      Whisper (Groq/OpenAI) et ElevenLabs Scribe : mots minutés
  suno.js            Kie.ai : morceau, paroles horodatées, séparation de la voix
  stems.js           Demucs sur l'ordinateur
  ffmpeg.js          extraction du son, assemblage et conversion des exports
public/js/core/      code partagé navigateur + tests
  lyrics.js          texte <-> lignes, duo, découpe des lignes longues
  align.js           synchronisation mot par mot (alignement de séquences, voix détectée)
  timing.js          quelles lignes à l'écran, quand et où
  render.js          dessin d'une image (aperçu et export)
  dsp.js             forme d'onde, détection de la voix, voix retirée au centre, WAV
  style.js           styles, préréglages, polices, résolutions
public/js/           interface : studio, frise, paroles, style, synchro, export
```
