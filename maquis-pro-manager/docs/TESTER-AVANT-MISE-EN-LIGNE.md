# Tester l'application avant la mise en ligne

But : vérifier vous-même chaque fonction dans les conditions réelles (vrais téléphones, vrais rôles, vraie nuit avec le bilan de 03 h 00) **avant** de vendre l'application. Ce test ne demande aucun hébergeur payant.

## 1. Démarrer l'application de test

### Sur un téléphone Android (conseillé)

1. Installez **Termux** depuis F-Droid : https://f-droid.org/packages/com.termux/ (pas la version du Play Store).
2. Ouvrez Termux, collez cette ligne puis Entrée :
   ```
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-98ef2a93-v667hk/maquis-pro-manager/installer-android.sh | bash
   ```
3. Après l'installation (3 à 10 minutes), l'écran affiche :
   - l'adresse pour **ce téléphone** : `http://localhost:3100` ;
   - un **lien https** du type `https://xxxx.trycloudflare.com` pour **les autres téléphones**, l'iPhone et l'installation de l'application ;
   - le **code d'installation**, qui sert à créer le compte du propriétaire.
4. Les fois suivantes, ouvrez Termux et tapez `maquis`.

| Commande dans Termux | Effet |
|---|---|
| `maquis` | démarre l'application et le lien pour les autres téléphones |
| `maquis lien` | réaffiche le lien (il **change à chaque démarrage**) |
| `maquis code` | réaffiche le code d'installation |
| `maquis maj` | installe la dernière version corrigée (les données de test sont gardées) |
| `maquis arret` | arrête l'application |

Pour que le test dure toute la nuit :
- laissez Termux ouvert, le téléphone **branché** ;
- dans les réglages Android → Applications → Termux → Batterie, choisissez **« Sans restriction »** (sinon Android peut arrêter Termux la nuit).

### Sur un ordinateur Windows

1. Installez Node.js (version LTS) : https://nodejs.org/fr/download
2. Pour le lien des téléphones, installez cloudflared : dans *Invite de commandes*, tapez `winget install Cloudflare.cloudflared`.
3. Téléchargez le projet (*Code → Download ZIP* sur GitHub, branche `ccr-98ef2a93-v667hk`), décompressez-le, ouvrez le dossier `maquis-pro-manager` et double-cliquez sur **DEMARRER-TEST**.

### À savoir sur ce mode test

- Les données restent **sur le téléphone ou l'ordinateur de test** (dossier `maquis-donnees`).
- Le lien `trycloudflare.com` est gratuit et temporaire. Il change à chaque démarrage : une application installée sur un autre téléphone avec l'ancien lien doit être réinstallée avec le nouveau.
- Si le téléphone de test est éteint à 03 h 00, le bilan est produit dès le redémarrage de `maquis`. Ce cas est à tester aussi (voir 3.D).

## 2. Jouer les quatre rôles

L'idéal est d'avoir un appareil par rôle. Sinon, sur un même téléphone, chaque navigateur garde une connexion séparée :
- Chrome normal : le propriétaire ;
- Chrome en navigation privée : le gérant ;
- Firefox ou Samsung Internet : le caissier ;
- un deuxième téléphone : le serveur.

Faites au moins une partie du test sur un **iPhone** (Safari) : c'est là que les notifications et l'installation diffèrent le plus.

## 3. Liste de tests

Cochez au fur et à mesure. Notez tout ce qui ne va pas (voir 4.).

### A. Mise en place (propriétaire, puis gérant)

- [ ] Création du compte propriétaire avec le code d'installation.
- [ ] *Administration → Paramètres* : nom du maquis, logo, téléphone, message des reçus. Le logo apparaît sur un reçu PDF.
- [ ] *Administration → Comptes* : créer un gérant, un caissier, deux serveurs. À leur première connexion, chacun doit changer son mot de passe.
- [ ] Gérant : créer 2 fournisseurs et au moins 6 boissons dans 3 catégories, avec photo, prix et bouteilles par casier (12, 24…).
- [ ] Installer l'application sur l'écran d'accueil (Android : menu ⋮ → *Installer l'application* ; iPhone : *Partager → Sur l'écran d'accueil*), puis *Mon compte → Activer les notifications*.

### B. Journée de service

| N° | Action | Résultat attendu |
|---|---|---|
| 1 | Gérant : entrée de **10 casiers de 12** Brakina | Stock Brakina **+120**, reçu d'entrée créé, reste à payer correct |
| 2 | Caissier : ouvrir la caisse avec un fonds (ex. 10 000) | Caisse ouverte, solde théorique = fonds |
| 3 | Serveur : commande de 10 Brakina pour une table | La commande apparaît **tout de suite** chez le caissier |
| 4 | Caissier : encaisser en espèces, saisir le montant reçu | Monnaie à rendre correcte ; stock Brakina **−10** ; reçu de vente |
| 5 | Gérant : sortie « Cassée » de **3** Brakina | Stock −3 ; compté à part (pas dans les ventes) |
| 6 | Caissier : vente à crédit (client « Kouka »), puis paiement partiel, puis solde | Stock diminué dès la vente ; l'argent n'entre en caisse qu'aux paiements ; reçus de paiement |
| 7 | Caissier : vente payée moitié espèces, moitié Orange Money | Deux modes sur le reçu ; chaque mode compté à part dans la caisse |
| 8 | Caissier : dépense (glace), retrait (« remis au gérant »), ajout | Chaque opération a son reçu et change le solde théorique |
| 9 | Caissier : annuler une vente de sa caisse, avec motif | Stock remis, remboursement enregistré, document « rectificatif » ; le reçu d'origine reste intact |
| 10 | Serveur : *Mes ventes* | Ses ventes et bouteilles uniquement |
| 11 | Propriétaire : essayer de modifier quoi que ce soit | Impossible : aucune action de modification ne lui est proposée |
| 12 | Caissier : fermer la caisse en comptant **500 de moins** que prévu | Écart −500 affiché, reçu de clôture, **notification « Manquant en caisse »** au propriétaire |
| 13 | Ouvrir des reçus : *Télécharger*, *Imprimer*, *WhatsApp*, *E-mail* | PDF lisible ; impression au format ticket ; partage vers WhatsApp |
| 14 | *Reçus* : chercher par numéro, par boisson, par nom | Les bons reçus sont trouvés |
| 15 | Gérant : inventaire, compter une boisson avec un écart | Validation refusée sans justification ; acceptée avec ; stock ajusté ; propriétaire prévenu |

### C. Sans internet

- [ ] Sur le téléphone du **serveur**, coupez internet (mode avion) et passez une commande : la pastille « Hors ligne · 1 » apparaît.
- [ ] Fermez puis rouvrez l'application, toujours sans internet : elle s'ouvre et affiche les boissons.
- [ ] Rallumez internet : la commande part toute seule et arrive **une seule fois** chez le caissier.
- [ ] Même essai avec une vente du **caissier** (caisse ouverte avant de couper internet).

### D. Bilans automatiques

- [ ] Avant 03 h 00 : *Rapports → Voir la journée en cours* puis **PDF de l'aperçu**. Vérifiez les quantités par marque, les pertes, la caisse.
- [ ] Le lendemain matin : le **bilan quotidien** de la veille est là, produit à 03 h 00 (« Généré automatiquement »), avec une notification au propriétaire et au gérant.
- [ ] Vérifiez que le bilan compte bien : bouteilles vendues + cassées + offertes = total des sorties, et les ventes par serveur.
- [ ] **Panne** : arrêtez l'application une nuit (`maquis arret`) et relancez-la le matin (`maquis`). Le bilan manquant doit être produit au démarrage (« Produit à la reprise du serveur »).
- [ ] Le **lundi** : le bilan hebdomadaire de la semaine précédente, en PDF et en Excel. Avant le lundi, *Voir la semaine en cours* donne un aperçu.
- [ ] Bilan rectificatif : annulez une vente de la veille (gérant). Quelques minutes après, une **version 2** du bilan de la veille apparaît, et la version 1 reste consultable.

### E. Sécurité

- [ ] 5 mauvais mots de passe : la connexion est bloquée un moment et le propriétaire reçoit une alerte.
- [ ] Connexion du gérant sur un **nouvel appareil** : le propriétaire est prévenu.
- [ ] *Administration → Appareils connectés* : déconnecter le téléphone d'un serveur ; il doit se reconnecter.
- [ ] Bloquer un compte : la personne ne peut plus se connecter.
- [ ] *Journal d'audit → Vérifier l'intégrité* : « Journal intact ».
- [ ] *Administration → Sauvegardes* : *Sauvegarder maintenant*, puis télécharger le fichier.

## 4. Signaler un problème

Pour chaque problème, envoyez-moi :
1. **Qui** (propriétaire, gérant, caissier, serveur) et **sur quel téléphone** (Android / iPhone, navigateur).
2. **Ce que vous avez fait**, étape par étape.
3. **Ce que vous attendiez** et **ce qui s'est passé**, avec une **capture d'écran**.
4. Si l'application affiche « Erreur interne », les dernières lignes du journal : dans Termux, `tail -40 ~/maquis-donnees/serveur.log`.

Je corrige, puis vous tapez `maquis maj` pour récupérer la correction sans perdre vos données de test.

## 5. Après le test

Les données de test **ne vont pas** en ligne : l'installation sur l'hébergeur définitif part d'une base vide (voir [INSTALLATION.md](INSTALLATION.md)). Pour recommencer un test à zéro sur le téléphone :
```
maquis arret
rm -rf ~/maquis-donnees
maquis
```
