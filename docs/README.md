# Questionnaire en ligne : « La grâce divine et la liberté humaine »

Petite application pour l'enquête de terrain de la thèse de SAWADOGO Bouraïma (EMGJ, Ouagadougou).
Les participants ouvrent un lien, répondent aux 37 questions sur leur téléphone, puis envoient
leurs réponses au chercheur. Une deuxième partie, « Mes documents », transforme un livre, un PDF ou
un fichier Word en lien de lecture.

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
- **Réponses reçues** (dans l'application, ou adresse du site suivie de `#chercheur`) :
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

## L'application sur le téléphone du chercheur

Envoyez au chercheur ce lien : **https://digitalbrainnk-boop.github.io/Nk/#appli**

Il ouvre son espace avec un bouton **« Installer l'application »** (sur iPhone, les 3 étapes s'affichent).
L'application « Enquête grâce » s'ajoute alors sur l'écran d'accueil, s'ouvre en plein écran et marche
même sans connexion pour les pages déjà ouvertes. À l'ouverture, il trouve :
- **Partager le questionnaire** : le lien pour les participants, avec un message tout prêt pour WhatsApp ;
- **Réponses reçues** : le tableau, les résultats et l'export Excel ;
- **Mes documents** : transformer un livre ou un PDF en lien ;
- **Voir le questionnaire** tel que les participants le voient.

Les participants, eux, reçoivent seulement le lien du questionnaire (https://digitalbrainnk-boop.github.io/Nk/) :
ils n'ont rien à installer.

Sur iPhone, l'application installée garde ses propres données, séparées de Safari : utilisez toujours
l'application pour le tableau des réponses.

## Mes documents : transformer un document en lien

Deuxième partie de l'application : page `documents.html` (lien « Mes documents » en bas de l'accueil
et dans l'espace chercheur).

- Vous choisissez un ou plusieurs fichiers (livre PDF, Word, e-book EPUB, image, audio, vidéo…, jusqu'à
  50 Mo chacun) et vous pouvez changer le titre affiché.
- « Créer le lien » : le fichier est rangé dans votre dépôt GitHub (dossier `docs/d/`) et vous recevez un lien
  du type `https://digitalbrainnk-boop.github.io/Nk/d/mon-livre-k7p2/`, avec boutons Copier et WhatsApp.
- La personne qui ouvre le lien lit le document en entier dans son navigateur, sans rien installer :
  - **PDF** : toutes les pages, avec zoom et « aller à la page » ;
  - **Word (.docx)** : texte mis en page pour le téléphone (et lien vers la mise en page d'origine) ;
  - **EPUB** : lecture page par page, avec la liste des chapitres ;
  - images, textes, audio et vidéo s'affichent directement ;
  - les autres fichiers (PowerPoint, Excel, ancien .doc…) s'ouvrent avec la visionneuse Microsoft ou se téléchargent.
  Un bouton « Télécharger » est toujours là.
- La liste « Documents en ligne » permet de recopier un lien ou de supprimer un document (le lien ne marche plus).
- Le lien fonctionne 1 à 2 minutes après sa création, le temps que GitHub publie le fichier.

**Première utilisation : la clé GitHub.** Pour déposer les fichiers dans votre dépôt, la page a besoin d'une clé
d'accès GitHub. Les étapes sont affichées sur la page :
1. ouvrez https://github.com/settings/personal-access-tokens/new ;
2. *Token name* : « Mes documents », *Expiration* : une longue durée ;
3. *Repository access* : *Only select repositories* → **Nk** ;
4. *Permissions* → *Repository permissions* → **Contents : Read and write** ;
5. *Generate token*, copiez la clé (`github_pat_…`) et collez-la dans la page.

La clé reste dans le navigateur de l'appareil où vous l'avez collée. Ne la donnez à personne.
« Se déconnecter » l'efface de l'appareil.

Attention : le dépôt est public. Toute personne qui a le lien peut lire le document, et les fichiers sont visibles
sur GitHub. Ne mettez pas en ligne de documents confidentiels. GitHub accepte environ 1 Go de fichiers au total.

## Mettre le questionnaire en ligne (gratuit, une seule fois)

1. Sur GitHub, ouvrez le dépôt **Nk** → **Settings** (Paramètres) → **Pages**.
2. Sous *Build and deployment*, **Source** : *Deploy from a branch*.
3. **Branch** : choisissez `claude/theology-survey-app-sqz80q`, puis le dossier `/docs`, et cliquez **Save**.
4. Après une ou deux minutes, le questionnaire est en ligne à l'adresse :
   **https://digitalbrainnk-boop.github.io/Nk/**

C'est ce lien que vous envoyez aux participants (WhatsApp, groupes d'église, SMS…).
« Mes documents » a besoin de ce réglage pour publier les fichiers.

Autre possibilité : déposer le contenu de ce dossier `docs` sur n'importe quel hébergement (par exemple
dans un sous-dossier de votre hébergement o2switch). Il n'y a ni base de données ni serveur à installer.

## Réglages

Tout se règle en haut du fichier [`questionnaire.js`](questionnaire.js), dans `reglages` :

- `whatsapp` : votre numéro WhatsApp au format international, sans « + » ni espaces. Il est réglé sur
  `"22676634189"` : les participants vous écrivent directement. Vide : ils choisissent le contact.
- `email` : votre adresse e-mail pour le bouton « Envoyer par e-mail ».
- `lienDuSite` : l'adresse publique du questionnaire, si vous l'hébergez ailleurs que sur GitHub Pages.
- `depot` : le dépôt, la branche et le dossier où « Mes documents » range les fichiers. Ils doivent correspondre
  au réglage de GitHub Pages.

Les questions, les choix de réponse et les textes d'introduction se modifient dans ce même fichier.
Pour qu'une question n'accepte qu'**une seule réponse**, ajoutez-lui `multiple: false`. Ne changez pas les numéros
des questions une fois l'enquête commencée : les liens déjà reçus s'appuient sur eux.

## Confidentialité

- Le questionnaire ne demande ni nom ni numéro : chaque participant reçoit seulement un code (exemple : `PZUBMR`).
- Les réponses ne sont envoyées à aucun serveur. Elles restent sur le téléphone du participant jusqu'à ce qu'il
  les envoie lui-même. Le lien contient les réponses, compressées, après le signe `#`. Cette partie de l'adresse
  n'est jamais transmise à l'hébergeur.
- Toute personne qui a un lien de réponses peut lire ces réponses. Ne publiez donc pas ces liens.

## Bibliothèques incluses

Le dossier `vendor/` contient les outils de lecture, servis avec le site pour fonctionner sans service extérieur :
PDF.js 3.11.174 (Mozilla, licence Apache 2.0), mammoth 1.8.0 (licence BSD-2), epub.js 0.3.93 (licence BSD-2)
et JSZip 3.10.1 (licence MIT). Leurs licences sont à côté de chaque fichier.
