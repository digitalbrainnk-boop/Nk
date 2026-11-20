# Multi-Lignes : superviser plusieurs comptes WhatsApp Business

Une application installable sur ton téléphone (PWA) et son serveur Node.js pour suivre plusieurs comptes WhatsApp Business. Chaque compte est une **ligne** complètement isolée : ses propres clés, son propre historique, son propre flux temps réel.

---

## Installer maintenant

### Sur ton téléphone Android (le serveur tourne sur le téléphone)

1. Installe **Termux** depuis F-Droid : https://f-droid.org/packages/com.termux/ (pas la version du Play Store).
2. Ouvre Termux, colle cette ligne puis Entrée :
   ```
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-2ad928f4-gleusx/whatsapp-multi-hub/installer-android.sh | bash
   ```
3. À la fin, Chrome s'ouvre tout seul, déjà connecté à l'application.
4. Dans Chrome : menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »). L'icône Multi-Lignes apparaît sur ton écran d'accueil.
5. Les fois suivantes : ouvre Termux et tape `lignes`, puis touche l'icône.

Termux doit rester ouvert (le téléphone de préférence en charge). Si ton agent IA tourne déjà dans Termux, ouvre une 2e session (glisse depuis le bord gauche → New session) pour taper `lignes`. Les deux applications utilisent des ports différents (3000 et 3100).

### Sur un ordinateur (Windows ou Mac)

1. Installe **Node.js** (version LTS) : https://nodejs.org/fr/download
2. Dans le dossier `whatsapp-multi-hub`, double-clique sur **`DEMARRER.bat`** (Windows) ou **`DEMARRER-Mac.command`** (Mac).
3. La première fois, l'installation prend 1 à 3 minutes. Ensuite ton navigateur s'ouvre, déjà connecté.

Sous Linux, ou en ligne de commande :

```bash
cd whatsapp-multi-hub
npm install
npm start          # ou : node server.js
```

### Le lien de connexion

Au démarrage, le terminal affiche :

```
  ✅ Multi-Lignes est prêt.

  Ouvre ce lien (connexion automatique, rien à recopier) :
     http://localhost:3100/#token=XXXXXXXX

  Depuis un autre appareil du même Wi-Fi :
     http://192.168.1.20:3100/#token=XXXXXXXX
```

Ouvrir ce lien enregistre le jeton d'accès sur l'appareil, puis le retire de la barre d'adresse. **Garde-le pour toi** : il donne accès à toutes les lignes. Le jeton est conservé dans `data/api-token.txt`. Pour le changer, mets `API_TOKEN=` dans `.env`, ou supprime ce fichier : un nouveau jeton sera créé au prochain démarrage.

> Un navigateur n'accepte d'**installer** l'application qu'en HTTPS ou sur `localhost`. Sur le téléphone qui fait tourner le serveur (Termux), `localhost` suffit. Depuis un autre appareil, l'adresse `http://192.168…` fonctionne dans le navigateur mais ne permet pas l'installation. Pour ça, voir « Accès depuis internet (HTTPS) » plus bas.

## Relier une première ligne

1. Onglet **Lignes** → **Ajouter une ligne** : donne un nom (ex. « Ligne 1 — Accueil »).
2. Choisis la méthode :
   - **QR code** : sur le téléphone du compte, ouvre WhatsApp Business → ⋮ (ou Réglages) → **Appareils connectés** → **Connecter un appareil** → scanne le QR affiché.
   - **Code d'appairage**, si l'application est ouverte sur le téléphone même du compte (impossible de scanner son propre écran). Saisis le numéro avec l'indicatif (ex. `33612345678`, `22670123456`). Dans WhatsApp Business : **Appareils connectés** → **Connecter un appareil** → « **Associer avec le numéro de téléphone** » → tape le code à 8 caractères.
3. La ligne passe à **Connectée**. Les conversations récentes arrivent, puis les nouveaux messages en direct dans l'onglet **Messages**.
4. Ajoute les autres lignes de la même façon. Le sélecteur en haut (Ligne 1, Ligne 2…) change la ligne affichée. La couleur de la ligne active teinte l'en-tête, les bulles envoyées et le bouton d'envoi (« Répondre depuis Ligne 2 »).

Après un redémarrage, les lignes déjà reliées se reconnectent seules, sans nouveau QR.

## Comment l'isolation est garantie

| Niveau | Ce qui est séparé |
|---|---|
| Disque | `data/sessions/<id>/` : `auth/` (clés WhatsApp), `store.json` (historique) et `meta.json` propres à chaque ligne |
| Mémoire | une instance `WhatsAppSession` par ligne : son propre socket WhatsApp, son propre historique, ses propres événements |
| Temps réel | une salle Socket.io `session:<id>` par ligne. Un client n'est jamais dans deux salles de ligne : changer de ligne lui fait quitter l'ancienne côté serveur |
| API REST | les routes de messages portent l'identifiant de la ligne et ne lisent que son historique |
| Application | seules les données de la ligne affichée sont en mémoire. Tout événement ou réponse d'une autre ligne est ignoré |
| Changement de numéro | si un **autre** numéro est relié à une ligne, l'ancien historique de cette ligne est effacé |

`test/isolation.test.js` vérifie de bout en bout qu'un message de la ligne 1 n'arrive jamais chez un client qui regarde la ligne 2.

## Structure du projet

```
whatsapp-multi-hub/
├── server.js                  # point d'entrée (node server.js)
├── DEMARRER.bat               # Windows : double-clic
├── DEMARRER-Mac.command       # Mac : double-clic
├── installer-android.sh       # Android (Termux) : installation + commande « lignes »
├── package.json   .env.example   capacitor.config.json
├── scripts/copy-vendor.js     # copie le client Socket.io dans public/vendor
├── src/
│   ├── server.js              # démarrage, lien de connexion, arrêt propre
│   ├── app.js                 # Express (API + PWA) + Socket.io
│   ├── config.js  logger.js  errors.js
│   ├── http/auth.js           # jeton (REST + Socket.io), blocage après 10 erreurs
│   ├── http/routes/sessions.js
│   ├── realtime/socket.js     # salles par ligne
│   └── whatsapp/
│       ├── SessionManager.js  # registre des lignes
│       ├── WhatsAppSession.js # UNE ligne : QR/code, reconnexion, messages
│       ├── MessageStore.js    # historique d'UNE ligne
│       └── messageParser.js  jid.js
├── public/                    # la PWA (aucune étape de build)
│   ├── index.html  manifest.json  sw.js  css/app.css  icons/  vendor/
│   └── js/ app.js api.js realtime.js settings.js ui.js views/{lines,messages}.js
├── test/                      # npm test
└── data/                      # créé au démarrage, ignoré par git : NE PAS PARTAGER
```

## API REST

Toutes les routes, sauf `/api/health`, exigent l'en-tête `Authorization: Bearer <jeton>`. Les erreurs ont la forme `{ "error": { "code", "message" } }`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | vérification (sans jeton) |
| GET | `/api/sessions` | liste des lignes et de leur état |
| POST | `/api/sessions` | créer et connecter : `{ label?, id?, phoneNumber? }` |
| POST | `/api/sessions/:id/init` | créer la ligne `:id` si besoin, puis la connecter : `{ label?, phoneNumber? }` |
| GET | `/api/sessions/:id` | état : `status`, `qr` (image), `pairingCode`, `phone`, `unread`, `lastError`… |
| PATCH | `/api/sessions/:id` | renommer : `{ label }` |
| POST | `/api/sessions/:id/connect` | (re)connecter : `{ phoneNumber? }` |
| POST | `/api/sessions/:id/disconnect` | pause (l'appareil reste relié) |
| POST | `/api/sessions/:id/logout` | délier l'appareil |
| DELETE | `/api/sessions/:id` | délier et effacer toutes les données de la ligne |
| GET | `/api/sessions/:id/chats` | discussions de la ligne |
| GET | `/api/sessions/:id/chats/:chatId/messages?limit=50&before=<ms>` | messages (pagination) |
| POST | `/api/sessions/:id/chats/:chatId/read` | remet le compteur « non lus » à zéro, dans l'app seulement |
| POST | `/api/sessions/:id/messages` | envoyer : `{ to: "33612345678" ou "<jid>", text }` |

Exemple :

```bash
TOKEN=$(cat data/api-token.txt)
curl -s -X POST localhost:3100/api/sessions/ligne-1/init -H "Authorization: Bearer $TOKEN"
curl -s localhost:3100/api/sessions/ligne-1 -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:3100/api/sessions/ligne-1/messages -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"to":"33611111111","text":"Bonjour !"}'
```

États d'une ligne : `idle`, `connecting`, `qr`, `pairing`, `open`, `reconnecting`, `logged_out`, `error`.

## Événements Socket.io

Connexion : `io(url, { auth: { token } })`.

| Sens | Événement | Destinataires |
|---|---|---|
| client → serveur | `session:select` `{ sessionId }` ou `join:session` `"ligne-1"` | quitte l'ancienne salle, rejoint `session:<id>`, reçoit `session:state` |
| serveur → client | `sessions:list`, `session:update`, `session:removed` | tous les clients. Uniquement l'**état** des lignes (statut, QR, nombre de non-lus) |
| serveur → client | `message:new`, `message:update`, `chat:update`, `chats:reset` | **uniquement** la salle de la ligne concernée |

## Reconnexion et erreurs

- **Coupure réseau** : nouvel essai automatique, avec un délai qui double (2 s, 4 s, 8 s… jusqu'à 2 min max). Le compte à rebours s'affiche dans l'app.
- **Redémarrage demandé juste après l'appairage (515)** : réouverture immédiate. C'est normal.
- **Appareil délié depuis le téléphone (401)** : les clés de la ligne sont effacées et la ligne passe à « Déliée ».
- **Ligne ouverte ailleurs (440), compte restreint (403), trop d'essais (405), session abîmée (500)** : arrêt sans nouvel essai, avec une explication. Insister aggraverait la situation.
- **QR ou code non validé à temps** : la ligne s'arrête. Clique de nouveau sur « Connecter ».
- **Application lancée deux fois** : la 2e copie s'arrête avec un message et ne touche pas aux lignes de la 1re.
- **Arrêt (Ctrl + C)** : les connexions sont fermées **sans** délier les appareils, et l'historique est enregistré.

## Accès depuis internet (HTTPS)

Pour utiliser et installer l'application depuis un téléphone autre que celui qui fait tourner le serveur :

- **Essai rapide** : `cloudflared tunnel --url http://localhost:3100`, puis ouvre l'adresse `https://…` donnée, suivie de `/#token=<ton jeton>`.
- **Serveur permanent** (VPS) : place l'application derrière Caddy ou Nginx avec HTTPS (Let's Encrypt), mets `TRUST_PROXY=1` dans `.env`, et laisse passer les WebSockets (`/socket.io/`). Lance-la avec un superviseur : `pm2 start server.js --name multi-lignes`.

## Application native (Capacitor)

`public/` est directement le dossier web de Capacitor :

```bash
npm install -D @capacitor/cli
npm install @capacitor/core @capacitor/android
npx cap add android && npx cap sync && npx cap open android
```

Dans l'app native, renseigne l'adresse du serveur et le jeton dans **Réglages**. `capacitor.config.json` autorise le `http://` pour les tests en réseau local. **En production, utilise HTTPS et retire `cleartext` et `allowMixedContent`.**

## Limites et précautions

- **Baileys n'est pas l'API officielle de WhatsApp.** Il se connecte comme un « appareil connecté » (comme WhatsApp Web), ce qui est contraire aux conditions de WhatsApp : le numéro risque d'être restreint. L'alternative officielle est la **WhatsApp Business Platform (Cloud API)** de Meta.
- **Collaborateurs** : informe les personnes dont la ligne est supervisée. En Europe, le RGPD l'impose, et souvent aussi le droit du travail.
- **Discrétion** : aucun accusé de lecture n'est envoyé, et la ligne n'apparaît pas « en ligne ».
- **Médias** : photos, vocaux et documents s'affichent sous forme d'étiquette (📷 Photo + légende) et ne sont pas téléchargés.
- **Stockage** : un fichier JSON par ligne, limité à 200 messages par discussion et 500 discussions (réglable dans `.env`).
- **Sécurité** : `data/` contient les clés de chaque compte. Protège ce dossier comme un mot de passe et ne le partage jamais.
