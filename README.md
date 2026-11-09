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
Les curseurs règlent la hauteur de la houle et la vitesse de séchage du sable.

## La physique

Tout est en unités SI. La simulation (`src/sim.js`) tourne sur une grille de
240 × 240 cellules de 11 cm.

| Phénomène | Modèle |
|---|---|
| Eau | Équations de Saint-Venant linéarisées sur grille décalée : `∂q/∂t = −g·h·∂η/∂x − frottement`, `∂h/∂t = −∇·q`. La célérité des ondes vaut donc `√(g·h)` : les vagues ralentissent et se cambrent en arrivant sur la plage. Pas de temps borné par la condition CFL. |
| Frottement | Loi quadratique (Darcy-Weisbach) plus un terme visqueux pour les films minces. |
| Houle | Somme d'ondes d'Airy respectant la relation de dispersion `ω² = g·k·tanh(k·h)`, injectée aux bords de la zone simulée. |
| Sable | Angle de talus : toute pente plus raide que `tan φ` s'éboule, avec conservation exacte du volume. φ = 34° pour le sable sec. |
| Cohésion | φ dépend de l'humidité : ~76° pour le sable humide (ponts capillaires), puis effondrement quand il est saturé. |
| Humidité | Infiltration de type Darcy / Green-Ampt (le sable sec « aspire » l'eau), drainage vers la capacité au champ, évaporation, frange capillaire au-dessus de la nappe. |
| Nappe phréatique | Un trou creusé sous le niveau de la mer se remplit tout seul. |
| Érosion | Capacité de transport `∝ (‖u‖ − u_crit)·h`, sédiment advecté de façon conservative par les flux d'eau. |
| Écume | Produite là où l'écoulement devient torrentiel (nombre de Froude `u/√(g·h) > 1`). |
| Objets | Chute libre sous `g = 9,81 m/s²` avec traînée ; le parasol oscille comme un pendule amorti. |
| Optique de l'eau | Fresnel (Schlick), réfraction (Snell-Descartes), absorption de Beer-Lambert selon l'épaisseur d'eau traversée. |

### Limites assumées

- Le sable est un champ de hauteurs : pas de tunnels ni de surplombs.
- Saint-Venant sans terme d'advection : les vagues lèvent et déferlent sur la
  plage sous forme de ressaut, mais ne forment pas de rouleau.
- Le temps de séchage est accéléré (quelques minutes au lieu de plusieurs heures).

## Performances

- La physique complète ne tourne que sur l'île et sa zone de ressac.
- Au-delà, l'océan est une formule évaluée dans le shader (houle d'Airy +
  déplacement de Gerstner), sans simulation.
- Cet océan lointain est découpé en tuiles : celles qui sortent du champ de la
  caméra ne sont ni calculées ni dessinées.
- Si l'appareil peine, la résolution de rendu baisse automatiquement.

## Tests

```bash
npm test
```

Vérifie l'angle de talus, la conservation du sable, la stabilité de la houle,
la tenue d'un pâté humide et l'effondrement d'un pâté sec, l'écoulement et
l'infiltration, et le remplissage d'un trou par la nappe.

## Structure

```
index.html        page et interface
src/main.js       boucle principale, caméra, entrées
src/sim.js        simulation physique
src/waves.js      houle (partagée entre la simulation et les shaders)
src/world.js      scène : ciel, sable, eau, océan, parasol
src/shaders.js    shaders GLSL
src/tools.js      pelle, seau, arrosoir
src/particles.js  sable jeté et eau versée
vendor/           three.js (licence MIT)
```
