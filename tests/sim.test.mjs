// Vérifications physiques de la simulation (node tests/sim.test.mjs)
import { Sim } from '../src/sim.js';
import { makeSwell } from '../src/waves.js';

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) failed++;
};
const finite = (a) => a.every(Number.isFinite);
const maxSlope = (sim, x0, x1, z0, z1) => {
  let mx = 0;
  const { N, s, dx } = sim;
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      const i = x + z * N;
      mx = Math.max(mx, Math.abs(s[i] - s[i + 1]) / dx, Math.abs(s[i] - s[i + N]) / dx);
    }
  return mx;
};

const sim = new Sim({ N: 240, L: 26, waves: makeSwell(1.2) });
const { N } = sim;
const mid = N >> 1;

// 1. la dune au repos respecte l'angle de talus du sable sec (34°)
let dry = 0;
for (let z = 20; z < N - 20; z++)
  for (let x = 20; x < N - 20; x++) {
    const i = x + z * N;
    if (sim.s[i] > 0.6) dry = Math.max(dry, Math.abs(sim.s[i] - sim.s[i + 1]) / sim.dx, Math.abs(sim.s[i] - sim.s[i + N]) / sim.dx);
  }
check('talus sec ≤ 34°', dry <= 0.70, `tan=${dry.toFixed(3)}`);

// 2. houle : stabilité et bornes sur 40 s
const sand0 = sim.totalSand();
let t0 = performance.now();
let maxEta = 0;
for (let f = 0; f < 2400; f++) sim.frame(1 / 60);
const ms = (performance.now() - t0) / 2400;
for (let i = 0; i < N * N; i++) if (sim.w[i] > 0) maxEta = Math.max(maxEta, sim.s[i] + sim.w[i]);
check('champs finis', finite(sim.w) && finite(sim.s) && finite(sim.qx) && finite(sim.m));
check('surface bornée', maxEta < 1.0, `ηmax=${maxEta.toFixed(3)} m`);
check('eau ≥ 0', sim.w.every((v) => v >= 0));
// les vagues doivent atteindre le milieu du domaine côté au vent
let amp = 0;
for (let z = 60; z < N - 60; z++) amp = Math.max(amp, Math.abs(sim.s[30 + z * N] + sim.w[30 + z * N]));
check('la houle se propage', amp > 0.03, `amp=${amp.toFixed(3)} m`);
const sand1 = sim.totalSand();
check('sable conservé sous la houle (<1%)', Math.abs(sand1 - sand0) / Math.abs(sand0) < 0.01, `${sand0.toFixed(2)} → ${sand1.toFixed(2)} m³`);
console.log(`     coût : ${ms.toFixed(2)} ms / image (N=${N})`);

// 3. tas de sable sec : s'effondre à l'angle de talus, volume conservé
const px = 3.0, pz = 3.0;
const before = sim.totalSand();
sim.addSand(px, pz, 0.15, 0, 0.2);
check('ajout de volume exact', Math.abs(sim.totalSand() - before - 0.15) < 1e-3);
const peak0 = sim.heightAt(px, pz);
for (let f = 0; f < 300; f++) sim.frame(1 / 60);
const peak1 = sim.heightAt(px, pz);
check('le tas sec s’éboule', peak1 < peak0 - 0.2, `${peak0.toFixed(2)} → ${peak1.toFixed(2)} m`);
const gi = Math.round(sim.gx(px)), gj = Math.round(sim.gx(pz));
const sl = maxSlope(sim, gi - 6, gi + 6, gj - 6, gj + 6);
check('pente du tas ≤ talus', sl <= 0.72, `tan=${sl.toFixed(3)}`);

// 4. pâté de sable humide : tient debout ; sec : s'écroule
const hBase = sim.heightAt(3, -3);
sim.stamp(3, -3, 0.33, 0.25, 0.42, 0.1117, 0.5);
for (let f = 0; f < 120; f++) sim.frame(1 / 60);
const hWet = sim.heightAt(3, -3) - hBase;
check('pâté humide debout', hWet > 0.36, `h=${hWet.toFixed(2)} m`);
const hBase2 = sim.heightAt(1.5, -4);
sim.stamp(1.5, -4, 0.33, 0.25, 0.42, 0.1117, 0.0);
for (let f = 0; f < 240; f++) sim.frame(1 / 60);
const hDry = sim.heightAt(1.5, -4) - hBase2;
check('pâté sec effondré', hDry < 0.33, `h=${hDry.toFixed(2)} m`);

// 5. eau versée : s'écoule vers le bas puis s'infiltre
sim.addWater(-3.5, 0.3, 0.05, 0.3);
let wTop = sim.waterAt(-3.5, 0.3);
for (let f = 0; f < 60; f++) sim.frame(1 / 60);
check('l’eau s’écoule', sim.waterAt(-3.5, 0.3) < wTop * 0.5, `${wTop.toFixed(3)} → ${sim.waterAt(-3.5, 0.3).toFixed(3)} m`);
check('le sable est mouillé', sim.moistAt(-3.5, 0.3) > 0.2, `m=${sim.moistAt(-3.5, 0.3).toFixed(2)}`);

// 6. trou sous le niveau de la mer : la nappe le remplit
let bx = 0;
for (let x = 2; x < 12; x += 0.05) if (sim.heightAt(x, 0) < 0.25 && sim.heightAt(x, 0) > 0.2) { bx = x; break; }
for (let k = 0; k < 6; k++) sim.dig(bx, 0, 0.3, 0.12);
const holeS = sim.heightAt(bx, 0);
for (let f = 0; f < 600; f++) sim.frame(1 / 60);
check('trou sous la mer', holeS < 0, `fond=${holeS.toFixed(2)} m`);
check('la nappe remplit le trou', sim.waterAt(bx, 0) > 0.03, `eau=${sim.waterAt(bx, 0).toFixed(3)} m`);
check('toujours fini', finite(sim.w) && finite(sim.s) && finite(sim.m) && finite(sim.sed));

// 7. rupture de barrage : comparaison à la solution analytique de Stoker
//    (Saint-Venant non linéaire, fond plat, sans frottement)
{
  const G = 9.81;
  const d = new Sim({ N: 240, L: 26, waves: makeSwell(1.2) });
  const n = d.N;
  const hL = 0.5, hR = 0.1;
  d.cf = 0; d.nu3 = 0;
  d.s.fill(-1);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) d.w[x + z * n] = x < n / 2 ? hL : hR;
  d.qx.fill(0); d.qz.fill(0); d.ux.fill(0); d.uz.fill(0);
  // état intermédiaire h_m : onde de détente à gauche, ressaut à droite
  const f = (hm) => 2 * (Math.sqrt(G * hL) - Math.sqrt(G * hm)) - (hm - hR) * Math.sqrt((G * (hm + hR)) / (2 * hm * hR));
  let a = hR, b = hL;
  for (let k = 0; k < 60; k++) { const mid = (a + b) / 2; if (f(mid) > 0) a = mid; else b = mid; }
  const hm = (a + b) / 2;
  const um = 2 * (Math.sqrt(G * hL) - Math.sqrt(G * hm));
  const S = (hm * um) / (hm - hR); // vitesse du ressaut
  const T = 1.6, dt = 0.004;
  for (let k = 0; k < T / dt; k++) { d.updateFlux(dt); d.updateDepth(dt); }
  const row = (n >> 1) * n;
  const xOf = (x) => (x / (n - 1) - 0.5) * d.L;
  // plateau : entre l'onde de détente et le ressaut
  const x0 = (um - Math.sqrt(G * hm)) * T, x1 = S * T;
  let sum = 0, cnt = 0, front = 0;
  for (let x = 0; x < n; x++) {
    const X = xOf(x);
    if (X > x0 + 0.3 && X < x1 - 0.3) { sum += d.w[row + x]; cnt++; }
    if (d.w[row + x] > (hm + hR) / 2) front = X;
  }
  const plateau = sum / cnt;
  check('rupture de barrage : hauteur du plateau (±3 %)', Math.abs(plateau - hm) / hm < 0.03, `${plateau.toFixed(4)} m, théorie ${hm.toFixed(4)} m`);
  check('rupture de barrage : position du ressaut (±4 %)', Math.abs(front - x1) / x1 < 0.04, `${front.toFixed(2)} m, théorie ${x1.toFixed(2)} m`);
  // onde de détente : h = (2·√(g·hL) − x/t)² / (9g)
  let err = 0, c2 = 0;
  for (let x = 0; x < n; x++) {
    const X = xOf(x);
    if (X > -Math.sqrt(G * hL) * T + 0.3 && X < x0 - 0.3) {
      const th = (2 * Math.sqrt(G * hL) - X / T) ** 2 / (9 * G);
      err += Math.abs(d.w[row + x] - th) / th; c2++;
    }
  }
  check('rupture de barrage : onde de détente (±3 %)', err / c2 < 0.03, `écart moyen ${((err / c2) * 100).toFixed(2)} %`);
  check('rupture de barrage : volume conservé', (() => { let v = 0; for (let x = 1; x < n - 1; x++) v += d.w[row + x]; const v0 = (hL + hR) / 2 * (n - 2); return Math.abs(v - v0) / v0 < 1e-3; })());
}

// 8. vent : rien ne bouge sous le seuil, la dune migre sous le vent au-dessus
{
  const d = new Sim({ N: 160, L: 26, waves: makeSwell(1.2) });
  d.swell = 0;
  const centroid = () => { let sx = 0, sm = 0; for (let z = 0; z < d.N; z++) for (let x = 0; x < d.N; x++) { const h = d.s[x + z * d.N] - 0.7; if (h > 0) { sx += h * x; sm += h; } } return (sx / sm / (d.N - 1) - 0.5) * d.L; };
  const snap = Float32Array.from(d.s);
  d.wind = 3.5;
  for (let f = 0; f < 240; f++) d.frame(1 / 60);
  let diff = 0;
  for (let i = 0; i < snap.length; i++) if (snap[i] > 0.6) diff = Math.max(diff, Math.abs(snap[i] - d.s[i]));
  check('vent faible : la dune ne bouge pas', diff < 1e-4, `Δmax=${diff.toExponential(1)} m`);
  const c0 = centroid(), v0 = d.totalSand();
  d.wind = 14;
  for (let f = 0; f < 3600; f++) d.frame(1 / 60);
  const c1 = centroid();
  check('vent fort : la dune migre sous le vent', c1 - c0 > 0.03, `Δx=${(c1 - c0).toFixed(3)} m en 60 s`);
  check('vent : sable conservé', Math.abs(d.totalSand() - v0) < 0.02, `Δ=${(d.totalSand() - v0).toExponential(1)} m³`);
  let slip = 0;
  for (let z = 20; z < d.N - 20; z++) for (let x = 20; x < d.N - 20; x++) { const i = x + z * d.N; if (d.s[i] > 0.6) slip = Math.max(slip, (d.s[i] - d.s[i + 1]) / d.dx); }
  check('vent : face d’avalanche à l’angle de talus', slip <= 0.70 && slip > 0.5, `tan=${slip.toFixed(3)}`);
  check('vent : champs finis', finite(d.s) && finite(d.m));
}

process.exit(failed ? 1 : 0);
