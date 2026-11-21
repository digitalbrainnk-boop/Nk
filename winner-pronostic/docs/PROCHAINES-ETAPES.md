# Mise en ligne — ce qu'il te reste à faire

Tout le code est terminé et testé. Il reste à brancher **tes** comptes (Supabase, Vercel, API-Sports, CinetPay). Compte environ 1 heure, hors délai de validation CinetPay. Détails techniques : [README](../README.md).

> 🔐 Règle d'or : ne colle **jamais** une clé secrète dans une conversation, un e-mail ou le code. Les clés vont uniquement dans Vercel (*Settings → Environment Variables*).

## 1. Supabase — base de données (10 min)

1. Ouvre ton projet sur https://supabase.com/dashboard → **SQL Editor** → *New query*.
2. Colle et exécute (bouton **Run**), **dans cet ordre**, un fichier à la fois :
   1. `supabase/migrations/20261102000100_init_schema.sql`
   2. `supabase/migrations/20261102000200_reference_data.sql`
   3. `supabase/migrations/20261121000300_operations.sql`
3. **Project Settings → API Keys** : garde sous la main l'URL du projet, la clé *publishable* et la clé *secret*.
4. **Authentication** : règle *URL Configuration* et les modèles d'e-mails (README, section 3.2).
5. **Connexion par SMS** : *Authentication → Sign In / Providers → Phone*, choisis un fournisseur SMS (Twilio, Vonage…) et vérifie son prix vers le Burkina. Sans lui, seule la connexion par e-mail marche.

## 2. API-Sports — les vrais matchs (5 min)

1. Crée un compte sur https://dashboard.api-football.com et choisis une offre (l'offre gratuite donne ~100 requêtes/jour/sport : bien pour tester ; une offre payante est conseillée en production).
2. Copie ta clé : tu la mettras dans Vercel sous le nom `API_SPORTS_KEY`.

## 3. Vercel — mise en ligne (15 min)

1. https://vercel.com/new → importe le dépôt `Nk`.
2. **Root Directory : `winner-pronostic`** (très important).
3. Branche : fusionne `ccr-3293b74c-1aisuu` dans `main`, ou choisis cette branche dans *Settings → Git*.
4. Ajoute les variables : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL` (ton adresse Vercel), `API_SPORTS_KEY`, plus `RATE_LIMIT_SALT` et `CRON_SECRET` (génère-les avec `openssl rand -hex 32`, ou plus tard dans `/admin/outils`).
5. **Deploy**. Reporte l'adresse obtenue dans Supabase (*Site URL* et *Redirect URLs*).

## 4. Ton compte administrateur (2 min)

1. Inscris-toi dans l'application.
2. Supabase → SQL Editor :
   ```sql
   update public.profiles set role = 'admin' where email = 'ton-adresse@exemple.com';
   ```
3. Ouvre `/admin` : tu vois le tableau de bord.

## 5. Premier remplissage des matchs (5 min)

1. `/admin/synchro` : vérifie que tout est ✅, clique **Tester la clé API-Sports**.
2. Lance les étapes : **Saisons** → **Programme** → **Classements** → **Cotes** → **Pronostics** → **Publication**.
3. `/admin/competitions` : 10 grandes compétitions de football sont activées par défaut (Ligue des champions, CAN, Premier League, Ligue 1…). Après l'étape **Programme**, toutes les compétitions trouvées (championnat du Burkina, NBA, NHL…) apparaissent dans la liste : active celles que tu veux suivre, puis relance **Programme**.
4. Ensuite tout est automatique : 1 synchronisation complète par jour (Vercel) + le direct toutes les 2 minutes (étape 6).

## 6. Direct toutes les 2 minutes (5 min)

1. Supabase → *Database → Extensions* : active **pg_cron** et **pg_net**.
2. Copie le SQL affiché dans `/admin/outils`, remplace `VOTRE_CRON_SECRET` par ta valeur de `CRON_SECRET`, exécute-le dans SQL Editor.

## 7. Notifications push (5 min)

1. `/admin/outils` → **Générer** : copie `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` (`mailto:` + ton e-mail) dans Vercel.
2. Redéploie (*Deployments → Redeploy*). Teste dans **Mon compte → Activer les alertes**.

## 8. Paiements Premium par Mobile Money

1. Crée un compte marchand sur https://app.cinetpay.com et envoie les documents demandés (la validation prend quelques jours).
2. *Intégrations* : copie **API KEY**, **SITE ID** et **Clé secrète** dans Vercel (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`), puis redéploie.
3. Fais un vrai paiement de 1 000 F sur `/premium` : tu dois arriver sur « Bienvenue en Premium ! ». Le paiement apparaît dans `/admin/paiements`.
4. Prix modifiables dans `/admin/reglages` (1 000 F/semaine et 3 000 F/mois par défaut).

## 9. Décisions de ton côté

- **Codes 1xBet** : demande au programme partenaire 1xBet s'il existe un moyen officiel de créer des codes de coupon. En attendant, tu les colles dans `/admin/coupons`.
- **Cadre légal** : vérifie les règles sur la promotion des paris au Burkina Faso (et l'âge minimum, fixé à 18 ans dans l'application).
- **Publicité** : l'encart des comptes gratuits met en avant Premium ; il peut être désactivé dans `/admin/reglages`.
