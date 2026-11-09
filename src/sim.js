// Simulation physique de l'île : sable, eau, humidité, érosion.
// Tout est en unités SI (mètres, secondes). Niveau de la mer = 0.
//
//  Eau      : équations de Saint-Venant linéarisées (eau peu profonde) sur
//             grille décalée : ∂q/∂t = -g·h·∂η/∂x - frottement ; ∂h/∂t = -∇·q
//             → célérité des ondes √(g·h), levée des vagues sur la plage.
//  Sable    : angle de talus (avalanches) dépendant de l'humidité (cohésion
//             capillaire), conservation exacte du volume.
//  Humidité : infiltration type Darcy/Green-Ampt, frange capillaire au-dessus
//             de la nappe (niveau de la mer), drainage, évaporation.
//  Érosion  : capacité de transport ∝ (|u| - u_crit)·h, advection conservative.

import { G } from './waves.js';

const SQRT2 = Math.SQRT2;

// --- constantes physiques ---
const CF = 0.015; // coefficient de frottement quadratique (Darcy-Weisbach)
const NU3 = 3e-5; // 3·ν (viscosité, gonflée pour les films minces)
const TAN_DRY = 0.675; // tan(34°)  sable sec
const TAN_WET = 4.2; // tan(~76°) sable humide (ponts capillaires)
const TAN_SAT = 0.45; // sable saturé (liquéfié)
const TAN_SUB = 0.55; // sable immergé
const KS = 1.5e-3; // conductivité hydraulique (m/s)
const MCAP = 0.05; // lame d'eau pour saturer la couche superficielle (m)
const FIELD_CAP = 0.58; // capacité au champ
const DRAIN = 0.35; // drainage gravitaire (1/s)
const EVAP = 0.0025; // évaporation (1/s)
const CAP_H = 0.5; // hauteur de la frange capillaire (m)
const KSEEP = 0.4; // échange avec la nappe (1/s)
const KC = 0.12; // capacité de transport sédimentaire
const UCRIT = 0.22; // vitesse critique d'entraînement (m/s)
const KE = 2.0; // vitesse d'érosion (1/s)
const KD = 3.0; // vitesse de dépôt (1/s)
const SPONGE = 14; // largeur de la zone de forçage (cellules)

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TAN_TAB = new Float32Array(64);
for (let k = 0; k < 64; k++) {
  const mm = k / 63;
  const c = smooth(0.04, 0.28, mm) * (1 - smooth(0.78, 0.97, mm));
  const t = TAN_DRY + (TAN_WET - TAN_DRY) * c;
  const sat = smooth(0.9, 1.0, mm);
  TAN_TAB[k] = t * (1 - sat) + TAN_SAT * sat;
}
const TAN_MIN = TAN_SAT;

export class Sim {
  constructor({ N = 240, L = 26, h0 = 1.2, waves }) {
    this.N = N;
    this.L = L;
    this.h0 = h0;
    this.dx = L / (N - 1);
    this.waves = waves;
    this.swell = 1;
    this.sun = 1;
    this.time = 0;
    this.frameCount = 0;
    this.shade = { x: 0, z: 0, r2: 0 };
    const n = N * N;
    this.s = new Float32Array(n); // hauteur du sable
    this.bed = new Float32Array(n); // socle non creusable
    this.w = new Float32Array(n); // hauteur d'eau
    this.m = new Float32Array(n); // humidité (0..1)
    this.qx = new Float32Array(n); // débit linéique (m²/s) face x+
    this.qz = new Float32Array(n);
    this.fac = new Float32Array(n);
    this.conc = new Float32Array(n);
    this.sed = new Float32Array(n); // sédiment en suspension (m)
    this.foam = new Float32Array(n);
    this.thr = new Float32Array(n);
    this.ocean = new Uint8Array(n);
    this.stack = new Int32Array(n);
    this.tex = new Float32Array(n * 4); // [sable, surface d'eau, humidité, écume]
    this.initSponge();
    this.reset();
  }

  // ---------- terrain initial ----------
  static profile(r) {
    const K = [
      [0, 0.75],
      [4.2, 0.6],
      [7.0, 0.0],
      [9.6, -0.65],
      [11.6, -1.2],
    ];
    if (r >= 11.6) return -1.2;
    for (let i = 0; i < K.length - 1; i++) {
      if (r < K[i + 1][0]) {
        const t = (r - K[i][0]) / (K[i + 1][0] - K[i][0]);
        return K[i][1] + (K[i + 1][1] - K[i][1]) * t;
      }
    }
    return -1.2;
  }

  static island(x, z) {
    const th = Math.atan2(z, x);
    const r =
      Math.hypot(x, z) /
      (1 + 0.07 * Math.sin(2 * th + 0.6) + 0.045 * Math.sin(3 * th - 1.1) + 0.02 * Math.sin(5 * th + 2));
    let h = Sim.profile(r);
    // dune en croissant : pente douce au vent, face d'avalanche sous le vent
    const u = x + 1.2 - 0.07 * (z - 0.3) * (z - 0.3);
    const v = z - 0.3;
    const prof = u < 0 ? Math.exp(-(u * u) / (2.8 * 2.8)) : Math.exp(-(u * u) / (1.0 * 1.0));
    h += 1.5 * Math.exp(-(v * v) / (3.0 * 3.0)) * prof * smooth(7.2, 4.4, r);
    h += 0.025 * Math.sin(1.7 * x + 0.3) * Math.sin(2.3 * z + 1.1) * smooth(8, 6, r);
    return h;
  }

  reset() {
    const { N, L, s, w, m, bed } = this;
    const n = N * N;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const wx = (x / (N - 1) - 0.5) * L,
          wz = (z / (N - 1) - 0.5) * L;
        // le fond rejoint exactement la profondeur du large au bord du domaine
        const edge = smooth(L / 2 - 2.6, L / 2 - 1.3, Math.max(Math.abs(wx), Math.abs(wz)));
        const h = Sim.island(wx, wz);
        s[x + z * N] = h + (-this.h0 - h) * edge;
      }
    // lissage
    const tmp = new Float32Array(n);
    const passes = Math.max(2, Math.round(0.25 / this.dx));
    for (let p = 0; p < passes; p++) {
      tmp.set(s);
      for (let z = 1; z < N - 1; z++)
        for (let x = 1; x < N - 1; x++) {
          const i = x + z * N;
          s[i] = (tmp[i] * 4 + tmp[i - 1] + tmp[i + 1] + tmp[i - N] + tmp[i + N]) / 8;
        }
    }
    for (let i = 0; i < n; i++) {
      bed[i] = s[i] - 1.6;
      w[i] = s[i] < 0 ? -s[i] : 0;
      m[i] = Sim.capillary(s[i]);
    }
    this.qx.fill(0);
    this.qz.fill(0);
    this.sed.fill(0);
    this.foam.fill(0);
    // la face sous le vent s'éboule jusqu'à l'angle de talus
    for (let k = 0; k < 400; k++) if (!this.avalanche()) break;
    for (let c = 0; c < this.spIdx.length; c++) if (this.spW[c] === 1) s[this.spIdx[c]] = -this.h0;
    for (let i = 0; i < n; i++) {
      bed[i] = Math.min(bed[i], s[i] - 1.2);
      w[i] = s[i] < 0 ? -s[i] : 0;
    }
    this.floodOcean();
    this.buildRenderData();
  }

  static capillary(h) {
    if (h <= 0) return 1;
    if (h >= CAP_H) return 0;
    const t = 1 - h / CAP_H;
    return t * t;
  }

  initSponge() {
    const { N, L, waves } = this;
    const idx = [];
    const wgt = [];
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const d = Math.min(x, z, N - 1 - x, N - 1 - z);
        if (d < SPONGE) {
          idx.push(x + z * N);
          const t = (SPONGE - d) / SPONGE;
          wgt.push(d === 0 ? 1 : t * t * 0.35);
        }
      }
    this.spIdx = Int32Array.from(idx);
    this.spW = Float32Array.from(wgt);
    const nw = waves.length;
    this.spSin = new Float32Array(idx.length * nw);
    this.spCos = new Float32Array(idx.length * nw);
    for (let c = 0; c < idx.length; c++) {
      const i = idx[c];
      const x = ((i % N) / (N - 1) - 0.5) * L;
      const z = (((i / N) | 0) / (N - 1) - 0.5) * L;
      for (let j = 0; j < nw; j++) {
        const wv = waves[j];
        const ph = (x * wv.dx + z * wv.dz) * wv.k + wv.ph;
        this.spSin[c * nw + j] = Math.sin(ph);
        this.spCos[c * nw + j] = Math.cos(ph);
      }
    }
    this.inSponge = new Uint8Array(N * N);
    for (const i of idx) this.inSponge[i] = 1;
    this.cT = new Float32Array(nw);
    this.sT = new Float32Array(nw);
  }

  // ---------- conditions aux limites : houle entrante ----------
  applyBoundary() {
    const { waves, spIdx, spW, spSin, spCos, s, w, qx, qz, sed, cT, sT, swell } = this;
    const nw = waves.length;
    for (let j = 0; j < nw; j++) {
      cT[j] = Math.cos(waves[j].om * this.time) * waves[j].A * swell;
      sT[j] = Math.sin(waves[j].om * this.time) * waves[j].A * swell;
    }
    for (let c = 0; c < spIdx.length; c++) {
      const i = spIdx[c];
      const g = spW[c];
      let eta = 0,
        qxa = 0,
        qza = 0;
      const b = c * nw;
      for (let j = 0; j < nw; j++) {
        // A·sin(k·x − ω·t) par formule d'addition
        const e = spSin[b + j] * cT[j] - spCos[b + j] * sT[j];
        eta += e;
        const wv = waves[j];
        qxa += e * wv.c * wv.dx; // onde progressive : q = η·c
        qza += e * wv.c * wv.dz;
      }
      let wi = w[i] + g * (eta - (s[i] + w[i]));
      w[i] = wi > 0 ? wi : 0;
      qx[i] += g * (qxa - qx[i]);
      qz[i] += g * (qza - qz[i]);
      sed[i] *= 1 - g;
    }
  }

  // ---------- Saint-Venant : quantité de mouvement ----------
  updateFlux(dt) {
    const { N, s, w, qx, qz, dx } = this;
    const k = (dt * G) / dx;
    const vmax = (0.4 * dx) / dt;
    for (let z = 0; z < N; z++) {
      let i = z * N;
      for (let x = 0; x < N - 1; x++, i++) {
        const si = s[i],
          sj = s[i + 1];
        const ei = si + w[i],
          ej = sj + w[i + 1];
        const hf = (ei > ej ? ei : ej) - (si > sj ? si : sj);
        if (hf <= 1e-4) {
          qx[i] = 0;
          continue;
        }
        let q = qx[i] + k * hf * (ei - ej);
        q /= 1 + (dt * (CF * (q < 0 ? -q : q) + NU3)) / (hf * hf);
        const qm = hf * vmax;
        qx[i] = q > qm ? qm : q < -qm ? -qm : q;
      }
    }
    for (let z = 0; z < N - 1; z++) {
      let i = z * N;
      for (let x = 0; x < N; x++, i++) {
        const j = i + N;
        const si = s[i],
          sj = s[j];
        const ei = si + w[i],
          ej = sj + w[j];
        const hf = (ei > ej ? ei : ej) - (si > sj ? si : sj);
        if (hf <= 1e-4) {
          qz[i] = 0;
          continue;
        }
        let q = qz[i] + k * hf * (ei - ej);
        q /= 1 + (dt * (CF * (q < 0 ? -q : q) + NU3)) / (hf * hf);
        const qm = hf * vmax;
        qz[i] = q > qm ? qm : q < -qm ? -qm : q;
      }
    }
  }

  // ---------- Saint-Venant : conservation de la masse (+ sédiments) ----------
  updateDepth(dt) {
    const { N, w, qx, qz, fac, conc, sed, dx } = this;
    const r = dt / dx;
    fac.fill(1);
    for (let z = 1; z < N - 1; z++) {
      let i = z * N + 1;
      for (let x = 1; x < N - 1; x++, i++) {
        const a = qx[i],
          b = qx[i - 1],
          c = qz[i],
          d = qz[i - N];
        const out = (a > 0 ? a : 0) - (b < 0 ? b : 0) + (c > 0 ? c : 0) - (d < 0 ? d : 0);
        const wi = w[i];
        if (out * r > wi) fac[i] = wi / (out * r);
        conc[i] = wi > 1e-5 ? sed[i] / wi : 0;
      }
    }
    for (let z = 0; z < N; z++) {
      let i = z * N;
      for (let x = 0; x < N - 1; x++, i++) {
        const q = qx[i];
        if (q > 0) qx[i] = q * fac[i];
        else if (q < 0) qx[i] = q * fac[i + 1];
      }
    }
    for (let z = 0; z < N - 1; z++) {
      let i = z * N;
      for (let x = 0; x < N; x++, i++) {
        const q = qz[i];
        if (q > 0) qz[i] = q * fac[i];
        else if (q < 0) qz[i] = q * fac[i + N];
      }
    }
    for (let z = 1; z < N - 1; z++) {
      let i = z * N + 1;
      for (let x = 1; x < N - 1; x++, i++) {
        const a = qx[i],
          b = qx[i - 1],
          c = qz[i],
          d = qz[i - N];
        const wi = w[i] + r * (b - a + d - c);
        w[i] = wi > 0 ? wi : 0;
        const ci = conc[i];
        const sf =
          (b > 0 ? b * conc[i - 1] : b * ci) -
          (a > 0 ? a * ci : a * conc[i + 1]) +
          (d > 0 ? d * conc[i - N] : d * ci) -
          (c > 0 ? c * ci : c * conc[i + N]);
        if (sf !== 0) {
          const sv = sed[i] + r * sf;
          sed[i] = sv > 0 ? sv : 0;
        }
      }
    }
  }

  // ---------- érosion / dépôt / écume ----------
  erosion(dt) {
    const { N, s, w, qx, qz, sed, foam, bed, inSponge } = this;
    const decay = Math.exp(-1.1 * dt);
    for (let z = 1; z < N - 1; z++) {
      let i = z * N + 1;
      for (let x = 1; x < N - 1; x++, i++) {
        const wi = w[i];
        if (wi < 2e-4) {
          if (sed[i] > 0) {
            s[i] += sed[i];
            sed[i] = 0;
          }
          foam[i] *= decay;
          continue;
        }
        const hh = wi + 0.004;
        const u = (0.5 * (qx[i - 1] + qx[i])) / hh;
        const v = (0.5 * (qz[i - N] + qz[i])) / hh;
        const sp2 = u * u + v * v;
        let f = foam[i] * decay;
        if (sp2 > 0.06) {
          // nombre de Froude : Fr² = u²/(g·h) ; régime torrentiel → ressaut, écume
          const fr2 = sp2 / (G * wi);
          let src = sp2 > 0.2 && wi > 0.012 ? (fr2 - 0.9) * 0.8 : 0;
          if (src > 0) {
            if (src > 1) src = 1;
            f += 4 * dt * src * (1 - f);
          }
          if (!inSponge[i]) {
            const speed = Math.sqrt(sp2);
            const cap = speed > UCRIT ? KC * (speed - UCRIT) * (wi < 0.2 ? wi : 0.2) : 0;
            const d = cap - sed[i];
            if (d > 0) {
              let e = KE * dt * d;
              const av = s[i] - bed[i];
              if (e > av) e = av;
              if (e > 0.003) e = 0.003;
              if (e > 0) {
                s[i] -= e;
                sed[i] += e;
              }
            } else {
              let dp = KD * dt * -d;
              if (dp > -d) dp = -d;
              s[i] += dp;
              sed[i] -= dp;
            }
          }
        } else if (sed[i] > 0) {
          let dp = KD * dt * sed[i];
          if (dp > sed[i]) dp = sed[i];
          s[i] += dp;
          sed[i] -= dp;
        }
        foam[i] = f;
      }
    }
  }

  // ---------- avalanches : angle de talus fonction de l'humidité ----------
  avalanche() {
    const { N, s, m, w, thr, bed, dx } = this;
    const n = N * N;
    for (let i = 0; i < n; i++) thr[i] = w[i] > 0.02 ? TAN_SUB : TAN_TAB[(m[i] * 63.99) | 0];
    let moved = false;
    const flip = this.frameCount & 1;
    for (let p = 0; p < 4; p++) {
      const pp = flip ? 3 - p : p;
      const o = pp === 0 ? 1 : pp === 1 ? N : pp === 2 ? N + 1 : N - 1;
      const dist = pp < 2 ? dx : dx * SQRT2;
      const minD = TAN_MIN * dist;
      for (let z = 1; z < N - 1; z++) {
        let i = z * N + 1;
        for (let x = 1; x < N - 1; x++, i++) {
          const j = i + o;
          let d = s[i] - s[j];
          if (d < minD && d > -minD) continue;
          let hi = i,
            lo = j;
          if (d < 0) {
            hi = j;
            lo = i;
            d = -d;
          }
          const t = thr[hi] * dist;
          if (d <= t) continue;
          let mv = (d - t) * 0.25;
          const av = s[hi] - bed[hi];
          if (mv > av) mv = av;
          if (mv <= 1e-6) continue;
          s[hi] -= mv;
          s[lo] += mv;
          // l'eau est déplacée par le sable (volume conservé)
          const dw = mv < w[lo] ? mv : w[lo];
          if (dw > 0) {
            w[lo] -= dw;
            w[hi] += dw;
          }
          const f = mv * 10;
          m[lo] += (m[hi] - m[lo]) * (f > 1 ? 1 : f);
          moved = true;
        }
      }
    }
    return moved;
  }

  // ---------- humidité du sable ----------
  moisture(dt) {
    const { N, L, s, w, m, ocean, dx, shade } = this;
    const dm = Math.min(0.2, (1.5e-3 * dt) / (dx * dx)); // diffusion latérale
    const capRate = Math.min(1, 2 * dt);
    const evap = EVAP * dt * this.sun;
    for (let z = 1; z < N - 1; z++) {
      let i = z * N + 1;
      const wz = (z / (N - 1) - 0.5) * L - shade.z;
      for (let x = 1; x < N - 1; x++, i++) {
        const si = s[i];
        let wi = w[i];
        if (si < -0.3 && ocean[i]) {
          m[i] = 1;
          continue;
        }
        let mi = m[i];
        mi += dm * (m[i - 1] + m[i + 1] + m[i - N] + m[i + N] - 4 * mi);
        if (wi > 1e-4) {
          // infiltration : succion du sable sec + drainage profond
          const rate = KS * ((1 - mi) * 16 + (si > 0 ? (si < 0.3 ? si / 0.3 : 1) : 0));
          let inf = rate * dt;
          if (inf > wi) inf = wi;
          wi -= inf;
          mi += inf / MCAP;
        } else {
          if (mi > FIELD_CAP) mi -= (mi - FIELD_CAP) * Math.min(1, DRAIN * dt);
          const wx = (x / (N - 1) - 0.5) * L - shade.x;
          mi -= wx * wx + wz * wz < shade.r2 ? evap * 0.3 : evap;
        }
        const cap = si <= 0 ? 1 : si >= CAP_H ? 0 : (1 - si / CAP_H) * (1 - si / CAP_H);
        if (mi < cap) mi += (cap - mi) * capRate;
        m[i] = mi < 0 ? 0 : mi > 1 ? 1 : mi;
        // nappe phréatique : un trou sous le niveau de la mer se remplit
        if (si < 0 && !ocean[i]) {
          wi += Math.min(1, KSEEP * dt) * (0 - (si + wi));
          if (wi < 0) wi = 0;
        }
        w[i] = wi;
      }
    }
  }

  // cellules reliées à l'océan (remplissage par diffusion depuis le bord)
  floodOcean() {
    const { N, w, ocean, stack } = this;
    ocean.fill(0);
    let sp = 0;
    for (let k = 0; k < N; k++) {
      for (const i of [k, k + (N - 1) * N, k * N, k * N + N - 1]) {
        if (!ocean[i]) {
          ocean[i] = 1;
          stack[sp++] = i;
        }
      }
    }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % N,
        z = (i / N) | 0;
      if (x > 0 && !ocean[i - 1] && w[i - 1] > 0.01) {
        ocean[i - 1] = 1;
        stack[sp++] = i - 1;
      }
      if (x < N - 1 && !ocean[i + 1] && w[i + 1] > 0.01) {
        ocean[i + 1] = 1;
        stack[sp++] = i + 1;
      }
      if (z > 0 && !ocean[i - N] && w[i - N] > 0.01) {
        ocean[i - N] = 1;
        stack[sp++] = i - N;
      }
      if (z < N - 1 && !ocean[i + N] && w[i + N] > 0.01) {
        ocean[i + N] = 1;
        stack[sp++] = i + N;
      }
    }
  }

  buildRenderData() {
    const { N, s, w, m, foam, tex } = this;
    const n = N * N;
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const si = s[i],
        wi = w[i];
      let eta;
      if (wi > 5e-4) eta = si + wi;
      else {
        // cellule sèche : on prolonge la surface des voisines mouillées pour
        // que le plan d'eau coupe proprement le terrain
        let sum = 0,
          c = 0;
        const x = i % N;
        if (x > 0 && w[i - 1] > 5e-4) {
          sum += s[i - 1] + w[i - 1];
          c++;
        }
        if (x < N - 1 && w[i + 1] > 5e-4) {
          sum += s[i + 1] + w[i + 1];
          c++;
        }
        if (i >= N && w[i - N] > 5e-4) {
          sum += s[i - N] + w[i - N];
          c++;
        }
        if (i < n - N && w[i + N] > 5e-4) {
          sum += s[i + N] + w[i + N];
          c++;
        }
        if (c) {
          eta = sum / c;
          if (eta > si - 0.002) eta = si - 0.002;
        } else eta = si - 0.03;
      }
      tex[k] = si;
      tex[k + 1] = eta;
      tex[k + 2] = m[i];
      tex[k + 3] = foam[i];
    }
  }

  // ---------- boucle ----------
  frame(dtFrame) {
    const total = Math.min(dtFrame, 1 / 30);
    // condition CFL : dt ≤ 0,62·dx/√(g·h)
    const dtMax = (0.62 * this.dx) / Math.sqrt(G * (this.h0 + 0.35));
    const nSub = Math.max(1, Math.min(5, Math.ceil(total / dtMax - 0.02)));
    const dt = total / nSub;
    for (let k = 0; k < nSub; k++) {
      this.time += dt;
      this.applyBoundary();
      this.updateFlux(dt);
      this.updateDepth(dt);
    }
    this.erosion(total);
    this.avalanche();
    this.frameCount++;
    if (this.frameCount & 1) this.moisture(total * 2);
    if (this.frameCount % 20 === 0) this.floodOcean();
    this.buildRenderData();
  }

  // ---------- accès / outils ----------
  gx(x) {
    return (x / this.L + 0.5) * (this.N - 1);
  }
  inside(x, z) {
    const h = this.L / 2 - this.dx * 2;
    return x > -h && x < h && z > -h && z < h;
  }
  sample(arr, x, z) {
    const N = this.N;
    let fx = this.gx(x),
      fz = this.gx(z);
    fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
    const ix = fx | 0,
      iz = fz | 0;
    const tx = fx - ix,
      tz = fz - iz;
    const i = ix + iz * N;
    return (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - tz) + (arr[i + N] * (1 - tx) + arr[i + N + 1] * tx) * tz;
  }
  heightAt(x, z) {
    return this.sample(this.s, x, z);
  }
  waterAt(x, z) {
    return this.sample(this.w, x, z);
  }
  moistAt(x, z) {
    return this.sample(this.m, x, z);
  }

  // applique fn(i, d²) aux cellules d'un disque
  disc(x, z, r, fn) {
    const { N, dx } = this;
    const cx = this.gx(x),
      cz = this.gx(z);
    const rc = r / dx;
    const x0 = Math.max(1, Math.ceil(cx - rc)),
      x1 = Math.min(N - 2, Math.floor(cx + rc));
    const z0 = Math.max(1, Math.ceil(cz - rc)),
      z1 = Math.min(N - 2, Math.floor(cz + rc));
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const ddx = (ix - cx) * dx,
          ddz = (iz - cz) * dx;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 <= r * r) fn(ix + iz * N, d2);
      }
  }

  // creuse un bol parabolique ; renvoie le volume et l'humidité moyenne
  dig(x, z, r, depth, maxVol = Infinity) {
    const { s, m, bed, dx } = this;
    const a = dx * dx;
    let want = 0;
    this.disc(x, z, r, (i, d2) => {
      want += Math.min(depth * (1 - d2 / (r * r)), s[i] - bed[i]) * a;
    });
    const scale = want > maxVol ? maxVol / want : 1;
    let vol = 0,
      mo = 0;
    this.disc(x, z, r, (i, d2) => {
      const d = Math.min(depth * (1 - d2 / (r * r)), s[i] - bed[i]) * scale;
      if (d <= 0) return;
      s[i] -= d;
      vol += d * a;
      mo += m[i] * d * a;
      // le sable mis à nu est celui de la frange capillaire
      const cap = Sim.capillary(s[i]);
      if (m[i] < cap) m[i] = cap;
    });
    return { vol, moist: vol > 0 ? mo / vol : 0 };
  }

  addSand(x, z, vol, moist, r) {
    const { s, m, dx } = this;
    r = Math.max(r, dx * 1.5);
    let sum = 0;
    this.disc(x, z, r, (i, d2) => {
      sum += 1 - d2 / (r * r);
    });
    if (sum <= 0) return;
    const k = vol / (sum * dx * dx);
    this.disc(x, z, r, (i, d2) => {
      const d = k * (1 - d2 / (r * r));
      s[i] += d;
      const f = d * 12;
      m[i] += (moist - m[i]) * (f > 1 ? 1 : f);
    });
  }

  addWater(x, z, vol, r) {
    const { w, dx } = this;
    r = Math.max(r, dx * 1.5);
    let sum = 0;
    this.disc(x, z, r, (i, d2) => {
      sum += 1 - d2 / (r * r);
    });
    if (sum <= 0) return;
    const k = vol / (sum * dx * dx);
    this.disc(x, z, r, (i, d2) => {
      w[i] += k * (1 - d2 / (r * r));
    });
  }

  takeWater(x, z, r, maxVol) {
    const { w, dx } = this;
    const a = dx * dx;
    let avail = 0;
    this.disc(x, z, r, (i) => {
      avail += w[i] * a;
    });
    if (avail <= 0) return 0;
    const f = Math.min(1, maxVol / avail);
    this.disc(x, z, r, (i) => {
      w[i] -= w[i] * f;
    });
    return avail * f;
  }

  // démoule un pâté tronconique (seau retourné) en conservant le volume
  stamp(x, z, R, rTop, H, vol, moist) {
    const { s, m, dx } = this;
    const a = dx * dx;
    let base = 0,
      cnt = 0;
    this.disc(x, z, R, (i) => {
      base += s[i];
      cnt++;
    });
    if (!cnt) return;
    base /= cnt;
    const shape = (d2) => {
      const d = Math.sqrt(d2);
      return d <= rTop ? 1 : (R - d) / (R - rTop);
    };
    const volFor = (h) => {
      let v = 0;
      this.disc(x, z, R, (i, d2) => {
        const t = base + h * shape(d2) - s[i];
        if (t > 0) v += t * a;
      });
      return v;
    };
    let lo = 0,
      hi = H * 1.6;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (volFor(mid) > vol) hi = mid;
      else lo = mid;
    }
    const h = (lo + hi) / 2;
    let placed = 0;
    this.disc(x, z, R, (i, d2) => {
      const t = base + h * shape(d2) - s[i];
      if (t > 0) {
        s[i] += t;
        placed += t * a;
        const f = t * 12;
        m[i] += (moist - m[i]) * (f > 1 ? 1 : f);
      }
    });
    if (vol - placed > 1e-5) this.addSand(x, z, vol - placed, moist, rTop);
  }

  // intersection rayon / terrain (origine o, direction d normalisée)
  raycast(ox, oy, oz, dx, dy, dz, maxT = 120) {
    const half = this.L / 2;
    let t = 0;
    // avance jusqu'à la boîte englobante
    if (oy > 3 && dy < 0) t = (oy - 3) / -dy;
    let prevT = t;
    let prevH = oy + dy * t - this.heightAt(ox + dx * t, oz + dz * t);
    if (prevH < 0) return null;
    while (t < maxT) {
      const step = 0.04 + t * 0.004;
      t += step;
      const x = ox + dx * t,
        y = oy + dy * t,
        z = oz + dz * t;
      if (y < -3) return null;
      if (x < -half || x > half || z < -half || z > half) {
        if (y < -1.3) return null;
        continue;
      }
      const h = y - this.heightAt(x, z);
      if (h <= 0) {
        let a = prevT,
          b = t;
        for (let k = 0; k < 8; k++) {
          const mid = (a + b) / 2;
          const hm = oy + dy * mid - this.heightAt(ox + dx * mid, oz + dz * mid);
          if (hm > 0) a = mid;
          else b = mid;
        }
        const tm = (a + b) / 2;
        return { x: ox + dx * tm, y: oy + dy * tm, z: oz + dz * tm, t: tm };
      }
      prevT = t;
      prevH = h;
    }
    return null;
  }

  totalSand() {
    let v = 0;
    for (let i = 0; i < this.s.length; i++) v += this.s[i] + this.sed[i];
    return v * this.dx * this.dx;
  }
}
