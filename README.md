# A Game About a Dune

Une dune de sable au milieu de l'océan, un parasol, et trois outils : une
pelle, un seau et de l'eau. Pas de score, pas d'objectif — tout l'intérêt est
dans la simulation physique.

## Lancer le jeu

Site 100 % statique, aucune étape de build.

```bash
npm start          # python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

N'importe quel serveur de fichiers statiques convient (GitHub Pages, Vercel,
Netlify…). Il faut un navigateur avec WebGL 2.
Ajouter `?q=low` à l'adresse force le mode allégé (activé d'office sur mobile).

## Jouer

| Outil | Action |
|---|---|
| **Pelle** | un clic creuse, le clic suivant verse le sable là où l'on vise |
| **Seau** | clic sur le sable ou dans l'eau pour le remplir, puis clic pour démouler un pâté ou verser l'eau |
| **Eau** | maintenir appuyé pour arroser |
| **Caméra** | glisser pour tourner ; toujours disponible au clic droit, à la molette, ou à deux doigts |

Raccourcis : `1`–`4` pour les outils, flèches pour tourner la caméra.

Trois réglages changent les conditions :

- **Houle** — hauteur des vagues.
- **Vent** — au-delà d'environ 20 km/h il arrache le sable sec : la dune avance, les châteaux secs s'usent.
- **Heure** — de 6 h à 20 h ; le soleil, les ombres, le ciel et la vitesse de séchage suivent.

L'île est sauvegardée automatiquement dans le navigateur ; « Réinitialiser »
repart d'une île neuve. Le son est entièrement synthétisé et se coupe d'un clic.

## La physique

Tout est en unités SI. La simulation (`src/sim.js`) tourne sur une grille de
240 × 240 cellules de 11 cm.

| Phénomène | Modèle |
|---|---|
| Eau | Équations de Saint-Venant complètes (non linéaires) sur grille décalée : `∂h/∂t + ∇·q = 0`, `∂u/∂t + (u·∇)u = −g·∇η − frottement`, avec une advection amont qui conserve la quantité de mouvement (Stelling & Duinmeijer, 2003). Célérité `√(g·h)`, levée des vagues sur la plage, ressauts. Pas de temps borné par la condition CFL. |
| Frottement | Loi quadratique (Darcy-Weisbach) plus un terme visqueux pour les films minces. |
| Houle | Somme d'ondes d'Airy respectant la relation de dispersion `ω² = g·k·tanh(k·h)`, injectée aux bords de la zone simulée. |
| Sable | Angle de talus : toute pente plus raide que `tan φ` s'éboule, avec conservation exacte du volume. φ = 34° pour le sable sec. |
| Cohésion | φ dépend de l'humidité : ~76° pour le sable humide (ponts capillaires), puis effondrement quand il est saturé. |
| Humidité | Infiltration de type Darcy / Green-Ampt (le sable sec « aspire » l'eau), drainage vers la capacité au champ, frange capillaire au-dessus de la nappe, évaporation selon la hauteur du soleil et le vent (loi de Dalton). |
| Nappe phréatique | Un trou creusé sous le niveau de la mer se remplit tout seul. |
| Érosion par l'eau | Capacité de transport `∝ (‖u‖ − u_crit)·h`, sédiment advecté de façon conservative par les flux d'eau. |
| Vent | Saltation au-dessus d'une vitesse seuil (6 m/s sur sable sec, plus sur sable humide), flux de Kawamura `q ∝ (U − Uₜ)(U + Uₜ)²`, accélération sur les pentes au vent, zone d'ombre derrière les crêtes, relief mis à jour par l'équation d'Exner `∂s/∂t = −∂q/∂x`. La dune migre et garde sa face d'avalanche à 34°. |
| Écume | Produite là où l'écoulement devient torrentiel (nombre de Froude `u/√(g·h) > 1`). |
| Objets | Chute libre sous `g = 9,81 m/s²` avec traînée ; le parasol oscille comme un pendule amorti poussé par `½·ρ·U²`. |
| Ombres | Balayage exact du relief vers le soleil (`src/shadow.js`) : chaque point reçoit la ligne d'ombre de ses voisins, abaissée de `tan(hauteur du soleil) × distance`. Pénombre proportionnelle à la distance. Parasol et outils : ombres analytiques. |
| Optique de l'eau | Fresnel (Schlick), réfraction (Snell-Descartes), absorption de Beer-Lambert selon l'épaisseur d'eau traversée. |

### Vérifié contre la théorie

`npm test` compare la simulation à des résultats connus :

- **Rupture de barrage** (solution analytique de Stoker) : hauteur du plateau
  à 0,2 % près, position du ressaut à 1 % près.
- **Angle de talus** : un tas de sable sec retombe à 34°, y compris la face
  d'avalanche d'une dune poussée par le vent.
- **Conservation** : le volume de sable est conservé quand on creuse, verse,
  démoule, ou que le vent et l'eau le déplacent.
- **Ombres** : la longueur de l'ombre d'un mur vaut `h / tan(élévation)`.

### Limites assumées

- Le sable est un champ de hauteurs : pas de tunnels ni de surplombs.
- Les vagues lèvent et déferlent en ressaut sur la plage, mais ne forment pas
  de rouleau (Saint-Venant moyenne l'eau sur la verticale).
- Le vent souffle toujours dans la même direction (vers +x).
- Séchage et transport par le vent sont accélérés : quelques minutes au lieu
  de plusieurs heures ou jours.

## Performances

- La physique complète ne tourne que sur l'île et sa zone de ressac.
- Au-delà, l'océan est une formule évaluée dans le shader (houle d'Airy +
  déplacement de Gerstner), sans simulation.
- Cet océan lointain est découpé en tuiles : celles qui sortent du champ de la
  caméra ne sont ni calculées ni dessinées.
- Le calcul des ombres est étalé sur quatre images.
- Si l'appareil peine, la résolution de rendu baisse automatiquement.

## Tests

```bash
npm test
```

## Structure

```
index.html        page et interface
src/main.js       boucle principale, caméra, entrées, sauvegarde
src/sim.js        simulation physique (eau, sable, humidité, érosion, vent)
src/waves.js      houle (partagée entre la simulation et les shaders)
src/shadow.js     ombres portées du relief
src/world.js      scène : ciel, sable, eau, océan, parasol, heure du jour
src/shaders.js    shaders GLSL
src/tools.js      pelle, seau, arrosoir
src/particles.js  sable jeté, eau versée, sable soufflé
src/audio.js      son synthétisé
vendor/           three.js (licence MIT)
```
