# Mettre Lyric Studio en ligne (nom de domaine, hébergement, application Android)

Ce guide va de « je teste chez moi » à « mes clients s'inscrivent sur mon site et installent l'application ».

---

## 1. Tester tout de suite (avant d'acheter quoi que ce soit)

### Sur un ordinateur

```bash
cd lyric-studio
npm install
npm start
```

Ouvre **http://localhost:3500** dans Chrome. **Le premier compte que tu crées devient administrateur** :
crée le tien en premier. (En ligne, c'est l'adresse `ADMIN_EMAIL` qui devient administrateur, personne d'autre.) Pour voir l'application comme un client, ouvre une fenêtre de navigation privée
et crée un deuxième compte.

### Sur ton téléphone Android (Termux)

```bash
pkg install nodejs-lts git ffmpeg
git clone https://github.com/digitalbrainnk-boop/Nk.git
cd Nk && git checkout ccr-78cf5167-8sfpbb && cd lyric-studio
npm install
npm start
```

Ouvre **http://localhost:3500** dans Chrome sur le téléphone, puis menu ⋮ → **Installer l'application** :
l'icône apparaît avec tes autres applications.

> Pour la synchronisation automatique par IA, va dans **Administration → Site et IA** et colle une clé
> Groq (gratuite : https://console.groq.com/keys).

---

## 2. Choisir un hébergement

| Solution | Prix indicatif | Pour qui |
| --- | --- | --- |
| **o2switch** (ton hébergeur actuel) | déjà payé | **Pour démarrer** : installation en une commande (section 4), domaine et HTTPS inclus |
| Serveur VPS + Docker | 4 à 8 €/mois (Hetzner, Contabo, OVH…) | Quand tu as beaucoup de clients, ou pour la séparation de voix par IA (Demucs) |
| Render | ~7 $/mois + disque | Tout dans le navigateur, sans ligne de commande |

### Ce que o2switch fait et ne fait pas

Le gros du travail (dessin des images, encodage de la vidéo) se fait **dans le téléphone ou l'ordinateur du
client**, pas sur le serveur : c'est pour cela qu'un hébergement mutualisé comme o2switch suffit.

- ✅ Comptes, formules, paiements, administration, synchronisation par IA (Groq, OpenAI, ElevenLabs, Suno).
- ✅ Domaine ou sous-domaine et certificat HTTPS gratuits (déjà inclus dans ton offre).
- ✅ ffmpeg : installé automatiquement dans ton espace par l'installateur (s'il ne peut pas l'être, le studio
  marche quand même : Chrome sur Android, Windows et Mac exporte le MP4 complet tout seul).
- ❌ **Séparation de la voix par IA (Demucs)** : trop gourmande pour un hébergement mutualisé. Le karaoké
  retire alors la voix « au centre » du son, les chansons Suno peuvent être séparées par Suno, et les clients
  peuvent envoyer leurs propres pistes. La page des tarifs ne promet la séparation par IA que si le serveur la
  fait.
- ⚠️ L'espace disque est partagé avec tes autres sites : surveille-le (Administration → Tableau de bord), règle
  le stockage de chaque formule en conséquence et fais des sauvegardes (`studio sauvegarde`).

Quand le nombre de clients grandit, tu peux passer à un VPS sans rien perdre (sauvegarde → restauration du
dossier des données).

## 3. Acheter le nom de domaine

1. Chez un registraire (Namecheap, OVH, Hostinger, Google Domains/Squarespace…), cherche un nom libre, par
   exemple `monkaraoke.com` (~10 €/an).
2. Dans la zone DNS du domaine, crée :
   - un enregistrement **A** : nom `@` → l'adresse IP de ton serveur ;
   - un enregistrement **A** (ou CNAME vers `@`) : nom `www` → la même adresse.
3. Attends quelques minutes (parfois jusqu'à quelques heures) que le domaine pointe vers le serveur.

Chez o2switch : pas d'adresse IP à recopier, tout se fait dans cPanel (étape 4).
Sur Render : Settings → **Custom Domains** → ajoute ton domaine et suis les indications DNS de Render.

---

## 4. Installer chez o2switch

1. **Adresse du studio** — dans cPanel :
   - avec ton domaine actuel : **Domaines** → crée un sous-domaine, par exemple `studio.tondomaine.com` ;
   - avec un nouveau domaine acheté ailleurs : **Domaines** → ajoute-le, puis chez le registraire remplace les
     serveurs DNS par ceux d'o2switch (indiqués dans ton espace client) ; un domaine pris chez o2switch est
     prêt tout de suite.
   - Le certificat HTTPS est créé automatiquement (cPanel → **Statut SSL/TLS** pour vérifier).
2. **Installation** — cPanel → **Terminal**, colle cette ligne puis Entrée :
   ```bash
   curl -fsSL https://raw.githubusercontent.com/digitalbrainnk-boop/Nk/ccr-78cf5167-8sfpbb/lyric-studio/deploy/o2switch/installer.sh | bash
   ```
   Il demande **ton adresse e-mail** (elle seule deviendra administrateur) et **l'adresse du studio**
   (`studio.tondomaine.com`).
3. **Démarrage** — cPanel → **Setup Node.js App** → **Create Application** :
   - Node.js version : **22** (la plus récente proposée) ;
   - Application mode : Production ;
   - Application root : `lyric-studio` ;
   - Application URL : ton domaine ou sous-domaine ;
   - Application startup file : `app.js` ;
   - puis **Create** (pas besoin de « Run NPM Install »).
4. Ouvre `https://studio.tondomaine.com`, **inscris-toi avec ton adresse e-mail** : tu es administrateur.

Ensuite, dans un nouveau Terminal :

| Commande | Effet |
| --- | --- |
| `studio maj` | installer la dernière version |
| `studio journal` | voir ce que fait le studio (en cas de problème) |
| `studio relancer` | redémarrer |
| `studio retour` | revenir à la version précédente |
| `studio sauvegarde` | copier comptes, projets et vidéos dans `~/lyric-studio-sauvegardes` |

Les réglages de démarrage sont dans `~/lyric-studio/.env` et les données dans `~/lyric-studio-donnees` : une
mise à jour ne touche ni à l'un ni à l'autre.

---

## 5. Installer sur un serveur VPS (Docker)

Sur le serveur (Ubuntu ou Debian), une seule fois :

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/digitalbrainnk-boop/Nk.git
cd Nk && git checkout ccr-78cf5167-8sfpbb && cd lyric-studio
cp .env.example .env
nano .env        # DOMAIN=tondomaine.com, ADMIN_EMAIL=ton@email.com, et la clé Groq si tu l'as
docker compose up -d --build
```

C'est tout : **https://tondomaine.com** répond, avec un certificat HTTPS créé automatiquement.
Inscris-toi avec l'adresse de `ADMIN_EMAIL` : tu es administrateur.

Mettre à jour plus tard :

```bash
cd Nk && git pull && cd lyric-studio && docker compose up -d --build
```

Sauvegarder les données (comptes, projets, vidéos) :

```bash
docker run --rm -v lyric-studio_studio-data:/data -v "$PWD":/backup debian tar czf /backup/sauvegarde-$(date +%F).tgz -C /data .
```

### Sur Render

New → **Blueprint** → choisis ce dépôt → chemin du Blueprint : `lyric-studio/render.yaml`.
Renseigne `ADMIN_EMAIL` (et la clé Groq si tu veux), valide. Ajoute ensuite ton domaine (étape 3).

---

## 6. Régler ton site (Administration)

Une fois connecté avec le compte administrateur :

- **Site et IA** : nom de l'application, slogan, **WhatsApp et e-mail du support**, texte de paiement
  (Mobile Money…), clés d'IA (Groq / OpenAI / ElevenLabs, Kie.ai pour Suno), conditions d'utilisation.
- **Formules et prix** : prix, limites (projets, minutes d'IA, exports, qualité maximale, filigrane,
  voix séparée…). La formule `free` est celle des nouveaux comptes.
- **Demandes** : quand un client paie, il envoie sa référence de paiement ; tu vérifies le paiement reçu
  puis tu cliques **✓ Paiement reçu** : sa formule est activée pour la durée choisie.
- **Clients** : changer une formule ou une date de fin, suspendre un compte, donner un mot de passe
  provisoire (mot de passe oublié), supprimer un compte.

---

## 7. L'application Android

### a) Installation directe (déjà prête)

Sur le site, les clients Android touchent **📲 Installer l'application** (ou menu ⋮ de Chrome →
Installer l'application). L'application apparaît dans la liste des applications, s'ouvre en plein
écran et se met à jour toute seule. Rien à publier.

### b) Fichier APK et Play Store

Le site doit d'abord être en ligne avec son nom de domaine en HTTPS (étapes 3 et 4, ou 3 et 5).

1. Va sur **https://www.pwabuilder.com**, entre `https://tondomaine.com`, puis **Package for stores →
   Android**.
2. Choisis un identifiant de paquet (ex. `com.tondomaine.lyrics`) et télécharge le paquet. Tu reçois :
   - un fichier **.aab** (pour le Play Store) et un **.apk** (à installer ou partager directement) ;
   - une **clé de signature** : garde-la précieusement, elle sert à toutes les mises à jour ;
   - un fichier `assetlinks.json` contenant l'**empreinte SHA-256**.
3. Dans **Administration → Site et IA → Application Android**, colle le nom du paquet et l'empreinte
   SHA-256 (sans rien redéployer : le site les publie à `/.well-known/assetlinks.json`). Sans cette étape,
   l'application affiche une barre d'adresse en haut.
4. Play Store : crée un compte développeur Google Play (25 $ une seule fois), crée l'application, envoie
   le fichier .aab, ajoute des captures d'écran et l'adresse de la politique de confidentialité :
   `https://tondomaine.com/#/confidentialite`.
5. Colle le lien du Play Store (ou de l'APK) dans **Lien de téléchargement** : un bouton
   « Télécharger sur Android » apparaît sur la page d'accueil.

Avec Android Studio installé, tu peux aussi le faire en ligne de commande :

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://tondomaine.com/manifest.webmanifest
bubblewrap build
```

---

## 8. Coûts à prévoir

- Domaine : ~10 €/an.
- Serveur : rien de plus chez o2switch (déjà payé) ; sinon 4 à 8 €/mois (VPS) ou ~7 $/mois + disque (Render).
- IA de synchronisation : Groq a une offre gratuite ; ensuite quelques centimes par heure d'audio.
  Les quotas des formules limitent la dépense par client.
- Play Store : 25 $ une seule fois (facultatif).
