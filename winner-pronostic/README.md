# 🏆 Winner Pronostic

Application web mobile (**PWA installable sur Android**) de pronostics **multi-sports** pour l'Afrique de l'Ouest (Burkina Faso en priorité), en français :
⚽ football · 🏀 basketball · 🏒 hockey sur glace · 🤾 handball · 🏐 volleyball · 🏉 rugby · ⚾ baseball · 🏈 football américain.

Programme des matchs, scores en direct, statistiques, pronostics calculés, **générateur de « code de X »** (cote visée 2, 5, 10…) et **analyse de coupon**.
**Outil d'analyse uniquement : l'application ne prend aucun pari et ne gère aucune mise d'argent.**

> Stack : Next.js 16 (App Router, TypeScript, Tailwind CSS 4) · Supabase (PostgreSQL, Auth, RLS) · API-Sports · CinetPay (Mobile Money) · Web Push · Vercel.
> Architecture, schéma de la base et règles d'accès : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Structure, base multi-sports, authentification (e-mail + téléphone), PWA, interface sportive | ✅ |
| 1+ | Générateur « code de X », analyse de coupon, codes de chargement 1xBet | ✅ |
| 1++ | Moteurs de probabilités par sport (plus de 400 marchés en football), rapport d'analyse complet par match | ✅ |
| 2 | Synchronisation API-Sports (tous sports) : programme, direct, classements, cotes | ✅ |
| 3 | Fiche match : forme, confrontations, classement, bilans domicile/extérieur, absences, compositions, cotes | ✅ |
| 4 | Calcul automatique des pronostics (Poisson + Elo + forme + absences), value bets, publication du jour | ✅ |
| 5 | Règlement automatique des résultats, historique public et taux de réussite (par sport, marché, compétition) | ✅ |
| 6 | Premium par Mobile Money (Orange Money, Moov Money…) via CinetPay, activation vérifiée côté serveur | ✅ |
| 7 | Favoris, notifications push (avant le match, buts), espace admin complet, publicité des comptes gratuits | ✅ |

---

## 1. Prérequis

- **Node.js 20.9 ou plus récent** (22 conseillé) : https://nodejs.org
- Un compte **Supabase** (gratuit) : https://supabase.com
- Un compte **Vercel** (gratuit) : https://vercel.com
- Un compte **API-Sports** (même compte qu'API-Football) : https://dashboard.api-football.com
- Un compte marchand **CinetPay** (Mobile Money) : https://app.cinetpay.com

## 2. Installation en local

```bash
cd winner-pronostic
npm install
cp .env.example .env.local      # puis remplissez les valeurs (voir ci-dessous)
npm run dev                     # http://localhost:3000
```

## 3. Configurer Supabase

### 3.1 Créer le projet et la base

1. Sur https://supabase.com/dashboard, créez un projet (région la plus proche : **Europe (Frankfurt ou Paris)**).
2. Appliquez les migrations, au choix :
   - **Sans outil** : *SQL Editor* → collez puis exécutez **dans l'ordre** le contenu de
     1. `supabase/migrations/20261102000100_init_schema.sql`
     2. `supabase/migrations/20261102000200_reference_data.sql`
     3. `supabase/migrations/20261121000300_operations.sql`
   - **Avec la CLI** :
     ```bash
     npx supabase login
     npx supabase link --project-ref <identifiant-du-projet>
     npx supabase db push
     ```
3. *Project Settings → API Keys* : copiez dans `.env.local`
   - l'URL du projet → `NEXT_PUBLIC_SUPABASE_URL`
   - la clé **publishable** (ou « anon ») → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - la clé **secret** (ou « service_role ») → `SUPABASE_SECRET_KEY` (⚠️ serveur uniquement, ne jamais la partager)
4. Recommandé : *Project Settings → JWT Keys* → passez aux **clés de signature asymétriques**. La session est alors vérifiée localement, sans appel réseau, à chaque page.

### 3.2 Authentification

*Authentication → URL Configuration*
- **Site URL** : `http://localhost:3000` en local, puis l'adresse de production (ex. `https://winner-pronostic.vercel.app`).
- **Redirect URLs** : ajoutez `http://localhost:3000/auth/confirm` et `https://<votre-domaine>/auth/confirm`.

*Authentication → Emails → Templates* (liens qui fonctionnent même ouverts sur un autre appareil) :

| Modèle | Lien à mettre dans le bouton |
|---|---|
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&suivant=/compte` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&suivant=/nouveau-mot-de-passe` |
| Change email address | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&suivant=/compte` |

*Authentication → Sign In / Providers*
- **Email** : activé, avec « Confirm email ».
- **Phone** : activez-le et choisissez un fournisseur SMS (Twilio, MessageBird, Vonage, Textlocal…). Vérifiez chez lui la **couverture et le prix par SMS vers le Burkina Faso** et les pays voisins. Pour un agrégateur local, Supabase propose aussi un *Send SMS Hook*.
- Pour tester sans envoyer de SMS : ajoutez un **numéro de test** (ex. `22670123456` → code `123456`).

L'application limite déjà le nombre de SMS par numéro et par IP. Vous pouvez aussi régler les plafonds globaux dans *Authentication → Rate Limits*.

### 3.3 Devenir administrateur

Inscrivez-vous dans l'application, puis dans *SQL Editor* :

```sql
update public.profiles set role = 'admin' where email = 'vous@exemple.com';
-- ou, compte créé par téléphone (numéro sans le +) :
update public.profiles set role = 'admin' where phone = '22670123456';
```

L'espace admin est accessible sur `/admin` (les autres utilisateurs y voient une page 404).

## 4. Variables d'environnement

Toutes sont décrites dans [`.env.example`](.env.example). Les clés secrètes ne sont **jamais** envoyées au navigateur : seules les variables `NEXT_PUBLIC_*` le sont, et elles ne contiennent rien de secret.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | oui | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | oui | Clé publique (la sécurité repose sur la RLS) |
| `SUPABASE_SECRET_KEY` | oui | Clé secrète, serveur uniquement (synchro, paiements, notifications, anti-abus) |
| `NEXT_PUBLIC_SITE_URL` | oui | Adresse publique (liens des e-mails, retour de paiement) |
| `RATE_LIMIT_SALT` | oui | Sel des compteurs anti-abus |
| `API_SPORTS_KEY` | oui | Données sportives (tous les sports, une seule clé) |
| `CRON_SECRET` | oui | Protège les tâches planifiées `/api/cron/*` |
| `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` | pour Premium | Paiements Mobile Money |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | pour les alertes | Notifications push |
| `NEXT_PUBLIC_DESIGN_PREVIEW` | non | `1` pour afficher `/apercu` (données fictives) en production |

`RATE_LIMIT_SALT`, `CRON_SECRET` et les clés VAPID se génèrent dans **`/admin/outils`** (dans le navigateur, rien n'est envoyé au serveur), ou en ligne de commande : `openssl rand -hex 32` et `npx web-push generate-vapid-keys`.

L'état de chaque intégration est visible dans **`/admin/synchro`** (✅ / ❌), avec un bouton « Tester la clé API-Sports ».

## 5. Tests et qualité

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript strict
npm test            # tests unitaires (validation, sécurité, puis moteur de pronostics)
```

Tests de la base (migrations + règles RLS) sur un PostgreSQL local, sans Docker ni projet Supabase :

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

Après chaque nouvelle migration, régénérez les types TypeScript :

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:types
# ou depuis le projet en ligne :
npx supabase gen types typescript --project-id <id> > src/types/database.ts
```

## 6. Déployer sur Vercel

1. Poussez le code sur GitHub (déjà fait si vous lisez ceci sur GitHub).
2. Sur https://vercel.com/new, importez le dépôt `Nk`.
3. **Root Directory : `winner-pronostic`** (le dépôt contient aussi un autre projet à sa racine). Framework détecté : Next.js.
4. *Environment Variables* : ajoutez les variables de la section 4 (`NEXT_PUBLIC_SITE_URL` = l'adresse Vercel ou votre domaine).
5. Cliquez sur **Deploy**.
6. Dans Supabase, mettez à jour *Site URL* et *Redirect URLs* (section 3.2) avec l'adresse de production.

> La branche déployée par défaut est `main`. Fusionnez la branche de travail dans `main`, ou choisissez la branche dans *Settings → Git* sur Vercel.

### Tâches planifiées (synchronisation, résultats, alertes)

| Tâche | Fréquence | Étapes |
|---|---|---|
| `/api/cron/daily` | 1 fois par jour (Vercel Cron, `vercel.json`) | saisons, programme sur 3 jours, classements, cotes, calcul des pronostics, publication, règlement des résultats, maintenance |
| `/api/cron/frequent` | toutes les 2 minutes (Supabase Cron) | scores en direct, règlement des matchs terminés, notifications |

L'offre gratuite de Vercel ne lance un cron qu'**une fois par jour**. Pour le direct, Supabase appelle l'application toutes les 2 minutes :

1. Supabase → *Database → Extensions* : activez **pg_cron** et **pg_net**.
2. Ouvrez **`/admin/outils`** dans l'application : le SQL prêt à l'emploi (avec votre adresse) s'y trouve ; remplacez `VOTRE_CRON_SECRET` par la valeur de `CRON_SECRET` puis exécutez-le dans *SQL Editor*. Le secret est rangé dans le coffre-fort Supabase (*Vault*), pas en clair dans la tâche.

Sans ce réglage, la page « En direct » se met quand même à jour quand quelqu'un la consulte (au plus une fois par minute, pour économiser le quota API).

Pour un premier remplissage immédiat : **`/admin/synchro`** → lancez les étapes une par une (saisons → programme → classements → cotes → pronostics → publication). Le journal affiche le nombre de requêtes et les erreurs éventuelles.

### Paiements CinetPay

1. Créez un compte marchand sur https://app.cinetpay.com et faites valider votre dossier (KYC).
2. *Intégrations* : copiez **API KEY**, **SITE ID** et **Clé secrète** dans Vercel (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`).
3. Les adresses sont envoyées automatiquement à chaque paiement : notification `https://<votre-domaine>/api/webhooks/cinetpay`, retour `https://<votre-domaine>/paiement/retour`.
4. Parcours : `/premium` → choix de l'offre → page CinetPay (Orange Money, Moov Money…) → retour sur `/premium/merci`.

**Aucun abonnement n'est activé sur la seule foi de la notification** : le serveur redemande toujours le statut à l'API CinetPay (`/v2/payment/check`) et vérifie le montant et la devise. L'activation est atomique et idempotente (fonction SQL `activate_subscription`) : une notification reçue deux fois ne donne pas deux abonnements. Un abonnement acheté pendant un abonnement en cours le prolonge. En cas de souci, `/admin/paiements` → **Vérifier** relance le contrôle, et `/admin/utilisateurs` permet d'offrir Premium manuellement.

### Notifications push

Générez les clés VAPID dans `/admin/outils`, ajoutez-les dans Vercel, redéployez. Chaque utilisateur active les alertes dans **Mon compte** (avant le coup d'envoi et/ou à chaque but de ses équipes favorites). Sur Android, les notifications fonctionnent dans Chrome et dans l'application installée.

### Installer l'application sur Android

Ouvrez le site dans **Chrome** → menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »). L'application s'ouvre ensuite en plein écran, avec son icône, et les pages déjà consultées restent lisibles hors connexion.

## 7. Coupons : « code de X », analyse et codes de chargement

- **Générer un code** (`/coupons`) : l'utilisateur choisit la cote visée (2, 5, 10, 20…), le niveau de risque, la période et les sports (mélangés ou non). Le moteur (`src/lib/coupons/generator.ts`) cherche la combinaison dont la cote atteint la cible (100 à 115 %) avec la **probabilité réelle la plus élevée** — résolution exacte, vérifiée par des tests contre une recherche exhaustive. La chance réelle est toujours affichée (« 1 chance sur N ») : aucun coupon n'est présenté comme sûr.
- **Analyser un coupon** : l'utilisateur recopie ses sélections et leurs cotes ; l'application calcule la chance réelle (marge du bookmaker retirée), signale le maillon le plus faible et ce que changerait son retrait. Les sélections reconnues utilisent les probabilités du modèle.
- **Coupons de la rédaction** : dans `/admin/coupons`, l'admin compose un coupon à partir des pronostics publiés, le met en avant (gratuit ou Premium) et y ajoute son **code de chargement** (1xBet, par pays). Les utilisateurs le copient en un geste sur `/coupons` et `/pronostics`. Pas d'API officielle connue pour générer ces codes automatiquement — voir `docs/ARCHITECTURE.md`.
- Gratuit : `free_coupons_per_day` codes par jour (réglage), Premium : illimité.

## 8. Rapport d'analyse d'un match

Page `/match/[id]` (réservée aux abonnés Premium ; exemple fictif sur `/apercu/rapport` avec `NEXT_PUBLIC_DESIGN_PREVIEW=1`) :

- **Lecture du match** : buts/points attendus, attaque et défense (domicile/extérieur), classement Elo, forme récente, absences, classement, confrontations directes, scores probables, comparaison avec les cotes.
- **Sélections les plus solides** et **value bets** (quand notre probabilité dépasse celle de la cote).
- **Tous les marchés**, regroupés comme chez les bookmakers : 1X2, double chance, deux équipes vont marquer, total et total asiatique, Total 1 / Total 2, handicap et handicap asiatique, remboursé si nul, Résultat + Total, 1X2 + chaque équipe marque, double chance + BTTS, score exact, MT-Fin, 1re et 2e mi-temps, spéciaux mi-temps, premier but, but dans l'intervalle de temps, pénalty et expulsion, corners et cartons, buteurs.

Modèles (`src/lib/predictions/`) :

| Sport | Modèle |
|---|---|
| Football | Poisson avec correction de Dixon-Coles, mi-temps indépendantes, processus de Poisson pour les intervalles de temps |
| Hockey, baseball | Poisson, égalités départagées (prolongations, manches supplémentaires) |
| Basketball, handball, rugby, football américain | Loi normale sur l'écart et le total de points |
| Volleyball | Probabilité de gagner un set (méthode log5), match en 3 sets gagnants |

Les buts attendus viennent de `strength.ts` : forces offensive/défensive rapportées à la moyenne de la ligue (avec retour vers la moyenne quand il y a peu de matchs), puis ajustements Elo, forme et absences. Pénaltys et expulsions utilisent les moyennes de la ligue et sont signalés comme moins précis.

## 9. Sécurité (résumé)

- **Row Level Security** sur toutes les tables, droits par défaut retirés, tests automatiques des règles.
- **Validation zod côté serveur** de chaque formulaire, messages d'erreur traduits sans détail technique.
- **18 ans minimum** vérifié trois fois : formulaire, serveur (zod) et base (déclencheur + contrainte).
- **Limitation des tentatives** (connexion, inscription, SMS, code) partagée entre instances, avec des clés hachées.
- **Redirections internes uniquement** (pas de redirection ouverte), **en-têtes de sécurité** (CSP, anti-iframe, HSTS…).
- **Pronostics publiés immuables** : impossible de réécrire l'historique ; résultats réglés automatiquement à partir des scores officiels.
- **Tâches planifiées** protégées par `CRON_SECRET` (comparaison à temps constant), **webhook de paiement** limité en débit et toujours revérifié auprès de CinetPay.
- **Espace admin** : chaque action est validée, limitée en débit et inscrite dans un journal d'audit (`admin_audit_log`).
- **Clés API uniquement côté serveur** ; réponses API mises en cache (`api_cache`) pour économiser le quota.

## 10. Jeu responsable

Bandeau de prévention visible sur toutes les pages, page `/jeu-responsable`, inscription interdite aux mineurs. L'application n'affiche jamais de mention du type « gain garanti » ou « coupon sûr ».
