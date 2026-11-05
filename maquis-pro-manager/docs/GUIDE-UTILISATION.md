# Guide d'utilisation

Chaque personne a **son propre compte**. Ne prêtez jamais votre identifiant : chaque opération porte le nom de la personne connectée, l'heure et l'appareil utilisé.

À la première connexion d'un employé, l'application lui demande de remplacer le mot de passe provisoire par le sien.

La **journée commerciale** va de 03 h 00 à 02 h 59 le lendemain : une vente faite à 01 h 30 compte pour la journée de la veille.

---

## Propriétaire

Votre espace sert à **surveiller** : il est en **lecture seule** pour toutes les opérations. Vous ne pouvez ni modifier ni supprimer une vente, une entrée, une sortie ou une opération de caisse, et personne d'autre ne le peut non plus. Les erreurs se corrigent par une annulation qui laisse une trace.

- **Tableau de bord** : ventes, encaissements, dépenses, bénéfice estimé, sorties, pertes, stock restant, caisses ouvertes, activité du personnel, derniers reçus et derniers rapports. Choisissez *Aujourd'hui*, *Hier*, *7 jours*, *30 jours* ou une période précise.
- **Rapports** :
  - chaque jour à **03 h 00**, le **bilan quotidien des sorties** : bouteilles sorties par marque, par catégorie, par nature (vendues, offertes, personnel, cassées, perdues, périmées, autres) et par serveur, avec les ventes, les encaissements, les crédits, les pertes, la caisse et une analyse automatique ;
  - chaque **lundi à 03 h 00**, le **bilan hebdomadaire des ventes** : chiffre d'affaires, encaissements, dépenses, bouteilles et casiers vendus, classements, comparaison avec la semaine précédente, bénéfice brut estimé, écarts de caisse et stock restant.

  Les deux se téléchargent en **PDF**. Le bilan hebdomadaire s'exporte aussi en **Excel**. Vous recevez une notification dès qu'un bilan est prêt. *Voir la journée en cours* montre un aperçu en direct, avant 03 h 00.
- **Bilan rectificatif** : si une opération faite hors connexion arrive après 03 h 00, ou si une vente de la veille est annulée, un nouveau bilan (version 2) est produit automatiquement. L'original reste consultable.
- **Reçus** : tous les justificatifs, avec recherche par numéro, boisson, marque, type d'opération, responsable et dates.
- **Administration** (menu *Plus* sur téléphone) :
  - *Comptes* : créer un compte (gérant, caissier, serveur), le bloquer, réinitialiser un mot de passe ;
  - *Appareils connectés* : déconnecter à distance un téléphone perdu ou un ancien employé ;
  - *Connexions* : toutes les tentatives de connexion, réussies ou non ;
  - *Journal d'audit* : toutes les opérations, avec le bouton **Vérifier l'intégrité** (une modification frauduleuse directe dans la base serait détectée) ;
  - *Paramètres* : nom, logo, adresse, téléphone, message des reçus, modes de paiement, catégories de dépenses, délai de déconnexion automatique ;
  - *Sauvegardes* : créer et télécharger une copie complète.
- **Notifications** : vous êtes prévenu des entrées, sorties, ventes, dépenses, écarts de caisse, stocks faibles, ruptures, fermetures de caisse, bilans, connexions inhabituelles et annulations. Dans *Mon compte*, choisissez pour chaque type : push, application seulement, ou désactivé.

## Gérant

- **Catalogue** (*Plus → Catalogue des boissons*) : *Nouvelle boisson* (nom, marque, catégorie, prix d'achat et de vente, bouteilles par casier, stock minimum, fournisseur, stock initial). Ajoutez une photo depuis la fiche de la boisson (*Stock* → touchez la boisson).
- **Entrée** de marchandises : choisissez le fournisseur, puis pour chaque boisson le nombre de casiers, les bouteilles par casier et les bouteilles en plus. Le total se calcule seul (exemple : 10 casiers de 12 = 120 bouteilles). Indiquez le montant payé : le reste à payer s'ajoute à la dette du fournisseur. À la validation, le stock augmente et un **reçu d'entrée** est créé.
- **Sortie** (hors ventes) : choisissez le motif (*Cassée*, *Offerte*, *Consommée par le personnel*, *Perdue*, *Périmée*, *Autre*), les boissons, le responsable et une observation. Les **ventes ne s'enregistrent pas ici** : la caisse les sort déjà du stock.
- **Stock** : quantités disponibles, entrées, ventes, autres sorties, valeur, alertes. *Mouvements* donne le journal de chaque bouteille.
- **Inventaire** : *Inventaires → Inventaire quotidien / hebdomadaire / mensuel*. Saisissez les quantités comptées. Chaque écart doit être justifié avant la validation, qui ajuste le stock et prévient le propriétaire.
- **Fournisseurs** : achats, paiements et dettes. *Enregistrer un paiement* crée un reçu. *Consignes* suit les casiers et bouteilles consignés (versés, récupérés, remboursés).
- **Dépenses** : hors caisse, ou payées depuis une caisse ouverte.
- **Caisses** : situation de chaque caisse. Vous pouvez enregistrer un retrait ou un ajout, et fermer une caisse si le caissier est absent.
- **Annuler** une entrée, une sortie, une vente ou une dépense : ouvrez l'opération → *Annuler*, avec un **motif obligatoire**. Le stock et la caisse sont corrigés, un **document rectificatif** est créé, et l'original reste visible.
- **Personnel** : vous pouvez créer et bloquer les comptes des caissiers et des serveurs.

## Caissier

1. **Ouvrir la caisse** : saisissez le fonds de caisse (la monnaie présente dans le tiroir).
2. **Commandes** : les commandes des serveurs arrivent en direct. *Encaisser* :
   - *Tout en espèces* : saisissez les espèces reçues, la monnaie à rendre s'affiche ;
   - *Tout en Orange Money / Moov Money / Wave* ;
   - *Autre mode de paiement* : paiement mixte, par exemple une partie en espèces et une partie en Orange Money ;
   - *Crédit* ou paiement partiel : le **nom du client** est obligatoire.

   Le stock diminue à la validation, et le reçu peut être imprimé ou partagé.
3. **Vente directe** : vente au comptoir, sans commande de serveur (vous pouvez quand même choisir le serveur).
4. **Crédits** : liste des clients qui doivent de l'argent. *Encaisser* enregistre un paiement total ou partiel et crée un reçu.
5. **Dépense**, **Ajout / retrait / remboursement** : chaque opération demande un motif et crée un reçu.
6. **Fermer la caisse** : comptez l'argent réellement présent pour chaque mode de paiement. L'application calcule
   **solde théorique = fonds initial + encaissements + ajouts − dépenses − retraits − remboursements**,
   puis affiche l'**écart** (manquant ou excédent). Le reçu de fermeture est créé et le propriétaire est prévenu.

Une vente à crédit sort les boissons du stock mais n'entre dans la caisse que le jour où le client paie.

## Serveur

1. **Commander** : touchez les boissons (chaque touche ajoute une bouteille), ajustez les quantités avec − et +, indiquez la table, puis **Envoyer au caissier**.
2. **Commandes** : suivez l'état de vos commandes (en attente, encaissée, refusée). Une commande encore en attente peut être annulée.
3. **Mes ventes** : vos ventes et vos bouteilles de la journée, boisson par boisson.

Chaque vente encaissée est rattachée au serveur qui a pris la commande.

## Sans internet

L'application continue de fonctionner. Une pastille orange *Hors ligne* indique le nombre d'opérations gardées sur le téléphone. Elles partent **automatiquement** quand le réseau revient, sans jamais créer de doublon. Une opération refusée par le serveur (par exemple, une caisse déjà fermée) apparaît dans *Mon compte → Synchronisation*.

## Installer l'application

- **Android** : Chrome → menu ⋮ → *Installer l'application*.
- **iPhone** : Safari → *Partager* → *Sur l'écran d'accueil* (nécessaire pour les notifications).
- Puis *Mon compte* → **Activer les notifications sur cet appareil**.
