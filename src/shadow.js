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
  // scale : finesse de la carte par rapport à la grille de simulation
  constructor(sim, scale = 2) {
    this.sim = sim;
    this.scale = scale;
    const M = (this.M = (sim.N - 1) * scale + 1);
    this.hs = scale === 1 ? null : new Float32Array(M * M); // relief suréchantillonné
    this.H = new Float32Array(M * M);
    this.D = new Float32Array(M * M);
    this.tex = new Uint8Array(M * M * 2);
    this.drop = 0.1;
  }

  // interpolation bilinéaire du relief sur la grille fine (×2)
  upsample() {
    const { N, s } = this.sim;
    const { M, hs } = this;
    for (let z = 0; z < N; z++) {
      let o = 2 * z * M,
        i = z * N;
      for (let x = 0; x < N - 1; x++, i++, o += 2) {
        const a = s[i];
        hs[o] = a;
        hs[o + 1] = 0.5 * (a + s[i + 1]);
      }
      hs[o] = s[i];
    }
    for (let Z = 1; Z < M; Z += 2) {
      const o = Z * M;
      for (let X = 0; X < M; X++) hs[o + X] = 0.5 * (hs[o - M + X] + hs[o + M + X]);
    }
  }

  // calcul complet en une fois
  update(sun) {
    this.begin(sun);
    this.step(this.M);
  }

  // Calcul étalé sur plusieurs images : begin() fige la direction du soleil et
  // traite la première ligne, step(n) avance de n lignes et renvoie true une
  // fois la carte terminée.
  begin(sun) {
    const sim = this.sim;
    const { H, D, tex, M: N } = this;
    const dx = sim.dx / this.scale;
    let s = sim.s;
    if (this.hs) {
      this.upsample();
      s = this.hs;
    }
    const hl = Math.hypot(sun.x, sun.z);
    if (hl < 1e-4) {
      // soleil au zénith : aucune ombre portée
      for (let i = 0; i < N * N; i++) {
        tex[2 * i] = 0;
        tex[2 * i + 1] = 0;
      }
      this.drop = this.nextDrop = 1;
      this.k = N;
      return;
    }
    const majorX = Math.abs(sun.x) >= Math.abs(sun.z);
    const a = majorX ? sun.x : sun.z,
      b = majorX ? sun.z : sun.x;
    const sgn = a > 0 ? 1 : -1; // côté du soleil sur l'axe principal
    const r = b / Math.abs(a); // décalage latéral par pas
    const stepLen = dx * Math.sqrt(1 + r * r);
    const drop = (sun.y / hl) * stepLen;
    const o0 = Math.floor(r);
    this.p = {
      s,
      sgn,
      stepLen,
      drop,
      o0,
      f: r - o0,
      sm: majorX ? 1 : N, // pas mémoire sur l'axe principal
      sj: majorX ? N : 1, // … et sur l'axe secondaire
    };
    this.nextDrop = drop;
    const { sm, sj } = this.p;
    const dEdge = (127.5 - (127.5 * drop) / (drop + SHADOW_K) + 0.5) | 0;
    // première ligne, côté soleil : rien ne peut lui faire de l'ombre
    const m0 = (sgn > 0 ? N - 1 : 0) * sm;
    for (let j = 0; j < N; j++) {
      const i = m0 + j * sj;
      H[i] = s[i];
      D[i] = 0;
      tex[2 * i] = dEdge;
      tex[2 * i + 1] = 0;
    }
    this.k = 1;
  }

  step(rows) {
    const { H, D, tex, M: N } = this;
    if (this.k >= N) {
      this.drop = this.nextDrop ?? this.drop;
      return true;
    }
    const { s, sgn, stepLen, drop, o0, f, sm, sj } = this.p;
    const g = 1 - f;
    const K = SHADOW_K;
    // bornes de la partie sans débordement latéral
    const jA = o0 < 0 ? -o0 : 0,
      jB = N - 2 - (o0 > 0 ? o0 : 0);
    const kEnd = Math.min(N, this.k + rows);
    for (let k = this.k; k < kEnd; k++) {
      const m = sgn > 0 ? N - 1 - k : k;
      const base = m * sm;
      const up = (m + sgn) * sm + o0 * sj;
      // cœur de la boucle : aucune borne à tester
      for (let j = jA; j <= jB; j++) {
        const i = base + j * sj,
          i0 = up + j * sj,
          i1 = i0 + sj;
        const si = s[i];
        const line = H[i0] * g + H[i1] * f - drop;
        const d = line - si;
        if (d > 0) {
          H[i] = line;
          const dist = D[i0] * g + D[i1] * f + stepLen;
          D[i] = dist;
          // codage « signe doux » : précision maximale près de la limite d'ombre
          tex[2 * i] = 128 + (127.5 * d) / (d + K);
          tex[2 * i + 1] = dist > 7.9 ? 255 : dist * 32;
        } else {
          H[i] = si;
          D[i] = 0;
          tex[2 * i] = 128 + (127.5 * d) / (K - d);
          tex[2 * i + 1] = 0;
        }
      }
      // bords : indices latéraux bornés
      for (let j = 0; j < N; j++) {
        if (j === jA && jB >= jA) {
          j = jB;
          continue;
        }
        const i = base + j * sj;
        let j0 = j + o0,
          j1 = j0 + 1;
        j0 = j0 < 0 ? 0 : j0 > N - 1 ? N - 1 : j0;
        j1 = j1 < 0 ? 0 : j1 > N - 1 ? N - 1 : j1;
        const i0 = (m + sgn) * sm + j0 * sj,
          i1 = (m + sgn) * sm + j1 * sj;
        const si = s[i];
        const line = H[i0] * g + H[i1] * f - drop;
        const d = line - si;
        if (d > 0) {
          H[i] = line;
          D[i] = D[i0] * g + D[i1] * f + stepLen;
        } else {
          H[i] = si;
          D[i] = 0;
        }
        tex[2 * i] = 128 + (127.5 * d) / ((d < 0 ? -d : d) + K);
        tex[2 * i + 1] = D[i] > 7.9 ? 255 : D[i] * 32;
      }
    }
    this.k = kEnd;
    if (kEnd >= N) {
      this.drop = drop;
      return true;
    }
    return false;
  }
}
