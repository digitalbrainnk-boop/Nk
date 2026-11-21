# Multi-Lignes : superviser plusieurs comptes WhatsApp Business

Une application installable sur ton téléphone (PWA) et son serveur Node.js pour suivre plusieurs comptes WhatsApp Business. Chaque compte est une **ligne** complètement isolée : ses propres clés, son propre historique, son propre flux temps réel.

**Dans chaque ligne, comme dans WhatsApp :**
- lire les discussions en direct (personnes et groupes), avec photos, vidéos, vocaux, documents, autocollants et positions ;
- répondre, ou **répondre à un message précis** (citation) ;
- envoyer des **photos, vidéos et documents** (galerie, appareil photo ou fichiers), avec légende ;
- enregistrer et envoyer des **messages vocaux** ;
- **réagir** avec un emoji, copier un texte, télécharger un fichier, **supprimer pour tout le monde** un message envoyé ;
- voir les accusés (✓ envoyé, ✓✓ distribué, ✓✓ bleu lu), agrandir les photos, ouvrir les liens.

Appui long sur un message (ou clic droit sur ordinateur) : menu des réactions et actions. Trombone 📎 : joindre un fichier. Micro 🎤 : vocal.

Ce que WhatsApp ne permet pas aux appareils connectés de cette façon, et que l'app ne fait donc pas : **appels audio et vidéo**, statuts, et gestion du compte (profil, paramètres).

## Une connexion définitive ?

**Oui : tu relies chaque ligne une seule fois** (QR code ou code à 8 caractères, jamais par e-mail). Les clés sont enregistrées dans `data/sessions/<ligne>/auth/` :

- **Le serveur s'arrête ou le téléphone qui le fait tourner s'éteint** : au redémarrage, chaque ligne se reconnecte **toute seule, sans QR**. Les messages reçus entre-temps arrivent à la reconnexion.
- **Coupure internet** : nouvel essai automatique, sans fin, jusqu'au retour du réseau.
- **Le serveur plante** : il redémarre tout seul en quelques secondes (`scripts/termux-run.sh`).
- Il faut refaire l'appairage seulement si :
  - quelqu'un retire l'appareil dans WhatsApp → **Appareils connectés** sur le téléphone de la ligne ;
  - le téléphone de la ligne reste **plus de 14 jours sans se connecter à internet** (règle de WhatsApp pour tous les appareils connectés) ;
  - WhatsApp est réinstallé ou le numéro change sur ce téléphone ;
  - le dossier `data/` est supprimé ;
  - le serveur reste éteint très longtemps (plusieurs semaines) : WhatsApp finit par retirer les appareils inactifs.

Pour que l'application tourne **en permanence**, deux possibilités :

1. **Sur un téléphone Android** (Termux) : avec l'application **Termux:Boot**, elle redémarre seule quand le téléphone se rallume (voir ci-dessous). Le téléphone doit rester allumé et connecté.
2. **Sur un serveur Linux (VPS)**, la solution la plus stable : il ne s'éteint jamais, et tu installes l'application sur ton téléphone depuis son adresse HTTPS (voir « Serveur Linux allumé en permanence »).

---

## Installer maintenant

### Sur ton téléphone Android (le serveur tourne sur le téléphone)

1. Installe **Termux** depuis F-Droid : https://f-droid.org/packages/com.termux/ (pas la version du Play Store).
2. Ouvre Termux, colle cette ligne puis Entrée :
   ```
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-2ad928f4-gleusx/whatsapp-multi-hub/installer-android.sh | bash
   ```
3. À la fin, Chrome s'ouvre tout seul, déjà connecté à l'application.
4. **Installe l'application** : touche le bandeau « Installe Multi-Lignes » en haut des Messages, ou Réglages → **Installer sur l'écran d'accueil**, ou dans Chrome : menu ⋮ → **Installer l'application**. L'icône Multi-Lignes apparaît sur ton écran d'accueil et dans la liste de tes applications, comme une vraie application (plein écran, sans barre d'adresse).
5. **Notifications** (pour voir les messages arriver, comme WhatsApp) : installe l'application **Termux:API** depuis F-Droid (https://f-droid.org/packages/com.termux.api/), ouvre-la une fois, puis Paramètres Android → Applications → Termux:API → Notifications → **Autoriser**. Dans Multi-Lignes : Réglages → Notifications → **Envoyer une notification de test**.
   - Termux et Termux:API doivent venir **tous les deux de F-Droid** (des versions de sources différentes ne peuvent pas communiquer).
6. Dans **Réglages** : active le **code de verrouillage** (voir « Sécurité » plus bas).
7. Les fois suivantes : ouvre Termux et tape `lignes` (si l'application tourne déjà, elle s'ouvre simplement), puis touche l'icône. `lignes stop` l'arrête, `lignes log` affiche son journal.
8. **Démarrage automatique au rallumage du téléphone** : installe **Termux:Boot** depuis F-Droid (https://f-droid.org/packages/com.termux.boot/) et ouvre-le une fois. C'est tout.
9. Dans les paramètres Android → Applications → **Termux** → Batterie : choisis **Sans restriction**, sinon Android peut l'endormir.

**Mettre à jour** : colle de nouveau la ligne du point 2 dans Termux. Tes lignes reliées, ton historique et tes réglages sont conservés.

Termux doit rester ouvert en arrière-plan (le téléphone de préférence en charge). Si le serveur plante, il redémarre tout seul en 5 secondes. Si ton agent IA tourne déjà dans Termux, ouvre une 2e session (glisse depuis le bord gauche → New session) pour taper `lignes`. Les deux applications utilisent des ports différents (3000 et 3100).

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

  Ouvre ce lien pour connecter ton téléphone (valable 10 minutes, une seule fois) :
     http://localhost:3100/#login=XXXXXXXX
```

Ce lien ne contient **pas** le jeton d'accès : c'est un code à usage unique, échangé une seule fois contre le jeton, puis retiré de la barre d'adresse. Même retrouvé plus tard dans l'historique de Chrome, il ne vaut plus rien. Besoin d'un nouveau lien ? Dans Termux, tape `lignes`.

> Un navigateur n'accepte d'**installer** l'application qu'en HTTPS ou sur `localhost`. Sur le téléphone qui fait tourner le serveur (Termux), c'est le cas : tout fonctionne (installation, notifications, micro). Pour l'ouvrir depuis un autre appareil, voir « Accès depuis internet (HTTPS) » plus bas.

## Sécurité

| Protection | Ce qu'elle fait |
|---|---|
| **Accès limité au téléphone** | Par défaut, le serveur n'écoute que `127.0.0.1` : aucun autre appareil du Wi-Fi ne peut même le joindre (`HOST=0.0.0.0` dans `.env` pour l'ouvrir au Wi-Fi, le jeton restant exigé). |
| **Jeton d'accès** | Long, aléatoire, exigé par l'API et le temps réel ; comparaison à temps constant ; une adresse qui se trompe 10 fois est bloquée 15 minutes. |
| **Liens à usage unique** | Le jeton n'apparaît jamais dans une adresse ni dans le terminal : on se connecte avec un code valable 10 minutes, une seule fois. |
| **Code de verrouillage** | Réglages → Sécurité. Le jeton est **chiffré** sur le téléphone (AES-256-GCM, clé dérivée du code par PBKDF2, 310 000 itérations) : sans le code, il est illisible. Verrouillage automatique (immédiat, 1, 5 ou 15 min) ; l'écran est masqué aussi dans l'aperçu des applications récentes. Après 5 codes faux, attente imposée ; après 10, l'accès est effacé du téléphone (les lignes WhatsApp restent reliées : `lignes` pour revenir). |
| **Déconnecter les autres appareils** | Réglages → Sécurité → Changer : nouveau jeton, les autres appareils sont coupés immédiatement, celui-ci reste connecté. |
| **Fichiers privés** | Clés WhatsApp, historique, médias et jeton sont créés lisibles par toi seul (droits `600` / `700`), chaque ligne dans son dossier. |
| **Page blindée** | Politique de contenu stricte (aucun script extérieur, page non intégrable par un autre site) ; texte et noms reçus toujours échappés ; documents reçus (HTML, SVG…) téléchargés, jamais affichés ; fichiers servis par adresses signées. |
| **Notifications chiffrées** | Chiffrées de bout en bout entre ton serveur et ton téléphone : Google ne peut pas les lire. Option pour n'afficher que « Nouveau message ». |
| **Discrétion** | Aucun accusé de lecture envoyé, la ligne n'apparaît pas « en ligne ». |
| **Dépendances** | `npm audit` : 0 vulnérabilité (version corrigée de `zod` imposée). |

## Notifications

**Sur le téléphone (Termux) : vraies notifications Android**, affichées par le téléphone lui-même via l'application **Termux:API**. Elles ne passent ni par Chrome ni par Internet.

- Chaque nouveau message reçu s'affiche, application fermée : « **Claire Martin · Ligne 1 — Accueil** », avec le texte. Les photos s'affichent dans la notification.
- Plusieurs messages d'une même personne se regroupent (« Claire Martin (3) »), avec les derniers messages, sans resonner à chaque fois.
- **Répondre** : tape ta réponse directement dans la notification. Elle part depuis la bonne ligne, et un petit message confirme « Message envoyé ✓ ».
- **Marquer comme lu**, ou toucher la notification pour ouvrir la discussion.
- La notification disparaît quand tu lis la discussion dans l'app, ou quand tu réponds (depuis l'app ou depuis le téléphone de la ligne).
- Option dans Réglages : n'afficher que « Nouveau message », sans nom ni texte.
- Aucune notification pour l'historique, ni pour les messages envoyés par la ligne.

Si Termux:API n'est pas installée ou ne répond pas, Réglages → Notifications l'indique avec les étapes à suivre, et l'application bascule toute seule sur les **notifications Chrome** (méthode de secours, à activer dans le même écran). Hors Termux (ordinateur, serveur en ligne), seules les notifications Chrome existent : elles demandent HTTPS ou `localhost`.

Si une notification n'apparaît pas en bandeau en haut de l'écran : Paramètres Android → Applications → Termux:API → Notifications → choisis « Afficher en pop-up » / priorité haute.

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
├── installer-android.sh       # Android (Termux) : installation, commande « lignes », démarrage auto
├── deploy/multi-lignes.service # serveur Linux : service systemd
├── package.json   .env.example   capacitor.config.json
├── scripts/copy-vendor.js     # copie le client Socket.io dans public/vendor
├── scripts/termux-run.sh      # relance automatique du serveur en cas de plantage
├── scripts/notification-action.js # « Répondre » / « Marquer comme lu » depuis une notification
├── src/
│   ├── server.js              # démarrage, lien de connexion, arrêt propre
│   ├── app.js                 # Express (API + PWA) + Socket.io
│   ├── config.js  logger.js  errors.js
│   ├── http/auth.js           # jeton (REST + Socket.io), blocage après 10 erreurs
│   ├── http/mediaLinks.js     # adresses signées des fichiers
│   ├── http/loginCodes.js     # liens de connexion à usage unique
│   ├── http/routes/auth.js    # connexion des appareils, changement de jeton
│   ├── http/routes/push.js    # abonnement aux notifications
│   ├── push.js                # notifications Chrome (Web Push chiffré)
│   ├── notify/termux.js       # notifications Android natives (Termux:API), réponse directe
│   ├── http/routes/sessions.js
│   ├── realtime/socket.js     # salles par ligne
│   └── whatsapp/
│       ├── SessionManager.js  # registre des lignes
│       ├── WhatsAppSession.js # UNE ligne : QR/code, reconnexion, messages
│       ├── MessageStore.js    # historique d'UNE ligne
│       ├── media.js           # fichiers : formats, conversion des vocaux
│       └── messageParser.js  jid.js
├── public/                    # la PWA (aucune étape de build)
│   ├── index.html  manifest.json  sw.js  css/app.css  icons/  vendor/
│   └── js/ app.js api.js realtime.js settings.js ui.js lock.js notifications.js views/{lines,messages}.js
├── test/                      # npm test
└── data/                      # créé au démarrage, ignoré par git : NE PAS PARTAGER
```

## API REST

Toutes les routes, sauf `/api/health`, exigent l'en-tête `Authorization: Bearer <jeton>`. Les erreurs ont la forme `{ "error": { "code", "message" } }`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | vérification (sans jeton) |
| POST | `/api/auth/exchange` | `{ code }` → `{ token }` : échange d'un code de connexion à usage unique (sans jeton) |
| POST | `/api/auth/login-code` | nouveau code de connexion (valable 10 min, une fois) |
| POST | `/api/auth/rotate` | nouveau jeton ; les appareils utilisant l'ancien sont déconnectés |
| GET/POST | `/api/push/key`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test` | notifications Chrome |
| GET/PUT/POST | `/api/notifications`, `/api/notifications/check`, `/api/notifications/test` | notifications Android (état, réglages, vérification, test) |
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
| POST | `/api/sessions/:id/messages` | envoyer un texte : `{ to: "33612345678" ou "<jid>", text, replyTo? }` |
| POST | `/api/sessions/:id/messages/media` | envoyer un fichier (multipart) : `file`, `to`, `caption?`, `replyTo?`, `voice?` (`1` = note vocale) |
| POST | `/api/sessions/:id/chats/:chatId/messages/:messageId/react` | réagir : `{ emoji }` (vide = retirer) |
| DELETE | `/api/sessions/:id/chats/:chatId/messages/:messageId` | supprimer pour tout le monde (messages de la ligne) |
| GET | `/api/sessions/capabilities` | `{ voiceNotes, maxUploadBytes }` |
| GET | `/media/:id/:chatId/:messageId?exp&sig` | fichier d'un message, via l'adresse signée fournie dans `message.media.url` |

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

## Serveur Linux allumé en permanence

Sur un petit serveur Debian/Ubuntu (VPS) avec un nom de domaine pointant vers lui (ex. `lignes.mondomaine.fr`) :

```bash
# 1. Node.js 22, git, ffmpeg (vocaux) et Caddy (HTTPS automatique)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs git ffmpeg caddy

# 2. L'application, avec un utilisateur dédié
sudo useradd --system --home /opt/multi-lignes multilignes
sudo git clone -b ccr-2ad928f4-gleusx https://github.com/digitalbrainnk-boop/Nk.git /opt/multi-lignes
cd /opt/multi-lignes/whatsapp-multi-hub
sudo npm install --omit=dev
# L'application n'écoute que Caddy (pas d'accès direct en http:// depuis internet)
sudo cp .env.example .env && printf 'TRUST_PROXY=1\nHOST=127.0.0.1\n' | sudo tee -a .env
sudo mkdir -p data && sudo chown -R multilignes: /opt/multi-lignes

# 3. Démarrage automatique (et redémarrage en cas de problème)
sudo cp deploy/multi-lignes.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now multi-lignes
sudo journalctl -u multi-lignes -n 30     # affiche le lien de connexion

# 4. HTTPS : remplace le domaine puis recharge Caddy
echo 'lignes.mondomaine.fr {
  reverse_proxy 127.0.0.1:3100
}' | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Le journal (`journalctl`) affiche un lien de connexion à usage unique : remplace `http://localhost:3100` par `https://lignes.mondomaine.fr`, ouvre-le sur ton téléphone, puis menu ⋮ → **Installer l'application**. Mise à jour : `cd /opt/multi-lignes && sudo git pull && cd whatsapp-multi-hub && sudo npm install --omit=dev && sudo systemctl restart multi-lignes`.

## Accès depuis internet (HTTPS)

Pour utiliser et installer l'application depuis un téléphone autre que celui qui fait tourner le serveur :

- **Essai rapide** : `cloudflared tunnel --url http://localhost:3100`, puis ouvre l'adresse `https://…` donnée, suivie de `/#login=<code>` (code obtenu avec `lignes` ou affiché au démarrage).
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
- **Médias** : les fichiers reçus en direct jusqu'à 16 Mo sont téléchargés tout de suite, les autres (et ceux de l'historique) à leur ouverture. Ils sont rangés dans `data/sessions/<ligne>/media/` et supprimés quand leur message sort de l'historique. Envoi : 64 Mo maximum par fichier (`MAX_UPLOAD_MB`). Les adresses des fichiers sont signées et n'ouvrent que ce fichier-là ; un document reçu (HTML, SVG…) est toujours téléchargé, jamais affiché dans la page.
- **Vocaux** : enregistrés dans le navigateur, puis convertis au format WhatsApp par `ffmpeg` (installé par le script Android et par l'installation Linux). Sans ffmpeg (ex. Windows), ils partent comme fichiers audio. L'enregistrement demande HTTPS ou `localhost`.
- **Stockage** : un fichier JSON par ligne, limité à 200 messages par discussion et 500 discussions (réglable dans `.env`).
- **Sécurité** : `data/` contient les clés de chaque compte. Protège ce dossier comme un mot de passe et ne le partage jamais.
