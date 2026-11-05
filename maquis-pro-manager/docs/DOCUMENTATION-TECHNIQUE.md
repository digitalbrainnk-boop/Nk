# Documentation technique

## Architecture

```
Téléphones / tablettes / ordinateurs (navigateur ou application installée — PWA)
   │  public/js/*.js : interface (modules ES, sans compilation)
   │  public/sw.js   : service worker (application hors connexion, cache, push)
   │  IndexedDB      : file d'attente des opérations faites hors connexion
   ▼  HTTPS (cookie de session HttpOnly + en-tête X-Requested-With)
Serveur Node.js 22 (Express 5) — src/
   │  app.js         : routes de l'API, contrôle des rôles, anti-doublons
   │  reports.js     : bilans quotidiens / hebdomadaires + planificateur
   ▼
SQLite (node:sqlite, mode WAL) — DATA_DIR/maquis.db
   + DATA_DIR/uploads (logo, photos), DATA_DIR/sauvegardes
```

| Fichier | Rôle |
|---|---|
| `src/db.js` | Schéma, déclencheurs d'intégrité, transactions, réglages, numérotation |
| `src/time.js` | Fuseau Africa/Ouagadougou, journée commerciale 03 h → 03 h, semaine du lundi 03 h |
| `src/auth.js` | Mots de passe (scrypt), sessions, anti-devinette, comptes, appareils |
| `src/audit.js` | Journal d'audit chaîné (empreinte SHA-256 de la ligne précédente) |
| `src/catalog.js` | Catégories, produits, prix, photos, fournisseurs |
| `src/stock.js` | Grand livre du stock, entrées, sorties, inventaires, consignes, paiements fournisseurs |
| `src/sales.js` | Commandes, ventes, paiements partiels, crédits, annulations |
| `src/cash.js` | Sessions de caisse, ajouts, retraits, remboursements, dépenses, clôture |
| `src/documents.js` | Reçus figés, numérotation, recherche, droits de consultation |
| `src/reports.js` | Calcul des bilans, versions rectificatives, planification et reprise |
| `src/pdf.js`, `src/xlsx.js` | PDF (pdfkit) et Excel (Office Open XML via fflate) |
| `src/notify.js` | Notifications (base + temps réel SSE + Web Push VAPID) |
| `src/backup.js` | Sauvegardes vérifiées, rotation, restauration |

## Règles de calcul

- **Journée commerciale** : `businessDay(t)` = date locale, moins un jour avant 03 h 00. Chaque opération enregistre son `business_day`.
- **Stock** : grand livre `stock_movements`. Le stock d'une boisson est la **somme** des quantités (initial et entrées positives, sorties négatives, ajustements d'inventaire signés). Rien n'est saisi à la main.
- **Sorties** : `sale` (vendue, créée **uniquement** par la caisse), `offered`, `staff`, `broken`, `lost`, `expired`, `other`. Une vente n'existe qu'une fois dans le grand livre : elle n'est jamais recomptée comme sortie indépendante.
- **Annulation** : une ligne de même nature et de signe opposé (`reversal_of`), rattachée à la **même journée commerciale** que l'original. Le document d'origine reste ; un document « rectificatif » (ANN-…) est créé.
- **Caisse**, pour chaque mode de paiement : `théorique = fonds (espèces) + encaissements + ajouts − dépenses − retraits − remboursements`. `écart = compté − théorique`. Une vente à crédit diminue le stock ; l'argent n'entre qu'au paiement (`payments.kind = 'credit'`).
- **Bénéfice brut estimé** = chiffre d'affaires − coût d'achat des bouteilles vendues (prix d'achat figé au moment de la vente). Le résultat estimé retire en plus les dépenses et les pertes.

## Bilans automatiques

- `runDueReports()` produit tous les bilans dus : chaque journée terminée depuis l'installation (92 jours au plus en rattrapage) et chaque semaine terminée.
- Il est appelé :
  1. au démarrage du serveur (reprise après une panne) ;
  2. par un minuteur réglé sur **03 h 00 + 5 s**, heure locale ;
  3. chaque minute, en filet de sécurité ;
  4. par `scripts/rapports.js`, lancé par la tâche planifiée du serveur (cron). C'est indispensable sur les hébergements qui mettent l'application en veille.
- **Jamais de doublon** : contrainte `UNIQUE(kind, period_key, version)`, transaction `BEGIN IMMEDIATE` et vérification à l'intérieur de la transaction, même si le site et la tâche cron tournent en même temps.
- **Origine** : `automatique` (produit à moins de 15 minutes de l'échéance), `reprise` (plus tard) ou `rectification`.
- **Rectificatif** : une opération écrite sur une journée déjà close (synchronisation hors connexion, annulation) ajoute la période à `report_dirty`. Une version suivante (`-R1`, `-R2`…) est alors produite et la version précédente est conservée.
- Après les bilans, une **sauvegarde** quotidienne est faite (`backupIfDue`).

## Intégrité et sécurité

- **Déclencheurs SQLite** :
  - aucune modification ni suppression sur `stock_movements`, `payments`, `cash_movements`, `documents`, `audit_log`, les lignes d'opérations, etc. ;
  - aucune suppression sur les ventes, entrées, sorties, dépenses, caisses, rapports, comptes et produits ;
  - montant, date et auteur figés sur les opérations validées.
- **Journal d'audit chaîné** : chaque ligne contient l'empreinte de la précédente. `GET /api/audit/verify` détecte une ligne modifiée directement dans le fichier.
- **Reçus** : contenu figé (JSON) avec une empreinte SHA-256, imprimée en pied de PDF.
- **Mots de passe** : scrypt (N = 16384), sel aléatoire. Mots de passe trop simples refusés. Mot de passe provisoire à changer à la première connexion.
- **Sessions** : jeton aléatoire de 256 bits ; seule son empreinte est stockée. Cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production. Expiration après 30 jours et **déconnexion automatique** après inactivité, réglable par rôle.
- **Anti-devinette** : après 5 erreurs, attente qui double (jusqu'à 1 h) et alerte au propriétaire.
- **Appareils** : un appareil inconnu déclenche une notification au propriétaire. Révocation à distance. Historique des connexions.
- **Contrôle d'accès côté serveur** sur chaque route (`need(...roles)`). Le propriétaire n'a **aucune** route d'écriture sur les opérations. Les prix d'achat sont masqués aux serveurs et caissiers.
- **CSRF** : toute écriture exige l'en-tête `X-Requested-With: MaquisPro`, et le cookie est `SameSite=Strict`.
- **En-têtes** : CSP stricte (`script-src 'self'`), `nosniff`, `Referrer-Policy`, HSTS en production.
- **Installation** : la création du compte propriétaire exige le code d'installation affiché par le serveur.

## Hors connexion et synchronisation

- Le service worker garde l'application et les dernières lectures (catalogue, commandes, caisse…). Sans réseau, l'application s'ouvre et affiche ces données.
- Une écriture qui échoue faute de réseau est mise dans IndexedDB avec un **identifiant unique**, la date réelle de l'opération et l'utilisateur.
- Au retour du réseau, la file est renvoyée dans l'ordre avec les en-têtes `Idempotency-Key`, `X-Offline: 1` et `X-Occurred-At`. Elle est aussi renvoyée toutes les 30 s et quand l'application revient au premier plan.
- Le serveur enregistre la réponse de chaque identifiant (`sync_ops`) **dans la même transaction** que l'opération. Un renvoi renvoie la même réponse sans rien créer : pas de doublon, même si la connexion coupe pendant l'envoi.
- La date d'origine est acceptée si elle remonte à moins de 48 h. Une opération hors connexion qui dépasse le stock est acceptée (les bouteilles sont déjà parties), et le gérant est prévenu (« stock négatif après synchronisation »).
- Une opération refusée (règle métier) reste visible dans *Mon compte → Synchronisation*, où l'on peut l'abandonner.

## API (résumé)

Toutes les routes sont sous `/api` ; les écritures exigent `X-Requested-With: MaquisPro`.

| Domaine | Routes |
|---|---|
| Installation, session | `GET/POST /setup`, `POST /auth/login`, `POST /auth/logout`, `GET /me`, `POST /me/password`, `GET /bootstrap` |
| Administration | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/password`, `GET /devices`, `DELETE /devices/:id`, `GET /login-events`, `GET /audit`, `GET /audit/verify`, `GET/PUT /settings`, `POST /settings/logo`, `GET/POST /backups`, `GET /backups/:nom` |
| Catalogue | `GET/POST /categories`, `GET/POST /products`, `GET/PATCH /products/:id`, `POST /products/:id/photo`, `GET /products/:id/history`, `GET/POST /suppliers`, `GET/PATCH /suppliers/:id`, `POST /suppliers/:id/payments` |
| Stock | `GET /stock`, `GET /movements`, `GET/POST /entries`, `GET /entries/:id`, `POST /entries/:id/cancel`, `GET/POST /exits`, `GET /exits/:id`, `POST /exits/:id/cancel`, `GET/POST /inventories`, `GET/PUT /inventories/:id`, `POST /inventories/:id/validate`, `POST /inventories/:id/abandon`, `GET/POST /consignments` |
| Ventes | `GET/POST /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`, `GET/POST /sales`, `GET /sales/:id`, `POST /sales/:id/payments`, `POST /sales/:id/cancel`, `GET /credits`, `GET /my-stats` |
| Caisse | `GET /cash/current`, `POST /cash/open`, `POST /cash/close`, `POST /cash/movements`, `GET /cash/sessions`, `GET /cash/sessions/:id`, `GET/POST /expenses`, `POST /expenses/:id/cancel` |
| Reçus | `GET /documents`, `GET /documents/:no`, `GET /documents/:no/pdf`, `GET /documents/:no/print` |
| Rapports | `GET /reports`, `GET /reports/status`, `GET /reports/preview`, `POST /reports/run`, `GET /reports/:id`, `GET /reports/:id/pdf`, `GET /reports/:id/xlsx`, `GET /dashboard` |
| Notifications | `GET /notifications`, `POST /notifications/read`, `GET/PUT /notifications/prefs`, `GET /push/key`, `POST /push/subscribe`, `POST /push/unsubscribe`, `GET /events` (temps réel) |

## Tests

`npm test` lance un vrai serveur sur une base temporaire et simule l'horloge pour vivre une semaine complète.

| Test obligatoire | Où |
|---|---|
| 1. Entrée de 120 bouteilles → stock +120 | `scenario.test.js` « 1. » |
| 2. Vente de 10 bouteilles → stock −10 | « 2 et 4. » |
| 3. 3 bouteilles cassées comptées à part | « 3. » |
| 4. Ventes par serveur | « 2 et 4. », bilan « 12 et 14. » |
| 5. Encaissements | « 5 et 15. » |
| 6. Ventes à crédit et paiements partiels | « 6. » |
| 7. Reçu d'entrée | « 7. » |
| 8. Reçu de sortie | « 8 et 9. » |
| 9. Téléchargement PDF des reçus | « 7. », « 8 et 9. », « 5 et 15. » |
| 10. Permissions des 4 comptes | « 10. » |
| 11. Le propriétaire ne peut rien modifier (y compris directement en base) | « 11. » |
| 12. Bilan quotidien à 03 h 00 (pas avant, jamais deux fois) | « 12 et 14. » |
| 13. Bilan hebdomadaire du lundi 03 h 00 (et reprise après panne) | « 13. » |
| 14. Quantités sorties par marque | « 12 et 14. » |
| 15. Calculs de caisse | « 5 et 15. » |
| 16. Fonctionnement hors connexion | « 16 et 17. » + essai dans le navigateur (voir ci-dessous) |
| 17. Synchronisation sans doublon et bilan rectificatif | « 16 et 17. » |
| 18. Sauvegarde et restauration | « 18. » |

Autres tests : annulation traçable d'une vente, inventaire avec écart justifié, intégrité du journal d'audit, et `security.test.js` (anti-devinette, nouvel appareil, déconnexion à distance, compte bloqué, inactivité, mot de passe provisoire, en-têtes).

Essais dans un vrai navigateur (Chromium, écran de téléphone Android simulé et écran d'ordinateur) : installation, création des comptes, catalogue, entrée, commande d'un serveur, encaissement, vente à crédit, sortie (casse), tableau de bord, aperçu du bilan, reçus, notifications, mode sombre, et **hors connexion** (commande sans réseau, rechargement de l'application sans réseau, synchronisation au retour du réseau, une seule commande créée même après deux synchronisations). Aucune erreur JavaScript relevée.

## Évolutions possibles

- PostgreSQL pour plusieurs établissements sur un même serveur.
- Publication sur le Play Store (Trusted Web Activity) ou l'App Store (Capacitor) à partir de la même application.
- Impression directe Bluetooth sur imprimante thermique.
- Envoi automatique des bilans par e-mail ou WhatsApp Business.
