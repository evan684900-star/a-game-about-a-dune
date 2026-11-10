// Ombres portées du relief, calculées exactement sur la grille.
//
// On balaie le terrain en s'éloignant du soleil. Chaque cellule reçoit la
// « ligne d'ombre » de ses voisines situées vers le soleil, abaissée de
//   tan(hauteur du soleil) × distance parcourue ;
// si le sable est sous cette ligne il est à l'ombre, sinon c'est lui qui
// porte la nouvelle ligne. Un seul passage : coût O(N²), résultat sans
// crénelage ni bandes, identique sur tous les appareils (texture 8 bits).
//
// Texture : R = hauteur de la ligne d'ombre au-dessus du sol (codée),
//           G = distance à l'obstacle qui fait l'ombre (pour la pénombre).

export const SHADOW_K = 0.08; // échelle du codage (m)

export class ShadowMap {
  constructor(sim) {
    this.sim = sim;
    const n = sim.N * sim.N;
    this.H = new Float32Array(n);
    this.D = new Float32Array(n);
    this.tex = new Uint8Array(n * 2);
    this.drop = 0.1;
  }

  update(sun) {
    const sim = this.sim;
    const { N, s, dx } = sim;
    const { H, D, tex } = this;
    const hl = Math.hypot(sun.x, sun.z);
    if (hl < 1e-4) {
      // soleil au zénith : aucune ombre portée
      for (let i = 0; i < N * N; i++) {
        tex[2 * i] = 0;
        tex[2 * i + 1] = 0;
      }
      this.drop = 1;
      return;
    }
    const majorX = Math.abs(sun.x) >= Math.abs(sun.z);
    const a = majorX ? sun.x : sun.z,
      b = majorX ? sun.z : sun.x;
    const sgn = a > 0 ? 1 : -1; // côté du soleil sur l'axe principal
    const r = b / Math.abs(a); // décalage latéral par pas
    const stepLen = dx * Math.sqrt(1 + r * r);
    const drop = (sun.y / hl) * stepLen;
    this.drop = drop;
    const o0 = Math.floor(r),
      f = r - o0;
    const sm = majorX ? 1 : N, // pas mémoire sur l'axe principal
      sj = majorX ? N : 1; // … et sur l'axe secondaire
    for (let k = 0; k < N; k++) {
      const m = sgn > 0 ? N - 1 - k : k;
      const base = m * sm;
      const up = (m + sgn) * sm;
      for (let j = 0; j < N; j++) {
        const i = base + j * sj;
        const si = s[i];
        let d, dist;
        if (k === 0) {
          H[i] = si;
          D[i] = 0;
          d = -drop;
          dist = 0;
        } else {
          let j0 = j + o0,
            j1 = j0 + 1;
          if (j0 < 0) j0 = 0;
          else if (j0 > N - 1) j0 = N - 1;
          if (j1 < 0) j1 = 0;
          else if (j1 > N - 1) j1 = N - 1;
          const i0 = up + j0 * sj,
            i1 = up + j1 * sj;
          const line = H[i0] * (1 - f) + H[i1] * f - drop;
          d = line - si;
          if (d > 0) {
            H[i] = line;
            dist = D[i0] * (1 - f) + D[i1] * f + stepLen;
          } else {
            H[i] = si;
            dist = 0;
          }
          D[i] = dist;
        }
        // codage « signe doux » : précision maximale près de la limite d'ombre
        const t = d / ((d < 0 ? -d : d) + SHADOW_K);
        tex[2 * i] = (127.5 + 127.5 * t + 0.5) | 0;
        const g = dist * 32;
        tex[2 * i + 1] = g > 255 ? 255 : g | 0;
      }
    }
  }
}
