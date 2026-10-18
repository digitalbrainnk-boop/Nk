# 🎵 DB.Mélo — chansons personnalisées de qualité studio

Application SaaS **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Framer Motion**, installable sur **Android, iPhone, iPad et ordinateur** (PWA).

L'utilisateur écrit ses paroles (ou les fait écrire par l'IA), choisit la voix et le style, puis **paie 1 000 FCFA** par **Mobile Money** (Orange Money, Wave, MTN MoMo, Moov, Airtel Money, M-Pesa…) ou **carte** (Visa, Mastercard, Apple Pay, Google Pay), depuis **n'importe quel pays d'Afrique**. Le paiement confirmé, Suno (via Kie.ai) compose la chanson et en livre **deux versions** au choix (une seule composition, ≈ 12 crédits Kie) ; le **MP3 HD** s'enregistre sur le téléphone, s'envoie sur WhatsApp ou se partage via une **page cadeau avec QR code**.

> **Aucun son n'existe avant le paiement** : il n'y a rien à enregistrer à l'écran pour obtenir la chanson sans payer. (Bloquer l'enregistrement d'écran est impossible sur un site web ou une application installée depuis le navigateur ; aucun navigateur ne le permet, et le son peut de toute façon être capté par un autre téléphone.)

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

### Sur Android, avec Termux

1. Installe **Termux** depuis F-Droid : https://f-droid.org/packages/com.termux/ (pas la version du Play Store). Téléphone **64 bits (ARM64)** obligatoire.
2. Ouvre Termux et colle cette ligne, puis Entrée :
   ```
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/installer-termux.sh | bash
   ```
3. Réponds aux questions (clé Kie.ai, paiement simulé pour tes essais). La première installation prend 10 à 20 minutes : Next.js n'ayant pas de compilateur natif pour Android, l'application est compilée avec sa version WebAssembly (`next build --webpack`).
4. Chrome s'ouvre sur **http://localhost:3001** (le port 3000 reste à l'agent IA). Menu ⋮ → *Ajouter à l'écran d'accueil* pour l'icône DB.Mélo.

Commandes dans Termux :

| Commande | Effet |
|---|---|
| `dbmelo` | lance DB.Mélo (en arrière-plan) et ouvre Chrome ; il démarre aussi tout seul à l'ouverture de Termux |
| `dbmelo-stop` | arrête DB.Mélo et l'accès public |
| `dbmelo-journal` | affiche ce que fait le serveur |
| `dbmelo-public` | ouvre une adresse publique temporaire `https://….trycloudflare.com` pour montrer DB.Mélo à des clients (refusé tant que le paiement simulé est actif) |
| `dbmelo-maj` | met à jour, recompile et relance |
| `dbmelo-cles` | menu pour saisir **et tester** tes clés API (Kie.ai avec ton crédit restant, Claude, CinetPay, Flutterwave, Stripe, Paystack), activer ou couper le paiement simulé, choisir les versions (économiques ou rythmée + acoustique) et le modèle Suno, puis relancer |

Les clés restent dans `~/DBMelo/db-melo/.env.local` (lisible par toi seul), les commandes et les chansons dans `~/dbmelo-donnees`.

Limites : Termux doit rester ouvert et le téléphone allumé (idéalement en charge) ; l'adresse publique change à chaque `dbmelo-public`, et les webhooks configurés dans les tableaux de bord (Stripe, Flutterwave) ne peuvent pas la suivre. Le téléphone convient pour tester et faire des démonstrations ; pour vendre durablement, héberge DB.Mélo (o2switch, Render…).
Contrôles : `npm test` (tests unitaires), `npm run typecheck`.

## Parcours

1. **Studio** (`/studio`) : formulaire en 4 onglets validés étape par étape (Paroles · Voix · Style · Finaliser), brouillon sauvegardé sur l'appareil.
   - **Mode 1 « Studio Paroles »** : éditeur avec balises cliquables `[Couplet]`, `[Refrain]`, `[Pont]`, `[Solo Instrumental]`, `[Outro]`, détection des rimes (lettres A/B/C et couleurs par strophe) et compte des syllabes.
   - **Mode 2 « Parolier & Compositeur IA »** : prénom, surnoms, occasion, anecdotes, curseur d'émotion → paroles proposées, modifiables librement avant la musique.
   - **Voix** : masculine, féminine, duo, enfant, avec échantillon de 5 s.
   - **Style** : grille de styles (Afro-pop, Coupé-décalé, Zouk, R&B, Amapiano, Gospel…), inspiration libre, **Style Match** (tempo et énergie d'un MP3/WAV de référence mesurés dans le navigateur ; option « base » via Suno upload-cover si l'on détient les droits), instruments prioritaires.
2. **Commande** (`/chanson/:id`) : récapitulatif des paroles (encore modifiables) → **paiement** → composition en direct (1 à 5 min) → lecteur HD (forme d'onde, karaoké synchronisé), téléchargement mobile, choix de pochette, page cadeau. Si Suno échoue (mot refusé…), le client corrige ses paroles et relance sans repayer (3 compositions maximum par chanson, `MAX_GENERATION_ATTEMPTS`).
3. **Page cadeau** (`/cadeau/:slug`) : pochette, mot doux, lecteur karaoké, « Garder cette chanson sur mon téléphone », QR code.
4. **Mes chansons** (`/mes-chansons`) : les commandes créées sur cet appareil.

Parcours par défaut `FLOW_MODE=pay_first` : rien n'est composé ni audible avant le paiement (le serveur refuse la composition et la pré-écoute d'une chanson non payée). La composition démarre **côté serveur** dès la confirmation du paiement, même si le client a fermé la page (confirmation Mobile Money reçue par webhook). L'ancien parcours `FLOW_MODE=preview_first` (pré-écoute de 45 s avant paiement) reste disponible mais est déconseillé.

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

### Paiements : 1 000 FCFA, partout en Afrique

Le prix est défini dans `src/lib/constants.ts` (`SONG_PRICES`) : **1 000 FCFA** (XOF et XAF). Pour le Mobile Money hors zone FCFA, le client paie l'équivalent dans sa monnaie (GNF, CDF, GHS, KES, UGX, TZS, RWF, ZMW) ; ces équivalents sont **approximatifs, à ajuster** selon les taux du moment. Par carte, le client paie 1 000 FCFA, 1,50 € ou 1,75 $ ; sa banque convertit.

Le client choisit son **pays** (présélectionné d'après son fuseau horaire, les **54 pays d'Afrique** sont listés) :

| Pays | Mobile Money | Passerelle |
|---|---|---|
| Côte d'Ivoire, Sénégal, Burkina Faso, Mali, Togo, Bénin, Niger, Cameroun, Guinée, RD Congo | Orange Money, Wave, MTN, Moov, Free Money, T-Money, Airtel, M-Pesa, Afrimoney (selon le pays) | **CinetPay** (sinon Flutterwave / Paystack quand ils couvrent le pays) |
| Ghana, Kenya, Ouganda, Rwanda, Zambie, Tanzanie | MTN, Telecel Cash, AirtelTigo, M-Pesa, Airtel, Mixx by Yas, HaloPesa, Zamtel | **Flutterwave** (Paystack pour le Ghana et le Kenya) |
| Tous les autres pays (Nigeria, Maroc, Afrique du Sud, Gabon, Congo…) | — | **Carte bancaire** : Stripe, sinon Flutterwave, Paystack ou CinetPay |

Sécurité : le **montant vient toujours du serveur**, la passerelle renvoie sur `/api/payments/return`, puis le statut est **revérifié auprès du prestataire** (montant et devise contrôlés) avant de lancer la composition. Les webhooks sont authentifiés (HMAC CinetPay `x-token`, HMAC-SHA512 Paystack, `verif-hash` Flutterwave, signature Stripe) puis revérifiés.

Configuration chez les prestataires (au moins un pour le Mobile Money et un pour la carte) :

- **CinetPay** : `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY`. L'adresse de notification `https://ton-domaine/api/payments/webhooks/cinetpay` est transmise à chaque paiement.
- **Flutterwave** : `FLUTTERWAVE_SECRET_KEY` ; webhook `https://ton-domaine/api/payments/webhooks/flutterwave` avec un « Secret hash » recopié dans `FLUTTERWAVE_WEBHOOK_HASH`.
- **Stripe** : `STRIPE_SECRET_KEY` ; webhook `https://ton-domaine/api/payments/webhooks/stripe` avec les événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, puis `STRIPE_WEBHOOK_SECRET`. Activez Apple Pay / Google Pay dans le tableau de bord Stripe.
- **Paystack** : `PAYSTACK_SECRET_KEY` ; webhook `https://ton-domaine/api/payments/webhooks/paystack`.
- **Ton entreprise** (`MERCHANT_NAME`, `MERCHANT_EMAIL`, `MERCHANT_PHONE`, `MERCHANT_ADDRESS`, `MERCHANT_REGISTRATION`, `HOSTING_INFO`) : affichée sur `/contact`, `/conditions` et `/confidentialite`, que CinetPay vérifie avant de valider un compte. `MERCHANT_EMAIL` sert aussi de reçu quand Flutterwave ou Paystack exigent un e-mail. Tout se règle dans `dbmelo-cles` → 7.

#### Ouvrir le compte CinetPay

1. Sur cinetpay.com, crée un compte **marchand** (entreprise, ou particulier si ton pays le permet) et envoie les pièces demandées.
2. Comme site web, donne ton domaine (ex. `https://dbmelo.com`) ; comme activité : « vente en ligne de chansons personnalisées (contenu numérique) ». Les pages Contact, Conditions de vente et Confidentialité sont en bas de chaque page.
3. Une fois le compte validé : **Intégrations** → copie l'**API KEY**, le **SITE ID** et la **SECRET KEY** dans `dbmelo-cles` → 3. Rien d'autre à régler : l'adresse de notification est envoyée par DB.Mélo à chaque paiement.
4. Active les opérateurs Mobile Money de ton pays (et la carte si tu veux), puis fais un vrai paiement de 1 000 FCFA pour vérifier.

Le paiement simulé n'est proposé que pour les chansons de démo, ou si `ALLOW_DEMO_PAYMENTS=true` (tests uniquement).

L'offre Prestige (WAV, 4 prises, pochette IA) est désactivée ; pour la proposer, passer `enabled: true` dans `PLANS` et fixer ses prix.

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
| `KIE_SUNO_MODEL` | `V6` par défaut ; `V6_MINI`, `V6_WILD` ou `V5` possibles |
| `KIE_SUNO_FALLBACK_MODEL` | `V5` : utilisé si Kie refuse le modèle principal, et pour les relances après un échec |
| `VERSIONS_MODE` | `takes` (défaut) : 1 composition Suno, ses 2 prises font les 2 versions (≈ 12 crédits) ; `styles` : une version rythmée + une acoustique (2 compositions, ≈ 24 crédits) |
| `ANTHROPIC_API_KEY` | Parolier Claude (facultatif) |
| `FLOW_MODE` | `pay_first` (défaut : paiement avant composition) ou `preview_first` |
| `MAX_GENERATION_ATTEMPTS` | Compositions autorisées par chanson, relances comprises (3) |
| `PREVIEW_SECONDS`, `GENERATIONS_PER_HOUR` | Pré-écoute et limite par adresse IP, en `preview_first` uniquement |
| `CINETPAY_*`, `FLUTTERWAVE_*`, `PAYSTACK_SECRET_KEY`, `STRIPE_*`, `MERCHANT_EMAIL` | Passerelles de paiement |
| `DATA_DIR` | Dossier de stockage persistant (défaut `.data`) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Stockage pour l'hébergement serverless |

## Hébergement

### o2switch (recommandé)

GitHub compile DB.Mélo à chaque modification (`.github/workflows/dbmelo-o2switch.yml`) et publie un paquet prêt à installer : le serveur n'a rien à compiler. Les données (`~/dbmelo-donnees`) et la configuration (`~/dbmelo-app/.env`) sont conservées d'une version à l'autre.

1. **Commande** l'offre o2switch et choisis ton nom de domaine. Attends l'e-mail avec l'accès à cPanel.
2. **cPanel → Setup Node.js App → Create Application** :
   - Node.js version : la plus récente (au moins 20) ;
   - Application mode : Production ;
   - Application root : `dbmelo-app` ;
   - Application URL : ton domaine ;
   - Application startup file : `app.js` ;
   - puis **Create**.
3. **cPanel → Terminal** : colle la ligne suivante, puis Entrée, et donne ton domaine quand il est demandé :
   ```bash
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/db-melo-saas-app-14k2yw/db-melo/deploy/o2switch/installer.sh | bash
   ```
4. Ouvre un **nouveau** Terminal et tape `dbmelo-cles` : clé Kie (1), ton entreprise (7), CinetPay (3) quand ton compte est validé, test (9), puis 0 pour redémarrer.
5. **cPanel → SSL/TLS Status** : vérifie que ton domaine a un certificat (AutoSSL, gratuit). Ouvre `https://ton-domaine` : DB.Mélo est en ligne.

| Commande (Terminal cPanel) | Rôle |
|---|---|
| `dbmelo-cles` | clés API, ton entreprise, adresse du site, test du site et des clés |
| `dbmelo-maj` | installer la dernière version |
| `dbmelo-journal` | voir ce que fait le serveur |
| `dbmelo-relancer` | redémarrer DB.Mélo (ou bouton **Restart** dans Setup Node.js App) |
| `dbmelo-retour` | revenir à la version précédente |

Passenger peut lancer plusieurs processus Node : le stockage sur fichiers est protégé par un verrou partagé.

### Autres hébergeurs

- **Render / VPS / Railway** : dossier racine `db-melo`, build `npm install && npm run build`, démarrage `npm start`, **disque persistant** monté sur `DATA_DIR` (commandes, copies audio, photos).
- **Vercel** : dossier racine `db-melo`, renseigner `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Sans disque, les fichiers ne sont pas copiés localement : les liens audio restent ceux de Kie (expiration d'environ deux semaines). Prévoir un stockage objet (S3, R2…) pour une conservation longue.

## Échantillons vocaux

`KIE_API_KEY=… npm run samples` génère `public/samples/voice-{male,female,duo,child}.mp3` (extraits de 5 s, coupés avec ffmpeg). Sans eux, un aperçu synthétique du timbre est proposé.

## À savoir avant la mise en ligne

- **Accès** : pas de compte utilisateur. Une commande est accessible par son lien privé (identifiant aléatoire de 128 bits) ; la page cadeau a un identifiant distinct et ne donne accès qu'à l'écoute. Pour un historique multi-appareils, ajouter une authentification (Auth.js, Clerk…).
- **Limiteur de débit** en mémoire : suffisant sur une instance ; derrière plusieurs instances, utiliser un limiteur partagé.
- **Enregistrement d'écran** : impossible à bloquer sur le web. La protection repose sur le paiement avant composition ; une fois payée, la chanson appartient au client.
- **Coût par commande** : une composition Suno par chanson (≈ 12 crédits Kie, ses 2 prises font les 2 versions), et jusqu'à 2 relances gratuites en cas d'échec, en V5. Garde toujours du crédit Kie d'avance : sans crédit, un client qui a payé ne reçoit pas sa chanson.
- **Langue** : l'interface est en français ; une version anglaise faciliterait l'usage au Nigeria, au Ghana, au Kenya…
- **API Kie** : les routes `get-timestamped-lyrics`, `wav`, `jobs` (images) et l'envoi de fichiers suivent la documentation Kie ; les noms de modèles d'image sont réglables (`KIE_IMAGE_MODEL`, `KIE_IMAGE_EDIT_MODEL`). Faites un premier essai réel avec une petite recharge.
- **Paystack en XOF** : le montant est envoyé en « sous-unité » (× 100), comme pour les autres devises ; à confirmer sur votre compte.
- **Flutterwave** : les options Mobile Money par pays (`mobilemoneyghana`, `mpesa`, `mobilemoneyfranco`…) suivent sa documentation ; faites un paiement test par pays visé.
- **Textes** : la FAQ, les conditions de vente et la politique de confidentialité sont des propositions à faire relire ; vérifie aussi les conditions de Kie et de Suno sur l'usage commercial des chansons générées.
