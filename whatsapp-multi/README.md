# Multi-Lignes : superviser plusieurs comptes WhatsApp Business

Un backend Node.js (Express + Socket.io + [Baileys](https://github.com/WhiskeySockets/Baileys)) et une application installable (PWA, prête pour Capacitor) pour consulter et suivre plusieurs comptes WhatsApp Business depuis ton téléphone. Chaque compte est une **ligne** complètement isolée.

## L'isolation, concrètement

| Niveau | Ce qui est séparé |
|---|---|
| Disque | `data/sessions/<id>/` : `auth/` (clés WhatsApp), `store.json` (historique) et `meta.json` propres à chaque ligne |
| Mémoire | une instance `WhatsAppSession` par ligne : son propre socket Baileys, son propre `MessageStore`, ses propres événements |
| Temps réel | une salle Socket.io `session:<id>` par ligne. Un client n'est jamais dans deux salles de ligne à la fois : changer de ligne lui fait quitter l'ancienne côté serveur |
| API REST | toutes les routes de messages portent `:id` et ne lisent que le store de cette ligne |
| Interface | seules les données de la ligne active sont gardées en mémoire. Tout événement ou toute réponse qui ne porte pas le `sessionId` actif est ignoré |
| Changement de numéro | si un **autre** numéro est relié à une ligne, l'ancien historique de cette ligne est effacé |

Un test de bout en bout (`test/isolation.test.js`) vérifie qu'un message de la ligne 1 n'arrive jamais chez un client qui regarde la ligne 2.

## Structure du projet

```
whatsapp-multi/
├── package.json
├── .env.example               # configuration (port, jeton, limites…)
├── capacitor.config.json      # pour empaqueter l'app en Android / iOS
├── scripts/
│   └── copy-vendor.js         # copie le client Socket.io dans public/vendor (postinstall)
├── src/
│   ├── server.js              # point d'entrée : démarrage et arrêt propre
│   ├── app.js                 # Express (API + fichiers PWA) + Socket.io
│   ├── config.js              # lecture des variables d'environnement
│   ├── logger.js              # journaux (pino)
│   ├── errors.js              # erreurs métier avec code HTTP
│   ├── http/
│   │   ├── auth.js            # jeton Bearer (REST + Socket.io), anti-force brute
│   │   └── routes/sessions.js # endpoints REST
│   ├── realtime/
│   │   └── socket.js          # salles par ligne, diffusion des événements
│   └── whatsapp/
│       ├── SessionManager.js  # registre des lignes (création, reprise, suppression)
│       ├── WhatsAppSession.js # UNE ligne : connexion QR/code, reconnexion, messages
│       ├── MessageStore.js    # historique d'UNE ligne (fichier JSON)
│       ├── messageParser.js   # message Baileys -> objet simple
│       └── jid.js             # numéros et identifiants WhatsApp
├── public/                    # la PWA (aucune étape de build)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                  # service worker (cache de l'interface uniquement)
│   ├── css/app.css
│   ├── js/
│   │   ├── app.js             # contrôleur : état, isolation côté client
│   │   ├── api.js             # client REST
│   │   ├── realtime.js        # client Socket.io
│   │   ├── settings.js        # adresse du serveur + jeton (stockés sur l'appareil)
│   │   ├── ui.js              # échappement HTML, dates, dialogues, toasts
│   │   └── views/
│   │       ├── lines.js       # vue « Lignes » (QR, code, actions)
│   │       └── messages.js    # vue « Messages » (discussions, conversation)
│   ├── icons/                 # icônes 192/512, maskable, Apple
│   └── vendor/socket.io.min.js
├── test/                      # node --test
└── data/                      # créé au démarrage (ignoré par git)
    ├── api-token.txt
    └── sessions/<id>/{meta.json, auth/, store.json}
```

## Installation et démarrage

Il faut **Node.js 20.12 ou plus récent** (22 conseillé).

```bash
cd whatsapp-multi
npm install          # installe et copie public/vendor/socket.io.min.js
cp .env.example .env # facultatif : PORT, API_TOKEN, limites…
npm start            # ou « npm run dev » pour relancer à chaque modification
npm test             # 13 tests (isolation, reconnexion, stockage…)
```

Au premier démarrage, le terminal affiche :

```
INFO: Serveur prêt : http://localhost:3000
WARN: Jeton d'accès généré (à coller dans l'application) : xxxxxxxxxxxxxxxx
```

Le jeton est enregistré dans `data/api-token.txt`. Pour choisir le tien, mets `API_TOKEN=` dans `.env` (au moins 32 caractères aléatoires).

## Tester avec une première ligne

1. Ouvre **http://localhost:3000** sur l'ordinateur qui fait tourner le serveur.
2. Onglet **Réglages** : l'adresse est pré-remplie ; colle le jeton puis **Enregistrer et se connecter**.
3. Onglet **Lignes** → **Ajouter une ligne** : donne un nom (ex. « Ligne 1 — Accueil »), garde **QR code**, puis **Ajouter et connecter**.
4. Sur le téléphone du compte WhatsApp Business : ⋮ (ou Réglages) → **Appareils connectés** → **Connecter un appareil** → scanne le QR affiché.
   - Si l'application tourne sur ce même téléphone (impossible de scanner son propre écran), choisis **Code d'appairage**, saisis le numéro avec l'indicatif (ex. `33612345678`), puis dans WhatsApp : **Connecter un appareil** → « **Associer avec le numéro de téléphone** » → tape le code à 8 caractères.
5. La ligne passe à **Connectée**. Les conversations récentes arrivent, puis les nouveaux messages en direct dans l'onglet **Messages**.
6. Ajoute les lignes suivantes de la même façon. Le sélecteur en haut (Ligne 1, Ligne 2…) change la ligne affichée. Chaque ligne a sa couleur, reprise dans l'en-tête, les bulles envoyées et le bouton d'envoi, pour savoir toujours depuis quelle ligne tu réponds.

Même test en ligne de commande :

```bash
TOKEN=$(cat data/api-token.txt)
# créer une ligne (QR) ; ajoute "phoneNumber":"33612345678" pour un code d'appairage
curl -s -X POST localhost:3000/api/sessions -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"label":"Ligne 1"}'
# état (le champ "qr" contient l'image du QR en data URL, "pairingCode" le code)
curl -s localhost:3000/api/sessions/ligne-1 -H "Authorization: Bearer $TOKEN"
# envoyer un message depuis CETTE ligne
curl -s -X POST localhost:3000/api/sessions/ligne-1/messages -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"to":"33611111111","text":"Bonjour !"}'
```

Après un redémarrage du serveur, les lignes déjà reliées se reconnectent seules, sans nouveau QR.

## Installer l'application sur le téléphone (PWA)

Un navigateur n'accepte d'installer une PWA (et d'activer son service worker) **qu'en HTTPS**, sauf sur `localhost`. Pour l'utiliser sur ton téléphone :

- **Serveur en ligne** (VPS, etc.) derrière un reverse proxy HTTPS (Caddy, Nginx + Let's Encrypt). Mets `TRUST_PROXY=1` dans `.env`. Le proxy doit laisser passer les WebSockets (`/socket.io/`).
- **Pour un essai rapide** depuis ton ordinateur : un tunnel HTTPS, par exemple `cloudflared tunnel --url http://localhost:3000`, puis ouvre l'adresse `https://…` donnée.

Ensuite, sur le téléphone :

- **Android (Chrome)** : ouvre l'adresse, puis Réglages → **Installer sur l'écran d'accueil** (ou menu ⋮ → Installer l'application).
- **iPhone (Safari)** : bouton Partager → **Sur l'écran d'accueil**.

Le service worker ne met en cache que l'interface (HTML, CSS, JS, icônes). Les messages et l'API ne sont jamais mis en cache. À chaque mise à jour de l'interface, augmente `VERSION` dans `public/sw.js`.

## Empaqueter en application native (Capacitor)

`public/` est directement le `webDir` de Capacitor (aucune étape de build) :

```bash
npm install -D @capacitor/cli
npm install @capacitor/core @capacitor/android      # et/ou @capacitor/ios
npx cap add android
npx cap sync
npx cap open android                                  # build et installation depuis Android Studio
```

Dans l'app native, renseigne l'**adresse du serveur** (ex. `https://lignes.mondomaine.fr`) et le jeton dans **Réglages**. Les origines Capacitor (`capacitor://localhost`, `https://localhost`, `http://localhost`) sont autorisées par défaut (`CORS_ORIGINS`).

`capacitor.config.json` active `cleartext` et `allowMixedContent` pour pouvoir tester contre un serveur en `http://` sur le réseau local. **En production, utilise HTTPS et retire ces deux options.** Après chaque modification de `public/`, relance `npx cap sync`.

## API REST

Toutes les routes (sauf `/api/health`) exigent l'en-tête `Authorization: Bearer <jeton>`. Les erreurs ont la forme `{ "error": { "code": "...", "message": "..." } }`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | vérification (sans jeton) |
| GET | `/api/sessions` | liste des lignes et de leur état |
| POST | `/api/sessions` | créer et connecter : `{ label?, id?, phoneNumber? }` (avec `phoneNumber` : code d'appairage au lieu du QR) |
| GET | `/api/sessions/:id` | état : `status`, `qr`, `pairingCode`, `phone`, `unread`, `lastError`… |
| PATCH | `/api/sessions/:id` | renommer : `{ label }` |
| POST | `/api/sessions/:id/connect` | (re)connecter : `{ phoneNumber? }` |
| POST | `/api/sessions/:id/disconnect` | pause (l'appareil reste relié) |
| POST | `/api/sessions/:id/logout` | délier l'appareil (il faudra refaire un QR ou un code) |
| DELETE | `/api/sessions/:id` | délier et effacer toutes les données de la ligne |
| GET | `/api/sessions/:id/chats` | discussions de la ligne |
| GET | `/api/sessions/:id/chats/:chatId/messages?limit=50&before=<ms>` | messages, avec pagination |
| POST | `/api/sessions/:id/chats/:chatId/read` | remet le compteur « non lus » à zéro (dans l'app uniquement) |
| POST | `/api/sessions/:id/messages` | envoyer : `{ to: "33612345678" ou "<jid>", text }` |

États d'une ligne (`status`) : `idle`, `connecting`, `qr`, `pairing`, `open`, `reconnecting`, `logged_out`, `error`.

## Événements Socket.io

Connexion : `io(url, { auth: { token } })`.

| Sens | Événement | Destinataires |
|---|---|---|
| client → serveur | `session:select` `{ sessionId }` (avec accusé) | quitte l'ancienne salle, rejoint `session:<id>` |
| serveur → client | `sessions:list`, `session:update`, `session:removed` | tous les clients. Uniquement l'**état** des lignes (statut, QR, nombre de non-lus), jamais le contenu des messages |
| serveur → client | `message:new` `{ sessionId, chat, message }` | salle de la ligne uniquement |
| serveur → client | `message:update` (accusé, modification, suppression) | salle de la ligne uniquement |
| serveur → client | `chat:update`, `chats:reset` | salle de la ligne uniquement |

## Reconnexion et erreurs

- **Coupure réseau / WhatsApp indisponible** : nouvel essai automatique avec un délai qui double (2 s, 4 s, 8 s… plafonné à 2 min, avec un peu d'aléatoire). Le compte à rebours s'affiche dans l'app.
- **515 (redémarrage demandé juste après l'appairage)** : réouverture immédiate. C'est normal.
- **401 (appareil délié depuis le téléphone)** : les clés de la ligne sont effacées et la ligne passe à « Déliée ».
- **440 (ligne ouverte ailleurs), 403, 405, 500, 411** : arrêt sans nouvel essai, avec une explication. Insister aggraverait la situation (deux serveurs qui se volent la connexion, blocage temporaire côté WhatsApp).
- **QR ou code non validé à temps** : la ligne s'arrête. Clique de nouveau sur « Connecter », pour ne pas multiplier les demandes auprès de WhatsApp.
- Chaque ligne a son propre compteur de tentatives : une ligne en panne n'affecte pas les autres.
- Arrêt du serveur (Ctrl+C, SIGTERM) : les connexions sont fermées **sans** délier les appareils et l'historique est enregistré.

Pour un serveur permanent, lance-le avec un superviseur qui le relance en cas d'arrêt, par exemple `pm2 start src/server.js --name multi-lignes` ou un service systemd.

## Limites et précautions

- **Baileys n'est pas l'API officielle de WhatsApp.** Il se connecte comme un « appareil connecté » (comme WhatsApp Web). C'est contraire aux conditions d'utilisation de WhatsApp, avec un risque de restriction du numéro. Pour un usage professionnel durable, l'alternative officielle est la **WhatsApp Business Platform (Cloud API)** de Meta.
- **Collaborateurs** : superviser le compte professionnel d'un collaborateur doit se faire en toute transparence. Informe les personnes concernées (en Europe, le RGPD l'impose, et souvent aussi le droit du travail). Le relier demande d'ailleurs un accès au téléphone de la ligne.
- **Discrétion** : l'app n'envoie aucun accusé de lecture. Ouvrir une discussion ici ne la marque pas comme lue sur WhatsApp, et la ligne n'apparaît pas « en ligne » (`markOnlineOnConnect: false`).
- **Médias** : les photos, vocaux et documents apparaissent sous forme d'étiquette (📷 Photo + légende) et ne sont pas téléchargés.
- **Stockage** : un fichier JSON par ligne, limité aux 200 derniers messages par discussion et à 500 discussions (réglables). Pour de gros volumes, remplace `MessageStore` par SQLite : son interface reste la même.
- **Sécurité** : `data/` contient les clés de session de chaque compte. Protège ce dossier comme un mot de passe et ne le commite jamais (il est dans `.gitignore`). Utilise HTTPS dès que le serveur est accessible depuis internet.
