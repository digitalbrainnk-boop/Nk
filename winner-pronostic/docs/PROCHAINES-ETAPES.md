# Prochaines étapes — ce qu'il te reste à faire

Le code est prêt pour brancher les vraies données. Voici, dans l'ordre, ce qu'il faut faire de ton côté. Les détails techniques sont dans le [README](../README.md).

## 1. Supabase (base de données et comptes) — environ 15 minutes

1. Crée un compte sur https://supabase.com, puis un **nouveau projet** (région : Europe).
2. Dans **SQL Editor**, colle et exécute, dans cet ordre :
   - `supabase/migrations/20261102000100_init_schema.sql`
   - `supabase/migrations/20261102000200_reference_data.sql`
3. Dans **Project Settings → API Keys**, note :
   - l'URL du projet ;
   - la clé **publishable** ;
   - la clé **secret** (à ne jamais partager publiquement).
4. Dans **Authentication** : règle « URL Configuration » et les modèles d'e-mails (README, section 3.2).
5. SMS (connexion par téléphone) : active **Phone** et choisis un fournisseur SMS (Twilio, Vonage…). Vérifie le prix par SMS vers le Burkina. Sans ce réglage, seule la connexion par e-mail marche.

## 2. Vercel (mise en ligne) — environ 10 minutes

1. Crée un compte sur https://vercel.com avec ton compte GitHub.
2. **Add New → Project** → choisis le dépôt `Nk`.
3. **Root Directory : `winner-pronostic`** (très important).
4. Ajoute les variables d'environnement (README, section 4) : URL Supabase, clé publishable, clé secret, adresse du site, `RATE_LIMIT_SALT`.
5. Clique sur **Deploy**. Vercel te donne une adresse (ex. `winner-pronostic.vercel.app`) : reporte-la dans Supabase (Site URL et Redirect URLs).
6. Crée ton compte dans l'application, puis passe-toi administrateur (README, section 3.3).

> La branche de travail est `ccr-3293b74c-1aisuu`. Fusionne-la dans `main`, ou choisis cette branche dans les réglages Git de Vercel.

## 3. API-Sports (les vrais matchs) — indispensable pour la phase 2

1. Crée un compte sur https://dashboard.api-football.com (le même compte sert pour API-Sports).
2. Choisis une offre. L'offre gratuite suffit pour tester (environ 100 requêtes par jour et par sport). Pour l'application en production, il faudra une offre payante.
3. Ajoute la clé dans Vercel sous le nom `API_SPORTS_KEY`, puis préviens-moi. **Ne colle jamais la clé dans une conversation ni dans le code.**

## 4. Ce que je fais ensuite (phase 2)

- Synchronisation automatique (toutes les quelques minutes) des matchs de tous les sports : programme, scores en direct, classements, cotes.
- Programme réel sur l'accueil (filtres par sport, pays, compétition, recherche d'équipe), page « En direct ».
- Calcul automatique des buts attendus et des probabilités de tous les marchés pour chaque match, puis rapports d'analyse et générateur de codes sur les vrais matchs.

## 5. Décisions à prendre de ton côté

- Prix Premium : 1 000 F/semaine et 3 000 F/mois pour l'instant (modifiables).
- Codes 1xBet : demande au programme partenaire 1xBet s'il existe un moyen officiel de créer des codes de coupon. Sinon, l'admin les colle à la main (prévu en phase 7, avançable si tu veux).
- Cadre légal : vérifie les règles sur la promotion des paris au Burkina Faso.
