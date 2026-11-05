# MAQUIS PRO MANAGER

Application de gestion d'un maquis : stocks, entrées et sorties de boissons, commandes des serveurs, ventes, caisse, reçus PDF, bilans automatiques à 03 h 00 (heure du Burkina Faso), notifications et journal d'audit.

- **Une seule application** pour Android, iPhone, iPad et ordinateur. Elle s'ouvre dans le navigateur et s'installe sur l'écran d'accueil comme une application (PWA).
- **Un serveur** qui garde toutes les données dans une base sécurisée, synchronisée entre tous les appareils autorisés.
- **Langue** : français. **Devise** : FCFA. **Fuseau** : Africa/Ouagadougou. **Journée commerciale** : de 03 h 00 à 02 h 59 min 59 s le lendemain.

## Ce qui est réellement opérationnel

| Exigence du cahier des charges | État |
|---|---|
| 4 comptes : propriétaire (lecture seule), gérant, caissier, serveur | ✅ Droits vérifiés **côté serveur** à chaque requête |
| Catalogue complet (catégories, marques, photo, référence, prix, casier, stock min., fournisseur, valeur du stock) | ✅ |
| Entrées en casiers + bouteilles, calcul automatique, reçu PDF, reste à payer | ✅ |
| Sorties différenciées : vendues, offertes, personnel, cassées, perdues, périmées, autres | ✅ Une vente n'est jamais comptée deux fois |
| **Bilan quotidien à 03 h 00** par marque, par catégorie, par serveur, pertes, analyse, PDF | ✅ Produit par le serveur, avec reprise automatique après une panne |
| **Bilan hebdomadaire le lundi à 03 h 00** avec comparaison, graphiques, PDF et Excel | ✅ |
| Caisse : fonds, ventes, paiements partiels, crédits, dépenses, retraits, ajouts, remboursements, solde théorique / physique / écart | ✅ Calcul pour chaque mode de paiement (Espèces, Orange Money, Moov Money, Wave…) |
| Reçus numérotés : téléchargement PDF, impression (ticket 80 mm ou A4), partage WhatsApp et e-mail, historique et recherche | ✅ Un reçu émis n'est jamais modifié ; une correction crée un document rectificatif |
| Stock calculé (STOCK INITIAL + ENTRÉES − SORTIES), alertes, inventaires avec écarts justifiés | ✅ |
| Tableau de bord du propriétaire, période au choix, graphiques | ✅ |
| Sécurité : mots de passe chiffrés, sessions, déconnexion automatique, appareils, historique des connexions, journal d'audit infalsifiable, sauvegardes | ✅ |
| Notifications (entrée, sortie, vente, dépense, écart, stock faible, rupture, clôture, bilans, connexion inhabituelle…) | ✅ Dans l'application et en push |
| Fournisseurs, dettes, paiements, consignes et casiers | ✅ |
| Fonctionnement hors connexion avec synchronisation sans doublon | ✅ Testé dans un vrai navigateur |

## Démarrage rapide (ordinateur ou serveur)

Il faut **Node.js 22.16 ou plus récent**.

```bash
cd maquis-pro-manager
npm install
npm start
```

Ouvrez http://localhost:3000. Au premier démarrage, le serveur affiche un **code d'installation**, également écrit dans `data/CODE-INSTALLATION.txt`. Saisissez-le pour créer le compte du propriétaire.

Mise en ligne (o2switch, serveur Docker) et tâche planifiée de 03 h 00 : voir [docs/INSTALLATION.md](docs/INSTALLATION.md).

## Tests

```bash
npm test
```

24 tests automatiques sur un vrai serveur et une vraie base. Ils couvrent les 18 tests obligatoires du cahier des charges (scénario d'une semaine dans un maquis : entrées, ventes, casses, crédits, caisse, reçus, permissions, bilans de 03 h 00 et du lundi, hors connexion, sauvegarde et restauration), ainsi que la sécurité. Le détail est dans [docs/DOCUMENTATION-TECHNIQUE.md](docs/DOCUMENTATION-TECHNIQUE.md#tests).

## Documentation

- [Guide d'utilisation](docs/GUIDE-UTILISATION.md) : propriétaire, gérant, caissier, serveur.
- [Installation et mise en ligne](docs/INSTALLATION.md).
- [Documentation technique](docs/DOCUMENTATION-TECHNIQUE.md) : architecture, règles de calcul, sécurité, API.

## Choix techniques et limites (à connaître)

Le cahier des charges recommandait Flutter, Next.js, NestJS et PostgreSQL. L'application a été construite avec **Node.js + Express + SQLite + une application web installable (PWA)** :

- **une seule application** au lieu de trois (Android, iPhone, Web), donc moins de risques d'écarts entre les versions ;
- elle fonctionne sur un **hébergement simple** comme o2switch, sans boutique d'applications ;
- SQLite tient dans un seul fichier, facile à sauvegarder. Il convient à un établissement. Pour gérer plusieurs maquis sur un même serveur, il faudra passer à PostgreSQL : toutes les requêtes sont en SQL standard.

Limites actuelles :

- l'application ne se trouve pas sur le Play Store ni l'App Store : elle s'installe depuis le navigateur (« Installer l'application » sur Android, « Sur l'écran d'accueil » sur iPhone) ;
- sur **iPhone**, les notifications push demandent **iOS 16.4 ou plus récent** et l'application ajoutée à l'écran d'accueil ;
- **hors connexion**, on peut passer les commandes, enregistrer les ventes et paiements de crédit, les dépenses, les ajouts et retraits de caisse, les entrées et les sorties. Les annulations, la fermeture de caisse, la validation d'un inventaire et l'administration demandent une connexion. Le reçu d'une opération faite hors connexion est disponible après la synchronisation ;
- l'impression passe par le menu d'impression du téléphone ou de l'ordinateur (format ticket 80 mm prévu). Il n'y a pas de pilote direct d'imprimante Bluetooth ;
- le partage par e-mail utilise l'application de messagerie du téléphone : le serveur n'envoie pas d'e-mails ;
- les tests ont été faits dans Chromium avec l'écran d'un téléphone Android simulé (Pixel 7) et un écran d'ordinateur. **Pas encore sur de vrais téléphones** : faites un essai sur un Android et un iPhone avant l'ouverture.
