# 2. Recueil mathématique — Modules A à E et référentiels normatifs

Conventions :
* unités SI sauf mention contraire ;
* $U$ tension entre phases, $U_0 = V$ tension phase-neutre ;
* les coefficients notés en %/°C sont divisés par 100 dans les formules.

Les équations des modules A, B et C sont codées dans [`demo_hybride.py`](../demo_hybride.py) et dans le moteur de l'application [`app/moteur.js`](../app/moteur.js). Les référentiels, la source réseau et les modules D et E sont codés dans le moteur de l'application. La référence entre crochets renvoie à la source à consulter pour la justification opposable.

> ⚠️ Les valeurs de tables reproduites ici sont des valeurs usuelles de référence. Avant toute mise en production, chacune doit être vérifiée contre **l'édition en vigueur** de la norme citée et validée par un ingénieur qualifié (voir §1.1, principe 3).

---

## Module A — Bilan de puissance et installations du bâtiment

### A.1 Puissances d'un récepteur

```math
P_a = \frac{P_u}{\eta} \qquad Q_a = P_a \tan\varphi \qquad S_a = \frac{P_a}{\cos\varphi} = \sqrt{P_a^2 + Q_a^2}
```

$P_u$ est la puissance utile (plaque d'un moteur), $P_a$ la puissance absorbée. Pour un récepteur non motorisé, on prend $\eta = 1$.

```math
I_n^{\text{tri}} = \frac{P_u}{\sqrt{3}\,U\,\eta\cos\varphi} \qquad I_n^{\text{mono}} = \frac{P_u}{U_0\,\eta\cos\varphi}
```

### A.2 Foisonnement : facteurs d'utilisation et de simultanéité

```math
P_{\text{circ}} = k_{s,\text{circ}} \sum_i k_{u,i}\, n_i\, P_{a,i} \qquad
Q_{\text{circ}} = k_{s,\text{circ}} \sum_i k_{u,i}\, n_i\, Q_{a,i}
```

```math
P_{\text{TGBT}} = k_{s,\text{tab}} \sum P_{\text{circ}} \qquad Q_{\text{TGBT}} = k_{s,\text{tab}} \sum Q_{\text{circ}} \qquad
S_{\text{TGBT}} = \sqrt{P_{\text{TGBT}}^2 + Q_{\text{TGBT}}^2}
```

On additionne $P$ et $Q$ séparément (**théorème de Boucherot**), jamais les puissances apparentes $S$.

```math
S_{\text{dim}} = k_e \cdot \max\left(S_{\text{TGBT}},\; \max_h S_{\text{profil}}(h)\right)
```

* $k_u$, facteur d'utilisation : moteurs ≈ 0,75 ; éclairage et chauffage = 1.
* $k_e$, coefficient d'extension : 1,1 à 1,3.
* Le profil horaire sert à contrôler la méthode normative. En site isolé, la pointe réellement simultanée peut dépasser la valeur foisonnée.

**Simultanéité d'un tableau** (IEC 61439-2, tab. 101 — facteur de diversité assigné) :

| Nombre de circuits | 2–3 | 4–5 | 6–9 | ≥ 10 |
|---|---|---|---|---|
| $k_{s,\text{tab}}$ | 0,9 | 0,8 | 0,7 | 0,6 |

**Simultanéité par usage** (valeurs usuelles) :
* éclairage, chauffage, climatisation : 1 ;
* prises de courant : 0,1 à 0,2 ;
* ascenseurs : 1 pour le plus gros moteur, 0,75 pour le suivant, 0,6 pour les autres.

**Immeubles d'habitation** (nombre de logements en aval, valeurs usuelles du *Guide de l'installation électrique* Schneider Electric) :

| Logements | 2–4 | 5–9 | 10–14 | 15–19 | 20–24 | 25–29 | 30–34 | 35–39 | 40–49 | ≥ 50 |
|---|---|---|---|---|---|---|---|---|---|---|
| $k_s$ | 1 | 0,78 | 0,63 | 0,53 | 0,49 | 0,46 | 0,44 | 0,42 | 0,41 | 0,40 |

**Énergie journalière.** Elle n'utilise pas $k_s$ mais les durées et taux de marche réels :

```math
E_j = \sum_i \sum_{h=0}^{23} n_i\, P_{a,i}\, k_{u,i}\, \tau_i(h)\cdot 1\,\text{h}
```

### A.3 Courant d'emploi

```math
I_B^{\text{tri}} = \frac{S}{\sqrt{3}\,U} \qquad I_B^{\text{mono}} = \frac{S}{U_0} \qquad
I_{B,\text{eff}} = I_{B,1}\sqrt{1 + THD_i^2}\;\;(\text{charges non linéaires})
```

En triphasé déséquilibré, on dimensionne sur la **phase la plus chargée**. Les circuits monophasés sont répartis du plus gros au plus petit, chacun sur la phase la moins chargée.

### A.4 Protection contre les surcharges et les courts-circuits [IEC 60364-4-43 §433, NF C 15-100]

```math
I_B \le I_n \le I_z \qquad\qquad I_2 \le 1{,}45\, I_z
```

| Dispositif | $I_2$ (courant conventionnel de déclenchement) | Condition pratique |
|---|---|---|
| Disjoncteur domestique IEC 60898-1 | $1{,}45\,I_n$ | $I_n \le I_z$ |
| Disjoncteur industriel IEC 60947-2 | $1{,}30\,I_n$ | $I_n \le I_z$ |
| Fusible gG | $1{,}6\,I_n$ | $I_n \le I_z / k_3$, avec $k_3$ = 1,31 ($I_n$ ≤ 10 A) ; 1,21 (10 < $I_n$ ≤ 25 A) ; 1,10 ($I_n$ > 25 A) |

* **Pouvoir de coupure :** $I_{cu} \ge I''_{k3,\max}$ au point d'installation. Sinon, il faut une association (filiation) validée par le constructeur.
* **Courbes** (IEC 60898-1), seuil de déclenchement magnétique $I_m$ :

| Courbe | B | C | D |
|---|---|---|---|
| $I_m$ | 3 à 5 $I_n$ | 5 à 10 $I_n$ | 10 à 20 $I_n$ |

* **Choix de la courbe :** prendre la plus basse vérifiant $I_{m,\min} > 1{,}2\,I_d$ ($I_d$ = appel au démarrage), puis vérifier le déclenchement : $I_{k1,\min}(\text{bout de ligne}) \ge I_{m,\max}$.
* **Protection des personnes** (IEC 60364-4-41, tab. 41.1) :
  * schéma TN, 230 V, circuits terminaux ≤ 32 A : coupure en 0,4 s au plus ;
  * schéma TT : coupure en 0,2 s au plus, et $R_A \cdot I_{\Delta n} \le 50$ V.
* **Sélectivité** :
  * ampèremétrique : $I_{m,\text{amont}} > I_{k,\max,\text{aval}}$ ;
  * chronométrique (temporisation) ;
  * énergétique (tables des constructeurs).

> **Spécificité des sources autonomes.** Un onduleur ne fournit qu'environ 1,1 à 2,5 $I_n$ en court-circuit. Un groupe ne maintient qu'environ 3 $I_n$, et seulement avec une excitation AREP ou PMG. Le déclenchement magnétique n'est alors souvent **pas** assuré. Mesures à prévoir : DDR 30 mA, courbe B, calibres réduits, et un onduleur à fort courant de court-circuit si la continuité de service l'exige. Le démonstrateur fait cette vérification automatiquement.

### A.5 Courant admissible corrigé [IEC 60364-5-52 annexe B, NF C 15-100 §523]

```math
I'_z = I_{z,0}\cdot K, \qquad K = K_1\, K_2\, K_3\, K_n\, K_s \qquad\Rightarrow\qquad I_{z,0} \ge \frac{I_n}{K}
```

* $K_1$ : mode de pose (méthodes de référence A1, A2, B1, B2, C, D, E, F, G).
* $K_2$ : groupement (tab. B.52.17).
* $K_3$ : température. Avec $\theta_p$ = 70 °C (PVC) ou 90 °C (PR/EPR), et $\theta_\text{réf}$ = 30 °C dans l'air ou 20 °C dans le sol :

```math
K_3 = \sqrt{\frac{\theta_p - \theta_a}{\theta_p - \theta_{\text{réf}}}}
```

* $K_n$ : neutre chargé par les harmoniques de rang 3 (annexe E) :

| Taux d'harmonique 3 | 0–15 % | 15–33 % | 33–45 % | > 45 % |
|---|---|---|---|---|
| Courant pris en compte | phase | phase | neutre ($I_N = 3\,h_3\,I_B$) | neutre |
| Facteur | 1 | 0,86 | 0,86 | 1 |

* $K_s$ : symétrie des câbles unipolaires en parallèle.
* Pose enterrée : ajouter le facteur de résistivité thermique du sol.

**Groupement** (tab. B.52.17, nombre de circuits ou de câbles multiconducteurs) :

| Disposition | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12 | 16 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Faisceau à l'air, encastré ou sous conduit | 1 | 0,80 | 0,70 | 0,65 | 0,60 | 0,57 | 0,54 | 0,52 | 0,50 | 0,45 | 0,41 | 0,38 |
| Une couche sur paroi ou sur chemin non perforé | 1 | 0,85 | 0,79 | 0,75 | 0,73 | 0,72 | 0,72 | 0,71 | 0,70 | — | — | — |
| Une couche sur chemin perforé | 1 | 0,88 | 0,82 | 0,77 | 0,75 | 0,73 | 0,73 | 0,72 | 0,72 | — | — | — |

**Méthode E** (multiconducteur sur chemin perforé), cuivre PR, 30 °C, valeurs en A :

| S (mm²) | 1,5 | 2,5 | 4 | 6 | 10 | 16 | 25 | 35 | 50 | 70 | 95 | 120 | 150 | 185 | 240 | 300 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 conducteurs chargés | 23 | 31 | 42 | 54 | 75 | 100 | 127 | 158 | 192 | 246 | 298 | 346 | 399 | 456 | 538 | 621 |
| 2 conducteurs chargés | 26 | 36 | 49 | 63 | 86 | 115 | 149 | 185 | 225 | 289 | 352 | 410 | 473 | 542 | 641 | 741 |

### A.6 Chute de tension [NF C 15-100 §525, IEC 60364-5-52 annexe G]

```math
\Delta U = b\left(\rho_1 \frac{L}{S}\cos\varphi + \lambda L \sin\varphi\right) I_B
\qquad\qquad \Delta U\% = 100\,\frac{\Delta U}{U_0}
```

* $b$ = 1 en triphasé, 2 en monophasé.
* $\rho_1 = 1{,}25\,\rho_0$ : 0,023 Ω·mm²/m pour le cuivre, 0,037 Ω·mm²/m pour l'aluminium.
* $\lambda \approx 0{,}08$ mΩ/m.

Limites, cumulées de l'origine de l'installation au récepteur :

| Alimentation | Éclairage | Autres usages |
|---|---|---|
| A — réseau public BT | 3 % | 5 % |
| B — poste HTA/BT privé | 6 % | 8 % |

Pour une source autonome, retenir la ligne A, plus prudente. Au démarrage d'un moteur, viser $\Delta U \le$ 10 à 15 % et vérifier le couple. Côté continu :

```math
\Delta U_{DC}\% = 100\,\frac{2\rho L I}{S\,U_{DC}}
```

### A.7 Contrainte thermique en court-circuit [IEC 60364-4-43 §434.5.2, tab. 43A]

```math
S \ge \frac{\sqrt{I^2 t}}{k} \qquad
k = 115 \;(\text{Cu-PVC}),\; 143 \;(\text{Cu-PR}),\; 76 \;(\text{Al-PVC}),\; 94 \;(\text{Al-PR})
```

* Formule valable pour $t \le 5$ s.
* Pour $t < 0{,}1$ s, utiliser l'énergie $I^2t$ limitée par le dispositif de protection (donnée constructeur).
* Conducteur de protection (IEC 60364-5-54, tab. 54.2) :
  * $S_{ph} \le 16$ mm² : $S_{PE} = S_{ph}$ ;
  * jusqu'à 35 mm² : $S_{PE}$ = 16 mm² ;
  * au-delà : $S_{PE} = S_{ph}/2$.

### A.8 Courants de court-circuit [IEC 60909-0, méthode des impédances]

**Impédances des éléments :**

```math
Z_Q = \frac{c\,U_n^2}{S''_{kQ}} \qquad
Z_T = \frac{u_k\,U_n^2}{S_{rT}},\;\; R_T = \frac{P_{cu}\,U_n^2}{S_{rT}^2},\;\; X_T = \sqrt{Z_T^2 - R_T^2} \qquad
R_c = \rho\frac{L}{S},\;\; X_c = \lambda L
```

**Courants de court-circuit :**

```math
I''_{k3} = \frac{c_{\max}\,U_n}{\sqrt{3}\,\lvert Z_k\rvert} \qquad
I''_{k2} = \frac{\sqrt{3}}{2}\, I''_{k3} \qquad
I''_{k1} = \frac{\sqrt{3}\,c\,U_n}{\lvert 2Z_1 + Z_0\rvert} \qquad
i_p = \kappa\sqrt{2}\,I''_k,\;\; \kappa = 1{,}02 + 0{,}98\,e^{-3R/X}
```

**Courant phase-neutre minimal en bout de ligne** (vérification des protections) :

```math
I_{k1,\min} = \frac{c_{\min}\,U_0}{\lvert Z_{\text{source}}\rvert + \rho_{cc}\,\dfrac{2L}{S}}, \qquad \rho_{cc} \approx 1{,}5\,\rho_0 \;\text{(fin de défaut)}
```

* Facteurs de tension en BT : $c_{\max}$ = 1,05 (tolérance +6 %) ou 1,10 (tolérance +10 %) ; $c_{\min}$ = 0,95.
* Pour le calcul de $I_{k,\max}$, prendre la résistivité à 20 °C ($\rho_0 = 0{,}0185$ Ω·mm²/m pour le cuivre).

**Contributions des sources :**

| Source | Courant de court-circuit |
|---|---|
| Alternateur | $I''_{k3} = I_{rG}/x''_d$, puis $I'_{k3} = I_{rG}/x'_d$, puis courant maintenu ≈ 3 $I_{rG}$ (excitation AREP ou PMG). Avec une excitation shunt, le courant s'effondre. |
| Onduleur | ≈ 1,1 à 2,5 $I_n$ pendant une durée limitée (donnée constructeur) |
| Batterie | $I_{cc} \approx U/R_i$, ce qui donne plusieurs dizaines de kA. Il faut des protections avec un pouvoir de coupure en courant continu suffisant. |

---

## Module B — Photovoltaïque et systèmes hybrides

### B.1 Géométrie solaire [Duffie & Beckman, ch. 1]

```math
\delta = 23{,}45^\circ \sin\!\left(360^\circ\,\frac{284+n}{365}\right) \qquad
\omega_s = \arccos(-\tan\varphi\,\tan\delta) \qquad
N_{\text{jour}} = \frac{2\,\omega_s}{15}\;\text{h}
```

```math
H_0 = \frac{24 \times 3600\; G_{sc}}{\pi}\left(1 + 0{,}033\cos\frac{2\pi n}{365}\right)
\left[\cos\varphi\cos\delta\sin\omega_s + \omega_s\sin\varphi\sin\delta\right]
\qquad (G_{sc} = 1367\ \text{W/m}^2,\ \omega_s\ \text{en rad})
```

* Indice de clarté : $K_T = H / H_0$.
* Jours moyens de chaque mois (Klein) : 17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344.
* Contrôle : pour φ = 43° N et n = 105, on obtient H₀ = 33,8 MJ/m² (vérifié dans les tests).

Angle d'incidence sur un plan quelconque (inclinaison β, azimut γ, angle horaire ω), utilisé pour le calcul horaire :

```math
\cos\theta = \sin\delta\sin\varphi\cos\beta - \sin\delta\cos\varphi\sin\beta\cos\gamma
+ \cos\delta\cos\varphi\cos\beta\cos\omega + \cos\delta\sin\varphi\sin\beta\cos\gamma\cos\omega
+ \cos\delta\sin\beta\sin\gamma\sin\omega
```

### B.2 Transposition sur plan incliné (modèle isotrope de Liu & Jordan)

**Fraction diffuse mensuelle** (Erbs) :

```math
\frac{\bar H_d}{\bar H} = \begin{cases}
1{,}391 - 3{,}560\,K_T + 4{,}189\,K_T^2 - 2{,}137\,K_T^3 & \omega_s \le 81{,}4^\circ\\
1{,}311 - 3{,}022\,K_T + 3{,}427\,K_T^2 - 1{,}821\,K_T^3 & \omega_s > 81{,}4^\circ
\end{cases}
\qquad 0{,}3 \le K_T \le 0{,}8
```

**Irradiation sur le plan incliné** (albédo $\rho_g$) :

```math
\bar H_T = \bar H\left[\left(1 - \frac{\bar H_d}{\bar H}\right)\bar R_b + \frac{\bar H_d}{\bar H}\,\frac{1+\cos\beta}{2} + \rho_g\,\frac{1-\cos\beta}{2}\right]
```

**Facteur géométrique du rayonnement direct**, pour un plan orienté vers l'équateur. Dans l'hémisphère Sud, remplacer $\varphi - \beta$ par $\varphi + \beta$.

```math
\bar R_b = \frac{\cos(\varphi-\beta)\cos\delta\sin\omega'_s + \omega'_s\sin(\varphi-\beta)\sin\delta}
{\cos\varphi\cos\delta\sin\omega_s + \omega_s\sin\varphi\sin\delta},
\qquad \omega'_s = \min\left[\omega_s,\ \arccos\left(-\tan(\varphi-\beta)\tan\delta\right)\right]
```

**Choix de l'inclinaison** pour un site isolé : on prend β qui maximise l'irradiation du mois le plus défavorable, avec β ≥ 10° pour l'auto-nettoyage par la pluie. En pratique, β ≈ |φ| + 10 à 15°.

En production (V1), utiliser :
* le modèle anisotrope de Perez (`pvlib`) ;
* des données horaires TMY (PVGIS) ;
* le masque d'horizon et les pertes angulaires (IAM).

**Répartition horaire** (Collares-Pereira & Rabl), utilisée par la simulation, avec $\omega$ en heure solaire et la somme sur la journée normalisée à 1 :

```math
r_t(\omega) = \frac{\pi}{24}\,(a + b\cos\omega)\,\frac{\cos\omega - \cos\omega_s}{\sin\omega_s - \omega_s\cos\omega_s}
\qquad a = 0{,}409 + 0{,}5016\sin(\omega_s - 60^\circ),\;\; b = 0{,}6609 - 0{,}4767\sin(\omega_s - 60^\circ)
```

### B.3 Productible et puissance crête

**Heures équivalentes de plein soleil :**

```math
PSH = \frac{\bar H_T\ [\text{kWh/m}^2/\text{j}]}{1\ \text{kW/m}^2}
```

**Température de cellule et facteur de température :**

```math
T_c = T_a + \frac{NOCT - 20}{800}\,G \qquad\qquad k_\theta = 1 + \gamma\,(T_c - 25)
```

**Ratio de performance côté continu :**

```math
PR_{DC} = k_\theta\,(1 - p_{\text{encr}})(1 - p_{\text{disp}})(1 - p_{\text{câbles}})\;\eta_{MPPT}\;(1-d)^{N}
```

Encrassement, dispersion entre modules, pertes dans les câbles, rendement MPPT, dégradation annuelle $d$ sur $N$ années.

**Énergie à produire.** La part $f_d$ est consommée directement dans la journée, le reste passe par la batterie. $c$ est le taux de couverture visé sur le mois critique.

```math
E_{PV} = c\left[\frac{f_d\,E_j}{\eta_{ond}} + \frac{(1-f_d)\,E_j}{\eta_{ond}\,\eta_{batt}}\right]
```

**Puissance crête et nombre de modules :**

```math
P_c = \frac{E_{PV}}{PSH_{\text{crit}}\cdot PR_{DC}} \qquad\qquad N_{\text{mod}} = \left\lceil \frac{P_c}{P_{\text{mod}}}\right\rceil
```

### B.4 Agencement série/parallèle [IEC 62548, guide UTE C 15-712-1]

```math
V_{oc}(T_{\min}) = V_{oc}\,[1 + \beta_{V_{oc}}(T_{\min} - 25)] \qquad
V_{mp}(T) = V_{mp}\,[1 + \gamma_{V_{mp}}(T - 25)] \qquad
I_{sc}(T) = I_{sc}\,[1 + \alpha_{I_{sc}}(T - 25)]
```

```math
N_{s,\max} = \left\lfloor \min\left(\frac{V_{DC,\max}}{V_{oc}(T_{\min})},\ \frac{V_{MPPT,\max}}{V_{mp}(T_{\min})}\right)\right\rfloor
\qquad
N_{s,\min} = \left\lceil \frac{V_{MPPT,\min}}{V_{mp}(T_{c,\max})}\right\rceil
\qquad
N_{p,\max} = \left\lfloor \frac{I_{\text{entrée},\max}}{I_{sc}(T_{c,\max})}\right\rfloor
```

* $T_{c,\max} = T_{a,\max} + (NOCT - 20)\cdot 1000/800$.
* Pour un régulateur MPPT de charge batterie : $V_{MPPT,\min} \ge U_{\text{charge batt}} + 5$ V (donnée constructeur).
* Pour un régulateur : $N_s N_p P_{\text{mod}} \le r \cdot I_{\text{charge},\max}\, U_{\text{batt}}$, avec $r \approx 1{,}1$ à $1{,}3$.
* Pour un onduleur réseau : rapport DC/AC compris entre 1,1 et 1,3.

**Protection des chaînes :**

* Elle est requise si $(N_p - 1)\cdot 1{,}25\,I_{sc} > I_{RM}$, où $I_{RM}$ est le courant inverse admissible du module.
* Calibre du fusible gPV (IEC 60269-6) : $1{,}5\,I_{sc} \le I_n \le 2{,}4\,I_{sc}$ et $I_n \le I_{RM}$.

**Câbles de chaîne** (H1Z2Z2-K, EN 50618) :
* $I_z \ge 1{,}25\,I_{sc}$ (chaîne sans protection), ou $I_z \ge I_n$ (chaîne protégée) ;
* $\Delta U_{DC} \le$ 1 à 1,5 % visé, 3 % au maximum.

Prévoir aussi un parafoudre de type 2 côté continu (IEC 61643-31), et une isolation de classe II.

### B.5 Parc batteries [IEEE 1013, IEEE 1562, IEEE 485]

```math
C_{Wh} = \frac{E_j\;N_{\text{aut}}\;k_{\text{vieill}}\;k_T}{\eta_{ond}\;DoD} \qquad
C_{Ah} = \frac{C_{Wh}}{U_{\text{nom}}} \qquad
N_s = \frac{U_{\text{bus}}}{U_{\text{élément}}} \qquad
N_p = \left\lceil\frac{C_{Ah}}{C_{\text{unité}}}\right\rceil
```

| Paramètre | LiFePO4 | Plomb OPzV/GEL |
|---|---|---|
| DoD de cyclage | 0,8 – 0,9 | 0,5 |
| Rendement aller-retour | 0,95 | 0,80 – 0,85 |
| $k_\text{vieill}$ | 1,0 – 1,1 | 1,25 (fin de vie à 80 %, IEEE 485) |
| $k_T$ | 1 (pas de charge sous 0 °C, géré par le BMS) | $1 + 0{,}01\,(25 - T_{\min})$ |
| Courant de charge max | 0,5 C | 0,10 – 0,15 C₁₀ |
| Courant de décharge continu | 0,5 – 1 C | 0,2 C |

* **Jours d'autonomie :**
  * 2 à 5 jours en site isolé sans groupe ;
  * 0,5 à 1,5 jour en hybride, car le groupe couvre les séquences nuageuses. Le bon compromis se trouve par simulation.
* **Effet Peukert (plomb) :**

```math
t = H\left(\frac{C}{I\,H}\right)^{k}, \qquad k \approx 1{,}1 \text{ à } 1{,}3
```

  Pour une autonomie de plusieurs jours, utiliser la capacité au régime C₁₀₀.
* **Vérification des courants :**

```math
I_{\text{déch},\max} = \frac{P_{\text{ond}}}{U_{\min}\,\eta_{ond}} \le c_{\text{déch}}\,C \qquad
I_{\text{charge}} \le c_{\text{ch}}\,C
```

  Pour le plomb, il faut aussi $I_{\text{charge PV}} \ge 0{,}05\,C_{10}$, sinon les recharges restent incomplètes (sulfatation).
* **Tension du bus :**
  * 12 V jusqu'à environ 1,5 kW ;
  * 24 V jusqu'à environ 4 kW ;
  * 48 V au-delà ;
  * batterie haute tension (≥ 200 V) au-delà d'environ 50 kW.
  * L'objectif est de limiter le courant continu et la section des câbles.
* **Climat chaud :** la durée de vie du plomb est divisée par environ 2 tous les +10 °C au-delà de 25 °C.
* **Ventilation du local plomb** (EN IEC 62485-2, à vérifier sur la norme), avec $n$ éléments et $I_{\text{gaz}}$ en mA/Ah :

```math
Q = 0{,}05\; n\; I_{\text{gaz}}\; C_{\text{rt}}\cdot 10^{-3}\ \ [\text{m}^3/\text{h}]
```

* **Courant de court-circuit du parc :** $I_{cc} \approx U_{\text{nom}}\,N_p / R_{i,\text{branche}}$. Les protections côté batterie doivent avoir un pouvoir de coupure en courant continu supérieur à $I_{cc}$.

### B.6 Onduleur/chargeur et régulateurs

**Puissance assignée.** $k_{\theta,\text{ond}}$ est le rapport entre la puissance continue à 40 °C et la puissance assignée à 25 °C, souvent 0,65 à 0,85.

```math
S_{\text{ond, phase}}\;k_{\theta,\text{ond}} \ge S_{\text{dim, phase}}
```

**Surcharge au démarrage d'un moteur** (quelques secondes) :

```math
k_{\text{surch}}\, S_{\text{ond}} \ge S_{\text{dim}} - S_{\text{moteur, marche}} + S_{d}
```

* **Chargeur :**

```math
P_{\text{charge}} = \min\left(\frac{C_{\text{utile}}}{t_{\text{recharge}}},\ c_{\text{ch}}\,C\,U_{\text{charge}},\ P_{\text{chargeur}}\right)
```

* **Relais de transfert :** le courant de transfert doit être au moins égal au courant assigné du groupe. Le départ « AC-out » se dimensionne sur $\max(I_{\text{ond}}, I_{rG})$.

### B.7 Vérification par simulation horaire

Avec $\eta_c = \eta_d = \sqrt{\eta_{rt}}$ et $\Delta t$ = 1 h :

```math
E_{t+1} = E_t + \eta_c\,(P_{PV\to B} + P_{GE\to B})\,\Delta t - \frac{P_{B\to \text{charge}}}{\eta_d}\,\Delta t,
\qquad SOC_{\min}\,C \le E_t \le C
```

**Ordre de priorité à chaque heure :**
1. Le PV alimente la charge.
2. Le surplus PV charge la batterie, et ce qui reste au-delà est écrêté.
3. La batterie complète le besoin.
4. Le groupe démarre si le SOC passe sous $SOC_{\text{dém}}$, ou si la puissance demandée dépasse la capacité de l'onduleur.
5. Une fois en marche, le groupe alimente la charge et recharge la batterie jusqu'à $SOC_{\text{arrêt}}$ (stratégie *cycle charging*), en restant sous 70 % de sa PRP.

**Indicateurs :**

```math
LLP = \frac{\sum E_{\text{non servie}}}{\sum E_{\text{demandée}}} \qquad
f_{EnR} = 1 - \frac{E_{GE}}{E_{\text{servie}}} \qquad
N_{\text{cycles}} = \frac{\sum E_{\text{déchargée}}}{C\,(1 - SOC_{\min})}
```

On suit aussi les heures de marche et le nombre de démarrages du groupe, le carburant consommé, l'énergie écrêtée et la contrôle de conservation de l'énergie (fait dans les tests).

---

## Module C — Groupes électrogènes

### C.1 Régimes assignés [ISO 8528-1]

| Régime | Usage | Contraintes usuelles |
|---|---|---|
| **COP** (continu) | Charge constante, durée illimitée | 100 % en permanence |
| **PRP** (principal) | Charge variable, durée illimitée : **c'est le régime d'un groupe d'appoint hybride** | Puissance moyenne sur 24 h ≤ 70 % de la PRP. Les puissances < 30 % comptent pour 30 % et les arrêts sont exclus. Surcharge de 10 % pendant 1 h sur 12 h selon le constructeur. |
| **LTP** (durée limitée) | ≤ 500 h/an | 100 % maximum |
| **ESP** (secours) | Secours du réseau, ≤ environ 200 h/an | ESP ≈ 1,1 × PRP, moyenne ≤ 70 %, aucune surcharge |

### C.2 Puissance en régime établi

La puissance active est limitée par le moteur thermique, la puissance apparente par l'alternateur. On vérifie les deux, sur la base cos φ = 0,8 :

```math
S_{GE}\;k_{\text{dérat}} \ge \max\left(S_{\text{dim}},\ 3\,S_{\text{phase},\max},\ \frac{P_{\text{dim}}}{0{,}8}\right)
```

**En hybride**, le groupe doit pouvoir alimenter la charge moyenne pendant ses heures de marche et recharger la batterie sous le taux cible $\tau$ ≈ 70 % :

```math
P_{GE}\;k_{\text{dérat}} \ge \frac{\bar P_{\text{nuit}} + P_{\text{charge,AC}}}{\tau}
```

### C.3 Démarrage des moteurs et chute de tension transitoire

**Appel au démarrage :**

```math
I_d = k_d\,I_n \qquad S_d = \sqrt{3}\,U\,I_d = k_d\,\frac{P_u}{\eta\cos\varphi} \qquad P_d = S_d\cos\varphi_d
```

| Mode de démarrage | $k_d = I_d/I_n$ | $\cos\varphi_d$ |
|---|---|---|
| Direct | 6 – 8 | 0,3 – 0,4 |
| Étoile-triangle | ≈ 1/3 du direct (2 – 2,7), avec pointe à la commutation | 0,4 |
| Démarreur progressif | 2,5 – 4 | 0,4 – 0,5 |
| Variateur de vitesse | 1 – 1,5 | ≈ 0,85 |

**Chute de tension transitoire** (diviseur d'impédance, réactance transitoire $x'_d$ en p.u. typiquement 0,15 à 0,30) :

```math
\Delta U = \frac{x'_d\,S_d}{S_{GE} + x'_d\,S_d} \qquad\Longleftrightarrow\qquad
S_{GE} \ge x'_d\,S_d\,\frac{1 - \Delta U_{\max}}{\Delta U_{\max}}
```

* ISO 8528-5 : classe G2, $\Delta U$ ≤ 20 % ; classe G3, ≤ 15 %. Au-delà d'environ 30 %, les contacteurs risquent de retomber.
* **Séquencement :** démarrer le plus gros moteur en premier. À chaque échelon $k$, $S_{\text{marche},k-1} + S_{d,k}$ doit rester admissible.
* **Échelon de puissance active :** il doit rester sous la prise de charge admissible du moteur thermique, qui dépend de sa pression moyenne effective (ISO 8528-5, courbes du constructeur) :

```math
P_{\text{marche}} + P_d \le P_{\text{échelon,adm}}
```

### C.4 Déclassement selon l'environnement

```math
k_{\text{dérat}} = k_{\text{alt}}\cdot k_\theta\cdot k_{HR}, \qquad S_{\text{assignée}} \ge \frac{S_{\text{requise}}}{k_{\text{dérat}}}
```

* **Conditions de référence ISO 3046-1 / ISO 8528-1 :** 25 °C, 100 kPa, 30 % d'humidité relative. Les constructeurs garantissent souvent la puissance jusqu'à 40 °C et 1000 m.
* **Ordres de grandeur, à remplacer par les courbes constructeur :**
  * moteur thermique : environ −1 % par 100 m au-delà de 1000 m, et environ −1 à −2 % par °C au-delà de la température de site assignée ;
  * alternateur (IEC 60034-1) : environ −4 % par tranche de 5 °C au-delà de 40 °C.
* On retient le plus contraignant du moteur thermique et de l'alternateur.

### C.5 Charges non linéaires

Variateurs, redresseurs, onduleurs et chargeurs déforment la tension, d'autant plus que la réactance subtransitoire $x''_d$ est élevée. Pour limiter $THD_u$ à environ 5 à 8 %, surdimensionner l'alternateur :

```math
S_{\text{alt}} \ge k_{NL}\,S_{NL}
```

* $k_{NL}$ ≈ 1,5 à 2 pour des redresseurs 6 pulses sans filtrage ;
* $k_{NL}$ ≈ 1,1 à 1,3 avec redresseur actif ou filtre (guides constructeurs).

### C.6 Taux de charge minimal

```math
\tau = \frac{\bar P_{\text{marche}}}{P_{PRP}}, \qquad 30\,\% \le \tau \le 70\,\%
```

* En dessous de 30 % environ, le moteur s'encrasse (*wet stacking*) : imbrûlés, dépôts, dilution de l'huile.
* Remèdes :
  * un groupe plus petit ;
  * une recharge batterie qui charge le groupe ;
  * un banc de charge ;
  * deux groupes en cascade.

### C.7 Consommation de carburant (droite de Willans)

```math
F\ [\text{L/h}] = a\,P_{\text{sortie}} + b\,P_{\text{assignée}}, \qquad a \approx 0{,}246\ \text{L/kWh},\ \ b \approx 0{,}0815\ \text{L/h/kW}
```

* Consommation spécifique : $F / P_{\text{sortie}}$.
* Volume de cuve : $V = \bar F \cdot t_{\text{autonomie}} \cdot 1{,}1$ (réserve).
* Les coefficients sont des valeurs par défaut de la littérature (modèle utilisé par HOMER). Les remplacer par la courbe du constructeur, donnée à 25, 50, 75 et 100 %.

### C.8 Court-circuit et réglage des protections du groupe

```math
I''_{k3} = \frac{I_{rG}}{x''_d}\;(x''_d \approx 0{,}10\text{–}0{,}15) \qquad
I'_{k3} = \frac{I_{rG}}{x'_d} \qquad
I_{k,\text{maintenu}} \approx 3\,I_{rG}\ (\text{AREP/PMG, environ }10\ \text{s})
```

* Disjoncteur du groupe à déclencheur électronique, avec un seuil court retard d'environ 2 à 3 $I_{rG}$.
* Sur chaque circuit terminal, vérifier que $I_{k1,\min}$ en bout de ligne reste au-dessus du seuil magnétique (§A.4).

### C.9 Inverseur de source (ATS) [IEC 60947-6-1]

* **Calibre :** $I_{th} \ge \max(I_{rG}, I_{B,\text{TGBT}})$.
* **Catégorie d'emploi :** AC-31 (charges résistives), AC-32 (mixtes), **AC-33A** (moteurs et charges mixtes, cas usuel en tertiaire).
* **4 pôles en schéma TN-S** quand le neutre est commuté, pour éviter les boucles de courant de neutre et les déclenchements intempestifs des DDR.
* **Verrouillage** mécanique et électrique. Transition ouverte, ou fermée seulement si le synchronisme est assuré.
* **Temporisations usuelles :**

| Temporisation | Valeur usuelle |
|---|---|
| T1 — confirmation de l'absence de réseau | 1 à 5 s |
| T2 — stabilisation du groupe | quelques secondes |
| T3 — confirmation du retour réseau | 2 à 5 min |
| T4 — refroidissement du groupe à vide | 3 à 5 min |

* **Hybride sans réseau :**
  * le transfert est assuré par le relais de l'onduleur/chargeur ;
  * démarrage du groupe si SOC ≤ $SOC_{\text{dém}}$, si la charge dépasse la puissance de l'onduleur, ou si la batterie reste longtemps sans charge complète (plomb) ;
  * arrêt du groupe quand SOC ≥ $SOC_{\text{arrêt}}$, avec une durée minimale de marche.

---

## Référentiels normatifs : ce qui change d'une norme à l'autre

L'application calcule selon quatre référentiels. Les équations physiques (A.1 à C.9) sont les mêmes ; le référentiel fixe les tables, les règles de choix et les limites.

| Point | NF C 15-100 | IEC 60364 | BS 7671 | NEC (NFPA 70) |
|---|---|---|---|---|
| Réseaux | 400/230, 380/220, 230 V – 50 Hz | idem + 415/240 V | 400/230, 415/240, 230 V – 50 Hz | 120/240, 208Y/120, 480Y/277 V – 60 Hz |
| Sections | mm² | mm² | mm² | AWG / kcmil |
| Courant admissible | §523 (valeurs IEC 60364-5-52), méthodes E, C, B1 | IEC 60364-5-52 annexe B | Appendix 4 | Table 310.16 (60/75/90 °C), 310.17 pour le PV à l'air libre |
| Règle de protection | $I_B \le I_n \le I_z$, $I_2 \le 1{,}45\,I_z$ | idem | idem (Reg. 433.1.1) | 125 % des charges continues ; 240.4(B) calibre supérieur ≤ 800 A ; 240.4(D) 14 AWG ≤ 15 A, 12 AWG ≤ 20 A, 10 AWG ≤ 30 A |
| Chute de tension | 3 % éclairage, 5 % autres (6 / 8 % depuis un poste privé) | idem | idem | recommandation : 3 % par circuit, 5 % au total |
| Conducteur de protection | §543.1 selon la section de phase | Tab. 54.2 | Table 54.7 | Table 250.122 selon le calibre de la protection |
| Protection des personnes | coupure ≤ 0,4 s (TN 230 V), DDR 30 mA | idem | $Z_s \le 0{,}95\,U_0/I_a$ (Table 41.3), RCD 30 mA | chemin de défaut 250.4(A)(5), GFCI 210.8, AFCI 210.12 |
| Moteurs | courant assigné calculé | idem | idem | FLC des Tables 430.248 / 430.250 ; conducteurs 125 % (430.22) ; disjoncteur ≤ 250 % (430.52) ; Art. 440 pour les motocompresseurs |
| cos φ visé par défaut | 0,928 (tan φ = 0,4) | 0,95 | 0,95 | 0,95 |
| Lignes aériennes | NF C 11-201, supports béton NF C 67-200 | IEC/EN 50341 | BS EN 50341 | NESC (ANSI C2) Rules 250 et 261, poteaux bois ANSI O5.1 |

**NEC — choix d'un conducteur.** Pour une charge continue $I_B$ protégée par $I_n$ :

```math
I_n \ge 1{,}25\,I_B \qquad
\min\!\big(I_{90\,°C}\cdot k_\theta \cdot k_{adj}\ ;\ I_{bornes\ 75\,°C}\big) \ge 1{,}25\,I_B
```

* $k_\theta$ : Table 310.15(B)(1)(1), tranche de 5 °C contenant la température ambiante (ex. 40 °C : 0,91 en colonne 90 °C, 0,88 en 75 °C) ;
* $k_{adj}$ : Table 310.15(C)(1) au-delà de 3 conducteurs actifs (4-6 : 0,8 ; 7-9 : 0,7 ; 10-20 : 0,5) ;
* le conducteur doit être protégé par $I_n$ (240.4) : ampacité ≥ $I_n$, ou calibre normalisé immédiatement supérieur ≤ 800 A.

Exemple vérifié par les tests : 40 A continus en 120 V donnent un disjoncteur de 50 A et du 8 AWG ; 16 A donnent 20 A et du 12 AWG (240.4(D)) ; un moteur de 10 HP en 480 V (FLC 14 A) donne du 14 AWG et un disjoncteur de 35 A.

**BS 7671 — impédance de boucle.** Avec $I_a$ le courant de déclenchement instantané (B : 5·In, C : 10·In, D : 20·In) :

```math
Z_{s,\max} = \frac{0{,}95\,U_0}{I_a} \qquad \text{ex. B32 : } \frac{0{,}95 \times 230}{160} = 1{,}37\ \Omega
```

Le moteur calcule $Z_s = 0{,}95\,U_0 / I_{cc,\min}$ en bout de circuit pour chaque source.

**Réseau 120/240 V à point milieu.** Un circuit « entre phases » (240 V) prend $I = S/U$ et $b = 2$ rapporté à $U$ ; un circuit phase-neutre (120 V) prend $I = S/U_0$ et $b = 2$ rapporté à $U_0$. Les circuits 120 V sont répartis sur L1 et L2.

---

## Source réseau [IEC 60076-1, IEEE C57.12.00]

**Transformateur privé.** Puissance $S_T$ prise dans la gamme normalisée (≥ $S_{dim}$), $u_k$ usuel 4 % jusqu'à 630 kVA et 6 % au-delà (IEC), 4,5 à 5,75 % (NEC). Avec la puissance de court-circuit du réseau amont $S''_{kQ}$ :

```math
I_{cc,\max} = \frac{c_{\max}\, I_n}{u_k + S_T/S''_{kQ}} \qquad c_{\max} = 1{,}05
```

**Branchement public.** $I_{cc,\max}$ et $I_{cc,\min}$ au point de livraison sont des données du distributeur.

**Groupe de secours.** Régime ESP (ISO 8528-1), dimensionné sur la part secourue de l'installation et sur le démarrage moteur (C.3). Cuve : $V = 1{,}1 \cdot F_{100\,\%} \cdot t_{aut}$. Inverseur de source ≥ max($I_n$ groupe ; $I_B$ du tableau), ×1,25 en NEC.

**Contrainte thermique côté réseau.** Le défaut franc est coupé par le déclencheur instantané en 20 ms ; derrière un disjoncteur modulaire limiteur (≤ 63 A), l'énergie traversante est prise égale à 40 000 A²s jusqu'à 32 A et 80 000 A²s jusqu'à 63 A. Ce sont des valeurs prudentes, à remplacer par la fiche constructeur :

```math
S \ge \frac{1}{k}\,\max\!\Big(\min(I_{k,\text{maintenu}} ; I_a)\sqrt{5},\ \min\big(I_{cc,\max}\sqrt{0{,}02}\ ;\ \sqrt{I^2t_{\text{lim}}}\big)\Big)
```

---

## Module D — Compensation de l'énergie réactive et harmoniques

**Puissance à installer** [IEC 60831-1, IEC 61921] :

```math
Q_c = P\,(\tan\varphi_1 - \tan\varphi_2)
```

$P$ est la puissance active foisonnée du tableau. La batterie est découpée en gradins ($\approx Q_c/6$, valeurs normalisées 2,5 à 100 kvar).

**Fixe ou automatique.** Batterie fixe si $Q_c \le 15\,\%\,S_n$ (puissance de la source), automatique à gradins au-delà.

**Choix selon la pollution harmonique.** $G_h$ est la puissance des récepteurs non linéaires, cochés « non linéaire » dans l'onglet Charges :

| $G_h/S_n$ | Équipement |
|---|---|
| < 15 % | condensateurs standard |
| 15 à 25 % | condensateurs renforcés (surdimensionnés en tension) |
| 25 à 50 % | selfs anti-harmoniques, $p = 7\,\%$, accord $f/\sqrt{p}$ (189 Hz à 50 Hz, 227 Hz à 60 Hz) |
| > 50 % | étude de filtrage (filtre actif) |

**Résonance parallèle.** Avec $S_{cc}$ la puissance de court-circuit au tableau :

```math
h_r = \sqrt{\frac{S_{cc}}{Q_c}}
```

Si $h_r$ est à moins de 10 % d'un rang 5, 7, 11 ou 13, des selfs anti-harmoniques sont requises.

**Câble et protection de la batterie.** Courant permanent jusqu'à $1{,}3\,I_n$ (harmoniques) et tolérance de capacité :
* IEC : $1{,}43\,I_c$ ;
* NEC 460.8(A) : $1{,}35\,I_c$.

**Gains.** Les pertes Joule amont diminuent dans le rapport $1 - (\cos\varphi_1/\cos\varphi_2)^2$.

**Sources autonomes.**
* L'onduleur fournit le réactif dans la limite de sa puissance apparente : pas de condensateurs.
* Sur groupe électrogène, jamais de batterie fixe : risque d'auto-excitation à faible charge.
* Sur réseau avec groupe de secours, la batterie est déconnectée en marche sur groupe.

---

## Module E — Lignes aériennes basse tension

**Charges sur le conducteur** (porteur en alliage d'aluminium ou ACSR), par mètre :

```math
w_v = m\,g + \rho_{givre}\,g\,\frac{\pi}{4}\big[(d+2e)^2 - d^2\big] \qquad
w_h = q_{vent}\,(d + 2e) \qquad
w = \sqrt{w_v^2 + w_h^2} + K
```

Dans ces formules :
* $e$ est l'épaisseur de givre ;
* $q_{vent}$ est la pression du vent ;
* $K$ est la constante NESC.

**Hypothèses climatiques.**

| Référentiel | États de calcul | Coefficient de sécurité | Tension journalière (EDS) maximale |
|---|---|---|---|
| NF C 11-201 (valeurs usuelles) | A : +15 °C, vent 480 Pa ; B : −10 °C, vent 180 Pa | 3 | 15 % de la charge de rupture |
| IEC (paramètres usuels) | +15 °C, vent 500 Pa ; −5 °C, vent 200 Pa | 3 | 15 % |
| NESC Heavy | −17,8 °C, givre 12,7 mm, 190 Pa, K = 4,38 N/m | 1/0,6 (Rule 261) | 25 % |
| NESC Medium | −9,4 °C, givre 6,35 mm, 190 Pa, K = 2,92 N/m | 1/0,6 | 25 % |
| NESC Light | −1,1 °C, 430 Pa, K = 0,73 N/m | 1/0,6 | 25 % |

**Portée équivalente** (canton de portées $a_i$) :

```math
a_{eq} = \sqrt{\frac{\sum a_i^3}{\sum a_i}}
```

**Équation de changement d'état** (Blondel), résolue par dichotomie pour $T_2$ :

```math
T_2^2\left[T_2 - T_1 + \frac{E S\,a^2 w_1^2}{24\,T_1^2} + \alpha E S(\theta_2-\theta_1)\right] = \frac{E S\,a^2 w_2^2}{24}
```

**Réglage.** La tension de pose à $\theta_{EDS}$ vaut EDS·RTS. Elle est abaissée si un état chargé dépasse RTS/$c_s$.

**Flèche et hauteur libre.** À la température de flèche maximale (40 °C NF/IEC, 50 °C NESC) :

```math
f = \frac{w_v\,a^2}{8\,T_{chaud}} \qquad h_{libre} = H - (0{,}1\,H + 0{,}6) - 0{,}3 - f_{\max} \ge h_{min}
```

**Efforts en tête de support**, dans chaque état chargé, multipliés par le facteur de charge (1 en NF/IEC, 2 en NESC) :
* alignement : $F = q\,d\,\dfrac{a_1+a_2}{2} + F_{vent,poteau}$ ;
* angle $\beta$ : $F = q\,d\,\dfrac{a_1+a_2}{2} + 2\,T\sin\dfrac{\beta}{2} + F_{vent,poteau}$ ;
* arrêt : $F = \sqrt{T^2 + F_h^2}$, hauban conseillé ;
* vent sur le poteau ramené au point d'attache : $F_{vent,poteau} = q\,D\,h^2/(2\,h_a)$.

La classe retenue est la première dont l'effort nominal dépasse $F$ :
* béton : classes en daN, NF C 67-200 ;
* bois : classes ANSI O5.1, de la classe 7 (534 daN) à la classe 1 (2 002 daN).

**Électrique, tronçon par tronçon.** Les charges sont placées aux poteaux d'arrivée, multipliées par $k_s$ :

```math
\Delta u_k = \frac{100\, b\,(r\,\ell_k\cos\varphi + x\,\ell_k\sin\varphi)\,I_k}{U_{ref}} \qquad r = 1{,}25\,r_{20}
```

```math
I_{cc,\min,fin} = \frac{0{,}95\,U_0}{U_0/I_{cc,origine} + 1{,}5\,(r_{ph} + r_N)\,L}
```

$I_{cc,origine}$ provient de la source :
* réseau : $I_{cc,\min}$ du distributeur ;
* groupe : courant maintenu ;
* onduleur : $k_{cc}\,I_n$.

**Vérifications de la ligne.**
* Courant admissible du conducteur à la température ambiante.
* Protection contre les surcharges : $I_{max} \le I_n \le I_z$, et $1{,}1\,I_n \le I_z$ pour un fusible gG en IEC.
* $I_{cc,\min,fin} \ge 5\,I_n$ (fusible gG, fusion en 5 s) ou $10\,I_n$ (disjoncteur).
* Chute de tension ≤ 80 % de la tolérance de tension :
  * ±10 % en EN 50160 ;
  * +10/−6 % en ESQCR (Royaume-Uni) ;
  * ±5 % en ANSI C84.1.
