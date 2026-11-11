// Outils : pelle, truelle, main, seau, moules, arrosoir, tuyau.
// Modèles 3D + logique d'interaction.
import * as THREE from '../vendor/three.module.min.js';

const SHOVEL_R = 0.3;
const SHOVEL_DEPTH = 0.13;
const BUCKET_R = 0.33; // rayon de l'ouverture
const BUCKET_RB = 0.25; // rayon du fond
const BUCKET_H = 0.42;
const BUCKET_VOL = ((Math.PI * BUCKET_H) / 3) * (BUCKET_R * BUCKET_R + BUCKET_R * BUCKET_RB + BUCKET_RB * BUCKET_RB);
const WATER_RATE = 0.012; // m³/s
const SAND_P = 1.2e-4; // volume d'une particule de sable
const WATER_P = 6e-5;
const TROWEL_R = 0.15;
const TROWEL_CAP = 0.012; // m³ portés avant de rejeter le sable sur le côté
const HAND_R = 0.3;
const HOSE_RATE = 0.035; // m³/s
const HOSE_P = 1.5e-4;
const HOSE_SPEED = 6; // m/s en sortie de lance

const SAND_DRY = new THREE.Color(0xdcb87a);
const SAND_WET = new THREE.Color(0x7a5f3c);
const WATER_COL = new THREE.Color(0x3fb6c9);

const damp = (cur, tgt, k, dt) => cur + (tgt - cur) * (1 - Math.exp(-k * dt));

function buildShovel() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const metal = new THREE.MeshStandardMaterial({ color: 0xaab2bb, roughness: 0.35, metalness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb07a43, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8322a, roughness: 0.5 });
  // lame légèrement galbée, pointe arrondie
  const bg = new THREE.PlaneGeometry(0.27, 0.32, 8, 8);
  const p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    const t = (0.16 - y) / 0.32; // 0 en haut, 1 à la pointe
    const taper = 1 - 0.55 * t * t * t;
    p.setX(i, x * taper);
    p.setZ(i, -(x * x) * 2.2 + t * 0.02);
    p.setY(i, y + 0.16 + (1 - Math.cos((x / 0.135) * 1.2)) * 0.03 * t);
  }
  bg.computeVertexNormals();
  const blade = new THREE.Mesh(bg, metal);
  blade.material.side = THREE.DoubleSide;
  g.add(blade);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.14, 10), metal);
  socket.position.set(0, 0.36, 0.0);
  g.add(socket);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.85, 10), wood);
  handle.position.set(0, 0.8, 0);
  g.add(handle);
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20), red);
  grip.position.set(0, 1.28, 0);
  g.add(grip);
  const sandMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1 });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), sandMat);
  mound.scale.set(0.95, 1.1, 0.42);
  mound.position.set(0, 0.17, -0.035);
  mound.visible = false;
  g.add(mound);
  return { group: g, mound, sandMat };
}

function buildBucket() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const h = BUCKET_H / 2;
  const pts = [
    [0, -h],
    [BUCKET_RB, -h],
    [BUCKET_R, h],
    [BUCKET_R + 0.018, h],
    [BUCKET_R + 0.018, h + 0.016],
    [BUCKET_R - 0.014, h + 0.016],
    [BUCKET_RB - 0.012, -h + 0.014],
    [0, -h + 0.014],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const plastic = new THREE.MeshStandardMaterial({ color: 0xf2b21c, roughness: 0.45, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 36), plastic));
  const hm = new THREE.MeshStandardMaterial({ color: 0x2a6fd6, roughness: 0.4 });
  const handle = new THREE.Mesh(new THREE.TorusGeometry(BUCKET_R + 0.012, 0.011, 6, 28, Math.PI), hm);
  handle.position.y = h - 0.01;
  handle.rotation.x = 0.5;
  g.add(handle);
  const contentMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1 });
  const content = new THREE.Mesh(new THREE.CircleGeometry(BUCKET_R - 0.03, 28).rotateX(-Math.PI / 2), contentMat);
  content.position.y = h - 0.045;
  content.visible = false;
  g.add(content);
  const rim = new THREE.Object3D();
  rim.position.set(0, h, BUCKET_R - 0.03);
  g.add(rim);
  return { group: g, content, contentMat, rim };
}

function buildCan() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const green = new THREE.MeshStandardMaterial({ color: 0x2f9e6b, roughness: 0.45, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.27, 24), green);
  g.add(body);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.42, 12), green);
  spout.position.set(0, 0.06, 0.29);
  spout.rotation.x = 0.95;
  g.add(spout);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.025, 0.05, 14), green);
  rose.position.set(0, 0.19, 0.47);
  rose.rotation.x = 0.95;
  g.add(rose);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.014, 8, 20, Math.PI * 1.1), green);
  handle.position.set(0, 0.03, -0.15);
  handle.rotation.set(0, Math.PI / 2, -Math.PI / 2 - 0.15);
  g.add(handle);
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0, 0.2, 0.5);
  g.add(nozzle);
  return { group: g, nozzle };
}

function buildTrowel() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a6fd6, roughness: 0.5 });
  // lame en pointe
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.quadraticCurveTo(0.075, 0.07, 0.06, 0.2);
  sh.lineTo(-0.06, 0.2);
  sh.quadraticCurveTo(-0.075, 0.07, 0, 0);
  const blade = new THREE.Mesh(new THREE.ShapeGeometry(sh, 8), metal);
  g.add(blade);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 8), metal);
  neck.position.set(0, 0.24, -0.02);
  neck.rotation.x = -0.4;
  g.add(neck);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.2, 10), wood);
  handle.position.set(0, 0.37, -0.04);
  g.add(handle);
  const sandMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1 });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), sandMat);
  mound.scale.set(1, 1.3, 0.4);
  mound.position.set(0, 0.11, -0.02);
  mound.visible = false;
  g.add(mound);
  return { group: g, mound, sandMat };
}

function buildHand() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0a57e, roughness: 0.75 });
  const box = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, 1), skin);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  box(0.17, 0.045, 0.17, 0, 0, 0); // paume
  for (let k = 0; k < 4; k++) box(0.036, 0.036, 0.15 - Math.abs(k - 1.5) * 0.018, -0.063 + k * 0.042, 0, 0.16); // doigts
  const thumb = box(0.04, 0.038, 0.11, 0.115, 0, 0.03);
  thumb.rotation.y = -0.6;
  const wrist = box(0.13, 0.05, 0.14, 0, 0.012, -0.15);
  wrist.rotation.x = -0.25;
  g.scale.setScalar(1.5);
  return { group: g };
}

function buildHose() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.3, metalness: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2f9e6b, roughness: 0.6 });
  // la lance pointe vers +Z local
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.034, 0.2, 12), brass);
  noz.rotation.x = Math.PI / 2;
  noz.position.z = 0.1;
  g.add(noz);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.14, 12), rubber);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.07;
  g.add(grip);
  // tuyau souple qui retombe derrière
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -0.14),
    new THREE.Vector3(0, -0.02, -0.4),
    new THREE.Vector3(0, -0.25, -0.75),
    new THREE.Vector3(0, -0.7, -1.0),
    new THREE.Vector3(0, -1.4, -1.15),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.026, 8), rubber));
  const tip = new THREE.Object3D();
  tip.position.z = 0.21;
  g.add(tip);
  return { group: g, tip };
}

// ---------- moules ----------
// shape(u, v) ∈ [0,1] : hauteur relative ; u suit la droite de l'écran.
const smoothEdge = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const MOLDS = [
  {
    name: 'Tour',
    R: 0.3,
    H: 0.6,
    color: 0xe5484d,
    shape: (u, v) => smoothEdge((0.3 - Math.hypot(u, v)) / 0.06),
  },
  {
    name: 'Mur',
    R: 0.6,
    H: 0.45,
    color: 0x3b82f6,
    shape: (u, v) => smoothEdge(Math.min((0.58 - Math.abs(u)) / 0.05, (0.17 - Math.abs(v)) / 0.05)),
  },
  {
    name: 'Pyramide',
    R: 0.72,
    H: 0.55,
    color: 0xf59e0b,
    shape: (u, v) => Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)) / 0.5),
  },
  {
    name: 'Dôme',
    R: 0.42,
    H: 0.42,
    color: 0x8b5cf6,
    shape: (u, v) => Math.sqrt(Math.max(0, 1 - (u * u + v * v) / (0.42 * 0.42))),
  },
  {
    name: 'Étoile',
    R: 0.56,
    H: 0.3,
    color: 0x10b981,
    shape: (u, v) => {
      const d = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      // rayon du contour : étoile à 5 branches
      const k = Math.abs(((((a / (Math.PI * 2)) * 5) % 1) + 1) % 1 - 0.5) * 2; // 0 à la pointe, 1 au creux
      const rs = 0.55 - 0.3 * k;
      return smoothEdge((rs - d) / 0.06);
    },
  },
];

function buildMold(def) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const { R, H, shape } = def;
  const G = 44;
  const pos = [],
    top = [];
  const P = (ix, iz) => {
    // repère local : u ↔ +Z (la droite de l'écran), v ↔ +X
    const v = (ix / G - 0.5) * 2 * R,
      u = (iz / G - 0.5) * 2 * R;
    return [v, u, shape(u, v)];
  };
  let vol = 0;
  const cell = ((2 * R) / G) ** 2;
  for (let iz = 0; iz < G; iz++)
    for (let ix = 0; ix < G; ix++) {
      const a = P(ix, iz),
        b = P(ix + 1, iz),
        c = P(ix, iz + 1),
        d = P(ix + 1, iz + 1);
      vol += ((a[2] + b[2] + c[2] + d[2]) / 4) * H * cell;
      for (const tri of [
        [a, c, b],
        [b, c, d],
      ]) {
        if (tri[0][2] + tri[1][2] + tri[2][2] <= 0) continue;
        // coque du moule, ouverture vers le haut
        for (const q of tri) pos.push(q[0], H / 2 - q[2] * H, q[1]);
        if (tri[0][2] > 0 && tri[1][2] > 0 && tri[2][2] > 0) for (const q of tri) top.push(q[0], H / 2 - 0.035, q[1]);
      }
    }
  def.vol = vol;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.45, side: THREE.DoubleSide })));
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  tg.computeVertexNormals();
  const contentMat = new THREE.MeshStandardMaterial({ color: SAND_DRY, roughness: 1, side: THREE.DoubleSide });
  const content = new THREE.Mesh(tg, contentMat);
  content.visible = false;
  g.add(content);
  return { group: g, content, contentMat, def };
}

const container = (o) => ({ ...o, kind: null, vol: 0, moist: 0, flip: 0, flipT: 0, h: 0.5, hT: 0.5, side: 0, sideT: 0, ax: 1, az: 0 });

export class Tools {
  constructor(scene, sim, particles) {
    this.sim = sim;
    this.particles = particles;
    this.current = 'shovel';
    this.cursor = null;
    this.anchor = new THREE.Vector3(0, 1, 0);
    this.busy = 0;
    this.events = [];
    this.emit = null;
    this.down = false;
    this.right = new THREE.Vector3(1, 0, 0);
    this.onEvent = () => {}; // (nom, donnée) : sons, sauvegarde
    this.time = 0;
    this.tick = 0;

    this.shovel = { ...buildShovel(), load: 0, moist: 0, lean: 0.6, leanT: 0.6, h: 0.35, hT: 0.35 };
    this.trowel = { ...buildTrowel(), load: 0, mo: 0, h: 0.2, hT: 0.2, lean: 0.9 };
    this.hand = { ...buildHand(), h: 0.25, press: 0 };
    this.bucket = container({
      ...buildBucket(),
      def: { name: 'Seau', R: BUCKET_R, H: BUCKET_H, vol: BUCKET_VOL, digR: 0.4, water: true },
    });
    this.molds = MOLDS.map((def) => container(buildMold(def)));
    this.moldIndex = 0;
    this.can = { ...buildCan(), tilt: 0, tiltT: 0, acc: 0 };
    this.hose = { ...buildHose(), acc: 0, on: 0 };
    this.groups = [this.shovel, this.trowel, this.hand, this.bucket, ...this.molds, this.can, this.hose];
    for (const t of this.groups) {
      t.group.visible = false;
      scene.add(t.group);
    }
    this.v = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
  }

  get mold() {
    return this.molds[this.moldIndex];
  }

  // change de forme de moule (impossible tant qu'il est plein)
  cycleMold() {
    if (this.busy > 0 || this.mold.kind) return false;
    this.moldIndex = (this.moldIndex + 1) % this.molds.length;
    return true;
  }

  setTool(name) {
    if (this.busy > 0) return false;
    this.current = name;
    this.down = false;
    return true;
  }

  active() {
    return {
      shovel: this.shovel,
      trowel: this.trowel,
      hand: this.hand,
      bucket: this.bucket,
      mold: this.mold,
      water: this.can,
      hose: this.hose,
    }[this.current];
  }

  get radius() {
    switch (this.current) {
      case 'shovel':
        return SHOVEL_R;
      case 'trowel':
        return TROWEL_R;
      case 'hand':
        return HAND_R;
      case 'bucket':
        return this.bucket.kind === 'sand' ? BUCKET_R : 0.4;
      case 'mold': {
        const d = this.mold.def;
        if (!this.mold.kind) return Math.sqrt((1.35 * d.vol * 2) / (Math.PI * 0.5));
        return d.R * (d.name === 'Pyramide' ? 0.72 : 1);
      }
      case 'water':
        return 0.2;
      case 'hose':
        return 0.15;
    }
    return 0;
  }

  activeGroup() {
    const t = this.active();
    return t && t.group.visible ? t.group : null;
  }

  // forme de l'ombre portée de l'outil tenu : une capsule [A,B] + une sphère
  shadowShape(A, B, S) {
    const g = this.activeGroup();
    if (!g) return false;
    g.updateMatrixWorld(true);
    const v = this.v;
    const put = (x, y, z) => g.localToWorld(v.set(x, y, z));
    S.w = 0;
    switch (this.current) {
      case 'shovel':
        put(0, 0.34, 0);
        A.set(v.x, v.y, v.z, 0.024);
        B.copy(put(0, 1.28, 0));
        put(0, 0.16, 0);
        S.set(v.x, v.y, v.z, this.shovel.load > 0 ? 0.14 : 0.115);
        break;
      case 'trowel':
        put(0, 0.22, -0.02);
        A.set(v.x, v.y, v.z, 0.02);
        B.copy(put(0, 0.46, -0.04));
        put(0, 0.11, 0);
        S.set(v.x, v.y, v.z, 0.07);
        break;
      case 'hand':
        put(0, 0, -0.15);
        A.set(v.x, v.y, v.z, 0.09);
        B.copy(put(0, 0, 0.15));
        break;
      case 'bucket':
        put(0, -0.07, 0);
        A.set(v.x, v.y, v.z, 0.27);
        B.copy(put(0, 0.07, 0));
        break;
      case 'mold': {
        const d = this.mold.def;
        const wall = d.name === 'Mur';
        const r = wall ? 0.2 : d.R * (d.name === 'Pyramide' ? 0.45 : d.name === 'Étoile' ? 0.6 : 0.85);
        const half = wall ? 0.42 : 0.02;
        put(0, 0, -half);
        A.set(v.x, v.y, v.z, r);
        B.copy(put(0, 0, half));
        break;
      }
      case 'water':
        put(0, 0.03, 0.15);
        A.set(v.x, v.y, v.z, 0.03);
        B.copy(put(0, 0.2, 0.5));
        put(0, 0, 0);
        S.set(v.x, v.y, v.z, 0.185);
        break;
      case 'hose':
        put(0, 0, -0.14);
        A.set(v.x, v.y, v.z, 0.035);
        B.copy(put(0, 0, 0.2));
        break;
      default:
        return false;
    }
    return true;
  }

  status() {
    const wet = (m) => (m > 0.25 ? (m > 0.85 ? 'détrempé' : 'humide') : 'sec');
    switch (this.current) {
      case 'shovel':
        return this.shovel.load > 0 ? 'Pelle chargée — clique pour verser le sable' : 'Pelle vide — clique pour creuser';
      case 'trowel':
        return 'Truelle — maintiens et glisse pour creuser fin ; le sable est rejeté sur le côté';
      case 'hand':
        return 'Main — maintiens et glisse pour lisser et tasser le sable';
      case 'bucket': {
        const b = this.bucket;
        if (b.kind === 'sand') return `Seau plein de sable ${wet(b.moist)} — clique pour démouler`;
        if (b.kind === 'water') return 'Seau plein d’eau — clique pour verser';
        return 'Seau vide — clique sur le sable ou dans l’eau pour le remplir';
      }
      case 'mold': {
        const b = this.mold;
        if (b.kind) return `Moule « ${b.def.name} » plein de sable ${wet(b.moist)} — clique pour démouler`;
        return `Moule « ${b.def.name} » vide — clique sur le sable pour le remplir ; reclique sur le bouton pour changer de forme`;
      }
      case 'water':
        return 'Arrosoir — maintiens appuyé pour verser';
      case 'hose':
        return 'Tuyau — maintiens appuyé : le jet creuse et emporte le sable';
    }
    return 'Caméra — glisse pour tourner, molette / pincement pour zoomer';
  }

  at(delay, fn) {
    this.events.push({ t: delay, fn });
  }

  // seau et moules : remplir, démouler, verser
  containerDown(b, c) {
    const sim = this.sim;
    const def = b.def;
    const setFill = () => {
      b.content.visible = !!b.kind;
      if (b === this.bucket) {
        b.content.scale.setScalar(0.75 + 0.25 * Math.min(1, b.vol / def.vol));
        b.content.position.y = def.H / 2 - 0.045 - 0.2 * (1 - Math.min(1, b.vol / def.vol));
      }
    };
    if (!b.kind) {
      const inWater = def.water && sim.waterAt(c.x, c.z) > 0.04;
      this.busy = 0.6;
      b.hT = def.H * 0.3;
      b.sideT = inWater ? 1.2 : 0.9;
      this.at(0.22, () => {
        if (inWater) {
          b.vol = sim.takeWater(c.x, c.z, 0.5, def.vol);
          this.onEvent('scoop', 1);
          b.kind = b.vol > 1e-3 ? 'water' : null;
          b.contentMat.color.copy(WATER_COL);
          b.contentMat.roughness = 0.1;
        } else {
          // cuvette assez grande pour remplir le moule : volume ≈ π·r²·h/2
          const digR = def.digR || Math.sqrt((1.35 * def.vol * 2) / (Math.PI * 0.5));
          const r = sim.dig(c.x, c.z, digR, 0.5, def.vol);
          this.onEvent('dig', r.moist);
          b.vol = r.vol;
          b.moist = r.moist;
          b.kind = r.vol > 1e-3 ? 'sand' : null;
          b.contentMat.color.copy(SAND_DRY).lerp(SAND_WET, Math.min(1, r.moist * 1.4));
          b.contentMat.roughness = 1;
        }
        setFill();
        b.hT = 0.5;
        b.sideT = 0;
      });
    } else if (b.kind === 'sand') {
      // retourner et démouler ; la forme garde l'orientation de l'écran
      this.busy = 1.0;
      b.flipT = 1;
      b.hT = def.H / 2 + 0.02;
      const ax = this.right.x,
        az = this.right.z;
      this.at(0.38, () => {
        if (b === this.bucket) sim.stamp(c.x, c.z, BUCKET_R, BUCKET_RB, BUCKET_H, b.vol, b.moist);
        else sim.stampShape(c.x, c.z, def.R, (u, v) => def.shape(-u, v), def.H, b.vol, b.moist, ax, az);
        this.onEvent('stamp', b.moist);
        b.kind = null;
        b.vol = 0;
        b.content.visible = false;
      });
      this.at(0.5, () => {
        b.hT = def.H + 0.35;
      });
      this.at(0.78, () => {
        b.flipT = 0;
        b.hT = 0.5;
      });
    } else {
      this.busy = 1.55;
      b.sideT = 1.75;
      this.at(0.2, () => {
        this.emit = { kind: 1, vol: b.vol, rate: b.vol / 1.0, moist: 1, src: b.rim, vel: [0.9, 0.1, 0], spread: 0.35, pv: b.vol / 480 };
      });
      this.at(1.25, () => {
        b.kind = null;
        b.vol = 0;
        b.content.visible = false;
        b.sideT = 0;
      });
    }
  }

  // la truelle rejette le sable qu'elle porte sur le côté
  flickTrowel() {
    const tr = this.trowel;
    if (tr.load <= 1e-6) return;
    const vol = tr.load;
    tr.load = 0;
    tr.mound.visible = false;
    this.emit = { kind: 0, vol, rate: vol / 0.12, moist: tr.mo, src: tr.mound, vel: [1.7, 1.5, 0], spread: 0.25, pv: 6e-5 };
  }

  onDown() {
    this.down = true;
    if (this.busy > 0 || !this.cursor) return;
    const c = this.cursor;
    const sim = this.sim;
    if (this.current === 'shovel') {
      const s = this.shovel;
      if (s.load <= 0) {
        this.busy = 0.5;
        s.hT = -0.2;
        s.leanT = 0.2;
        this.at(0.17, () => {
          const r = sim.dig(c.x, c.z, SHOVEL_R, SHOVEL_DEPTH);
          this.onEvent('dig', r.moist);
          s.load = r.vol;
          s.moist = r.moist;
          s.mound.visible = r.vol > 1e-4;
          s.sandMat.color.copy(SAND_DRY).lerp(SAND_WET, Math.min(1, r.moist * 1.4));
          s.hT = 0.35;
          s.leanT = r.vol > 1e-4 ? 1.2 : 0.6;
        });
      } else {
        this.busy = 0.75;
        s.leanT = -0.35;
        this.at(0.15, () => {
          this.emit = { kind: 0, vol: s.load, rate: s.load / 0.35, moist: s.moist, src: s.mound, vel: [0, 0.2, 0], spread: 0.5 };
        });
        this.at(0.5, () => {
          s.load = 0;
          s.mound.visible = false;
        });
        this.at(0.6, () => {
          s.leanT = 0.6;
        });
      }
    } else if (this.current === 'bucket') this.containerDown(this.bucket, c);
    else if (this.current === 'mold') this.containerDown(this.mold, c);
  }

  onUp() {
    this.down = false;
    if (this.current === 'trowel') this.flickTrowel();
  }

  update(dt, cursor, camRight) {
    const sim = this.sim;
    this.time += dt;
    // curseur limité à la zone jouable
    const lim = sim.L / 2 - 1.9;
    this.cursor = cursor && Math.abs(cursor.x) < lim && Math.abs(cursor.z) < lim ? cursor : null;
    this.right.copy(camRight);
    const yaw = Math.atan2(camRight.x, camRight.z);

    // chronologie des animations
    if (this.busy > 0) this.busy -= dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.events.splice(i, 1);
        e.fn();
      }
    }
    // l'outil suit le curseur (sauf pendant une action)
    if (this.cursor && this.busy <= 0) this.anchor.set(this.cursor.x, this.cursor.y, this.cursor.z);
    else if (this.busy > 0) this.anchor.y = sim.heightAt(this.anchor.x, this.anchor.z);
    const a = this.anchor;
    const show = this.current !== 'camera' && (this.cursor || this.busy > 0);
    const act = this.active();
    for (const t of this.groups) t.group.visible = !!show && t === act;
    const working = this.down && !!this.cursor && this.busy <= 0;
    this.tick -= dt;

    if (this.current === 'shovel') {
      const s = this.shovel;
      s.lean = damp(s.lean, s.leanT, 16, dt);
      s.h = damp(s.h, s.hT, 18, dt);
      s.group.rotation.set(s.lean, yaw, 0);
      // la pointe de la lame vise le curseur
      const back = s.lean > 0.9 ? 0.16 : 0;
      s.group.position.set(a.x - camRight.x * back, a.y + s.h, a.z - camRight.z * back);
    } else if (this.current === 'trowel') {
      const tr = this.trowel;
      if (working && dt > 0) {
        // creuse en continu une petite cuvette
        const r = sim.dig(a.x, a.z, TROWEL_R, 0.3 * dt, TROWEL_CAP - tr.load + 1e-6);
        if (r.vol > 0) {
          tr.mo = (tr.mo * tr.load + r.moist * r.vol) / (tr.load + r.vol);
          tr.load += r.vol;
          tr.mound.visible = true;
          tr.sandMat.color.copy(SAND_DRY).lerp(SAND_WET, Math.min(1, tr.mo * 1.4));
          if (this.tick <= 0) {
            this.tick = 0.28;
            this.onEvent('scrape', r.moist);
          }
        }
        if (tr.load >= TROWEL_CAP && !this.emit) this.flickTrowel();
      }
      tr.hT = working ? -0.04 : 0.2;
      tr.h = damp(tr.h, tr.hT, 18, dt);
      tr.lean = damp(tr.lean, working ? 0.55 + 0.12 * Math.sin(this.time * 14) : 0.9, 14, dt);
      tr.group.rotation.set(tr.lean, yaw, 0);
      tr.group.position.set(a.x, a.y + tr.h, a.z);
    } else if (this.current === 'hand') {
      const h = this.hand;
      // tapote : la main descend et remonte
      h.press = damp(h.press, working ? 0.5 + 0.5 * Math.sin(this.time * 16) : 0, 20, dt);
      if (working && dt > 0) {
        sim.pat(a.x, a.z, HAND_R, dt);
        if (this.tick <= 0) {
          this.tick = Math.PI / 8;
          this.onEvent('pat', sim.moistAt(a.x, a.z));
        }
      }
      h.h = damp(h.h, working ? 0.05 + 0.07 * (1 - h.press) : 0.25, 18, dt);
      h.group.rotation.set(0.12 - 0.1 * h.press, yaw + Math.PI / 2, 0);
      h.group.position.set(a.x, a.y + h.h, a.z);
    } else if (this.current === 'bucket' || this.current === 'mold') {
      const b = act;
      b.flip = damp(b.flip, b.flipT, 14, dt);
      b.side = damp(b.side, b.sideT, 12, dt);
      b.h = damp(b.h, b.hT, 16, dt);
      b.group.rotation.set(b.flip * Math.PI + b.side, yaw, 0);
      const off = b.kind === 'water' && b.sideT > 1.5 ? 0.45 : 0;
      b.group.position.set(a.x - camRight.x * off, a.y + b.h + (off ? 0.25 : 0), a.z - camRight.z * off);
    } else if (this.current === 'water') {
      const c = this.can;
      const pouring = this.down && !!this.cursor;
      c.tiltT = pouring ? 0.75 : 0.1;
      c.tilt = damp(c.tilt, c.tiltT, 10, dt);
      c.group.rotation.set(c.tilt, yaw, 0);
      c.group.position.set(a.x - camRight.x * 0.85, a.y + 0.8, a.z - camRight.z * 0.85);
      if (pouring && c.tilt > 0.45) {
        c.acc += WATER_RATE * dt;
        c.group.updateMatrixWorld(true);
        c.nozzle.getWorldPosition(this.v);
        while (c.acc >= WATER_P) {
          c.acc -= WATER_P;
          const j = () => (Math.random() - 0.5) * 0.35;
          const sp = 1.15 + Math.random() * 0.3;
          this.particles.spawn(1, this.v.x + j() * 0.1, this.v.y + j() * 0.1, this.v.z + j() * 0.1, camRight.x * sp + j(), -0.5 + j(), camRight.z * sp + j(), WATER_P, 1);
        }
      }
    } else if (this.current === 'hose') {
      const hs = this.hose;
      // la lance se tient à gauche du point visé et pointe dessus
      const px = a.x - camRight.x * 1.3,
        py = a.y + 0.75,
        pz = a.z - camRight.z * 1.3;
      hs.group.position.set(px, py, pz);
      // tir tendu : vitesse horizontale fixée, composante verticale telle que
      // la parabole (g = 9,81 m/s²) retombe sur le curseur
      const dxh = a.x - px,
        dzh = a.z - pz;
      const dh = Math.hypot(dxh, dzh);
      const tf = dh / HOSE_SPEED;
      const vy = (a.y - py + 0.5 * 9.81 * tf * tf) / tf;
      const vx = (dxh / dh) * HOSE_SPEED,
        vz = (dzh / dh) * HOSE_SPEED;
      hs.group.rotation.set(-Math.atan2(vy, HOSE_SPEED), Math.atan2(vx, vz), 0);
      hs.on = damp(hs.on, working ? 1 : 0, 12, dt);
      if (working) {
        hs.acc += HOSE_RATE * dt;
        hs.group.updateMatrixWorld(true);
        hs.tip.getWorldPosition(this.v);
        while (hs.acc >= HOSE_P) {
          hs.acc -= HOSE_P;
          const j = () => (Math.random() - 0.5) * 0.3;
          // réparties le long du trajet déjà parcouru pendant l'image
          const back = Math.random() * dt;
          this.particles.spawn(1, this.v.x + vx * back, this.v.y + vy * back, this.v.z + vz * back, vx + j(), vy + j(), vz + j(), HOSE_P, 1);
        }
      }
    }

    // émission progressive (pelle qui verse, seau qui se vide)
    const e = this.emit;
    if (e) {
      let out = Math.min(e.vol, e.rate * dt);
      e.vol -= out;
      const pv = e.pv || (e.kind === 0 ? SAND_P : WATER_P);
      e.src.getWorldPosition(this.v);
      e.acc = (e.acc || 0) + out;
      while (e.acc >= pv || (e.vol <= 1e-9 && e.acc > 1e-9)) {
        const vol = Math.min(pv, e.acc);
        e.acc -= vol;
        const j = () => (Math.random() - 0.5) * e.spread;
        this.particles.spawn(
          e.kind,
          this.v.x + j() * 0.3,
          this.v.y + j() * 0.15,
          this.v.z + j() * 0.3,
          camRight.x * e.vel[0] + j(),
          e.vel[1] + j() * 0.5,
          camRight.z * e.vel[0] + j(),
          vol,
          e.moist
        );
        if (e.acc <= 1e-9) break;
      }
      if (e.vol <= 1e-9 && e.acc <= 1e-9) this.emit = null;
    }
  }
}
