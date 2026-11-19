# Modèle de fonctionnement d'un maquis avec MAQUIS PRO MANAGER

Ce document décrit **qui fait quoi** et **comment se déroule une journée**. Il s'inspire de la façon dont fonctionnent les logiciels de caisse utilisés dans les bars et restaurants (Loyverse, Square, Zelty, caisses enregistreuses classiques) :
- **les serveurs** prennent les commandes ;
- **la caisse** encaisse ;
- **le responsable** valide les opérations sensibles ;
- **le propriétaire** contrôle tout, de loin.

Pour le voir en vrai, lancez la **démonstration** : `maquis demo` dans Termux, `DEMO.bat` sur Windows ou `npm run demo` ailleurs. C'est un maquis fictif, avec une semaine d'activité, dont les comptes sont proposés sur l'écran de connexion (mot de passe : `demo1234`).

## Les rôles

| Rôle | Qui | Son appareil | Son travail |
|---|---|---|---|
| **Propriétaire** (le patron) | Le patron du maquis, souvent absent | Son téléphone | Il surveille tout, de partout : ventes, caisse, stock, bilans. Il seul corrige ou annule une entrée ou une sortie. Il gère les comptes et les paramètres. |
| **Gérant** | Le responsable sur place | Une tablette au comptoir | Il tient la caisse, valide les commandes des serveurs, enregistre les livraisons (entrées) et les pertes (sorties), fait l'inventaire et les commandes aux fournisseurs. |
| **Caissier** *(facultatif)* | Quelqu'un d'autre que le gérant à la caisse | La tablette du comptoir | Il encaisse. Il ne peut pas annuler une vente seul : il le demande au gérant. |
| **Serveurs** | Chaque serveuse et chaque serveur | Leur téléphone | Ils prennent les commandes à table et les envoient au comptoir. Ils voient leurs propres ventes. |

### Règles de contrôle (comme dans les logiciels de caisse)

- **Chaque personne a son propre compte**, et chaque opération porte son nom, l'heure et l'appareil.
- **Rien ne s'efface.** Une erreur se corrige par une annulation avec motif, qui crée un document « rectificatif ». L'original reste visible.
- **Annuler une vente** :
  - le gérant peut le faire ;
  - le caissier envoie une **demande**, que le gérant **valide ou refuse** ;
  - le propriétaire est prévenu dans les deux cas.
- **Entrées et sorties de stock** :
  - le gérant les enregistre ;
  - une fois enregistrées, **seul le propriétaire peut les corriger ou les annuler** ;
  - le gérant peut lui **signaler une erreur**.
- **Prix** : le gérant tient le catalogue, mais **chaque changement de prix est envoyé au propriétaire**, et l'ancien prix reste dans l'historique.
- **Caisse** :
  - on l'ouvre avec un fonds de caisse et on la ferme en comptant l'argent (billets et pièces si on veut) ;
  - le **solde théorique** est calculé automatiquement ;
  - **tout écart** (manquant ou excédent) est signalé au propriétaire.
- **Le gérant ne voit pas** le tableau de bord du propriétaire (bénéfices, rentabilité) ni l'administration.

## Une journée type

1. **Avant l'ouverture (gérant).**
   - Il regarde l'*Accueil du gérant* : alertes de stock, commandes fournisseurs attendues.
   - Si une livraison arrive, il ouvre la commande fournisseur et fait *Réceptionner la livraison*. Le stock augmente, et les écarts avec la commande sont signalés.
2. **Ouverture de la caisse (gérant).** Dans *Ma caisse*, il saisit le fonds de caisse (la monnaie du tiroir).
3. **Service.**
   - La serveuse prend la commande sur son téléphone et touche *Envoyer au caissier*.
   - La tablette du gérant **sonne** et affiche la commande. Le gérant sert les boissons et touche *Encaisser* : espèces (la monnaie à rendre est calculée), Orange Money, Moov Money, paiement mixte ou crédit avec le nom du client.
   - Pour une table de plusieurs commandes : *Addition* imprime la note, puis *Encaisser la table* règle tout en une fois.
   - Le stock diminue automatiquement. Chaque bouteille est comptée au serveur qui l'a commandée.
4. **Incidents.**
   - Une bouteille cassée ou offerte : *Nouvelle sortie*, avec le motif et le responsable.
   - Un achat de glace : *Dépense*.
   - De l'argent remis au patron : *Retrait*, avec le motif.
5. **Fermeture de la caisse (gérant).** Il compte l'argent, billets et pièces. L'application compare au solde théorique et imprime le reçu de fermeture.
6. **03 h 00 : bilan automatique.**
   - Le serveur produit seul le **bilan de la journée** : sorties par marque, ventes par serveur, caisse, pertes, fiche de stock et analyse.
   - Le propriétaire et le gérant reçoivent une notification.
   - Chaque **lundi à 03 h 00**, le **bilan de la semaine** arrive aussi, avec la rentabilité par boisson et une comparaison avec la semaine précédente.
7. **Le patron, depuis chez lui.**
   - Il ouvre son tableau de bord : ventes, encaissé, bénéfice estimé, pertes, stock, caisse ouverte.
   - Il lit le bilan, vérifie les écarts de caisse, et corrige si besoin une entrée ou une sortie signalée par le gérant.

## Chaque semaine

- **Inventaire** (gérant) : il compte les bouteilles. Chaque écart doit être justifié, et le propriétaire est prévenu.
- **Commande fournisseur** (gérant) : l'application propose les quantités d'après les ventes réelles. Il ajuste, puis envoie le bon de commande en PDF par WhatsApp.
- **Lecture du bilan hebdomadaire** (propriétaire) : chiffre d'affaires, bénéfice brut, boissons qui rapportent le plus, pertes, écarts de caisse, point des serveurs.

## Ce que montre la démonstration

| Compte | Ce qu'il faut regarder |
|---|---|
| `patron` | *Tableau de bord* → *7 jours* : ventes, bénéfice, rentabilité par boisson. Menu *Gérant* : tout ce que fait le gérant. *Rapports* : bilans quotidiens et hebdomadaire en PDF et Excel. *Caisses* : écarts de −500 et +200 FCFA. |
| `gerant` | *Accueil* : caisse ouverte, **2 commandes en attente** (Table 9) à encaisser, rupture de Dafani, stock faible de Red Bull. *Commandes fournisseurs* : une commande reçue en partie avec un écart. |
| `awa`, `ali`, `fatim` | *Commander* : la prise de commande. *Mes ventes* : leur point de la journée. |
| `caissier` | La journée où il a tenu la caisse, et sa demande d'annulation validée par le gérant (dans les reçus). |

La démonstration est entièrement séparée des vraies données. On la recrée à zéro avec `maquis demo refaire`.
