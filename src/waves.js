// Houle : somme d'ondes d'Airy. Chaque composante respecte la relation de
// dispersion en profondeur finie  ω² = g·k·tanh(k·h).
// Le même jeu d'ondes pilote la simulation (conditions aux limites) et le
// shader de l'océan lointain, pour que les deux se raccordent sans couture.

export const G = 9.81;

export function makeSwell(h0, heading = 0.25) {
  // [longueur d'onde (m), amplitude (m), écart angulaire (rad)]
  const defs = [
    [14.0, 0.075, 0.0],
    [10.5, 0.05, 0.35],
    [8.0, 0.034, -0.4],
    [6.1, 0.02, 0.6],
    [4.7, 0.012, -0.75],
  ];
  return defs.map(([lam, A, ang], i) => {
    const k = (2 * Math.PI) / lam;
    const a = heading + ang;
    const om = Math.sqrt(G * k * Math.tanh(k * h0));
    return { dx: Math.cos(a), dz: Math.sin(a), k, A, om, ph: i * 1.7, c: om / k };
  });
}

// Petites ondes capillaro-gravitaires : uniquement pour les normales (rendu).
export function makeDetail(heading = 0.25) {
  const lams = [2.6, 1.7, 1.1, 0.7, 0.45, 0.28];
  const angs = [0.9, -0.7, 0.3, -1.3, 1.6, -0.2];
  return lams.map((lam, i) => {
    const k = (2 * Math.PI) / lam;
    const a = heading + angs[i];
    return { dx: Math.cos(a), dz: Math.sin(a), k, A: 0.011 * lam, om: Math.sqrt(G * k), ph: i * 2.3 };
  });
}

export function swellEta(waves, x, z, t) {
  let e = 0;
  for (const w of waves) e += w.A * Math.sin((x * w.dx + z * w.dz) * w.k - w.om * t + w.ph);
  return e;
}

const f = (v) => {
  const s = v.toFixed(5);
  return s.includes('.') ? s : s + '.0';
};

export function wavesGLSL(swell, detail) {
  let s = `
float swellWave(vec2 p, float t, out vec2 slope, out vec2 disp){
  float e = 0.0; slope = vec2(0.0); disp = vec2(0.0); float th; float c;
`;
  for (const w of swell) {
    s += `  th = dot(p, vec2(${f(w.dx)}, ${f(w.dz)})) * ${f(w.k)} - ${f(w.om)} * t + ${f(w.ph)}; c = cos(th);
  e += ${f(w.A)} * sin(th); slope += vec2(${f(w.dx * w.k * w.A)}, ${f(w.dz * w.k * w.A)}) * c; disp += vec2(${f(w.dx * w.A)}, ${f(w.dz * w.A)}) * c;
`;
  }
  s += `  return e;
}
vec2 detailSlope(vec2 p, float t, float dist){
  vec2 sl = vec2(0.0); float th;
`;
  for (const w of detail) {
    s += `  th = dot(p, vec2(${f(w.dx)}, ${f(w.dz)})) * ${f(w.k)} - ${f(w.om)} * t + ${f(w.ph)};
  sl += vec2(${f(w.dx * w.k * w.A)}, ${f(w.dz * w.k * w.A)}) * cos(th) * exp(-dist * ${f(w.k * 0.006)});
`;
  }
  s += `  return sl;
}
`;
  return s;
}
