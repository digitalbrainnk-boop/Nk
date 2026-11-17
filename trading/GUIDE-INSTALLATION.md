# Installer NK Trader sur Windows et l'utiliser sur le téléphone

NK Trader tourne sur l'**ordinateur Windows**. Le **téléphone** l'ouvre par le **Wi-Fi de la maison**,
comme une application (icône sur l'écran d'accueil).

---

## Étape 1 — Installer Python (une seule fois)

1. Sur l'ordinateur, allez sur **https://www.python.org/downloads/windows/**
2. Téléchargez **Python 3.13** (« Windows installer (64-bit) »).
3. Ouvrez le fichier téléchargé.
4. ⚠️ **Cochez la case « Add python.exe to PATH »** en bas de la première fenêtre.
5. Cliquez sur **Install Now**, attendez la fin, puis **Close**.

## Étape 2 — Télécharger NK Trader

1. Sur l'ordinateur, connecté à votre compte GitHub, ouvrez ce lien :
   **https://github.com/digitalbrainnk-boop/Nk/archive/refs/heads/ccr-10eec98d-l3lkjm.zip**
2. Un fichier ZIP se télécharge. Faites un **clic droit** dessus → **Extraire tout…** → **Extraire**.
3. Ouvrez le dossier obtenu (parfois deux fois de suite) jusqu'à voir un dossier nommé **`trading`**.
   Ouvrez-le.

## Étape 3 — Lancer NK Trader

1. Dans le dossier `trading`, **double-cliquez sur `DEMARRER.bat`**.
   - Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** → **Exécuter quand même**.
2. La **première fois**, une fenêtre noire installe tout : **3 à 5 minutes** (internet nécessaire).
3. Un menu apparaît : tapez **`1`** puis **Entrée** (données réelles Deriv).
4. Si Windows demande l'autorisation du **pare-feu** : cochez **Réseaux privés**, puis **Autoriser**.
   (C'est ce qui permet au téléphone de se connecter.)
5. NK Trader s'ouvre dans le navigateur de l'ordinateur.
   **Ne fermez pas la fenêtre noire** : c'est le moteur de l'application.
6. Cliquez sur **« Activer le son »** en haut de la page.

**Vérification :** en haut à droite, le point à côté de **Deriv** doit être **vert**.
Si un **bandeau rouge** apparaît, prenez une photo de la page et de la fenêtre noire et envoyez-les.
Pour essayer quand même l'application, fermez la fenêtre noire, relancez `DEMARRER.bat` et tapez **`2`** (simulateur).

## Étape 4 — Ouvrir NK Trader sur le téléphone

1. Le téléphone doit être connecté au **même Wi-Fi** que l'ordinateur.
2. Sur l'ordinateur, cliquez sur le bouton **📱 Téléphone** en haut de la page : un **QR code** s'affiche.
3. Sur le téléphone, ouvrez l'**appareil photo**, visez le QR code et **touchez le lien** qui apparaît.
4. NK Trader s'ouvre sur le téléphone.
5. Pour avoir une icône comme une application :
   - **Android (Chrome)** : menu **⋮** en haut à droite → **Ajouter à l'écran d'accueil**.
   - **iPhone (Safari)** : bouton **Partager** → **Sur l'écran d'accueil**.
6. Touchez **« Activer le son »** pour entendre les alarmes.

## Chaque jour ensuite

1. Ordinateur : double-clic sur **`DEMARRER.bat`**, tapez **`1`**, **Entrée**.
2. Téléphone : touchez l'icône **NK Trader**, puis **« Activer le son »**.

---

## À savoir

- **L'ordinateur doit rester allumé**, avec la fenêtre noire ouverte. Pour éviter la mise en veille :
  Paramètres Windows → **Système** → **Alimentation** → mise en veille : **Jamais** (sur secteur).
- **Le téléphone sonne seulement quand NK Trader est affiché et l'écran allumé** : les téléphones mettent
  en pause les pages en arrière-plan. L'ordinateur, lui, sonne en permanence. Les alertes manquées restent
  dans l'onglet **Alertes**.
- **Le téléphone ne se connecte pas ?**
  1. Vérifiez qu'il est sur le même Wi-Fi (pas en 4G).
  2. Sur l'ordinateur : Paramètres → **Réseau et Internet** → **Wi-Fi** → votre réseau →
     **Type de profil réseau : Privé**.
  3. Essayez l'autre adresse indiquée dans la fenêtre 📱 Téléphone, s'il y en a une.
- **Sécurité :** l'accès depuis le téléphone est protégé par un code (inclus dans le QR code). Le code est
  affiché dans la fenêtre noire ; il est enregistré dans `trading/data/code_telephone.txt`. Pour en créer
  un nouveau, supprimez ce fichier et relancez.
- **Hors de la maison (4G)**, cela ne fonctionne pas : il faudrait héberger l'application en ligne.
- NK Trader **analyse et alerte** ; il **ne passe aucun ordre** chez votre courtier.
