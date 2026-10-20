# 🎵 Mon agent IA — répond à tes clients comme toi

Un site (tableau de bord) avec un agent IA qui répond à tes clients sur **WhatsApp**, **Telegram**, **Messenger**, **Instagram** et aux **commentaires Facebook** — avec ta façon d'écrire, une mémoire de chaque client et la compréhension des **messages vocaux**.

## Ce que fait l'agent

- **Il écrit comme toi** : il apprend de tes vraies conversations (export WhatsApp, historique synchronisé, tes réponses en direct, tes corrections).
- **Il se comporte comme un humain** : il attend que le client ait fini d'écrire, laisse un délai avant de répondre, affiche « en train d'écrire… », découpe ses réponses en plusieurs petits messages.
- **Mémoire** : pour chaque client il retient le prénom, l'occasion, la chanson demandée, le budget, l'étape de la commande… (modifiable dans le tableau de bord).
- **Vocaux** : transcrits automatiquement (Whisper via Groq ou OpenAI) puis compris par l'agent. Les photos sont aussi vues.
- **Il n'invente rien** : prix, délais et conditions viennent de tes fiches « Mon activité » et de tes conversations. Quand il ne sait pas, ou pour un paiement, une réclamation… il te signale « 🔔 besoin de toi » (et peut t'alerter sur Telegram).
- **Tu gardes la main** :
  - mode **Brouillon** (conseillé au début) : il prépare, tu cliques « Envoyer », « Corriger » ou « Rejeter » — chaque correction lui apprend quelque chose ;
  - mode **Auto** : il répond seul ;
  - si tu réponds toi-même depuis ton téléphone, il se tait avec ce client pendant quelques heures ;
  - pause par conversation, et mode observation WhatsApp (il apprend sans répondre).
- **Honnête** : si un client demande sincèrement s'il parle à une IA, l'agent ne ment pas (il dit être ton assistant). Dans plusieurs pays (ex. Union européenne), signaler qu'un client parle à une IA est une obligation légale.

## Installation

Il faut **Node.js 22.13 ou plus récent** (https://nodejs.org).

```bash
npm install
cp .env.example .env      # puis mets ta clé ANTHROPIC_API_KEY dedans
npm start
```

Ouvre http://localhost:3000. Le mot de passe s'affiche dans le terminal (ou définis `ADMIN_PASSWORD` dans `.env`).

Clé Claude : https://console.anthropic.com → API Keys. Elle peut aussi être collée dans **Réglages**.

### Sur Android (sans ordinateur)

1. Installe **Termux** depuis F-Droid : https://f-droid.org/packages/com.termux/ (pas la version du Play Store).
2. Ouvre Termux et colle cette ligne, puis Entrée :
   ```
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/claude/ai-agent-multichannel-0snabq/installer-android.sh | bash
   ```
3. Réponds aux questions (clé Claude, mot de passe). L'agent démarre tout seul à la fin, puis à chaque ouverture de Termux (ou tape `agent`).
4. Dans Chrome, ouvre http://localhost:3000. Menu ⋮ → *Ajouter à l'écran d'accueil* pour avoir l'icône comme une application.
5. WhatsApp : dans Canaux, utilise **« Recevoir un code »** (pas le QR, impossible de scanner son propre écran). Le code s'affiche sur la page **et** dans Termux ; c'est toi qui le tapes dans WhatsApp → Appareils connectés → Connecter un appareil → « Associer avec le numéro de téléphone ».
   Si ça bloque : arrête l'agent (CTRL + c) puis `npm run whatsapp` pour te connecter directement dans Termux.

Limites : Termux doit rester ouvert et le téléphone allumé (idéalement en charge) ; Facebook/Instagram demandent une adresse internet publique, donc un hébergement en ligne.

### Kie.ai : DeepSeek comme cerveau + Suno pour les chansons

Réglages → **Cerveau de l'agent** → « Kie.ai — DeepSeek V4.1 Flash », colle ta **clé Kie.ai** dans la section Kie.ai, puis **Tester la connexion** (le bon nom de modèle est trouvé automatiquement).

Dans une conversation, bouton **🎵 Créer la chanson** : l'IA écrit titre, style et paroles à partir de la discussion, tu corriges, puis **Lancer Suno**. 1 à 5 minutes plus tard, les versions apparaissent dans la conversation : tu les écoutes et tu cliques **Envoyer au client** (WhatsApp, Telegram, Messenger, Instagram).

### Commandes, relances et ventes

- Chaque client qui demande une chanson a une **commande** (panneau 📦 dans la conversation) : étape, prix, payé, date. L'agent remplit lui-même l'occasion, le prix annoncé et la date ; **seul toi** marques un paiement.
- **Relances automatiques** : un client silencieux avec une demande ou un devis en cours reçoit une relance douce après X heures (Réglages → Commandes et relances).
- Onglet **Ventes** : encaissé du mois, reste à encaisser, commandes en cours, livrées, clients, graphique par semaine et liste des commandes.

### Réponses en vocal et démo automatique

- Réglages → **Répondre en vocal** : jamais, quand le client envoie un vocal, ou toujours. Voix ElevenLabs via ta clé Kie.ai (bouton « Écouter cette voix »). Avec ffmpeg installé, c'est une vraie note vocale.
- **Démo automatique** : quand un client hésite, l'agent prépare un extrait avec Suno (une fois par client) ; tu l'écoutes avant de l'envoyer.

### Numéros ignorés, vocaux et crédits

- **Ne jamais répondre** : Réglages → liste de numéros (avec ou sans indicatif, ou @pseudo Telegram), ou bouton « 🚫 Ne jamais répondre » dans une conversation. Les messages sont gardés, l'agent ne répond pas.
- **Vocaux** : sans clé Whisper/Groq, l'agent cherche un modèle de transcription dans la documentation Kie et l'utilise avec ta clé Kie (`npm run diag` montre s'il l'a trouvé).
- **Crédits Kie** : le solde est lu avant/après chaque réponse, vocal ou chanson ; le coût (estimation) s'affiche par conversation et dans Ventes (ce mois, par conversation, par réponse). 1 crédit ≈ 0,005 $.

### Connecter l'agent à tes applications (onglet Applications)

1. **Prévenir mes applications (webhooks)** : à chaque événement choisi (nouveau message, commande, paiement, « besoin de toi », chanson prête), l'agent envoie un JSON signé (`X-Agent-Signature: sha256=HMAC(clé, corps)`) à une adresse. Avec **Make / Zapier / n8n**, ça relie l'agent à Google Sheets, Gmail, Agenda, Notion…
2. **Actions de l'agent** : des adresses que l'agent peut appeler pendant une conversation (ex : « Disponibilités », « Catalogue »). Il envoie `{"input": "...", "contact": {...}}` et répond au client avec le résultat. Il ne voit que le nom et la description de l'action, jamais les clés. Chaque appel apparaît dans la conversation (🔌).

### Utiliser un autre cerveau que Claude (DeepSeek, OpenRouter…)

Réglages → **Cerveau de l'agent** → « Autre service compatible OpenAI », puis colle l'adresse de l'API (`…/chat/completions`), ta clé et le nom du modèle (ex. `deepseek-v4-flash`). Le bouton **Tester la connexion** vérifie que tout marche. Les photos ne sont pas vues par ces modèles (seulement signalées).

## Premiers pas (dans cet ordre)

1. **Mon activité** : ton nom, ta description, et des fiches (tarifs, délais, étapes, paiement, FAQ).
2. **Apprentissage** : exporte des discussions WhatsApp avec des clients (discussion → ⋮ → *Exporter la discussion* → *Sans médias*), dépose les fichiers, choisis ton nom, puis clique **Analyser ma façon d'écrire**.
3. **Tester** : joue le client et regarde comment il répond. Ajuste les fiches, le profil, les consignes.
4. **Canaux** : connecte WhatsApp (QR code), Telegram, Facebook… en laissant le mode **Brouillon**.
5. Quand les brouillons te conviennent presque toujours, passe le canal en **Auto**.

## Les canaux

### WhatsApp (ton numéro)
Canaux → **Connecter** → scanne le QR depuis WhatsApp → *Appareils connectés*. L'agent fonctionne comme un « WhatsApp Web ». Ton historique est synchronisé et sert d'exemples de style.

⚠️ Méthode non officielle (bibliothèque Baileys) : WhatsApp peut restreindre un numéro qui envoie beaucoup de messages automatiques. Le serveur doit rester allumé.

### WhatsApp Business Cloud (officiel)
Pour un numéro dédié via Meta : renseigne le jeton et le *Phone number ID*, et abonne l'app au webhook (voir Facebook ci-dessous, champ `messages`).

### Telegram
Sur Telegram, écris à **@BotFather** → `/newbot` → colle le jeton dans Canaux. Les clients écrivent à ton bot. Pour recevoir les alertes « besoin de toi », mets ton *chat ID* (obtenable via @userinfobot) et envoie un premier message à ton bot.

### Facebook (Messenger, commentaires) & Instagram
1. Sur https://developers.facebook.com crée une app (type *Business*) et ajoute **Messenger** (et **Instagram** / **WhatsApp** si besoin).
2. Génère un **jeton d'accès de la Page** (permissions `pages_messaging`, `pages_manage_engagement`, `pages_read_engagement`, `pages_manage_metadata`, et `instagram_manage_messages` pour Instagram).
3. Dans Canaux, colle le jeton, la **clé secrète de l'app** et invente un **jeton de vérification**.
4. Dans l'app Meta → Webhooks : URL = l'adresse affichée dans Canaux (`https://ton-domaine/webhooks/meta`), même jeton de vérification. Abonne la Page aux champs `messages`, `message_echoes` et `feed` (commentaires).
5. Meta exige une adresse **https publique** : héberge le site (voir ci-dessous) ou, pour tester, utilise un tunnel (`cloudflared tunnel --url http://localhost:3000`).

## Héberger le site 24h/24

### En un clic avec Render (recommandé)

[![Déployer sur Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/digitalbrainnk-boop/Nk/tree/claude/ai-agent-multichannel-0snabq)

1. Clique sur le bouton, connecte-toi à Render avec ton compte GitHub.
2. Remplis `ANTHROPIC_API_KEY` (ta clé `sk-ant-…`) et `ADMIN_PASSWORD` (ton mot de passe), puis **Apply**.
3. Après quelques minutes, Render te donne une adresse `https://mon-agent-ia-xxxx.onrender.com` : c'est ton tableau de bord, accessible depuis ton téléphone.
4. Cette adresse sert aussi de webhook pour Facebook/Instagram (`https://…onrender.com/webhooks/meta`).

L'offre utilisée (Starter + disque de 1 Go) est payante (quelques dollars par mois) : c'est nécessaire pour garder la session WhatsApp et la mémoire des clients.

### Ailleurs

N'importe quel serveur avec Node.js (VPS, Railway, Render, Fly.io…). Le dossier `data/` contient la base de données, la session WhatsApp et les médias : il doit être **persistant** et **sauvegardé**. Ne le partage jamais (il donne accès à ton WhatsApp).

## Coûts

- Claude : facturé à l'usage. Opus 5.5 est le plus intelligent ; Sonnet 5.5 ou Haiku 5.5 (dans Réglages) coûtent moins cher.
- Transcription : Groq Whisper coûte quelques centimes par heure d'audio.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/server.js` | Serveur web, API du tableau de bord, connexion |
| `src/router.js` | Orchestration : attente, délais humains, brouillons, prise de main |
| `src/agent.js` | Le cerveau : prompt, style, exemples, mémoire, appel à Claude |
| `src/learning.js` | Lecture des exports WhatsApp → exemples de style |
| `src/media.js` | Médias reçus et transcription des vocaux |
| `src/db.js` | Base SQLite locale (`data/agent.db`) |
| `src/channels/` | WhatsApp, Telegram, Meta (Messenger, Instagram, commentaires, WA Cloud) |
| `public/` | Le tableau de bord |

Tests : `npm test`.

## Idées pour la suite

- Répondre par **message vocal avec ta voix** (clonage vocal / synthèse).
- Envoyer automatiquement des extraits de tes chansons comme exemples.
- Suivi des commandes et des paiements (statuts, relances automatiques).
- Telegram sur ton compte personnel (pas seulement un bot).
