# Installation et mise en ligne

L'application doit tourner sur un **serveur en ligne** pour que le propriétaire suive le maquis à distance et que les bilans de 03 h 00 soient produits même quand tous les téléphones sont éteints.

## Ce dont vous avez besoin

- Un hébergement qui accepte **Node.js 22.16 ou plus récent** (o2switch, un serveur VPS, etc.).
- Une adresse **https** (par exemple `maquis.votre-domaine.com`). Le https est obligatoire pour installer l'application sur les téléphones et recevoir les notifications.

## Option 1 — o2switch (cPanel)

1. **Sous-domaine** : cPanel → *Domaines* → créez `maquis.votre-domaine.com`, puis activez le certificat SSL (cPanel → *Lets Encrypt™ SSL*).
2. **Fichiers** : dans le *Terminal* de cPanel :
   ```bash
   cd ~
   git clone https://github.com/digitalbrainnk-boop/Nk.git nk-source
   cp -r nk-source/maquis-pro-manager ~/maquis-pro-manager
   cp ~/maquis-pro-manager/deploy/o2switch/app.js ~/maquis-pro-manager/app.js
   mkdir -p ~/maquis-donnees
   cp ~/maquis-pro-manager/.env.example ~/maquis-pro-manager/.env
   ```
   Dans `~/maquis-pro-manager/.env`, mettez `DATA_DIR=/home/VOTRE_UTILISATEUR/maquis-donnees` et votre adresse dans `VAPID_SUBJECT`.
3. **Application Node.js** : cPanel → *Setup Node.js App* → *Create Application* :
   - Node.js version : **22** (la plus récente proposée, 22.16 au minimum) ;
   - Application mode : *Production* ;
   - Application root : `maquis-pro-manager` ;
   - Application URL : `maquis.votre-domaine.com` ;
   - Application startup file : `app.js`.

   Cliquez sur *Create*, puis *Run NPM Install*, puis *Restart*.
4. **Code d'installation** : ouvrez `https://maquis.votre-domaine.com`. Le code se trouve dans `~/maquis-donnees/CODE-INSTALLATION.txt` (`cat ~/maquis-donnees/CODE-INSTALLATION.txt` dans le Terminal). Créez le compte du propriétaire.
5. **Tâches planifiées (indispensable chez o2switch)** : l'hébergeur met l'application en veille quand personne ne l'utilise. Les bilans doivent donc aussi être lancés par une tâche planifiée du serveur. cPanel → *Tâches Cron* → ajoutez :
   ```
   */10 * * * * cd ~/maquis-pro-manager && . ~/nodevenv/maquis-pro-manager/22/bin/activate && node --env-file-if-exists=.env scripts/rapports.js >> ~/maquis-donnees/rapports.log 2>&1
   */5 * * * * curl -fsS -m 30 https://maquis.votre-domaine.com/health > /dev/null 2>&1
   ```
   La première ligne produit les bilans dus, au plus 10 minutes après 03 h 00, même si le site dormait. Elle n'en produit jamais deux fois et fait aussi la sauvegarde quotidienne. La seconde garde le site éveillé pour les notifications en temps réel.
   Adaptez le chemin `nodevenv/…/22` : cPanel l'affiche en haut de la page *Setup Node.js App* (« Enter to the virtual environment »).

### Mettre à jour

```bash
cd ~/nk-source && git pull
rsync -a --exclude node_modules --exclude .env ~/nk-source/maquis-pro-manager/ ~/maquis-pro-manager/
cp ~/maquis-pro-manager/deploy/o2switch/app.js ~/maquis-pro-manager/app.js
```
Puis *Run NPM Install* et *Restart* dans *Setup Node.js App*. Les données (`~/maquis-donnees`) ne sont jamais touchées par une mise à jour.

## Option 2 — Serveur avec Docker

```bash
cd maquis-pro-manager
docker build -t maquis-pro-manager .
docker run -d --name maquis --restart unless-stopped -p 3000:3000 -v maquis-donnees:/data \
  -e VAPID_SUBJECT=mailto:vous@exemple.com maquis-pro-manager
docker exec maquis cat /data/CODE-INSTALLATION.txt
```
Placez un relais https devant (Caddy, Nginx…). Ici l'application tourne en continu : son planificateur interne produit les bilans à 03 h 00 précises.

## Option 3 — Essai sur un ordinateur

```bash
cd maquis-pro-manager && npm install && npm start
```
Ouvrez http://localhost:3000. Pour un vrai usage, préférez un serveur en ligne : un ordinateur éteint la nuit ne produit pas le bilan à 03 h 00. Le bilan sera produit au redémarrage (reprise), mais avec du retard.

## Sauvegardes et restauration

- Une sauvegarde complète et vérifiée est faite **chaque jour** après le bilan de 03 h 00, dans `DATA_DIR/sauvegardes` (les 30 dernières sont gardées).
- Le propriétaire peut en créer une et la **télécharger** : *Administration → Sauvegardes*. Gardez de temps en temps une copie hors du serveur.
- Restaurer :
  ```bash
  npm run restaurer                                  # liste les sauvegardes
  npm run restaurer -- maquis-20261105-031002.db     # prépare la restauration
  ```
  Redémarrez ensuite l'application. La base actuelle est gardée de côté (`sauvegardes/avant-restauration-….db`).

## Installer l'application sur les téléphones

- **Android (Chrome)** : ouvrez l'adresse → menu ⋮ → *Installer l'application*.
- **iPhone / iPad (Safari)** : ouvrez l'adresse → bouton *Partager* → *Sur l'écran d'accueil*. Ouvrez ensuite l'application depuis l'icône.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Puis, dans *Mon compte*, touchez **Activer les notifications sur cet appareil**.
