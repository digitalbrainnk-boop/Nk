## Agent de dimensionnement électrique

Application de dimensionnement électrique, en français, utilisable sans connexion internet. Elle couvre :
* le bilan de puissance d'un bâtiment ;
* les câbles et les protections ;
* le solaire, les batteries et les onduleurs ;
* le groupe électrogène ;
* le raccordement au réseau ;
* la compensation et les lignes aériennes ;
* la note de calcul justifiée.

Normes prises en charge : NF C 15-100, IEC 60364, BS 7671 et NEC.

### Installer sur un téléphone Android

1. Téléchargez **agent-dimensionnement.apk** ci-dessous, dans « Assets ».
2. Ouvrez le fichier, puis touchez **Installer**.
   * Si Android bloque l'installation, touchez **Paramètres** et autorisez cette source.
   * Si Play Protect avertit que l'application n'est pas reconnue, touchez **Plus de détails**, puis **Installer quand même**. L'application n'est pas sur le Play Store.
3. Ouvrez **Dimensionnement**. L'application démarre sur un projet vide, avec un guide des informations à saisir.

Android 5.0 et plus. Une nouvelle version s'installe par-dessus l'ancienne, sans perdre les projets.

### Sur ordinateur

Téléchargez **agent-dimensionnement-hors-ligne.html** et ouvrez-le dans Chrome, Edge ou Firefox. Rien à installer.

### Assistant IA (facultatif)

Dans l'onglet **Assistant IA**, choisissez le cerveau, puis collez votre clé API personnelle :
* **DeepSeek** via Kie.ai, avec une clé kie.ai ;
* **Claude** via Anthropic, avec une clé console.anthropic.com.

La clé reste sur le téléphone. Sans clé, tous les calculs fonctionnent.

### Nouveautés de cette version

* **Catalogue de 237 équipements**, en 14 familles : éclairage, climatisation, froid, cuisine, électroménager, informatique, sécurité, pompage, atelier et soudage, agro-transformation, santé, commerce, bornes de recharge, moteurs et industrie. On recherche un appareil (« clim 12000 », « pompe forage », « moulin »), on choisit les quantités, et l'application crée les circuits.
  * Un circuit par climatiseur, chauffe-eau, plaque de cuisson, moteur ou borne de recharge.
  * Au plus 8 points d'éclairage par circuit.
  * Les protections et sections minimales usuelles sont fixées selon l'usage.
* **Types de circuits** (éclairage, prises, cuisson, chauffe-eau, climatisation, force motrice…) : protection et section minimales selon la NF C 15-100 ou le NEC.
* **Puissance dans l'unité de la plaque** : W, kW, CV, HP, kVA ou ampères. La conversion tient compte du cos φ, du rendement, de la tension et des phases.
* Réfrigérateurs, congélateurs et climatiseurs non inverter sont comptés comme des compresseurs : leur appel au démarrage est vérifié.
* **Démarrages décalés** : plusieurs moteurs identiques ne démarrent pas tous à la fois. L'onduleur et le groupe ne sont plus surdimensionnés quand il y a plusieurs pompes ou réfrigérateurs.
* **Nouvel onglet « Matériel et devis »**. Il donne la liste du matériel avec ses quantités :
  * modules, régulateurs, batteries, onduleurs, groupe ;
  * câbles par section et longueur ;
  * disjoncteurs avec leur pouvoir de coupure, interrupteurs différentiels et coffret.

  Vos prix unitaires sont mémorisés sur le téléphone. La main-d'œuvre et la TVA sont prises en compte, et le devis s'exporte en CSV. La liste du matériel figure aussi dans la note de calcul.
* **Fiche de relevé terrain à imprimer** : toutes les informations à relever chez le client, pré-remplies avec le projet en cours.
* L'assistant IA utilise le catalogue et peut donner la liste du matériel.
* Android : la touche Retour ferme le catalogue au lieu de quitter l'application.

> Outil d'aide à la conception : les valeurs des normes et du matériel sont à vérifier. Toute note remise à un bureau de contrôle doit être validée par un ingénieur qualifié.
