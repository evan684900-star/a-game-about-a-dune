// Construction de la scène : ciel, sable, eau, océan en tuiles, parasol.
import * as THREE from '../vendor/three.module.min.js';
import { wavesGLSL } from './waves.js';
import { SKY_VERT, SKY_FRAG, SAND_VERT, SAND_FRAG, waterVert, waterFrag } from './shaders.js';
import { ShadowMap, SHADOW_K } from './shadow.js';

function gridGeometry(N, L) {
  const pos = new Float32Array(N * N * 3);
  const uv = new Float32Array(N * N * 2);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const i = x + z * N;
      pos[i * 3] = (x / (N - 1) - 0.5) * L;
      pos[i * 3 + 2] = (z / (N - 1) - 0.5) * L;
      uv[i * 2] = (x + 0.5) / N;
      uv[i * 2 + 1] = (z + 0.5) / N;
    }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let z = 0; z < N - 1; z++)
    for (let x = 0; x < N - 1; x++) {
      const a = x + z * N,
        b = a + 1,
        c = a + N,
        d = c + 1;
      // diagonale alternée : évite les artefacts directionnels
      if ((x + z) & 1) {
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      } else {
        idx[k++] = a; idx[k++] = c; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = b;
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function buildParasol() {
  const g = new THREE.Group();
  const tilt = new THREE.Group(); // inclinaison statique + oscillation
  g.add(tilt);
  const wood = new THREE.MeshStandardMaterial({ color: 0xd9c7a3, roughness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.75, 12), wood);
  pole.position.y = 2.75 / 2 - 0.45;
  tilt.add(pole);
  // toile : cône à 8 pans rayés
  const R = 1.4,
    H = 0.42,
    SEG = 8,
    SUB = 6;
  const pos = [],
    col = [];
  const cA = new THREE.Color(0xd8322a),
    cB = new THREE.Color(0xf6efe2);
  const apex = [0, H, 0];
  for (let s = 0; s < SEG; s++) {
    const c = s % 2 ? cB : cA;
    for (let k = 0; k < SUB; k++) {
      const a0 = ((s + k / SUB) / SEG) * Math.PI * 2,
        a1 = ((s + (k + 1) / SUB) / SEG) * Math.PI * 2;
      // bord festonné : les baleines tirent la toile
      const sag = (t) => 1 - 0.035 * Math.sin(Math.PI * t);
      const r0 = R * sag(k / SUB),
        r1 = R * sag((k + 1) / SUB);
      pos.push(...apex, Math.cos(a1) * r1, 0, Math.sin(a1) * r1, Math.cos(a0) * r0, 0, Math.sin(a0) * r0);
      for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  cg.computeVertexNormals();
  const canopy = new THREE.Mesh(
    cg,
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 })
  );
  canopy.position.y = 1.95;
  tilt.add(canopy);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), wood);
  tip.position.y = 1.95 + H + 0.02;
  tilt.add(tip);
  // baleines
  const ribM = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.6 });
  for (let s = 0; s < SEG; s++) {
    const a = (s / SEG) * Math.PI * 2;
    const len = Math.hypot(R, H);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 5), ribM);
    rib.position.set((Math.cos(a) * R) / 2, 1.95 + H / 2 - 0.012, (Math.sin(a) * R) / 2);
    rib.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-Math.cos(a) * R, H, -Math.sin(a) * R).normalize()
    );
    tilt.add(rib);
  }
  return { group: g, tilt, R, rimY: 1.95 };
}

export function createWorld(renderer, sim, swell, detail, quality) {
  const { N, L, dx, h0 } = sim;
  const scene = new THREE.Scene();
  const sunDir = new THREE.Vector3(0.52, 0.72, 0.46).normalize();

  // lue aux centres des texels par les vertex shaders : pas besoin de filtrage
  const dataTex = new THREE.DataTexture(sim.tex, N, N, THREE.RGBAFormat, THREE.FloatType);
  dataTex.minFilter = dataTex.magFilter = THREE.NearestFilter;
  dataTex.wrapS = dataTex.wrapT = THREE.ClampToEdgeWrapping;
  dataTex.needsUpdate = true;

  // ombres du relief : texture 8 bits, filtrable sur tous les appareils
  const shadowMap = new ShadowMap(sim);
  const shadowTex = new THREE.DataTexture(shadowMap.tex, shadowMap.M, shadowMap.M, THREE.RGFormat, THREE.UnsignedByteType);
  shadowTex.minFilter = shadowTex.magFilter = THREE.LinearFilter;
  shadowTex.wrapS = shadowTex.wrapT = THREE.ClampToEdgeWrapping;
  shadowTex.unpackAlignment = 1;
  const K = SHADOW_K.toFixed(4);
  let shadowDirty = true,
    shadowBusy = false;
  const shadowRows = Math.ceil(shadowMap.M / 4);

  const U = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir },
    uPC: { value: new THREE.Vector3() },
    uPN: { value: new THREE.Vector3(0, 1, 0) },
    uPR: { value: 1.4 },
    uPB: { value: new THREE.Vector3() },
    uToolA: { value: new THREE.Vector4(0, 0, 0, 0) },
    uToolB: { value: new THREE.Vector3() },
    uTool2: { value: new THREE.Vector4(0, 0, 0, 0) },
    uShadow: { value: null },
    uShadowDrop: { value: 0.1 },
    uShadowTexel: { value: 1 / shadowMap.M },
    uSunCol: { value: new THREE.Vector3() },
    uSkyAmb: { value: new THREE.Vector3() },
    uGndAmb: { value: new THREE.Vector3() },
    uZen: { value: new THREE.Vector3() },
    uHor: { value: new THREE.Vector3() },
    uHor2: { value: new THREE.Vector3() },
    uCloudDark: { value: new THREE.Vector3() },
    uCloudLit: { value: new THREE.Vector3() },
    uGlow: { value: new THREE.Vector2() },
    uWind: { value: 0.2 },
    uData: { value: dataTex },
    uL: { value: L },
    uTexel: { value: 1 / N },
    uDx: { value: dx },
    uH0: { value: h0 },
    uSwell: { value: 1 },
    uCursor: { value: new THREE.Vector4(0, 0, 0.3, 0) },
    uScene: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  U.uShadow.value = shadowTex;

  // ciel
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // sable
  const grid = gridGeometry(N, L);
  const sand = new THREE.Mesh(
    grid,
    new THREE.ShaderMaterial({ uniforms: U, vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, defines: { SHADOW_K: K } })
  );
  sand.frustumCulled = false;
  scene.add(sand);

  // fond marin au-delà de la zone simulée
  const bedGeo = new THREE.PlaneGeometry(180, 180, 1, 1).rotateX(-Math.PI / 2);
  const seabed = new THREE.Mesh(
    bedGeo,
    new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: SAND_VERT,
      fragmentShader: SAND_FRAG,
      defines: { SHADOW_K: K, FLAT: 1 },
    })
  );
  seabed.position.y = -h0 - 0.004;
  scene.add(seabed);

  // eau
  const wg = wavesGLSL(swell, detail);
  const waterMat = (defines) =>
    new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: waterVert(wg),
      fragmentShader: waterFrag(wg),
      defines: { SHADOW_K: K, ...defines },
    });
  const water = [];
  const simWater = new THREE.Mesh(grid, waterMat({ SIM: 1 }));
  simWater.frustumCulled = false;
  scene.add(simWater);
  water.push(simWater);

  // océan : tuiles indépendantes → celles hors champ sont éliminées
  // (frustum culling), seule la partie visible est calculée.
  const RINGS = 3;
  const seg = quality === 'low' ? 40 : 64;
  const tileGeo = new THREE.PlaneGeometry(L, L, seg, seg).rotateX(-Math.PI / 2);
  tileGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), L * 0.75);
  const oceanMat = waterMat({ OCEAN: 1 });
  for (let tz = -RINGS; tz <= RINGS; tz++)
    for (let tx = -RINGS; tx <= RINGS; tx++) {
      if (tx === 0 && tz === 0) continue;
      const m = new THREE.Mesh(tileGeo, oceanMat);
      m.position.set(tx * L, 0, tz * L);
      scene.add(m);
      water.push(m);
    }
  const inner = (RINGS + 0.5) * L;
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2),
    waterMat({ FAR: 1, FAR_INNER: (inner - 0.1).toFixed(2) })
  );
  scene.add(far);
  water.push(far);

  // lumières pour les objets (parasol, outils)
  const dl = new THREE.DirectionalLight(0xffffff, 9.5);
  scene.add(dl);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 3.0);
  scene.add(hemi);

  // ---------- heure du jour ----------
  // Course du soleil de 6 h à 20 h ; couleurs interpolées entre une palette
  // de soleil rasant et une palette de plein jour.
  const PAL = {
    uSunCol: [[1.9, 0.76, 0.27], [3.2, 2.98, 2.56]],
    uSkyAmb: [[0.165, 0.154, 0.231], [0.342, 0.475, 0.703]],
    uGndAmb: [[0.092, 0.057, 0.04], [0.2, 0.168, 0.12]],
    uZen: [[0.07, 0.11, 0.3], [0.1, 0.27, 0.62]],
    uHor: [[0.95, 0.5, 0.22], [0.56, 0.72, 0.88]],
    uHor2: [[0.36, 0.34, 0.5], [0.56, 0.72, 0.88]],
    uCloudDark: [[0.36, 0.29, 0.38], [0.8, 0.85, 0.93]],
    uCloudLit: [[1.45, 0.7, 0.36], [1.25, 1.2, 1.12]],
  };
  const sstep = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const light = new THREE.Vector3(1, 1, 1); // éclairement moyen (particules)
  function setTimeOfDay(hour) {
    const t = Math.min(1, Math.max(0, (hour - 6) / 14));
    const el = Math.max(0.035, 1.08 * Math.pow(Math.sin(Math.PI * t), 0.9));
    const az = 0.1 + (t - 0.5) * 3.5;
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const d = sstep(0.02, 0.5, sunDir.y);
    for (const key in PAL) {
      const [a, b] = PAL[key];
      U[key].value.set(a[0] + (b[0] - a[0]) * d, a[1] + (b[1] - a[1]) * d, a[2] + (b[2] - a[2]) * d);
    }
    // le soleil s'éteint en touchant l'horizon
    U.uSunCol.value.multiplyScalar(0.2 + 0.8 * sstep(0.03, 0.12, sunDir.y));
    U.uGlow.value.set(0.55 + (0.1 - 0.55) * d, 0.9 + (0.3 - 0.9) * d);
    const sc = U.uSunCol.value,
      sa = U.uSkyAmb.value,
      ga = U.uGndAmb.value;
    const ms = Math.max(sc.x, sc.y, sc.z),
      ma = Math.max(sa.x, sa.y, sa.z);
    dl.color.setRGB(sc.x / ms, sc.y / ms, sc.z / ms);
    dl.intensity = ms * Math.PI * 0.95;
    dl.position.copy(sunDir).multiplyScalar(10);
    hemi.color.setRGB(sa.x / ma, sa.y / ma, sa.z / ma);
    hemi.groundColor.setRGB(ga.x / ma, ga.y / ma, ga.z / ma);
    hemi.intensity = ma * Math.PI;
    const nl = 0.25 + 0.4 * sunDir.y;
    light.set(sc.x * nl + sa.x * 0.8, sc.y * nl + sa.y * 0.8, sc.z * nl + sa.z * 0.8);
    sim.sun = Math.max(0.04, sunDir.y) / 0.8; // l'évaporation suit la hauteur du soleil
    shadowDirty = true;
  }
  setTimeOfDay(15.5);

  // parasol
  const parasol = buildParasol();
  const PX = 3.3,
    PZ = 1.6;
  parasol.group.position.set(PX, 0, PZ);
  scene.add(parasol.group);
  const sway = { ax: 0, az: 0, vx: 0, vz: 0, lx: 0.08, lz: -0.06 };
  const state = { gust: 0.5 };
  const tmp = new THREE.Vector3();

  function update(dt, time) {
    U.uTime.value = time;
    U.uSwell.value = sim.swell;
    U.uWind.value = Math.min(1, sim.wind / 15);
    dataTex.needsUpdate = true;
    // ombres : calcul étalé sur 4 images ; immédiat quand le soleil bouge
    if (shadowDirty) {
      shadowMap.update(sunDir);
      shadowDirty = false;
      shadowBusy = false;
      U.uShadowDrop.value = shadowMap.drop;
      shadowTex.needsUpdate = true;
    } else {
      if (!shadowBusy) {
        shadowMap.begin(sunDir);
        shadowBusy = true;
      }
      if (shadowMap.step(shadowRows)) {
        shadowBusy = false;
        U.uShadowDrop.value = shadowMap.drop;
        shadowTex.needsUpdate = true;
      }
    }

    // parasol : le pied suit le sable, la toile oscille au vent comme un
    // pendule amorti  θ'' = -ω0²·θ - 2ζω0·θ' + F(t)
    const gy = sim.heightAt(PX, PZ);
    parasol.group.position.y += (gy - parasol.group.position.y) * Math.min(1, dt * 8);
    const e = 0.25;
    const gxs = (sim.heightAt(PX + e, PZ) - sim.heightAt(PX - e, PZ)) / (2 * e);
    const gzs = (sim.heightAt(PX, PZ + e) - sim.heightAt(PX, PZ - e)) / (2 * e);
    sway.lx += (THREE.MathUtils.clamp(0.08 - gxs * 0.5, -0.45, 0.45) - sway.lx) * Math.min(1, dt * 1.5);
    sway.lz += (THREE.MathUtils.clamp(-0.06 - gzs * 0.5, -0.45, 0.45) - sway.lz) * Math.min(1, dt * 1.5);
    const gust = 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.83 + 1.3);
    // poussée du vent ∝ U² (pression dynamique ½·ρ·U²)
    const push = Math.min(9, (sim.wind / 3.5) * (sim.wind / 3.5));
    const fx = (0.25 + 0.75 * gust) * (0.5 + 0.5 * Math.sin(time * 2.9) * Math.sin(time * 1.3)) * 0.22 * push;
    const fz = gust * Math.sin(time * 2.1 + 0.7) * 0.1 * Math.min(3, push);
    state.gust = gust;
    const w0 = 3.2,
      zeta = 0.22;
    sway.vx += (-w0 * w0 * sway.ax - 2 * zeta * w0 * sway.vx + fx * w0 * w0) * dt;
    sway.vz += (-w0 * w0 * sway.az - 2 * zeta * w0 * sway.vz + fz * w0 * w0) * dt;
    sway.ax += sway.vx * dt;
    sway.az += sway.vz * dt;
    parasol.tilt.rotation.set(sway.lz + sway.az * 0.12, 0, -(sway.lx + sway.ax * 0.12));
    parasol.group.updateMatrixWorld(true);
    U.uPB.value.setFromMatrixPosition(parasol.tilt.matrixWorld);
    U.uPC.value.set(0, parasol.rimY, 0).applyMatrix4(parasol.tilt.matrixWorld);
    U.uPN.value.set(0, 1, 0).transformDirection(parasol.tilt.matrixWorld);
    // zone d'ombre au sol (évaporation ralentie)
    const c = U.uPC.value;
    const t = (c.y - gy) / sunDir.y;
    tmp.copy(c).addScaledVector(sunDir, -t);
    sim.shade.x = tmp.x;
    sim.shade.z = tmp.z;
    sim.shade.r2 = parasol.R * parasol.R;
  }

  return { scene, U, water, sky, sunDir, update, setTimeOfDay, light, state, parasolPos: { x: PX, z: PZ } };
}
