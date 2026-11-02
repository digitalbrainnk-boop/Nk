# Questionnaire en ligne : « La grâce divine et la liberté humaine »

Petit site web pour l'enquête de terrain d'une thèse de doctorat en théologie (Ouagadougou).
Par confidentialité, le site n'affiche ni le nom du chercheur, ni celui du directeur de thèse, ni l'institution.
Les participants ouvrent un lien, répondent aux 37 questions sur leur téléphone, puis envoient
leurs réponses au chercheur. Une deuxième partie, « Mes documents », transforme un livre, un PDF ou
un fichier Word en lien de lecture.

## Les liens

- **Questionnaire, pour les participants** : https://digitalbrainnk-boop.github.io/Nk/
- **Espace chercheur** : https://digitalbrainnk-boop.github.io/Nk/#espace
  (partager le questionnaire, réponses reçues, Mes documents)

Le site est publié par GitHub Pages depuis la branche `gh-pages`. Après une modification du dossier `docs/`,
lancez `./publier-site.sh` : il recopie le site sur `gh-pages` en gardant les documents déposés (`d/`).

Une copie d'essai sur claude.ai existe aussi (`artefact/`, fabriquée par `python3 artefact/assembler.py`) ;
elle n'est pas utilisée.

## Ce que fait le site

**Pour le participant**
- Une page d'accueil avec la lettre d'introduction, puis les 7 parties, une par écran.
- Il coche ses réponses. À partir de la 2ᵉ partie, il peut cocher **plusieurs réponses**.
  « Je ne sais pas », « Sans opinion » et « Je ne comprends pas… » décochent les autres réponses.
- « Autre » ouvre une case pour préciser sa réponse. Les questions 33 à 37 se remplissent en texte libre.
- Les réponses s'enregistrent toutes seules sur le téléphone : on peut fermer la page et reprendre plus tard.
- S'il oublie une question, le site le signale, sans l'obliger à répondre.
- À la fin, il envoie ses réponses de la façon qu'il préfère :
  - **Envoyer par WhatsApp** : un message tout prêt avec le lien de ses réponses ;
  - **Télécharger en Word** : un fichier `.docx` avec toutes les questions et les cases cochées ☒ ;
  - **Copier le lien de ses réponses** : à coller dans un SMS, Messenger, Telegram…
  - envoi par e-mail, partage vers une autre messagerie, impression ou PDF.

**Pour le chercheur**
- En ouvrant un lien reçu, il voit toutes les réponses du participant et peut télécharger le fichier Word.
- **Réponses reçues** (dans l'espace chercheur, ou adresse du site suivie de `#chercheur`) :
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

## Mes documents : transformer un document en lien

Deuxième partie du site : page `documents.html` (onglet « Mes documents » de l'espace chercheur).

- Vous choisissez un ou plusieurs fichiers (livre PDF, Word, e-book EPUB, image, audio, vidéo…, jusqu'à
  50 Mo chacun) et vous pouvez changer le titre affiché.
- « Créer le lien » : le fichier est rangé dans votre dépôt GitHub (dossier `d/` de la branche `gh-pages`) et vous recevez un lien
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

## Si le lien affiche « 404 »

GitHub allume normalement le site tout seul quand la branche `gh-pages` existe. S'il ne l'a pas fait :
dépôt **Nk** → **Settings** → **Pages** → *Source* : *Deploy from a branch* → branche **gh-pages**, dossier
**/ (root)** → **Save**. Une seule fois.

## Réglages

Tout se règle en haut du fichier [`questionnaire.js`](questionnaire.js), dans `reglages` :

- `whatsapp` : votre numéro WhatsApp au format international, sans « + » ni espaces. Il est réglé sur
  `"22676634189"` : les participants vous écrivent directement. Vide : ils choisissent le contact.
- `email` : votre adresse e-mail pour le bouton « Envoyer par e-mail ».
- `lienDuSite` : l'adresse publique du questionnaire, si vous l'hébergez ailleurs que sur GitHub Pages.
- `depot` : le dépôt et la branche (`gh-pages`) où « Mes documents » range les fichiers.

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
