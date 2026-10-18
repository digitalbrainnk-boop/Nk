# Données de marché pour la validation

Placer ici l'export M1 du symbole or depuis MetaTrader 5 :
**Affichage → Symboles → onglet Barres**, choisir le symbole (ex. `XAUUSDm`), la
période **M1** et une plage de plusieurs années, **Demander**, puis **Exporter les
barres** (fichier `.csv` avec les colonnes `<DATE> <TIME> <OPEN> <HIGH> <LOW>
<CLOSE> <TICKVOL> <VOL> <SPREAD>`).

Un fichier de plus de 100 Mo doit être zippé (`XAUUSDm_M1.zip`) pour GitHub.

Puis : `tests/run_validation.sh donnees/XAUUSDm_M1.csv` (voir le README, § 2).
Les données restent celles de votre courtier : vérifiez les conditions
d'utilisation de votre compte avant de les publier dans un dépôt public.
