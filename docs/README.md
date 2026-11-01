# Questionnaire en ligne : « La grâce divine et la liberté humaine »

Petite application pour l'enquête de terrain de la thèse de SAWADOGO Bouraïma (EMGJ, Ouagadougou).
Les participants ouvrent un lien, répondent aux 37 questions sur leur téléphone, puis envoient
leurs réponses au chercheur.

## Ce que fait l'application

**Pour le participant**
- Une page d'accueil avec la lettre d'introduction, puis les 7 parties, une par écran.
- Il coche ses réponses. À partir de la 2ᵉ partie, il peut cocher **plusieurs réponses**.
  « Je ne sais pas », « Sans opinion » et « Je ne comprends pas… » décochent les autres réponses.
- « Autre » ouvre une case pour préciser sa réponse. Les questions 33 à 37 se remplissent en texte libre.
- Les réponses s'enregistrent toutes seules sur le téléphone : on peut fermer la page et reprendre plus tard.
- S'il oublie une question, l'application le signale, sans l'obliger à répondre.
- À la fin, il envoie ses réponses de la façon qu'il préfère :
  - **Envoyer par WhatsApp** : un message tout prêt avec le lien de ses réponses ;
  - **Télécharger en Word** : un fichier `.docx` avec toutes les questions et les cases cochées ☒ ;
  - **Copier le lien de ses réponses** : à coller dans un SMS, Messenger, Telegram…
  - envoi par e-mail, partage vers une autre application, impression ou PDF.

**Pour le chercheur**
- En ouvrant un lien reçu, il voit toutes les réponses du participant et peut télécharger le fichier Word.
- **Espace chercheur** (lien en bas de la page d'accueil, ou adresse du site suivie de `#chercheur`) :
  - collez les liens reçus, un ou plusieurs à la fois, ou importez une discussion WhatsApp exportée
    (« Exporter la discussion » → « Sans médias ») : tous les liens qu'elle contient sont ajoutés d'un coup ;
  - compteurs : participants sur 100, catholiques sur 50, protestants sur 50 ;
  - **résultats par question** en pourcentages : ensemble, catholiques, protestants ;
  - toutes les réponses écrites (questions 33 à 37 et les « Autre ») regroupées par question ;
  - **Exporter vers Excel (.csv)** : une ligne par participant ;
  - **Sauvegarder les liens (.txt)** : un fichier à garder, qu'on réimporte avec « Importer un fichier .txt ».
- Si vous faites remplir le questionnaire à plusieurs personnes sur votre propre téléphone, utilisez à la fin
  « Enregistrer et passer au participant suivant ».

Le tableau de l'espace chercheur reste dans le navigateur où vous l'avez rempli. Gardez une sauvegarde
(.txt ou .csv) et les messages reçus.

## Mettre le questionnaire en ligne (gratuit, une seule fois)

1. Sur GitHub, ouvrez le dépôt **Nk** → **Settings** (Paramètres) → **Pages**.
2. Sous *Build and deployment*, **Source** : *Deploy from a branch*.
3. **Branch** : choisissez `claude/theology-survey-app-sqz80q`, puis le dossier `/docs`, et cliquez **Save**.
4. Après une ou deux minutes, le questionnaire est en ligne à l'adresse :
   **https://digitalbrainnk-boop.github.io/Nk/**

C'est ce lien que vous envoyez aux participants (WhatsApp, groupes d'église, SMS…).

Autre possibilité : déposer le contenu de ce dossier `docs` sur n'importe quel hébergement (par exemple
dans un sous-dossier de votre hébergement o2switch). Il n'y a ni base de données ni serveur à installer.

## Réglages

Tout se règle en haut du fichier [`questionnaire.js`](questionnaire.js), dans `reglages` :

- `whatsapp` : votre numéro WhatsApp au format international, sans « + » ni espaces
  (exemple : `"22670123456"`). Les participants vous écrivent alors directement. Vide : ils choisissent le contact.
- `email` : votre adresse e-mail pour le bouton « Envoyer par e-mail ».
- `lienDuSite` : l'adresse publique du questionnaire, si vous l'hébergez ailleurs que sur GitHub Pages.

Les questions, les choix de réponse et les textes d'introduction se modifient dans ce même fichier.
Pour qu'une question n'accepte qu'**une seule réponse**, ajoutez-lui `multiple: false`. Ne changez pas les numéros
des questions une fois l'enquête commencée : les liens déjà reçus s'appuient sur eux.

## Confidentialité

- Le questionnaire ne demande ni nom ni numéro : chaque participant reçoit seulement un code (exemple : `PZUBMR`).
- Les réponses ne sont envoyées à aucun serveur. Elles restent sur le téléphone du participant jusqu'à ce qu'il
  les envoie lui-même. Le lien contient les réponses, compressées, après le signe `#`. Cette partie de l'adresse
  n'est jamais transmise à l'hébergeur.
- Toute personne qui a un lien de réponses peut lire ces réponses. Ne publiez donc pas ces liens.
