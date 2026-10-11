# Installer l'Agent de dimensionnement électrique

L'application calcule entièrement sur le téléphone ou l'ordinateur, **sans connexion internet**. Seul l'assistant IA a besoin d'internet.

| Appareil | Méthode | Lien |
|---|---|---|
| Téléphone Android | Application à installer (fichier APK, moins de 1 Mo) | [agent-dimensionnement.apk](https://github.com/digitalbrainnk-boop/Nk/raw/ccr-efb31b50-bazt84/dimensionnement/dist/agent-dimensionnement.apk) |
| iPhone, iPad, Android, ordinateur | Application web installable | [digitalbrainnk-boop.github.io/Nk/dimensionnement/app](https://digitalbrainnk-boop.github.io/Nk/dimensionnement/app/) |
| Ordinateur sans internet | Un seul fichier à ouvrir dans Chrome, Edge ou Firefox | [`dist/agent-dimensionnement-hors-ligne.html`](dist/agent-dimensionnement-hors-ligne.html), à envoyer en pièce jointe |

## Sur un téléphone Android

1. Ouvrez le lien de l'APK, ou le fichier reçu par WhatsApp ou e-mail. Le fichier `agent-dimensionnement.apk` se télécharge.
2. Touchez le fichier téléchargé, puis **Installer**.
   * Si Android bloque l'installation d'applications inconnues, touchez **Paramètres** et autorisez l'application qui ouvre le fichier (Chrome, WhatsApp, Fichiers), puis revenez en arrière.
   * Si Play Protect affiche « Application non reconnue », touchez **Plus de détails**, puis **Installer quand même**. L'application n'est pas publiée sur le Play Store, d'où cet avertissement.
3. L'icône **Dimensionnement** apparaît avec les autres applications.

L'application fonctionne sur Android 5.0 et plus. Les notes de calcul, carnets de câbles et projets exportés sont enregistrés dans **Téléchargements** (Android 10 et plus) et peuvent être envoyés directement par WhatsApp ou e-mail.

**Mise à jour :** installez le nouveau fichier APK par-dessus l'ancien. Les projets sont conservés.

## Sur iPhone ou iPad

1. Ouvrez le lien de l'application web dans **Safari**.
2. Touchez **Partager** (le carré avec une flèche vers le haut), puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. Ouvrez l'application depuis son icône. Elle fonctionne ensuite sans connexion et se met à jour d'elle-même quand internet est disponible.

## Sur un ordinateur

* **Avec internet :** ouvrez le lien de l'application web dans Chrome ou Edge, puis cliquez sur l'icône **Installer** à droite de la barre d'adresse.
* **Sans internet :** ouvrez le fichier `agent-dimensionnement-hors-ligne.html` reçu en pièce jointe. Rien à installer.

## L'assistant IA

* **Dans Claude**, l'assistant est inclus : il suffit d'ouvrir le lien de l'application partagé depuis Claude.
* **Dans l'application installée**, on choisit le « cerveau » de l'assistant dans son panneau :
  * **DeepSeek V4.1 Flash, via Kie.ai** (choix par défaut) : clé API du compte Kie.ai, rubrique API Key ;
  * **Claude Opus 5.5, via Anthropic** : clé API créée sur console.anthropic.com, rubrique API Keys.
* Saisissez la clé, touchez **Activer l'assistant**, puis **Tester la connexion**.
* La clé reste enregistrée sur l'appareil et n'est envoyée qu'au service choisi. Chaque demande consomme des crédits du compte de la clé.
* Pour un collègue, transmettez la clé en privé : elle n'est jamais intégrée à l'application ni publiée sur GitHub.

Sans clé, tous les onglets de calcul restent disponibles.

**Réglages avancés Kie.ai** (adresse de l'API, modèle) : à ne modifier que si Kie.ai change son adresse ou le nom du modèle. Par défaut :
* adresse : `https://api.kie.ai/openai/v1/responses` ;
* modèle : `deepseek-v4-1-flash`.

## Premier dimensionnement

L'application s'ouvre sur un projet vide, avec un guide des informations à saisir :
1. **Projet** : nom, type de système, norme et réseau.
2. **Site** : lieu, altitude, températures. Le bouton **Utiliser ma position (GPS)** remplit le lieu.
3. **Charges** : circuits et appareils, avec leurs heures d'utilisation.
4. **Ensoleillement mensuel** : conseillé pour le solaire.
5. **Choix techniques** : facultatif.

Le calcul se lance tout seul dès que les étapes 2 et 3 sont remplies.

Pour tout effacer et repartir de zéro : onglet **Projet**, **Réinitialiser l'application**.

## Projets

Chaque appareil garde ses propres projets. Pour transmettre un projet à un collègue :
1. Onglet **Projet**, **Exporter le projet (.json)**.
2. Envoyez le fichier.
3. Votre collègue l'ouvre avec **Importer un projet (.json)**.

---

## Pour le responsable de l'application

**Activer le lien web (une seule fois).** Dans le dépôt GitHub :
1. Ouvrez **Settings**, puis **Pages**.
2. Sous **Build and deployment**, choisissez :
   * **Source** : *Deploy from a branch* ;
   * **Branche** : `ccr-efb31b50-bazt84` ;
   * **Dossier** : `/ (root)`.
3. Cliquez sur **Save**.

Le lien `https://digitalbrainnk-boop.github.io/Nk/dimensionnement/app/` est actif après une ou deux minutes. Le fichier `.nojekyll` à la racine du dépôt fait servir les fichiers tels quels.

**Reconstruire après une modification de l'application :**

```bash
cd dimensionnement
python3 outils/construire.py --apk
```

Cette commande :
* met à jour le numéro de cache de l'application web (les applications installées proposent alors la mise à jour) ;
* reconstruit le fichier unique hors ligne ;
* reconstruit l'APK signé.

Pour qu'un téléphone accepte la nouvelle version par-dessus l'ancienne, augmentez `VERSION` dans `app/moteur.js`. Le numéro de version Android en est déduit.

Prérequis :
* Python 3 avec le paquet `cryptography` ;
* un JDK 11 ou plus ;
* Linux x86-64.

Les outils Android sont téléchargés automatiquement depuis Maven Central et vérifiés. Le SDK Android n'est pas nécessaire.

**Clé de signature Android.** L'APK est signé avec une clé conservée hors du dépôt : `~/.config/agent-dimensionnement/signature-android.p12` et son mot de passe dans `signature-android.mdp`. On peut aussi l'indiquer avec les variables `ANDROID_CLE` et `ANDROID_CLE_MDP`.

Gardez cette clé en lieu sûr et ne la publiez jamais : les mises à jour doivent être signées avec la même clé pour s'installer par-dessus l'ancienne version. Sans elle, il faudrait désinstaller l'application, après avoir exporté ses projets, avant d'installer la nouvelle.
