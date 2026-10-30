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
crée le tien en premier. Pour voir l'application comme un client, ouvre une fenêtre de navigation privée
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
| **Serveur VPS + Docker** (recommandé) | 4 à 8 €/mois (Hetzner CX22, Contabo, OVH VPS…) | Le plus complet : ffmpeg inclus, HTTPS automatique, espace disque à volonté |
| **Render** | ~7 $/mois + disque | Le plus simple : tout se fait dans le navigateur, sans ligne de commande |
| o2switch (ton hébergeur actuel) | déjà payé | Possible pour démarrer, mais sans ffmpeg ni séparation de voix par IA, et les envois de gros fichiers sont limités |

Pour la séparation de la voix par IA (Demucs) sur le serveur, prends un VPS avec **8 Go de mémoire**
au moins (Hetzner CX32 ~8 €/mois). Sans Demucs, le karaoké retire la voix « au centre » et tes clients
peuvent envoyer leurs propres pistes.

---

## 3. Acheter le nom de domaine

1. Chez un registraire (Namecheap, OVH, Hostinger, Google Domains/Squarespace…), cherche un nom libre, par
   exemple `monkaraoke.com` (~10 €/an).
2. Dans la zone DNS du domaine, crée :
   - un enregistrement **A** : nom `@` → l'adresse IP de ton serveur ;
   - un enregistrement **A** (ou CNAME vers `@`) : nom `www` → la même adresse.
3. Attends quelques minutes (parfois jusqu'à quelques heures) que le domaine pointe vers le serveur.

Sur Render : Settings → **Custom Domains** → ajoute ton domaine et suis les indications DNS de Render.

---

## 4. Installer sur un serveur VPS (Docker)

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

## 5. Régler ton site (Administration)

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

## 6. L'application Android

### a) Installation directe (déjà prête)

Sur le site, les clients Android touchent **📲 Installer l'application** (ou menu ⋮ de Chrome →
Installer l'application). L'application apparaît dans la liste des applications, s'ouvre en plein
écran et se met à jour toute seule. Rien à publier.

### b) Fichier APK et Play Store

Le site doit d'abord être en ligne avec son nom de domaine en HTTPS (étapes 3 et 4).

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

## 7. Coûts à prévoir

- Domaine : ~10 €/an.
- Serveur : 4 à 8 €/mois (VPS) ou ~7 $/mois + disque (Render).
- IA de synchronisation : Groq a une offre gratuite ; ensuite quelques centimes par heure d'audio.
  Les quotas des formules limitent la dépense par client.
- Play Store : 25 $ une seule fois (facultatif).
