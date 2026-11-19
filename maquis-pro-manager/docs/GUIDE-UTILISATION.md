# Guide d'utilisation

Chaque personne a **son propre compte**. Ne prêtez jamais votre identifiant : chaque opération porte le nom de la personne connectée, l'heure et l'appareil utilisé.

À la première connexion d'un employé, l'application lui demande de remplacer le mot de passe provisoire par le sien.

**Mot de passe oublié** :
- un serveur, un caissier ou le gérant demande au propriétaire (ou au gérant pour les serveurs et caissiers) un nouveau mot de passe dans *Comptes* ;
- le propriétaire retrouve l'accès sur l'appareil qui fait tourner l'application : `maquis acces` dans Termux, ou `npm run acces` sur un ordinateur ou un serveur. La commande liste les identifiants ; avec un identifiant (`maquis acces patron`), elle donne un mot de passe provisoire, à changer dès la connexion. L'opération est inscrite au journal d'audit.

La **journée commerciale** va de 03 h 00 à 02 h 59 le lendemain : une vente faite à 01 h 30 compte pour la journée de la veille.

---

## Qui voit quoi

| | Propriétaire | Gérant | Caissier | Serveur |
|---|---|---|---|---|
| Tableau de bord du propriétaire (bénéfices, rentabilité, activité du personnel) | ✅ | ❌ | ❌ | ❌ |
| Administration (paramètres, journal d'audit, connexions, sauvegardes) | ✅ | ❌ | ❌ | ❌ |
| Espace du gérant (accueil, caisses, commandes, stock, entrées, sorties, fournisseurs…) | 👁️ lecture seule | ✅ | — | — |
| Tenir une caisse, encaisser, vendre, fermer la caisse | ❌ | ✅ | ✅ | ❌ |
| Enregistrer entrées, sorties, inventaires, commandes fournisseurs | ❌ | ✅ | ❌ | ❌ |
| Voir les entrées et les sorties | ✅ | ✅ | ❌ | ❌ |
| **Corriger ou annuler** une entrée ou une sortie déjà enregistrée | ✅ | ❌ (il signale l'erreur au propriétaire) | ❌ | ❌ |
| Prendre les commandes des clients | ❌ | ❌ | ❌ | ✅ |

Le propriétaire **voit tout ce que fait le gérant**, sur les mêmes écrans. Il **n'encaisse pas et ne valide pas les commandes à sa place**. En revanche, **seul le propriétaire peut corriger ou annuler une entrée ou une sortie** une fois enregistrée : le gérant les enregistre et les consulte, mais ne peut plus y toucher. Ce n'est pas qu'une question d'affichage : le serveur refuse toute modification venant du compte propriétaire. Le gérant, lui, **ne voit pas l'espace du propriétaire**.

## Propriétaire

Votre espace sert à **surveiller** : il est en **lecture seule** pour toutes les opérations.
- **Corriger une entrée ou une sortie** : ouvrez-la (*Espace du gérant → Entrées* ou *Sorties*). Vous avez deux boutons, avec un motif obligatoire :
  - *Corriger* : le formulaire s'ouvre avec les quantités enregistrées, vous mettez les bonnes. L'opération d'origine est annulée par un document rectificatif et remplacée par la bonne, dans un seul geste.
  - *Annuler* : l'opération n'a plus d'effet sur le stock.

  Le gérant est prévenu. Rien n'est effacé : l'original, l'annulation et la correction restent visibles. Une correction qui rendrait le stock négatif est refusée.
- **Erreurs signalées** : quand le gérant se trompe, il vous le signale depuis l'entrée ou la sortie. Vous recevez une notification, et son message apparaît en jaune sur l'opération.
- **Espace du gérant** (menu de gauche, ou bouton *Gérant* en bas sur téléphone) : vous voyez l'accueil du gérant tel qu'il le voit (ventes du jour, commandes en attente, caisses ouvertes avec leur montant, mouvements de stock, reçus de la journée), ainsi que chacun de ses écrans. Un bandeau « lecture seule » le rappelle, et aucun bouton d'action n'apparaît. Vous ne pouvez ni modifier ni supprimer une vente, une entrée, une sortie ou une opération de caisse, et personne d'autre ne le peut non plus. Les erreurs se corrigent par une annulation qui laisse une trace.

- **Tableau de bord** : ventes, encaissements, dépenses, bénéfice estimé, sorties, pertes, stock restant, caisses ouvertes, activité du personnel, derniers reçus et derniers rapports. Choisissez *Aujourd'hui*, *Hier*, *7 jours*, *30 jours* ou une période précise.
- **Rentabilité par boisson** (tableau de bord, et dans le bilan hebdomadaire) : bouteilles vendues, chiffre d'affaires, coût d'achat, marge brute, marge par bouteille, et bénéfice net une fois retirées les pertes, casses et boissons offertes. La période *Ce mois* donne le résultat du mois en cours.
- **Point des serveurs** (menu *Plus*) : pour chaque serveur, commandes, ventes, bouteilles, montant, crédits non soldés (sa part seulement pour une table partagée) et sorties hors ventes. Imprimable.
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

- **Accueil du gérant** : votre écran de travail de la journée. Il montre :
  - l'état de votre caisse ;
  - les boutons rapides : encaisser, vente directe, entrée, sortie, commande fournisseur, inventaire ;
  - les ventes du jour, les commandes en attente, les caisses ouvertes, les alertes de stock, les mouvements et les reçus de la journée.

  Les bénéfices et la rentabilité n'y figurent pas : ils restent sur le tableau de bord du propriétaire.
- **Nouvelle commande** : quand un serveur envoie une commande, votre tablette **sonne** (et vibre sur téléphone). Un message montre la table, le serveur et les boissons ; la commande vous attend dans *Commandes*. Pour être alerté même écran éteint, activez les notifications dans *Mon compte*.
- **Une erreur dans une entrée ou une sortie ?** Une fois enregistrée, vous ne pouvez plus la modifier ni l'annuler. Ouvrez-la et touchez *Signaler une erreur au propriétaire*, en expliquant l'erreur. Le propriétaire fera la correction.
- **Tenir la caisse** : si c'est vous qui encaissez, ouvrez *Ma caisse* avec le fonds de caisse.
  - Vous encaissez alors les commandes des serveurs (*Commandes*, avec addition et encaissement de toute une table), les ventes au comptoir (*Vente directe*) et les crédits, exactement comme un caissier.
  - Vous fermez votre caisse avec le comptage, et le billetage si vous le voulez.
  - Chaque opération porte votre nom, et le propriétaire la voit.
- Vous pouvez aussi enregistrer un retrait ou fermer la caisse d'un caissier absent (*Toutes les caisses*).

- **Catalogue** (*Plus → Catalogue des boissons*) : *Nouvelle boisson* (nom, marque, catégorie, prix d'achat et de vente, bouteilles par casier, stock minimum, fournisseur, stock initial). Ajoutez une photo depuis la fiche de la boisson (*Stock* → touchez la boisson).
- **Commandes fournisseurs** (*Stock → Commandes fournisseurs*, ou menu *Fournisseurs*) : *Nouvelle commande*, choisissez le fournisseur et le nombre de jours de vente à couvrir. L'application propose les quantités : ventes moyennes par jour × jours à couvrir + stock minimum − stock actuel − ce qui est déjà commandé, arrondies au casier complet. Vous pouvez tout modifier. *Créer le bon de commande* produit un PDF à envoyer au fournisseur par WhatsApp.
- **Réception** : à la livraison, ouvrez la commande puis *Réceptionner la livraison*. Les quantités restantes sont déjà remplies ; corrigez-les selon ce qui est vraiment livré. Le reçu d'entrée montre la comparaison commandé / reçu, et le propriétaire est prévenu en cas d'écart.
- **Fiche de stock** (*Stock → Fiche de stock*) : pour un jour ou une période, chaque boisson avec stock début, entrées, ventes, offertes, cassées…, ajustements d'inventaire et stock fin. L'application vérifie que le calcul tombe juste. Disponible en PDF et en Excel.
- **Entrée** de marchandises : choisissez le fournisseur, puis pour chaque boisson le nombre de casiers, les bouteilles par casier et les bouteilles en plus. Le total se calcule seul (exemple : 10 casiers de 12 = 120 bouteilles). Indiquez le montant payé : le reste à payer s'ajoute à la dette du fournisseur. À la validation, le stock augmente et un **reçu d'entrée** est créé.
- **Sortie** (hors ventes) : choisissez le motif (*Cassée*, *Offerte*, *Consommée par le personnel*, *Perdue*, *Périmée*, *Autre*), les boissons, le responsable et une observation. Les **ventes ne s'enregistrent pas ici** : la caisse les sort déjà du stock.
- **Stock** : quantités disponibles, entrées, ventes, autres sorties, valeur, alertes. *Mouvements* donne le journal de chaque bouteille.
- **Inventaire** : *Inventaires → Inventaire quotidien / hebdomadaire / mensuel*. Saisissez les quantités comptées. Chaque écart doit être justifié avant la validation, qui ajuste le stock et prévient le propriétaire.
- **Fournisseurs** : achats, paiements et dettes. *Enregistrer un paiement* crée un reçu. *Consignes* suit les casiers et bouteilles consignés (versés, récupérés, remboursés).
- **Dépenses** : hors caisse, ou payées depuis une caisse ouverte.
- **Caisses** : situation de chaque caisse. Vous pouvez enregistrer un retrait ou un ajout, et fermer une caisse si le caissier est absent.
- **Annuler** une vente ou une dépense : ouvrez l'opération → *Annuler*, avec un **motif obligatoire**. Pour une entrée ou une sortie, seul le propriétaire peut corriger ou annuler (voir ci-dessus). Le stock et la caisse sont corrigés, un **document rectificatif** est créé, et l'original reste visible.
- **Personnel** : vous pouvez créer et bloquer les comptes des caissiers et des serveurs.

## Caissier

1. **Ouvrir la caisse** : saisissez le fonds de caisse (la monnaie présente dans le tiroir).
2. **Commandes** : les commandes des serveurs arrivent en direct, **regroupées par table**.
   - *Addition* imprime la note de la table pour le client (ce n'est pas un reçu).
   - *Encaisser la table* encaisse toutes les commandes de la table en une seule vente ; *Encaisser seule* n'en encaisse qu'une.
   - Le prix est celui annoncé au moment de la commande, même si le gérant change le prix entre-temps.

   À l'encaissement :
   - *Tout en espèces* : saisissez les espèces reçues, la monnaie à rendre s'affiche ;
   - *Tout en Orange Money / Moov Money / Wave* ;
   - *Autre mode de paiement* : paiement mixte, par exemple une partie en espèces et une partie en Orange Money ;
   - *Crédit* ou paiement partiel : le **nom du client** est obligatoire.

   Le stock diminue à la validation, et le reçu peut être imprimé ou partagé.
3. **Vente directe** : vente au comptoir, sans commande de serveur (vous pouvez quand même choisir le serveur).
4. **Crédits** : liste des clients qui doivent de l'argent. *Encaisser* enregistre un paiement total ou partiel et crée un reçu.
5. **Dépense**, **Ajout / retrait / remboursement** : chaque opération demande un motif et crée un reçu.
6. **Fermer la caisse** : comptez l'argent réellement présent pour chaque mode de paiement. Pour les espèces, ouvrez *Compter les espèces par billets et pièces* : saisissez le nombre de billets de 10 000, 5 000… et de pièces, le total se calcule tout seul et s'imprime sur le reçu de fermeture. L'application calcule
   **solde théorique = fonds initial + encaissements + ajouts − dépenses − retraits − remboursements**,
   puis affiche l'**écart** (manquant ou excédent). Le reçu de fermeture est créé et le propriétaire est prévenu.

Une vente à crédit sort les boissons du stock mais n'entre dans la caisse que le jour où le client paie.

## Serveur

1. **Commander** : touchez les boissons (chaque touche ajoute une bouteille), ajustez les quantités avec − et +, indiquez la table, puis **Envoyer au caissier**. Le **bon de commande** numéroté peut être imprimé tout de suite pour le comptoir.
   Si une boisson est déjà presque toute commandée par d'autres serveurs, l'application le dit avant d'envoyer.
2. **Commandes** : suivez l'état de vos commandes (en attente, encaissée, refusée). *Imprimer l'addition* donne la note de la table au client. Une commande encore en attente peut être annulée.
3. **Mes ventes** : vos ventes et vos bouteilles de la journée, boisson par boisson.

Chaque vente encaissée est rattachée au serveur qui a pris la commande.

## Sans internet

L'application continue de fonctionner. Une pastille orange *Hors ligne* indique le nombre d'opérations gardées sur le téléphone. Elles partent **automatiquement** quand le réseau revient, sans jamais créer de doublon. Une opération refusée par le serveur (par exemple, une caisse déjà fermée) apparaît dans *Mon compte → Synchronisation*.

## Installer l'application

- **Android** : Chrome → menu ⋮ → *Installer l'application*.
- **iPhone** : Safari → *Partager* → *Sur l'écran d'accueil* (nécessaire pour les notifications).
- Puis *Mon compte* → **Activer les notifications sur cet appareil**.
