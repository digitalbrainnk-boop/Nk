# 🏆 Winner Pronostic

Application web mobile (**PWA installable sur Android**) de pronostics **multi-sports** pour l'Afrique de l'Ouest (Burkina Faso en priorité), en français :
⚽ football · 🏀 basketball · 🏒 hockey sur glace · 🤾 handball · 🏐 volleyball · 🏉 rugby · ⚾ baseball · 🏈 football américain.

Programme des matchs, scores en direct, statistiques, pronostics calculés, **générateur de « code de X »** (cote visée 2, 5, 10…) et **analyse de coupon**.
**Outil d'analyse uniquement : l'application ne prend aucun pari et ne gère aucune mise d'argent.**

> Stack : Next.js 16 (App Router, TypeScript, Tailwind CSS 4) · Supabase (PostgreSQL, Auth, RLS) · API-Sports · CinetPay/FedaPay · Vercel.
> Architecture, schéma de la base et règles d'accès : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Structure, base multi-sports, authentification (e-mail + téléphone), PWA, interface sportive | ✅ |
| 1+ | Générateur « code de X » (optimisation + tests), analyse de coupon, codes de chargement (stockage + affichage) | ✅ |
| 2 | Synchronisation des matchs tous sports (API-Sports), programme, direct | ⏳ |
| 3 | Fiche match et statistiques | ⏳ |
| 4 | Moteur de pronostics par sport (Poisson, Elo, points), tests | ⏳ |
| 5 | Historique et taux de réussite | ⏳ |
| 6 | Abonnements Mobile Money | ⏳ |
| 7 | Notifications, espace admin, finitions, déploiement | ⏳ |

---

## 1. Prérequis

- **Node.js 20.9 ou plus récent** (22 conseillé) : https://nodejs.org
- Un compte **Supabase** (gratuit) : https://supabase.com
- Un compte **Vercel** (gratuit) : https://vercel.com
- Plus tard : un compte **API-Sports** (même compte qu'API-Football, phase 2) et un compte marchand **CinetPay** ou **FedaPay** (phase 6).

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
   - **Sans outil** : *SQL Editor* → collez puis exécutez dans l'ordre le contenu de
     `supabase/migrations/20261102000100_init_schema.sql` puis `supabase/migrations/20261102000200_reference_data.sql`.
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

| Variable | Phase | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 1 | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 1 | Clé publique (la sécurité repose sur la RLS) |
| `SUPABASE_SECRET_KEY` | 1 | Clé secrète, serveur uniquement (anti-abus, cron, webhooks) |
| `NEXT_PUBLIC_SITE_URL` | 1 | Adresse publique (liens des e-mails) |
| `RATE_LIMIT_SALT` | 1 | Sel pour anonymiser les compteurs anti-abus (`openssl rand -hex 24`) |
| `API_SPORTS_KEY`, `CRON_SECRET` | 2 | API-Sports (tous les sports) et sécurisation des tâches planifiées |
| `NEXT_PUBLIC_DESIGN_PREVIEW` | — | `1` pour afficher la page `/apercu` (données fictives) en production |
| `CINETPAY_*` / `FEDAPAY_*` | 6 | Paiements Mobile Money |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | 7 | Notifications push |

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

### Installer l'application sur Android

Ouvrez le site dans **Chrome** → menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »). L'application s'ouvre ensuite en plein écran, avec son icône, et les pages déjà consultées restent lisibles hors connexion.

## 7. Coupons : « code de X », analyse et codes de chargement

- **Générer un code** (`/coupons`) : l'utilisateur choisit la cote visée (2, 5, 10, 20…), le niveau de risque, la période et les sports (mélangés ou non). Le moteur (`src/lib/coupons/generator.ts`) cherche la combinaison dont la cote atteint la cible (100 à 115 %) avec la **probabilité réelle la plus élevée** — résolution exacte, vérifiée par des tests contre une recherche exhaustive. La chance réelle est toujours affichée (« 1 chance sur N ») : aucun coupon n'est présenté comme sûr.
- **Analyser un coupon** : l'utilisateur recopie ses sélections et leurs cotes ; l'application calcule la chance réelle (marge du bookmaker retirée), signale le maillon le plus faible et ce que changerait son retrait. Quand les matchs seront synchronisés, les sélections reconnues utiliseront les probabilités du modèle.
- **Codes de chargement (1xBet…)** : la table `coupon_booking_codes` stocke le code d'un coupon par bookmaker et par pays ; l'utilisateur le copie en un geste et le charge dans son application de paris. Les codes sont saisis par l'admin (pas d'API officielle connue pour les générer automatiquement — voir `docs/ARCHITECTURE.md`).
- Gratuit : `free_coupons_per_day` codes par jour (réglage), Premium : illimité.

## 8. Sécurité (résumé)

- **Row Level Security** sur toutes les tables, droits par défaut retirés, tests automatiques des règles.
- **Validation zod côté serveur** de chaque formulaire, messages d'erreur traduits sans détail technique.
- **18 ans minimum** vérifié trois fois : formulaire, serveur (zod) et base (déclencheur + contrainte).
- **Limitation des tentatives** (connexion, inscription, SMS, code) partagée entre instances, avec des clés hachées.
- **Redirections internes uniquement** (pas de redirection ouverte), **en-têtes de sécurité** (CSP, anti-iframe, HSTS…).
- **Pronostics publiés immuables** : impossible de réécrire l'historique.

## 9. Jeu responsable

Bandeau de prévention visible sur toutes les pages, page `/jeu-responsable`, inscription interdite aux mineurs. L'application n'affiche jamais de mention du type « gain garanti » ou « coupon sûr ».
