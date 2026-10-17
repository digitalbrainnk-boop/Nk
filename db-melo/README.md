# 🎵 DB.Mélo — chansons personnalisées de qualité studio

Application SaaS **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Framer Motion**, installable sur **Android, iPhone, iPad et ordinateur** (PWA).

L'utilisateur écrit ses paroles (ou les fait écrire par l'IA), choisit la voix et le style. Suno, via Kie.ai, compose **deux versions** (A rythmée, B acoustique) ; l'utilisateur écoute une **pré-écoute protégée** puis paie par **Mobile Money** (Orange Money, Wave, MTN MoMo, Moov Money) ou **carte** (Visa, Mastercard, Apple Pay, Google Pay). Le **MP3 HD sans watermark** se débloque alors : on peut l'enregistrer sur le téléphone, l'envoyer sur WhatsApp ou partager une **page cadeau avec QR code**.

> Sans aucune clé, l'application tourne en **mode démo** : maquette musicale synthétisée, paiement simulé. Le parcours complet est testable tout de suite.

## Démarrer

Il faut **Node.js 20.9 ou plus récent**.

```bash
cd db-melo
npm install
cp .env.example .env.local   # facultatif : sans clé = mode démo
npm run dev                  # http://localhost:3000
```

Production : `npm run build && npm start` (port `PORT`, 3000 par défaut).
Contrôles : `npm test` (tests unitaires), `npm run typecheck`.

## Parcours

1. **Studio** (`/studio`) : formulaire en 4 onglets validés étape par étape (Paroles · Voix · Style · Finaliser), brouillon sauvegardé sur l'appareil.
   - **Mode 1 « Studio Paroles »** : éditeur avec balises cliquables `[Couplet]`, `[Refrain]`, `[Pont]`, `[Solo Instrumental]`, `[Outro]`, détection des rimes (lettres A/B/C et couleurs par strophe) et compte des syllabes.
   - **Mode 2 « Parolier & Compositeur IA »** : prénom, surnoms, occasion, anecdotes, curseur d'émotion → paroles proposées, modifiables librement avant la musique.
   - **Voix** : masculine, féminine, duo, enfant, avec échantillon de 5 s.
   - **Style** : grille de styles (Afro-pop, Coupé-décalé, Zouk, R&B, Amapiano, Gospel…), inspiration libre, **Style Match** (tempo et énergie d'un MP3/WAV de référence mesurés dans le navigateur ; option « base » via Suno upload-cover si l'on détient les droits), instruments prioritaires.
2. **Commande** (`/chanson/:id`) : progression en direct → pré-écoute de 45 s des deux versions (filigrane sonore) → paiement → lecteur HD (forme d'onde, karaoké synchronisé), téléchargement mobile, choix de pochette, page cadeau.
3. **Page cadeau** (`/cadeau/:slug`) : pochette, mot doux, lecteur karaoké, « Garder cette chanson sur mon téléphone », QR code.
4. **Mes chansons** (`/mes-chansons`) : les commandes créées sur cet appareil.

Variante `FLOW_MODE=pay_first` : les paroles sont validées, le paiement a lieu **avant** la composition.

## Livrables demandés : où les trouver

| Livrable | Fichier |
|---|---|
| Interfaces `SongConfig`, `KieGenerationRequest`, `PaymentProvider` (et tout le modèle) | `src/lib/types.ts` |
| Formulaire principal à onglets + validation | `src/components/creator/SongCreator.tsx` (schémas : `src/lib/schemas.ts`) |
| Hook `useKieSuno` (appel, polling, états) | `src/hooks/useKieSuno.ts` |
| `downloadToMobile` (Web Share API + Blob) | `src/lib/client/download-to-mobile.ts` |
| Sélection de paiement Mobile Money / carte | `src/components/payment/PaymentSelector.tsx` |
| Service `/api/generate-music` (Kie/Suno) | `src/app/api/generate-music/route.ts`, `src/lib/server/kie.ts`, `src/lib/server/songs.ts`, `src/lib/kie-prompt.ts` |

## Architecture

```
src/
  app/                    pages + routes API (App Router)
    api/generate-music    POST lance A + B · GET suivi (polling)
    api/generate-lyrics   parolier IA
    api/kie/callback      webhook Kie (adresse signée HMAC)
    api/songs/[id]/audio  pré-écoute tronquée · HD étiqueté ID3 · WAV
    api/songs/[id]/cover  pochettes (IA, Suno, collector)
    api/payments/*        options · checkout · verify · return · webhooks/[provider]
    api/gift/[slug]/*     audio et pochette de la page cadeau
    manifest.ts, icons/, apple-icon.tsx      PWA
  components/             creator · player · payment · song · gift · pwa · landing
  hooks/useKieSuno.ts
  lib/
    types.ts, constants.ts, schemas.ts, pricing.ts, kie-prompt.ts
    lyrics/   rimes françaises, balises Suno, calage karaoké, parolier de secours
    audio/    écriture ID3v2.3, maquette de démo
    client/   downloadToMobile, analyse BPM, envoi de fichiers…
    server/   env, store (disque / Upstash), kie, songs, audio, cover, lyrics, payments/
public/sw.js              service worker (hors ligne, installation)
```

### Moteur musical : Suno via Kie.ai

- `POST /api/v1/generate` en **Custom Generation** (`customMode: true`) : paroles, style, titre, `vocalGender`, `negativeTags`, `styleWeight`, `weirdnessConstraint`. Deux tâches sont lancées : **A** (« upbeat rhythmic… ») et **B** (« acoustic, soft and intimate… »). Chaque tâche renvoie 2 prises (les 4 prises sont incluses dans l'offre Prestige).
- Les balises françaises sont converties pour Suno : `[Couplet 1]` → `[Verse 1]`, `[Refrain]` → `[Chorus]`, `[Pont]` → `[Bridge]`, `[Solo Instrumental]` → `[Saxophone Solo]` (selon l'instrument choisi)… En duo, les couplets sont attribués `[Verse 1: Male Vocal]`, `[Chorus: Duet]`…
- Suivi : le navigateur interroge `GET /api/generate-music?songId=` toutes les 5 s (pause en arrière-plan, ralentissement sur erreur) ; le serveur relit `GET /api/v1/generate/record-info` (au plus toutes les 3 s). Le webhook Kie (`callBackUrl` signé) accélère la mise à jour quand `PUBLIC_BASE_URL` est une adresse https publique.
- À la réussite : `get-timestamped-lyrics` fournit les mots horodatés (karaoké exact) et la forme d'onde ; à défaut, le calage est estimé par syllabes.
- Offre Prestige, après paiement : conversion **WAV** (`/api/v1/wav/generate`) et **pochette IA** (`/api/v1/jobs/createTask`, modèles `KIE_IMAGE_MODEL` / `KIE_IMAGE_EDIT_MODEL` avec la photo).
- Les URL audio Kie **ne sont jamais envoyées au navigateur avant paiement** : la pré-écoute est servie par nos routes (requête `Range`, coupée à `PREVIEW_SECONDS`). Après paiement, une copie locale est gardée (les liens Kie expirent après environ deux semaines).

### Parolier IA

Ordre : **Claude** (`ANTHROPIC_API_KEY`, modèle `LYRICS_MODEL`, sortie JSON structurée), sinon **DeepSeek via Kie** (`KIE_CHAT_MODEL`), sinon un parolier intégré à partir de modèles rimés (proposition à retoucher).

### Paiements

| Moyen | Passerelle | Devises |
|---|---|---|
| Mobile Money : Orange Money, Wave, MTN MoMo, Moov Money | **CinetPay** (prioritaire), sinon Paystack | XOF, XAF |
| Carte : Visa, Mastercard, Apple Pay, Google Pay | **Stripe** (prioritaire), sinon Paystack, sinon CinetPay | EUR, USD, XOF, XAF |

Flux sécurisé : le **montant vient toujours du serveur** (`src/lib/constants.ts` → `PLANS`), la passerelle renvoie sur `/api/payments/return`, puis le statut est **revérifié auprès du prestataire** (montant et devise contrôlés) avant de débloquer le téléchargement. Les webhooks sont authentifiés (HMAC CinetPay `x-token`, HMAC-SHA512 Paystack, signature Stripe) puis revérifiés de la même façon.

Configuration chez les prestataires :

- **CinetPay** : `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`. L'adresse de notification `https://ton-domaine/api/payments/webhooks/cinetpay` est transmise à chaque paiement.
- **Stripe** : `STRIPE_SECRET_KEY` ; webhook `https://ton-domaine/api/payments/webhooks/stripe` avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, puis `STRIPE_WEBHOOK_SECRET`. Activez Apple Pay / Google Pay dans le tableau de bord Stripe (domaine vérifié pour Apple Pay).
- **Paystack** : `PAYSTACK_SECRET_KEY` ; webhook `https://ton-domaine/api/payments/webhooks/paystack`.

Le paiement simulé n'est proposé que pour les chansons de démo, ou si `ALLOW_DEMO_PAYMENTS=true` (tests uniquement).

### Téléchargement sur le téléphone

`downloadToMobile` (`src/lib/client/download-to-mobile.ts`) :

1. **Web Share API** (`navigator.share({ files })`) : feuille de partage native → « Enregistrer dans Fichiers » (iPhone, iPad), Fichiers / lecteurs (Android), ou WhatsApp en un geste.
2. Sinon, **téléchargement forcé** via un Blob et `<a download>` (Android → Téléchargements, ordinateur → dossier choisi).

Le fichier est préchargé avant le clic : Safari exige que le partage parte directement du geste. Le MP3 contient le **titre**, l'**artiste « DB.Mélo »**, l'album, les **paroles** et la **pochette** (ID3v2.3 écrit côté serveur, `src/lib/audio/id3.ts`, vérifié avec ffprobe dans les tests).
Limite des navigateurs : sur iPhone, un site ne peut pas ajouter un fichier directement à l'app Musique ; il s'enregistre dans Fichiers, d'où on peut l'ouvrir et le partager.

### Application installable

`manifest.webmanifest` (icônes 192/512 et maskable générées au build), icône Apple, `display: standalone`, raccourcis, service worker (coquille hors ligne, jamais de cache pour l'API). Bouton **« Installer l'app »** sur Android / Chrome / Edge, et instructions « Partager → Sur l'écran d'accueil » sur iPhone et iPad.

## Variables d'environnement

Voir `.env.example`. Les plus importantes :

| Variable | Rôle |
|---|---|
| `PUBLIC_BASE_URL` | Adresse https publique (webhooks Kie et paiements, liens cadeau) |
| `KIE_API_KEY` | Clé Kie.ai (sans elle : mode démo) |
| `KIE_SUNO_MODEL` | `V5` par défaut |
| `ANTHROPIC_API_KEY` | Parolier Claude (facultatif) |
| `FLOW_MODE` | `preview_first` (défaut) ou `pay_first` |
| `PREVIEW_SECONDS` | Durée de la pré-écoute (45 s) |
| `GENERATIONS_PER_HOUR` | Créations autorisées par adresse IP et par heure (protège le crédit Kie) |
| `CINETPAY_*`, `PAYSTACK_SECRET_KEY`, `STRIPE_*` | Passerelles de paiement |
| `DATA_DIR` | Dossier de stockage persistant (défaut `.data`) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Stockage pour l'hébergement serverless |

## Hébergement

- **Render / VPS / Railway** (recommandé) : dossier racine `db-melo`, build `npm install && npm run build`, démarrage `npm start`, **disque persistant** monté sur `DATA_DIR` (commandes, copies audio, photos).
- **Vercel** : dossier racine `db-melo`, renseigner `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Sans disque, les fichiers ne sont pas copiés localement : les liens audio restent ceux de Kie (expiration d'environ deux semaines). Prévoir un stockage objet (S3, R2…) pour une conservation longue.

## Échantillons vocaux

`KIE_API_KEY=… npm run samples` génère `public/samples/voice-{male,female,duo,child}.mp3` (extraits de 5 s, coupés avec ffmpeg). Sans eux, un aperçu synthétique du timbre est proposé.

## À savoir avant la mise en ligne

- **Accès** : pas de compte utilisateur. Une commande est accessible par son lien privé (identifiant aléatoire de 128 bits) ; la page cadeau a un identifiant distinct et ne donne accès qu'à l'écoute. Pour un historique multi-appareils, ajouter une authentification (Auth.js, Clerk…).
- **Limiteur de débit** en mémoire : suffisant sur une instance ; derrière plusieurs instances, utiliser un limiteur partagé.
- **Pré-écoute** : protégée côté serveur (extrait tronqué, URL d'origine jamais exposée) ; le filigrane sonore est ajouté par le lecteur.
- **API Kie** : les routes `get-timestamped-lyrics`, `wav`, `jobs` (images) et l'envoi de fichiers suivent la documentation Kie ; les noms de modèles d'image sont réglables (`KIE_IMAGE_MODEL`, `KIE_IMAGE_EDIT_MODEL`). Faites un premier essai réel avec une petite recharge.
- **Paystack en XOF** : le montant est envoyé en « sous-unité » (× 100), comme pour les autres devises ; à confirmer sur votre compte.
- **Textes** : la FAQ et les conditions (droits d'usage des chansons) sont des propositions à faire relire.
